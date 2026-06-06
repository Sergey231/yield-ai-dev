import { buildRaydiumClmmAction } from "../_lib/clmmActions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/protocols/raydium/claimFees
 *
 * Body: { owner: string, poolId: string, positionPda?: string, nftMint?: string }
 *
 * Builds a Raydium CLMM claim transaction via SDK `decreaseLiquidity` with
 * zero liquidity. Client signs the returned base64 transaction and submits it
 * through `/api/solana/sendRaw`.
 */
export async function POST(req: Request) {
  return buildRaydiumClmmAction(req, "claim");
}
