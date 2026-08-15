import { NextRequest, NextResponse } from "next/server";
import {
  parseLiveFlag,
  parseSkipSignal,
  verifyDnPilotAuth,
} from "@/app/api/protocols/decibel/dn-pilot/_auth";
import { runDnPilotOpen } from "@/lib/protocols/decibel/dnMultiChain/pilotRunner";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/protocols/decibel/dn-pilot/open
 *
 * Opens GOLD DN pilot: Decibel short first, then Jupiter spot buy.
 * Default dry-run. Pass `{ "live": true }` or `?live=true` for real txs.
 * Optional `{ "skipSignal": true }` to bypass net-edge gate.
 * Optional `{ "spotOnly": true }` to buy Jupiter spot for an existing Decibel short (recovery).
 */
export async function POST(request: NextRequest) {
  const authError = verifyDnPilotAuth(request);
  if (authError) return authError;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const live = parseLiveFlag(request, body);
  const skipSignal = parseSkipSignal(body);
  const spotOnly = body.spotOnly === true;

  try {
    const result = await runDnPilotOpen({ live, skipSignal, spotOnly });
    return NextResponse.json(createSuccessResponse(result));
  } catch (error) {
    console.error("[DN-Pilot] open error:", error);
    const message = error instanceof Error ? error.message : "DN pilot open failed";
    const status =
      message.includes("Signal blocked") || message.includes("pubkey mismatch") ? 422 : 500;
    return NextResponse.json(createErrorResponse(error instanceof Error ? error : new Error(message)), {
      status,
    });
  }
}
