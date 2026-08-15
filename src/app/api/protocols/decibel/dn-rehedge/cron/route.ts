import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse, parseOptionalNumber } from "@/lib/utils/http";
import {
  DN_REHEDGE_CRON_LOCK_KEY,
  runDnRehedgeCronPass,
} from "@/lib/protocols/decibel/dnRehedgeCron";

export const dynamic = "force-dynamic";
// Pro plan: an order + settle poll per cycle can take a while; allow up to 5 min.
export const maxDuration = 300;

function getAcceptedCronSecrets(): string[] {
  const secrets = [process.env.YIELD_AI_CRON_SECRET, process.env.CRON_SECRET].filter(
    (value): value is string => Boolean(value?.trim())
  );
  return [...new Set(secrets)];
}

function verifyCronAuth(request: NextRequest): NextResponse | null {
  const accepted = getAcceptedCronSecrets();
  if (accepted.length === 0) {
    return NextResponse.json(
      createErrorResponse(
        new Error("YIELD_AI_CRON_SECRET (or CRON_SECRET) is not configured on the server")
      ),
      { status: 500 }
    );
  }
  const headerSecret = request.headers.get("x-cron-secret");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const provided = headerSecret || bearer;
  if (!provided || !accepted.includes(provided)) {
    return NextResponse.json(createErrorResponse(new Error("Unauthorized")), { status: 401 });
  }
  return null;
}

const num = parseOptionalNumber;

type DnRehedgeOptions = {
  dryRun: boolean;
  bandBps?: number;
  marginBufferPct?: number;
  maxActionsPerRun?: number;
  safeAddresses?: string[];
};

async function runAndLog(opts: DnRehedgeOptions) {
  const result = await runDnRehedgeCronPass({
    dryRun: opts.dryRun,
    bandBps: opts.bandBps,
    marginBufferPct: opts.marginBufferPct,
    maxActionsPerRun: opts.maxActionsPerRun,
    safeAddresses: opts.safeAddresses,
  });
  console.log(
    `[DN-Rehedge] summary t=${new Date().toISOString()} dryRun=${opts.dryRun} ` +
      `safes=${result.safesProcessed} cycles=${result.cyclesProcessed} acted=${result.actedCycles}`
  );
  for (const r of result.results) {
    console.log(
      `[DN-Rehedge] safe=${r.safeAddress} cycle=${r.cycleId} action=${r.action ?? (r.error ? "error" : "?")} ` +
        `target=${r.targetAptHuman ?? "?"} short=${r.currentShortHuman ?? "?"} delta=${r.deltaApt ?? "?"} ` +
        `adj=${r.adjustedApt ?? "?"} ${r.note ? `note="${r.note}" ` : ""}${r.error ? `error="${r.error}"` : ""}`
    );
  }
  return result;
}

async function handle(request: NextRequest, opts: DnRehedgeOptions) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const g = globalThis as Record<string, unknown>;
  if (g[DN_REHEDGE_CRON_LOCK_KEY]) {
    return NextResponse.json(
      createErrorResponse(new Error("DN rehedge cron is already running")),
      { status: 429 }
    );
  }
  g[DN_REHEDGE_CRON_LOCK_KEY] = true;
  try {
    const result = await runAndLog(opts);
    return NextResponse.json(createSuccessResponse(result));
  } catch (err) {
    console.error("[DN-Rehedge] cron error:", err);
    return NextResponse.json(
      createErrorResponse(err instanceof Error ? err : new Error(String(err))),
      { status: 500 }
    );
  } finally {
    g[DN_REHEDGE_CRON_LOCK_KEY] = false;
  }
}

/**
 * GET /api/protocols/decibel/dn-rehedge/cron — Vercel Cron entrypoint.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET|YIELD_AI_CRON_SECRET>` or header `x-cron-secret`.
 * Query: dryRun (default TRUE — observe-only; resizes only with `?dryRun=false`), bandBps,
 * marginBufferPct, maxActionsPerRun. Default is observe-only so wiring the schedule never trades.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  return handle(request, {
    dryRun: sp.get("dryRun") !== "false",
    bandBps: num(sp.get("bandBps")),
    marginBufferPct: num(sp.get("marginBufferPct")),
    maxActionsPerRun: num(sp.get("maxActionsPerRun")),
  });
}

/**
 * POST /api/protocols/decibel/dn-rehedge/cron — manual runs.
 * Body: { dryRun?, bandBps?, marginBufferPct?, maxActionsPerRun?, safeAddresses? }. dryRun
 * defaults TRUE — pass `dryRun: false` to actually resize the short.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  return handle(request, {
    dryRun: body.dryRun !== false,
    bandBps: num(body.bandBps),
    marginBufferPct: num(body.marginBufferPct),
    maxActionsPerRun: num(body.maxActionsPerRun),
    safeAddresses: Array.isArray(body.safeAddresses) ? (body.safeAddresses as string[]) : undefined,
  });
}
