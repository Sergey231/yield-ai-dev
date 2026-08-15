import { NextRequest, NextResponse } from "next/server";
import { getServerSolanaConnection } from "@/app/api/jupiter/_lib";
import { fetchExponentUserPositions } from "@/lib/services/exponent/fetchExponentUserPositions";

export const dynamic = "force-dynamic";

function isLikelySolanaAddress(input: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input);
}

/**
 * GET /api/protocols/exponent/userPositions?address=<solana_wallet>&debug=1
 *
 * Read-only aggregation of Exponent Core PT/YT, staked YT, CLMM LP, and Strategy Vault shares.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = (searchParams.get("address") || "").trim();
    const debug = (searchParams.get("debug") || "").trim() === "1";

    if (!address) {
      return NextResponse.json(
        { success: false, error: "Address parameter is required", data: [], count: 0 },
        { status: 400 }
      );
    }

    if (!isLikelySolanaAddress(address)) {
      return NextResponse.json(
        { success: false, error: "Invalid Solana wallet address", data: [], count: 0 },
        { status: 400 }
      );
    }

    const connection = getServerSolanaConnection();
    const result = await fetchExponentUserPositions({
      connection,
      wallet: address,
      includeTimings: debug,
    });

    const payload = {
      success: true,
      data: result.positions,
      count: result.positions.length,
      ...(debug ? { meta: result.meta } : { totalValueUsd: result.meta.totalValueUsd }),
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[Exponent] userPositions error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        data: [],
        count: 0,
      },
      { status: 500 }
    );
  }
}
