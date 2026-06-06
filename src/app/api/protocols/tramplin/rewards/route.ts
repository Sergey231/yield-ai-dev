import { NextRequest, NextResponse } from "next/server";
import { isLikelySolanaAddress } from "@/lib/kamino/kvaultVaultAddress";
import {
  LAMPORTS_PER_SOL,
  fetchSolPriceUsd,
  fetchTramplinWins,
} from "@/lib/services/tramplin/tramplinApi";

export type TramplinRewardRow = {
  tokenMint: string;
  tokenSymbol: string;
  tokenLogoUrl?: string;
  amount: string;
  usdValue?: number;
  /** Number of unclaimed wins aggregated into this row. */
  winCount: number;
};

/**
 * GET /api/protocols/tramplin/rewards?address=<solana_wallet>
 *
 * Returns unclaimed Tramplin draw winnings (all denominated in SOL). View-only:
 * claiming is not implemented yet — it needs the draw program's claim instruction.
 */
export async function GET(request: NextRequest) {
  try {
    const address = (new URL(request.url).searchParams.get("address") || "").trim();
    if (!address) {
      return NextResponse.json({ success: false, error: "Address parameter is required", data: [] }, { status: 400 });
    }
    if (!isLikelySolanaAddress(address)) {
      return NextResponse.json({ success: false, error: "Invalid Solana wallet address", data: [] }, { status: 400 });
    }

    const [wins, solPriceUsd] = await Promise.all([
      fetchTramplinWins(address, { isClaimed: false }),
      fetchSolPriceUsd(),
    ]);

    let unclaimedLamports = 0;
    for (const win of wins) {
      const lamports = Number(win?.prizeLamports ?? 0);
      if (Number.isFinite(lamports) && lamports > 0) unclaimedLamports += lamports;
    }

    const data: TramplinRewardRow[] = [];
    if (unclaimedLamports > 0) {
      const amountSol = unclaimedLamports / LAMPORTS_PER_SOL;
      data.push({
        tokenMint: "So11111111111111111111111111111111111111112",
        tokenSymbol: "SOL",
        tokenLogoUrl: "/token_ico/sol.png",
        amount: String(amountSol),
        usdValue: solPriceUsd != null ? amountSol * solPriceUsd : undefined,
        winCount: wins.length,
      });
    }

    return NextResponse.json({ success: true, data, count: data.length });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: message, data: [] }, { status: 500 });
  }
}
