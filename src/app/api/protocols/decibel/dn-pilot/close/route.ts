import { NextRequest, NextResponse } from "next/server";
import { parseLiveFlag, verifyDnPilotAuth } from "@/app/api/protocols/decibel/dn-pilot/_auth";
import { runDnPilotClose } from "@/lib/protocols/decibel/dnMultiChain/pilotRunner";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/protocols/decibel/dn-pilot/close
 *
 * Closes GOLD DN pilot: Jupiter spot sell, then Decibel short close.
 * Default dry-run. Pass `{ "live": true }` or `?live=true` for real txs.
 */
export async function POST(request: NextRequest) {
  const authError = verifyDnPilotAuth(request);
  if (authError) return authError;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const live = parseLiveFlag(request, body);

  try {
    const result = await runDnPilotClose({ live });
    return NextResponse.json(createSuccessResponse(result));
  } catch (error) {
    console.error("[DN-Pilot] close error:", error);
    return NextResponse.json(
      createErrorResponse(error instanceof Error ? error : new Error("DN pilot close failed")),
      { status: 500 }
    );
  }
}
