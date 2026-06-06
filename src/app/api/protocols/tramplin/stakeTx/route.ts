import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { getSafeSolanaRpcEndpoint } from "@/lib/solana/solanaRpcEndpoint";
import { isLikelySolanaAddress } from "@/lib/kamino/kvaultVaultAddress";
import { buildTramplinStakeTransaction } from "@/lib/services/tramplin/stake";
import { LAMPORTS_PER_SOL } from "@/lib/services/tramplin/tramplinApi";

/**
 * POST /api/protocols/tramplin/stakeTx
 * body: { signer: string, amountSol: number }
 *
 * Builds an unsigned (only ephemeral stake-account signed) VersionedTransaction
 * that creates a new native stake account, funds it with `amountSol + rent`,
 * and delegates it to the Tramplin validator. The client signs with the user's
 * wallet and submits via /api/solana/sendRaw.
 *
 * Phase-3 scope: subsequent deposits only (UI gates the button on hasPosition).
 * First-time deposits would also work mechanically but the UI for them lives
 * in the "Ideas" dashboard tile, which is a later milestone.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { signer?: unknown; amountSol?: unknown }
      | null;

    const signer = typeof body?.signer === "string" ? body.signer.trim() : "";
    const amountSol =
      typeof body?.amountSol === "number" ? body.amountSol : Number(body?.amountSol);

    if (!signer) {
      return NextResponse.json({ success: false, error: "Missing signer" }, { status: 400 });
    }
    if (!isLikelySolanaAddress(signer)) {
      return NextResponse.json({ success: false, error: "Invalid Solana wallet address" }, { status: 400 });
    }
    if (!Number.isFinite(amountSol) || amountSol <= 0) {
      return NextResponse.json({ success: false, error: "Invalid amountSol" }, { status: 400 });
    }

    const amountLamports = BigInt(Math.floor(amountSol * LAMPORTS_PER_SOL));
    if (amountLamports <= 0n) {
      return NextResponse.json({ success: false, error: "amountSol rounds to zero" }, { status: 400 });
    }

    const connection = new Connection(getSafeSolanaRpcEndpoint(), "confirmed");
    const { blockhash } = await connection.getLatestBlockhash("confirmed");

    const built = await buildTramplinStakeTransaction({
      connection,
      payer: new PublicKey(signer),
      amountLamports,
      blockhash,
    });

    return NextResponse.json({
      success: true,
      data: {
        transaction: built.txBase64,
        stakeAccountAddress: built.stakeAccountAddress,
        rentExemptLamports: built.rentExemptLamports,
        totalChargedLamports: built.totalChargedLamports,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
