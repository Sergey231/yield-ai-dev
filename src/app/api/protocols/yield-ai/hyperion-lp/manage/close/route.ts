import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";
import { runHyperionClose, runHyperionCloseConvert } from "@/lib/protocols/yield-ai/hyperionLpActions";
import {
  HyperionManageAuthError,
  assertHyperionManageOwnerAuth,
  assertSafeOptedIntoHyperion,
} from "../_guard";
import type { HyperionPoolKey } from "@/lib/constants/yieldAiVault";

function optionalNumber(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * POST /api/protocols/yield-ai/hyperion-lp/manage/close
 *
 * User-facing proxy: closes a position (claim_fees → remove_all). Funds return
 * to the safe as both legs. With `convert: true`, the freed non-USDC leg is then
 * swapped back to USDC — ONLY the delta produced by this close, never
 * pre-existing safe holdings. Live actions require a wallet signature from the
 * safe owner.
 *
 * Body: { safeAddress, position, poolKey?, claimFirst?, convert?, slippageBps?, dryRun? }
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
    const claimFirst = body.claimFirst !== false;
    const dryRun = Boolean(body.dryRun);
    const convert = Boolean(body.convert);

    if (!dryRun) {
      await assertHyperionManageOwnerAuth({
        safeAddress,
        action: "hyperion_lp_manage_close",
        fields: {
          safeAddress,
          position,
          poolKey: typeof body.poolKey === "string" && body.poolKey.trim() ? body.poolKey.trim() : null,
          claimFirst,
          convert,
          slippageBps: optionalNumber(body.slippageBps),
          dryRun,
        },
        auth: body.auth,
      });
    }

    const result = convert
      ? await runHyperionCloseConvert({
          safeAddress,
          position,
          poolKey: (body.poolKey as HyperionPoolKey) || undefined,
          claimFirst,
          slippageBps: body.slippageBps,
          dryRun,
        })
      : await runHyperionClose({ safeAddress, position, claimFirst, dryRun });

    return NextResponse.json(createSuccessResponse(result));
  } catch (err) {
    return NextResponse.json(createErrorResponse(err instanceof Error ? err : new Error(String(err))), {
      status: err instanceof HyperionManageAuthError ? err.status : 500,
    });
  }
}
