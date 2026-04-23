import { NextRequest, NextResponse } from "next/server";
import {
  createAtaIx,
  deriveAtaAddress,
  getFeeOwner,
  getJupiterApiKey,
  getJupiterSwapBaseUrl,
  getPlatformFeeBps,
  getServerSolanaConnection,
  getSolanaPayerKeypair,
  stripEnv,
} from "@/app/api/jupiter/_lib";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

type ApiIx = {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string; // base64
};

function toWeb3Ix(ix: ApiIx): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.accounts.map((a) => ({
      pubkey: new PublicKey(a.pubkey),
      isSigner: a.isSigner,
      isWritable: a.isWritable,
    })),
    data: Buffer.from(ix.data, "base64"),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      inputMint: string;
      outputMint: string;
      amount: string;
      taker: string;
      slippageBps?: number;
    };

    const inputMint = stripEnv(body?.inputMint || "");
    const outputMint = stripEnv(body?.outputMint || "");
    const amount = stripEnv(body?.amount || "");
    const taker = stripEnv(body?.taker || "");
    const slippageBps = Number(body?.slippageBps ?? 100);

    if (!inputMint || !outputMint || !amount || !taker) {
      return NextResponse.json(
        { error: "inputMint, outputMint, amount, taker are required" },
        { status: 400 },
      );
    }

    const connection = getServerSolanaConnection();
    const { keypair: payerKeypair } = getSolanaPayerKeypair();
    const payer = payerKeypair.publicKey;
    const feeOwner = getFeeOwner();
    const platformFeeBps = getPlatformFeeBps();

    // Fee account: ATA of fee owner for outputMint (fee is charged in output token for /build platform fees).
    const outputMintPk = new PublicKey(outputMint);
    const feeAccount = await deriveAtaAddress({ owner: feeOwner, mint: outputMintPk });

    const base = getJupiterSwapBaseUrl();
    const apiKey = getJupiterApiKey();
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount,
      taker,
      payer: payer.toBase58(),
      slippageBps: String(Number.isFinite(slippageBps) ? Math.max(0, Math.min(5000, Math.floor(slippageBps))) : 100),
    });
    if (platformFeeBps > 0) {
      params.set("platformFeeBps", String(platformFeeBps));
      params.set("feeAccount", feeAccount.toBase58());
    }

    const res = await fetch(`${base}/build?${params.toString()}`, {
      headers: apiKey ? { "x-api-key": apiKey } : undefined,
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `/build failed: ${res.status}`, details: await res.text() },
        { status: 502 },
      );
    }
    const build = (await res.json()) as any;

    const ixs: TransactionInstruction[] = [];

    // Ensure feeAccount ATA exists (paid by payer). This instruction is safe to include even if ATA exists? No.
    // So we only include if missing.
    if (platformFeeBps > 0) {
      const feeAccInfo = await connection.getAccountInfo(feeAccount);
      if (!feeAccInfo) {
        ixs.push(createAtaIx({ payer, owner: feeOwner, mint: outputMintPk, ata: feeAccount }));
      }
    }

    // Compute unit limit: set high default to reduce failures for custom-built tx.
    ixs.push(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));

    const computeBudgetInstructions = Array.isArray(build.computeBudgetInstructions)
      ? (build.computeBudgetInstructions as ApiIx[]).map(toWeb3Ix)
      : [];
    const setupInstructions = Array.isArray(build.setupInstructions)
      ? (build.setupInstructions as ApiIx[]).map(toWeb3Ix)
      : [];
    const swapInstruction = build.swapInstruction ? toWeb3Ix(build.swapInstruction as ApiIx) : null;
    const cleanupInstruction = build.cleanupInstruction ? toWeb3Ix(build.cleanupInstruction as ApiIx) : null;
    const otherInstructions = Array.isArray(build.otherInstructions)
      ? (build.otherInstructions as ApiIx[]).map(toWeb3Ix)
      : [];

    ixs.push(...computeBudgetInstructions);
    ixs.push(...setupInstructions);
    if (swapInstruction) ixs.push(swapInstruction);
    if (cleanupInstruction) ixs.push(cleanupInstruction);
    ixs.push(...otherInstructions);

    // Resolve ALT accounts if present.
    const altMap = (build.addressesByLookupTableAddress ?? null) as Record<string, string[]> | null;
    const alts: AddressLookupTableAccount[] = [];
    if (altMap && typeof altMap === "object") {
      const altKeys = Object.keys(altMap);
      const altInfos = await Promise.all(
        altKeys.map(async (k) => {
          const pk = new PublicKey(k);
          const info = await connection.getAccountInfo(pk);
          return { pk, info };
        }),
      );
      for (const { pk, info } of altInfos) {
        if (!info) continue;
        try {
          const state = AddressLookupTableAccount.deserialize(info.data);
          alts.push(new AddressLookupTableAccount({ key: pk, state }));
        } catch {
          // ignore ALT parse failures
        }
      }
    }

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const messageV0 = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: ixs,
    }).compileToV0Message(alts);

    const tx = new VersionedTransaction(messageV0);

    // Return unsigned tx; client signs as taker, server adds payer signature on execute.
    return NextResponse.json({
      transaction: Buffer.from(tx.serialize()).toString("base64"),
      lastValidBlockHeight,
      feeAccount: feeAccount.toBase58(),
      platformFeeBps,
      outAmount: build.outAmount,
      inAmount: build.inAmount,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/jupiter/build]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

