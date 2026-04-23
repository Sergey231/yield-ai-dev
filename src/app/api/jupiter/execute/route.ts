import { NextRequest, NextResponse } from "next/server";
import { getServerSolanaConnection, getSolanaPayerKeypair, stripEnv } from "@/app/api/jupiter/_lib";
import { Keypair, VersionedTransaction } from "@solana/web3.js";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      signedTransaction: string; // base64
      lastValidBlockHeight?: number;
    };

    const signedTransaction = stripEnv(body?.signedTransaction || "");
    if (!signedTransaction) {
      return NextResponse.json({ error: "signedTransaction is required" }, { status: 400 });
    }

    const connection = getServerSolanaConnection();
    const { keypair: payerKeypair } = getSolanaPayerKeypair();

    const tx = VersionedTransaction.deserialize(Buffer.from(signedTransaction, "base64"));

    // Add payer signature (fee payer). Keep taker signature from wallet.
    tx.sign([payerKeypair as unknown as Keypair]);

    // Quick sanity check: gas station must have SOL for fees (and possible ATA creation).
    const payerLamports = await connection.getBalance(payerKeypair.publicKey, "confirmed");
    const minLamports = 10_000_000; // 0.01 SOL buffer
    if (payerLamports < minLamports) {
      return NextResponse.json(
        {
          error: "Gas station has insufficient SOL for fees",
          payer: payerKeypair.publicKey.toBase58(),
          payerLamports,
          minLamports,
        },
        { status: 503 },
      );
    }

    let sig: string;
    try {
      sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
    } catch (e: any) {
      // Try to surface a meaningful error with simulation logs.
      let sim: any = null;
      try {
        sim = await connection.simulateTransaction(tx, { sigVerify: false, commitment: "processed" });
      } catch {}
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[api/jupiter/execute] sendRawTransaction failed:", msg);
      return NextResponse.json(
        {
          error: msg,
          phase: "sendRawTransaction",
          simulation: sim?.value
            ? { err: sim.value.err, logs: sim.value.logs, unitsConsumed: sim.value.unitsConsumed }
            : null,
        },
        { status: 502 },
      );
    }

    const lastValidBlockHeight = Number(body?.lastValidBlockHeight ?? 0) || undefined;
    const confirmBlockHeight = lastValidBlockHeight ?? (await connection.getLatestBlockhash("confirmed")).lastValidBlockHeight;
    // Confirm against the transaction's blockhash (not a newly fetched one).
    const blockhash = (tx.message as any).recentBlockhash as string;

    const conf = await connection.confirmTransaction(
      {
        signature: sig,
        blockhash,
        lastValidBlockHeight: confirmBlockHeight,
      },
      "confirmed",
    );

    if (conf.value.err) {
      return NextResponse.json(
        { status: "Failed", signature: sig, err: conf.value.err, phase: "confirmTransaction" },
        { status: 502 },
      );
    }

    return NextResponse.json({ status: "Success", signature: sig });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/jupiter/execute]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

