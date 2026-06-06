import { NextRequest, NextResponse } from "next/server";
import { fetchVaultFaSwapLimits } from "@/lib/protocols/yield-ai/vaultFaSwapLimits";

/**
 * GET /api/protocols/yield-ai/vault-fa-swap-limits?safeAddress=0x...
 *
 * Reads the on-chain `vault::VaultFaSwapConfig` resource for the safe and
 * derives the daily swap budget remaining today. Used by the AI agent close
 * flow to pre-check whether the executor's swap leg would hit the 0x8 abort
 * before submitting.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const safeAddress = searchParams.get("safeAddress");
    if (!safeAddress) {
      return NextResponse.json(
        { success: false, error: "safeAddress is required" },
        { status: 400 }
      );
    }

    const limits = await fetchVaultFaSwapLimits({
      safeAddress,
      aptosApiKey: process.env.APTOS_API_KEY,
    });

    return NextResponse.json({
      success: true,
      data: {
        exists: limits.exists,
        day: limits.day.toString(),
        currentDayEpoch: limits.currentDayEpoch.toString(),
        maxDailyUsdc: limits.maxDailyUsdc.toString(),
        maxPerTxUsdc: limits.maxPerTxUsdc.toString(),
        spentTodayUsdcRaw: limits.spentTodayUsdcRaw.toString(),
        spentTodayUsdc: limits.spentTodayUsdc.toString(),
        remainingUsdc: limits.remainingUsdc.toString(),
        secondsUntilRollover: limits.secondsUntilRollover,
      },
    });
  } catch (error) {
    console.error("[yield-ai] vault-fa-swap-limits error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
