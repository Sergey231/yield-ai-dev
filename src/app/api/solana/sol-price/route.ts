import { NextResponse } from "next/server";

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Server-side proxy for the SOL/USD price (Jupiter Price API v3).
 * Keeps the optional Jupiter API key server-side and avoids client CORS.
 */
export async function GET() {
  try {
    const url = new URL("https://api.jup.ag/price/v3");
    url.searchParams.set("ids", WRAPPED_SOL_MINT);

    const headers: HeadersInit = { Accept: "application/json" };
    const apiKey = process.env.JUP_API_KEY || process.env.NEXT_PUBLIC_JUP_API_KEY;
    if (apiKey) headers["x-api-key"] = apiKey;

    const res = await fetch(url.toString(), { headers, cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ price: null }, { status: 200 });
    }

    const json: unknown = await res.json().catch(() => null);
    // v3: { data: { [mint]: { price | usdPrice } } } — some gateways flatten it.
    const o = (json ?? {}) as Record<string, unknown>;
    const dataObj = (o.data && typeof o.data === "object" ? o.data : o) as Record<string, unknown>;
    const row = dataObj?.[WRAPPED_SOL_MINT] as { price?: number; usdPrice?: number } | undefined;
    const p =
      typeof row?.usdPrice === "number"
        ? row.usdPrice
        : typeof row?.price === "number"
          ? row.price
          : null;

    return NextResponse.json({ price: Number.isFinite(p) && (p as number) > 0 ? p : null });
  } catch {
    return NextResponse.json({ price: null }, { status: 200 });
  }
}
