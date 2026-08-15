import { NextRequest, NextResponse } from "next/server";
import { rehedgeLpDeltaNeutral } from "@/lib/protocols/decibel/lpDeltaNeutralRehedge";
import { ManageAuthError } from "@/lib/protocols/yield-ai/manageAuthServer";

/**
 * POST /api/protocols/decibel/executor-rehedge-delta-neutral
 *
 * Resizes ONLY the Decibel perp short of an LP-hedge cycle to track the LP's live APT amount
 * (no safe swap — that belongs to close/re-range). Body:
 *   { owner, safeAddress, subaccount, cycleId, bandBps?, dryRun?, auth }
 *
 * Manage-auth: client signs action "decibel_dn_rehedge" with fields
 *   { safeAddress, subaccount, cycleId } (same order).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const owner = typeof body.owner === "string" ? body.owner.trim() : "";
    const safeAddress = typeof body.safeAddress === "string" ? body.safeAddress.trim() : "";
    const subaccount = typeof body.subaccount === "string" ? body.subaccount.trim() : "";
    const cycleId = body.cycleId != null ? String(body.cycleId).trim() : "";

    if (!owner || !safeAddress || !subaccount || !cycleId) {
      return NextResponse.json(
        { success: false, error: "owner, safeAddress, subaccount, and cycleId are required" },
        { status: 400 }
      );
    }
    if (!/^\d+$/.test(cycleId)) {
      return NextResponse.json({ success: false, error: "cycleId must be a non-negative integer" }, { status: 400 });
    }

    const result = await rehedgeLpDeltaNeutral({
      owner,
      safeAddress,
      subaccount,
      cycleId,
      bandBps: body.bandBps,
      dryRun: Boolean(body.dryRun),
      auth: body.auth,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: error instanceof ManageAuthError ? error.status : 500 }
    );
  }
}
