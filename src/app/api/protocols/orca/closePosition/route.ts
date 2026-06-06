import { buildOrcaWhirlpoolAction } from "../_lib/whirlpoolActions";

export const dynamic = "force-dynamic";

/**
 * POST /api/protocols/orca/closePosition
 *
 * Body: { owner: string, poolId?: string, positionPda?: string, nftMint?: string, slippageBps?: number }
 *
 * Builds an unsigned Orca Whirlpool full close transaction. The client signs it
 * with the connected wallet and submits through `/api/solana/sendRaw`.
 */
export async function POST(req: Request) {
  return buildOrcaWhirlpoolAction(req, "close");
}
