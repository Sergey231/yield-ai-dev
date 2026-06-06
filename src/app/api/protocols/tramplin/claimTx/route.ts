import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { getSafeSolanaRpcEndpoint } from "@/lib/solana/solanaRpcEndpoint";
import { isLikelySolanaAddress } from "@/lib/kamino/kvaultVaultAddress";
import { fetchTramplinWins } from "@/lib/services/tramplin/tramplinApi";
import {
  buildClaimTransactions,
  prepareClaimInstruction,
  winToClaimable,
} from "@/lib/services/tramplin/claim";

/**
 * POST /api/protocols/tramplin/claimTx
 * body: { signer: string }
 *
 * Builds (multiple, batched) unsigned VersionedTransactions that claim ALL
 * currently unclaimed Tramplin wins for the wallet. Client signs and submits
 * each via /api/solana/sendRaw.
 *
 * Response:
 *   { success: true, data: { transactions: [{ transaction, instructionCount }], totalWins, claimableWins } }
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { signer?: unknown } | null;
    const signer = typeof body?.signer === "string" ? body.signer.trim() : "";

    if (!signer) {
      return NextResponse.json({ success: false, error: "Missing signer" }, { status: 400 });
    }
    if (!isLikelySolanaAddress(signer)) {
      return NextResponse.json({ success: false, error: "Invalid Solana wallet address" }, { status: 400 });
    }

    const wallet = new PublicKey(signer);
    const wins = await fetchTramplinWins(signer, { isClaimed: false });
    const claimables = wins.map(winToClaimable).filter((w): w is NonNullable<typeof w> => w != null);

    if (claimables.length === 0) {
      return NextResponse.json({
        success: true,
        data: { transactions: [], totalWins: wins.length, claimableWins: 0 },
      });
    }

    const instructions = claimables.map((c) => prepareClaimInstruction(c, wallet));

    const connection = new Connection(getSafeSolanaRpcEndpoint(), "confirmed");
    const { blockhash } = await connection.getLatestBlockhash("confirmed");

    const txs = buildClaimTransactions(instructions, wallet, blockhash);

    return NextResponse.json({
      success: true,
      data: {
        transactions: txs.map((t) => ({
          transaction: t.txBase64,
          instructionCount: t.instructionCount,
        })),
        totalWins: wins.length,
        claimableWins: claimables.length,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
