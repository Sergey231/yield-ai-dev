import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";
import { runHyperionClaim } from "@/lib/protocols/yield-ai/hyperionLpActions";
import {
  HyperionManageAuthError,
  assertHyperionManageOwnerAuth,
  assertSafeOptedIntoHyperion,
} from "../_guard";

/**
 * POST /api/protocols/yield-ai/hyperion-lp/manage/claim
 *
 * User-facing proxy: claims accrued CLMM fees on a position (perf cut taken
 * on-chain). Live actions require a wallet signature from the safe owner.
 *
 * Body: { safeAddress, position, dryRun? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const safeAddressRaw = typeof body.safeAddress === "string" ? body.safeAddress.trim() : "";
    const position = typeof body.position === "string" ? body.position.trim() : "";

    if (!safeAddressRaw) {
      return NextResponse.json(createErrorResponse(new Error("safeAddress is required")), { status: 400 });
    }
    if (!position) {
      return NextResponse.json(createErrorResponse(new Error("position is required")), { status: 400 });
    }

    const safeAddress = await assertSafeOptedIntoHyperion(safeAddressRaw);
    const dryRun = Boolean(body.dryRun);

    if (!dryRun) {
      await assertHyperionManageOwnerAuth({
        safeAddress,
        action: "hyperion_lp_manage_claim",
        fields: {
          safeAddress,
          position,
          dryRun,
        },
        auth: body.auth,
      });
    }

    const result = await runHyperionClaim({
      safeAddress,
      position,
      dryRun,
    });

    return NextResponse.json(createSuccessResponse(result));
  } catch (err) {
    return NextResponse.json(createErrorResponse(err instanceof Error ? err : new Error(String(err))), {
      status: err instanceof HyperionManageAuthError ? err.status : 500,
    });
  }
}
