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
import {
  isJupiterNoRoutesFound,
  synthesizeExactOutViaExactIn,
  type JupiterQuoteLike,
} from "@/app/api/jupiter/exactOutFallback";
import { PublicKey } from "@solana/web3.js";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      inputMint: string;
      outputMint: string;
      amount: string;
      taker: string;
      slippageBps?: number;
      swapMode?: "ExactIn" | "ExactOut";
    };

    const inputMint = stripEnv(body?.inputMint || "");
    const outputMint = stripEnv(body?.outputMint || "");
    const amount = stripEnv(body?.amount || "");
    const taker = stripEnv(body?.taker || "");
    const slippageBps = Number(body?.slippageBps ?? 100);
    const swapMode = body?.swapMode === "ExactOut" ? "ExactOut" : "ExactIn";

    if (!inputMint || !outputMint || !amount || !taker) {
      return NextResponse.json(
        { error: "inputMint, outputMint, amount, taker are required" },
        { status: 400 },
      );
    }

    const apiKey = getJupiterApiKey();
    const platformFeeBps = getPlatformFeeBps();
    const feeOwner = getFeeOwner();
    const slippageStr = String(
      Number.isFinite(slippageBps) ? Math.max(0, Math.min(5000, Math.floor(slippageBps))) : 100,
    );

    const { address: payer } = getSolanaPayerKeypair();
    const base = getJupiterSwapBaseUrl();

    const fetchExactInBuild = async (inAmount: string): Promise<JupiterQuoteLike | null> => {
      const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount: inAmount,
        taker,
        payer,
        slippageBps: slippageStr,
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
      if (!res.ok) return null;
      const build = (await res.json()) as JupiterQuoteLike;
      return {
        inputMint: build.inputMint,
        outputMint: build.outputMint,
        inAmount: build.inAmount,
        outAmount: build.outAmount,
        otherAmountThreshold: build.otherAmountThreshold,
        slippageBps: build.slippageBps,
        swapMode: "ExactIn",
        routePlan: build.routePlan,
      };
    };

    // Swap v2 /build is ExactIn-only. ExactOut uses Metis v1 /quote; some mints (e.g. Token-2022 USDG)
    // have no ExactOut routes — fall back to ExactIn binary search via v2 /build.
    if (swapMode === "ExactOut") {
      const params = new URLSearchParams({
        inputMint,
        outputMint,
        amount,
        slippageBps: slippageStr,
        swapMode: "ExactOut",
      });
      if (platformFeeBps > 0) {
        const feeAccount = await deriveAtaAddress({
          owner: feeOwner,
          mint: new PublicKey(outputMint),
        });
        params.set("platformFeeBps", String(platformFeeBps));
        params.set("feeAccount", feeAccount.toBase58());
      }

      const res = await fetch(`https://api.jup.ag/swap/v1/quote?${params.toString()}`, {
        headers: apiKey ? { Accept: "application/json", "x-api-key": apiKey } : { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) {
        const details = await res.text();
        if (isJupiterNoRoutesFound(res.status, details)) {
          const synthesized = await synthesizeExactOutViaExactIn(
            amount,
            Number(slippageStr),
            fetchExactInBuild,
          );
          if (synthesized) return NextResponse.json(synthesized);
        }
        return NextResponse.json(
          { error: `Jupiter /quote failed: ${res.status}`, details },
          { status: 502 },
        );
      }
      const quote = await res.json();
      return NextResponse.json(quote);
    }

    const buildQuote = await fetchExactInBuild(amount);
    if (!buildQuote) {
      return NextResponse.json(
        { error: `/build failed`, details: "Jupiter build returned no quote" },
        { status: 502 },
      );
    }

    return NextResponse.json({
      inputMint: buildQuote.inputMint,
      outputMint: buildQuote.outputMint,
      inAmount: buildQuote.inAmount,
      outAmount: buildQuote.outAmount,
      otherAmountThreshold: buildQuote.otherAmountThreshold,
      slippageBps: buildQuote.slippageBps,
      swapMode: buildQuote.swapMode,
      routePlan: buildQuote.routePlan,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/jupiter/quote]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
