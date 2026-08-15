import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse, parseOptionalNumber } from "@/lib/utils/http";
import {
  HYPERION_LP_CRON_LOCK_KEY,
  resolveDnLpSafes,
  runHyperionLpCronPass,
} from "@/lib/protocols/yield-ai/hyperionLpCron";

export const dynamic = "force-dynamic";
// Pro plan: claim + reward-swap can take a while across safes; allow up to 5 min.
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

type DnAutoclaimOptions = {
  dryRun: boolean;
  minClaimUsd?: number;
  maxActionsPerRun?: number;
  /** Manual override; otherwise discovered via `resolveDnLpSafes`. */
  safeAddresses?: string[];
};

/**
 * Harvest pass over DN-LP safes: claim fees + farm rewards above the USD threshold (default
 * $0.1, perf cut applied) and swap claimed APT rewards → USDC. Claimed funds stay in the safe
 * as a stable buffer — NO reinvest into LP, NO compounding (re-deploy is a deliberate manual
 * batch action because it would resize the LP leg and require a rehedge). Reuses the Hyperion
 * LP cron pass + lock so it never overlaps the hourly LP claim / recenter crons on a safe.
 */
async function runDnAutoclaim(opts: DnAutoclaimOptions) {
  const safeAddresses =
    opts.safeAddresses && opts.safeAddresses.length > 0
      ? opts.safeAddresses
      : await resolveDnLpSafes();

  const result = await runHyperionLpCronPass({
    action: "claim",
    dryRun: opts.dryRun,
    safeAddresses,
    minClaimUsd: opts.minClaimUsd, // undefined → DEFAULT_AUTO_CLAIM_MIN_USD ($0.1)
    swapRewardsToUsdc: true,
    // DN-only policy: the strategy enters and exits in USDC, so claimed VOLATILE fee legs
    // (WBTC/APT) are swept → USDC too. Plain-LP autoclaim (hyperion-lp/cron) keeps fees as-is.
    convertFeesToUsdc: true,
    maxActionsPerRun: opts.maxActionsPerRun,
  });

  console.log(
    `[DN-Autoclaim] summary t=${new Date().toISOString()} dryRun=${opts.dryRun} ` +
      `safes=${result.safesProcessed} acted=${result.actedPositions}`
  );
  for (const safe of result.results) {
    const positions = (safe as { positions?: Array<Record<string, unknown>> }).positions;
    if (Array.isArray(positions)) {
      for (const p of positions) {
        console.log(
          `[DN-Autoclaim] safe=${safe.safeAddress} pos=${p.position ?? "?"} ` +
            `action=${p.action ?? "?"} feesUsd=${p.feesUsd ?? "?"} rewardsUsd=${p.rewardsUsd ?? "?"} ` +
            `claimFees=${p.claimFeesHash ?? "-"} claimRewards=${p.claimRewardsHash ?? "-"}`
        );
      }
    } else if (safe.error) {
      console.log(`[DN-Autoclaim] safe=${safe.safeAddress} error=${safe.error}`);
    }
  }
  return result;
}

async function handle(request: NextRequest, opts: DnAutoclaimOptions) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const g = globalThis as Record<string, unknown>;
  if (g[HYPERION_LP_CRON_LOCK_KEY]) {
    return NextResponse.json(
      createErrorResponse(new Error("Hyperion LP cron is already running")),
      { status: 429 }
    );
  }
  g[HYPERION_LP_CRON_LOCK_KEY] = true;
  try {
    const result = await runDnAutoclaim(opts);
    return NextResponse.json(createSuccessResponse(result));
  } catch (err) {
    console.error("[DN-Autoclaim] cron error:", err);
    return NextResponse.json(
      createErrorResponse(err instanceof Error ? err : new Error(String(err))),
      { status: 500 }
    );
  } finally {
    g[HYPERION_LP_CRON_LOCK_KEY] = false;
  }
}

/**
 * GET /api/protocols/decibel/dn-autoclaim/cron — Vercel Cron entrypoint.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET|YIELD_AI_CRON_SECRET>` or header `x-cron-secret`.
 * Query: dryRun (default TRUE — observe-only; claims only with `?dryRun=false`), minClaimUsd,
 * maxActionsPerRun. Default is observe-only so wiring the schedule never claims until enabled.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  return handle(request, {
    dryRun: sp.get("dryRun") !== "false",
    minClaimUsd: num(sp.get("minClaimUsd")),
    maxActionsPerRun: num(sp.get("maxActionsPerRun")),
  });
}

/**
 * POST /api/protocols/decibel/dn-autoclaim/cron — manual runs.
 * Body: { dryRun?, minClaimUsd?, maxActionsPerRun?, safeAddresses? }. dryRun defaults TRUE —
 * pass `dryRun: false` to actually claim.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  return handle(request, {
    dryRun: body.dryRun !== false,
    minClaimUsd: num(body.minClaimUsd),
    maxActionsPerRun: num(body.maxActionsPerRun),
    safeAddresses: Array.isArray(body.safeAddresses) ? (body.safeAddresses as string[]) : undefined,
  });
}
