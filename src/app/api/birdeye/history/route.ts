import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/birdeye/history?address=<token>&type=<1m|15m|1H|4H|1D>&time_from=<unix>&time_to=<unix>&chain=<solana|aptos>
 *
 * Proxies Birdeye Data Services (public-api.birdeye.so) so the API key stays server-side.
 * Docs: https://docs.birdeye.so/reference/get-defi-history_price
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const chain = (searchParams.get("chain") || "solana").trim().toLowerCase();
    const address = (searchParams.get("address") || "").trim();
    const type = (searchParams.get("type") || "1H").trim();
    const timeFrom = (searchParams.get("time_from") || "").trim();
    const timeTo = (searchParams.get("time_to") || "").trim();

    if (chain !== "solana" && chain !== "aptos") {
      return NextResponse.json({ success: false, message: "chain must be solana or aptos" }, { status: 400 });
    }

    if (!address || !timeFrom || !timeTo) {
      return NextResponse.json(
        { success: false, message: "address, time_from, and time_to are required" },
        { status: 400 }
      );
    }

    const apiKey = (
      process.env.BIRDEYE_API_KEY ||
      process.env.NEXT_PUBLIC_BIRDEYE_API_KEY ||
      ""
    ).trim();

    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          message: "Missing BIRDEYE_API_KEY on the server",
          hint: "https://docs.birdeye.so/docs/authentication-api-keys",
        },
        { status: 503 }
      );
    }

    const url = new URL("https://public-api.birdeye.so/defi/history_price");
    url.searchParams.set("address", address);
    url.searchParams.set("type", type);
    url.searchParams.set("time_from", timeFrom);
    url.searchParams.set("time_to", timeTo);
    url.searchParams.set("address_type", "token");

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-API-KEY": apiKey,
        "x-chain": chain,
      },
      cache: "no-store",
    });

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          message: `Birdeye history_price failed: ${res.status}`,
          request: {
            chain,
            address,
            type,
            time_from: timeFrom,
            time_to: timeTo,
            url: url.toString(),
          },
          details: text.length < 2000 ? text : text.slice(0, 2000),
        },
        { status: 502 }
      );
    }

    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { success: false, message: "Invalid JSON from Birdeye", raw: text.slice(0, 500) };
    }

    return NextResponse.json(json, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/birdeye/history]", msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}
