import { NextRequest, NextResponse } from "next/server";
import { isLikelySolanaAddress } from "@/lib/kamino/kvaultVaultAddress";
import { fetchSolPriceUsd, fetchTramplinStats } from "@/lib/services/tramplin/tramplinApi";

export type TramplinPositionData = {
  hasPosition: boolean;
  stakeSol: number;
  stakeUsd: number | null;
  effectiveStakeSol: number;
  aprPct: number;
  multiplier: number;
  totalPoints: number;
  /** Lifetime winnings — claimed + unclaimed — denominated in SOL. */
  totalWonSol: number;
  totalWonUsd: number | null;
  solPriceUsd: number | null;
  drawEligibility: {
    regular: boolean;
    epoch: boolean;
    big: boolean;
  };
};

/**
 * GET /api/protocols/tramplin/userPositions?address=<solana_wallet>
 *
 * Returns the wallet's Tramplin native-stake position (view-only).
 */
export async function GET(request: NextRequest) {
  try {
    const address = (new URL(request.url).searchParams.get("address") || "").trim();
    if (!address) {
      return NextResponse.json({ success: false, error: "Address parameter is required" }, { status: 400 });
    }
    if (!isLikelySolanaAddress(address)) {
      return NextResponse.json({ success: false, error: "Invalid Solana wallet address" }, { status: 400 });
    }

    const [stats, solPriceUsd] = await Promise.all([fetchTramplinStats(address), fetchSolPriceUsd()]);

    const stakeSol = typeof stats?.totalStakeAmount === "number" ? stats.totalStakeAmount : 0;
    const effectiveStakeSol = typeof stats?.effectiveStake === "number" ? stats.effectiveStake : 0;
    const aprPct = typeof stats?.apr === "number" ? stats.apr : 0;
    const multiplier = typeof stats?.multiplier === "number" ? stats.multiplier : 0;
    const totalPoints = typeof stats?.totalPoints === "number" ? stats.totalPoints : 0;
    // Prefer the precise lamport figure; fall back to the rounded SOL value.
    const totalWonSol =
      typeof stats?.totalWinLamports === "number"
        ? stats.totalWinLamports / 1_000_000_000
        : typeof stats?.totalWinSol === "number"
          ? stats.totalWinSol
          : 0;

    const data: TramplinPositionData = {
      hasPosition: stakeSol > 0,
      stakeSol,
      stakeUsd: solPriceUsd != null ? stakeSol * solPriceUsd : null,
      effectiveStakeSol,
      aprPct,
      multiplier,
      totalPoints,
      totalWonSol,
      totalWonUsd: solPriceUsd != null ? totalWonSol * solPriceUsd : null,
      solPriceUsd,
      drawEligibility: {
        regular: Boolean(stats?.isAttendingRegularDraw),
        epoch: Boolean(stats?.isAttendingEpochDraw),
        big: Boolean(stats?.isAttendingBigDraw),
      },
    };

    return NextResponse.json({ success: true, data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
