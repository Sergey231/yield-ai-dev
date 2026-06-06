import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";
import { getPoolCurrentTick } from "@/lib/protocols/yield-ai/hyperionLp";
import { YIELD_AI_HYPERION_POOLS, type HyperionPoolKey } from "@/lib/constants/yieldAiVault";

/**
 * GET /api/protocols/yield-ai/hyperion-lp/pool?poolKey=wbtc_usdc
 * Read-only: the pool's live current tick + derived human price (non-USDC leg
 * priced in USDC). Used by the UI to show the current price and draw the range
 * band before opening. No secret required.
 */
export async function GET(request: NextRequest) {
  try {
    const poolKey = (request.nextUrl.searchParams.get("poolKey") || "wbtc_usdc") as HyperionPoolKey;
    const pool = YIELD_AI_HYPERION_POOLS[poolKey];
    if (!pool) {
      return NextResponse.json(createErrorResponse(new Error(`Unknown poolKey: ${poolKey}`)), { status: 400 });
    }

    const currentTick = await getPoolCurrentTick(pool.poolAddress);
    // price = 1.0001^tick * 10^(decimalsA - decimalsB) — non-USDC (token_a) leg
    // priced in USDC (token_b) for these USDC-leg pools.
    const currentPrice = Math.pow(1.0001, currentTick) * 10 ** (pool.decimalsA - pool.decimalsB);

    return NextResponse.json(
      createSuccessResponse({
        poolKey,
        currentTick,
        currentPrice,
        tickSpacing: pool.tickSpacing,
        decimalsA: pool.decimalsA,
        decimalsB: pool.decimalsB,
        tokenA: pool.tokenA,
        tokenB: pool.tokenB,
      })
    );
  } catch (err) {
    return NextResponse.json(createErrorResponse(err instanceof Error ? err : new Error(String(err))), {
      status: 500,
    });
  }
}
