import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";
import { requireStrategyMutationSecret } from "@/app/api/protocols/yield-ai/strategy/_auth";
import { runHyperionOpen } from "@/lib/protocols/yield-ai/hyperionLpActions";
import type { HyperionPoolKey } from "@/lib/constants/yieldAiVault";

/**
 * POST /api/protocols/yield-ai/hyperion-lp/open
 * Header: x-cron-secret
 * Body: {
 *   safeAddress: string,
 *   usdcAmountInBaseUnits: string,   // u64 (USDC 6 dec)
 *   poolKey?: "wbtc_usdc",
 *   halfWidthTicks?: number,
 *   slippageBps?: number,
 *   dryRun?: boolean,
 * }
 *
 * Executor reads the pool's current tick, derives a centered range, computes the
 * USDC->non-USDC zap split, and submits vault::execute_hyperion_open_zap_usdc.
 * Shared planning/quoting logic lives in `hyperionLpActions.runHyperionOpen`.
 */
export async function POST(request: NextRequest) {
  const authError = requireStrategyMutationSecret(request);
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const safeAddress = typeof body.safeAddress === "string" ? body.safeAddress.trim() : "";
    if (!safeAddress) {
      return NextResponse.json(createErrorResponse(new Error("safeAddress is required")), { status: 400 });
    }

    let usdcAmountIn: bigint;
    try {
      usdcAmountIn = BigInt(String(body.usdcAmountInBaseUnits ?? "").trim());
    } catch {
      return NextResponse.json(createErrorResponse(new Error("usdcAmountInBaseUnits must be a u64 string")), { status: 400 });
    }
    if (usdcAmountIn <= 0n) {
      return NextResponse.json(createErrorResponse(new Error("usdcAmountInBaseUnits must be > 0")), { status: 400 });
    }

    const result = await runHyperionOpen({
      safeAddress,
      usdcAmountInBaseUnits: usdcAmountIn,
      poolKey: (body.poolKey as HyperionPoolKey) || undefined,
      halfWidthTicks: body.halfWidthTicks,
      tickLower: body.tickLower,
      tickUpper: body.tickUpper,
      slippageBps: body.slippageBps,
      dryRun: Boolean(body.dryRun),
    });

    return NextResponse.json(createSuccessResponse(result));
  } catch (err) {
    return NextResponse.json(createErrorResponse(err instanceof Error ? err : new Error(String(err))), {
      status: 500,
    });
  }
}
