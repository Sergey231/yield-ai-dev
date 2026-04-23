import { NextRequest, NextResponse } from "next/server";
import {
  deriveAtaAddress,
  getFeeOwner,
  getJupiterApiKey,
  getJupiterSwapBaseUrl,
  getPlatformFeeBps,
  getSolanaPayerKeypair,
  stripEnv,
} from "@/app/api/jupiter/_lib";
import { PublicKey } from "@solana/web3.js";

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

    // Validate payer exists (gasless).
    const { address: payer } = getSolanaPayerKeypair();

    const base = getJupiterSwapBaseUrl();
    const apiKey = getJupiterApiKey();
    const platformFeeBps = getPlatformFeeBps();
    const feeOwner = getFeeOwner();

    // IMPORTANT: /build requires feeAccount when platformFeeBps > 0.
    // We derive the feeAccount as the fee owner's ATA for outputMint (same as /build route).
    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount,
      taker,
      payer,
      slippageBps: String(Number.isFinite(slippageBps) ? Math.max(0, Math.min(5000, Math.floor(slippageBps))) : 100),
    });
    if (platformFeeBps > 0) {
      const feeAccount = await deriveAtaAddress({
        owner: feeOwner,
        mint: new PublicKey(outputMint),
      });
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
    const build = await res.json();

    return NextResponse.json({
      inputMint: build.inputMint,
      outputMint: build.outputMint,
      inAmount: build.inAmount,
      outAmount: build.outAmount,
      otherAmountThreshold: build.otherAmountThreshold,
      slippageBps: build.slippageBps,
      swapMode: build.swapMode,
      routePlan: build.routePlan,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/jupiter/quote]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

