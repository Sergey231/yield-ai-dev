import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";
import {
  DN_SPREAD_MONITOR_LOCK_KEY,
  runDnSpreadMonitorPass,
} from "@/lib/protocols/decibel/dnSpreadMonitor";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function getAcceptedCronSecrets(): string[] {
  const secrets = [process.env.YIELD_AI_CRON_SECRET, process.env.CRON_SECRET].filter(
    (value): value is string => Boolean(value?.trim())
  );
  return [...new Set(secrets)];
}

function verifyCronAuth(request: NextRequest): NextResponse | null {
  const acceptedSecrets = getAcceptedCronSecrets();
  const headerSecret = request.headers.get("x-cron-secret");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();

  if (acceptedSecrets.length === 0) {
    return NextResponse.json(
      createErrorResponse(
        new Error("YIELD_AI_CRON_SECRET (or CRON_SECRET) is not configured on the server")
      ),
      { status: 500 }
    );
  }

  const provided = headerSecret || bearer;
  if (!provided || !acceptedSecrets.includes(provided)) {
    return NextResponse.json(createErrorResponse(new Error("Unauthorized")), { status: 401 });
  }

  return null;
}

async function handleCron(request: NextRequest) {
  const authError = verifyCronAuth(request);
  if (authError) return authError;

  const g = globalThis as Record<string, unknown>;
  if (g[DN_SPREAD_MONITOR_LOCK_KEY]) {
    return NextResponse.json(
      createErrorResponse(new Error("DN spread monitor cron is already running")),
      { status: 429 }
    );
  }

  g[DN_SPREAD_MONITOR_LOCK_KEY] = true;

  try {
    const result = await runDnSpreadMonitorPass();
    return NextResponse.json(createSuccessResponse(result));
  } catch (error) {
    console.error("[DN-Monitor] cron error:", error);
    return NextResponse.json(
      createErrorResponse(error instanceof Error ? error : new Error("DN spread monitor failed")),
      { status: 500 }
    );
  } finally {
    g[DN_SPREAD_MONITOR_LOCK_KEY] = false;
  }
}

/**
 * GET/POST /api/protocols/decibel/dn-spread-monitor/cron
 *
 * Vercel Cron invokes GET with `Authorization: Bearer <CRON_SECRET>`.
 * Manual runs: POST/GET + header `x-cron-secret`.
 * Accepts either YIELD_AI_CRON_SECRET or CRON_SECRET when both are set.
 */
export async function GET(request: NextRequest) {
  return handleCron(request);
}

export async function POST(request: NextRequest) {
  return handleCron(request);
}
