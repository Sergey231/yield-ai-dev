import { NextRequest, NextResponse } from "next/server";
import { getJupiterApiKey, stripEnv } from "@/app/api/jupiter/_lib";

/**
 * POST /api/jupiter/swapTx
 * Builds a swap transaction (base64) using Jupiter Swap API (server-side) so the client
 * can sign & send it with the user's wallet (user pays gas).
 *
 * NOTE: This uses Swap API v1 `/swap` because it returns a ready `swapTransaction`.
 * Swap v2 `/build` returns raw instructions and requires custom transaction assembly.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      userPublicKey: string;
      quoteResponse: unknown;
      wrapAndUnwrapSol?: boolean;
    };

    const userPublicKey = stripEnv(body?.userPublicKey || "");
    const quoteResponse = body?.quoteResponse;
    const wrapAndUnwrapSol = body?.wrapAndUnwrapSol ?? true;

    if (!userPublicKey || !quoteResponse) {
      return NextResponse.json({ error: "userPublicKey and quoteResponse are required" }, { status: 400 });
    }

    const apiKey = getJupiterApiKey();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["x-api-key"] = apiKey;

    const res = await fetch("https://api.jup.ag/swap/v1/swap", {
      method: "POST",
      headers,
      cache: "no-store",
      body: JSON.stringify({
        userPublicKey,
        quoteResponse,
        wrapAndUnwrapSol,
      }),
    });

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return NextResponse.json(
        { error: `Jupiter /swap failed: ${res.status}`, details: text },
        { status: 502 }
      );
    }

    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    const swapTransaction = String(json?.swapTransaction || "").trim();
    const lastValidBlockHeight = json?.lastValidBlockHeight ?? null;
    if (!swapTransaction) {
      return NextResponse.json(
        { error: "Jupiter response missing swapTransaction", details: json ?? text },
        { status: 502 }
      );
    }

    return NextResponse.json({
      swapTransaction,
      lastValidBlockHeight,
      prioritizationFeeLamports: json?.prioritizationFeeLamports ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/jupiter/swapTx]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

