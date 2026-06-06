import { buildRaydiumClmmAction } from "../_lib/clmmActions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/protocols/raydium/closePosition
 *
 * Body: { owner: string, poolId: string, positionPda?: string, nftMint?: string }
 *
 * Builds a Raydium CLMM close transaction by removing 100% of position
 * liquidity and appending SDK `ClosePosition`. Client signs the returned
 * base64 transaction and submits it through `/api/solana/sendRaw`.
 */
export async function POST(req: Request) {
  return buildRaydiumClmmAction(req, "close");
}
