import { NextRequest, NextResponse } from "next/server";
import { isLikelySolanaAddress } from "@/lib/kamino/kvaultVaultAddress";
import { fetchKaminoRewardsPayload } from "@/lib/kamino/kaminoRewardsServer";

/**
 * GET /api/protocols/kamino/rewards?address=<solana_wallet>
 *
 * Returns pending rewards and claim targets across Kamino farms (via farms-sdk).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = (searchParams.get("address") || "").trim();
    if (!address) {
      return NextResponse.json({ success: false, error: "Address parameter is required", data: [] }, { status: 400 });
    }
    if (!isLikelySolanaAddress(address)) {
      return NextResponse.json({ success: false, error: "Invalid Solana wallet address", data: [] }, { status: 400 });
    }

    const payload = await fetchKaminoRewardsPayload(address);

    return NextResponse.json({
      success: true,
      data: payload.rewards,
      claimTargets: payload.claimTargets,
      totalUsdValue: payload.totalUsdValue,
      count: payload.rewards.length,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: message, data: [], claimTargets: [] }, { status: 500 });
  }
}
