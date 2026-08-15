import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";
import { requireStrategyMutationSecret } from "@/app/api/protocols/yield-ai/strategy/_auth";
import { runHyperionOpen, runHyperionOpenDual } from "@/lib/protocols/yield-ai/hyperionLpActions";
import type { HyperionPoolKey } from "@/lib/constants/yieldAiVault";

/**
 * POST /api/protocols/yield-ai/hyperion-lp/open
 * Header: x-cron-secret
 *
 * Two modes:
 *  - `mode: "zap"` (default): from USDC only. Body: {
 *      safeAddress, usdcAmountInBaseUnits (u64, USDC 6 dec), poolKey?,
 *      halfWidthTicks?, slippageBps?, tickLower?, tickUpper?, dryRun?
 *    }
 *    Reads the pool's current tick, derives a centered range, computes the
 *    USDC->non-USDC zap split, submits vault::execute_hyperion_open_zap_usdc.
 *  - `mode: "dual"`: from BOTH legs already in the safe, no swap. Body: {
 *      safeAddress, amountABaseUnits (u64), amountBBaseUnits (u64), poolKey?,
 *      halfWidthTicks?, tickLower?, tickUpper?, dryRun?
 *    }
 *    Adds both legs at a centered range with min=0, so the over-supplied leg's
 *    excess returns to the safe as leftover. Lets the agent deploy idle balances
 *    (e.g. after a recenter that left both tokens idle) without a zap swap.
 *
 * Shared planning/quoting lives in `hyperionLpActions.runHyperionOpen{,Dual}`.
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

    if (body.mode === "dual") {
      let amountA: bigint;
      let amountB: bigint;
      try {
        amountA = BigInt(String(body.amountABaseUnits ?? "").trim());
        amountB = BigInt(String(body.amountBBaseUnits ?? "").trim());
      } catch {
        return NextResponse.json(
          createErrorResponse(new Error("amountABaseUnits and amountBBaseUnits must be u64 strings")),
          { status: 400 }
        );
      }
      if (amountA <= 0n && amountB <= 0n) {
        return NextResponse.json(
          createErrorResponse(new Error("at least one of amountABaseUnits / amountBBaseUnits must be > 0")),
          { status: 400 }
        );
      }

      const dualResult = await runHyperionOpenDual({
        safeAddress,
        amountABaseUnits: amountA,
        amountBBaseUnits: amountB,
        poolKey: (body.poolKey as HyperionPoolKey) || undefined,
        halfWidthTicks: body.halfWidthTicks,
        tickLower: body.tickLower,
        tickUpper: body.tickUpper,
        dryRun: Boolean(body.dryRun),
      });
      return NextResponse.json(createSuccessResponse(dualResult));
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
