"use server";

import { NextRequest, NextResponse } from "next/server";

type CacheEntry = { at: number; hasTransactions: boolean };

function normalizeAptosAddress(input: string): string | null {
  const raw = (input || "").trim();
  if (!raw) return null;
  const no0x = raw.startsWith("0x") ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]{1,64}$/.test(no0x)) return null;
  return `0x${no0x.toLowerCase().padStart(64, "0")}`;
}

function getCache(): Map<string, CacheEntry> {
  const g = globalThis as unknown as { __aptosHasTxCache?: Map<string, CacheEntry> };
  g.__aptosHasTxCache ??= new Map<string, CacheEntry>();
  return g.__aptosHasTxCache;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const addressRaw = (searchParams.get("address") || "").trim();
  const address = normalizeAptosAddress(addressRaw);
  if (!address) {
    return NextResponse.json({ success: false, error: "Invalid address" }, { status: 400 });
  }

  // Derived Aptos accounts without on-chain activity are common; cache aggressively.
  const TTL_MS = 1000 * 60 * 60; // 1h
  const cache = getCache();
  const hit = cache.get(address);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) {
    return NextResponse.json(
      { success: true, address, hasTransactions: hit.hasTransactions },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
    );
  }

  try {
    // Fullnode REST: get latest tx (if any) with limit=1
    const url = new URL(`https://api.mainnet.aptoslabs.com/v1/accounts/${address}/transactions`);
    url.searchParams.set("limit", "1");
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (res.status === 404) {
      cache.set(address, { at: now, hasTransactions: false });
      return NextResponse.json(
        { success: true, address, hasTransactions: false },
        { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { success: false, address, error: `Upstream ${res.status}`, details: text.slice(0, 200) },
        { status: 502 }
      );
    }

    const json = (await res.json().catch(() => null)) as unknown;
    const hasTransactions = Array.isArray(json) ? json.length > 0 : false;
    cache.set(address, { at: now, hasTransactions });

    return NextResponse.json(
      { success: true, address, hasTransactions },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
    );
  } catch (e) {
    return NextResponse.json(
      { success: false, address, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 }
    );
  }
}

