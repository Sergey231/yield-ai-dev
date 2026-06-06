import { buildOrcaWhirlpoolAction } from "../_lib/whirlpoolActions";

export const dynamic = "force-dynamic";

/**
 * POST /api/protocols/orca/claimFees
 *
 * Body: { owner: string, poolId?: string, positionPda?: string, nftMint?: string }
 *
 * Builds an unsigned Orca Whirlpool harvest transaction. The client signs it
 * with the connected wallet and submits through `/api/solana/sendRaw`.
 */
export async function POST(req: Request) {
  return buildOrcaWhirlpoolAction(req, "claim");
}
