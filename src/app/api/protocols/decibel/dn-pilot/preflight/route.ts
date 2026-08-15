import { NextRequest, NextResponse } from "next/server";
import { verifyDnPilotAuth } from "@/app/api/protocols/decibel/dn-pilot/_auth";
import { runDnPilotPreflight } from "@/lib/protocols/decibel/dnMultiChain/pilotRunner";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET/POST /api/protocols/decibel/dn-pilot/preflight
 *
 * Secret-gated balance/signal/delegation check for the GOLD DN pilot.
 * Auth: `x-cron-secret` or `Authorization: Bearer <YIELD_AI_CRON_SECRET|CRON_SECRET>`.
 */
async function handle(request: NextRequest) {
  const authError = verifyDnPilotAuth(request);
  if (authError) return authError;

  try {
    const result = await runDnPilotPreflight();
    return NextResponse.json(createSuccessResponse(result));
  } catch (error) {
    console.error("[DN-Pilot] preflight error:", error);
    return NextResponse.json(
      createErrorResponse(error instanceof Error ? error : new Error("DN pilot preflight failed")),
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
