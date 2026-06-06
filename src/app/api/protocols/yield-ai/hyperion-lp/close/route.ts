import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";
import { requireStrategyMutationSecret } from "@/app/api/protocols/yield-ai/strategy/_auth";
import { runHyperionClose } from "@/lib/protocols/yield-ai/hyperionLpActions";

/**
 * POST /api/protocols/yield-ai/hyperion-lp/close
 * Header: x-cron-secret
 * Body: { safeAddress: string, position: string, claimFirst?: boolean, dryRun?: boolean }
 *
 * Exit flow: claim_fees (so the protocol perf cut is taken — Hyperion otherwise
 * auto-claims remaining fees to the safe on remove, bypassing the cut), then
 * remove_all. Funds (both legs) land back in the safe. Converting the non-USDC
 * leg back to USDC is a separate, explicit step (`manage/convert` /
 * `manage/close` with `convert: true`) to avoid touching pre-existing holdings.
 * Shared logic lives in `hyperionLpActions.runHyperionClose`.
 */
export async function POST(request: NextRequest) {
  const authError = requireStrategyMutationSecret(request);
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const safeAddress = typeof body.safeAddress === "string" ? body.safeAddress.trim() : "";
    const position = typeof body.position === "string" ? body.position.trim() : "";

    if (!safeAddress) {
      return NextResponse.json(createErrorResponse(new Error("safeAddress is required")), { status: 400 });
    }
    if (!position) {
      return NextResponse.json(createErrorResponse(new Error("position is required")), { status: 400 });
    }

    const result = await runHyperionClose({
      safeAddress,
      position,
      claimFirst: body.claimFirst !== false,
      dryRun: Boolean(body.dryRun),
    });

    return NextResponse.json(createSuccessResponse(result));
  } catch (err) {
    return NextResponse.json(createErrorResponse(err instanceof Error ? err : new Error(String(err))), {
      status: 500,
    });
  }
}
