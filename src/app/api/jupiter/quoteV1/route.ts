import { NextRequest, NextResponse } from "next/server";
import { getJupiterApiKey, stripEnv } from "@/app/api/jupiter/_lib";
import {
  isJupiterNoRoutesFound,
  synthesizeExactOutViaExactIn,
  type JupiterQuoteLike,
} from "@/app/api/jupiter/exactOutFallback";

/**
 * POST /api/jupiter/quoteV1
 * Proxies Jupiter Swap v1 quote (Metis) server-side so we can build a valid `quoteResponse`
 * for `/swap/v1/swap` when user pays gas (NEXT_PUBLIC_GASLESS_SWAP=0).
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      inputMint: string;
      outputMint: string;
      amount: string;
      slippageBps?: number;
      swapMode?: "ExactIn" | "ExactOut";
    };

    const inputMint = stripEnv(body?.inputMint || "");
    const outputMint = stripEnv(body?.outputMint || "");
    const amount = stripEnv(body?.amount || "");
    const slippageBpsRaw = Number(body?.slippageBps ?? 50);
    const slippageBps = Number.isFinite(slippageBpsRaw) ? Math.max(0, Math.min(5000, Math.floor(slippageBpsRaw))) : 50;
    const swapMode = body?.swapMode === "ExactOut" ? "ExactOut" : "ExactIn";

    if (!inputMint || !outputMint || !amount) {
      return NextResponse.json({ error: "inputMint, outputMint, amount are required" }, { status: 400 });
    }

    const apiKey = getJupiterApiKey();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers["x-api-key"] = apiKey;

    const fetchExactInQuote = async (inAmount: string): Promise<JupiterQuoteLike | null> => {
      const quoteParams = new URLSearchParams({
        inputMint,
        outputMint,
        amount: inAmount,
        slippageBps: String(slippageBps),
        swapMode: "ExactIn",
      });
      const quoteRes = await fetch(`https://api.jup.ag/swap/v1/quote?${quoteParams.toString()}`, {
        method: "GET",
        headers,
        cache: "no-store",
      });
      if (!quoteRes.ok) return null;
      return (await quoteRes.json()) as JupiterQuoteLike;
    };

    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount,
      slippageBps: String(slippageBps),
      swapMode,
    });

    const res = await fetch(`https://api.jup.ag/swap/v1/quote?${params.toString()}`, {
      method: "GET",
      headers,
      cache: "no-store",
    });

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      if (swapMode === "ExactOut" && isJupiterNoRoutesFound(res.status, text)) {
        const synthesized = await synthesizeExactOutViaExactIn(amount, slippageBps, fetchExactInQuote);
        if (synthesized) return NextResponse.json(synthesized);
      }
      return NextResponse.json(
        { error: `Jupiter /quote failed: ${res.status}`, details: text },
        { status: 502 }
      );
    }

    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    return NextResponse.json(json ?? {});
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/jupiter/quoteV1]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

