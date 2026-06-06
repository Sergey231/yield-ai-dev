import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";
import { requireStrategyMutationSecret } from "@/app/api/protocols/yield-ai/strategy/_auth";
import {
  HYPERION_LP_CRON_LOCK_KEY,
  runHyperionLpCronPass,
} from "@/lib/protocols/yield-ai/hyperionLpCron";

/**
 * POST /api/protocols/yield-ai/hyperion-lp/cron
 * Header: x-cron-secret
 * Body: {
 *   safeAddresses?: string[],   // explicit safes; otherwise auto-enumerate hyperion_lp safes
 *   halfWidthTicks?: number,
 *   edgeBufferTicks?: number,   // also re-center within N ticks of a range edge
 *   slippageBps?: number,
 *   minReopenUsdcBaseUnits?: string,
 *   dryRun?: boolean,
 * }
 *
 * Per active LP position on each hyperion_lp safe: if out of range (or near an
 * edge), close+convert to USDC and re-open a centered range with the recovered
 * USDC. In-range positions are untouched. Single-flight guarded.
 */
export async function POST(request: NextRequest) {
  const authError = requireStrategyMutationSecret(request);
  if (authError) return authError;

  const g = globalThis as Record<string, unknown>;
  if (g[HYPERION_LP_CRON_LOCK_KEY]) {
    return NextResponse.json(createErrorResponse(new Error("Hyperion LP cron is already running")), {
      status: 429,
    });
  }
  g[HYPERION_LP_CRON_LOCK_KEY] = true;

  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = Boolean(body.dryRun);
    // Default action is "claim" (auto-claim fees + swap APT rewards → USDC, fees
    // kept in the safe). "recenter" runs the out-of-range close→reopen pass.
    const action: "claim" | "recenter" = body.action === "recenter" ? "recenter" : "claim";
    const result = await runHyperionLpCronPass({
      action,
      dryRun,
      safeAddresses: Array.isArray(body.safeAddresses) ? body.safeAddresses : undefined,
      halfWidthTicks: body.halfWidthTicks,
      edgeBufferTicks: body.edgeBufferTicks,
      slippageBps: body.slippageBps,
      minReopenUsdcBaseUnits:
        body.minReopenUsdcBaseUnits != null ? BigInt(String(body.minReopenUsdcBaseUnits)) : undefined,
      minClaimUsd: Number.isFinite(Number(body.minClaimUsd)) ? Number(body.minClaimUsd) : undefined,
      minRewardClaimUsd: Number.isFinite(Number(body.minRewardClaimUsd))
        ? Number(body.minRewardClaimUsd)
        : undefined,
      minRewardSwapUsd: Number.isFinite(Number(body.minRewardSwapUsd))
        ? Number(body.minRewardSwapUsd)
        : undefined,
      swapRewardsToUsdc: body.swapRewardsToUsdc !== false,
    });

    return NextResponse.json(createSuccessResponse(result));
  } catch (err) {
    return NextResponse.json(createErrorResponse(err instanceof Error ? err : new Error(String(err))), {
      status: 500,
    });
  } finally {
    g[HYPERION_LP_CRON_LOCK_KEY] = false;
  }
}
