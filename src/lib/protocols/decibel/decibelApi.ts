import type { DecibelMarketConfig } from "@/lib/protocols/decibel/closePosition";

const DECIBEL_API_KEY = process.env.DECIBEL_API_KEY;
const DECIBEL_API_BASE_URL =
  process.env.DECIBEL_API_BASE_URL || "https://api.testnet.aptoslabs.com/decibel";

export type DecibelMarketRow = DecibelMarketConfig & {
  market_addr?: string;
  market_name?: string;
};

export async function fetchDecibel(path: string): Promise<unknown> {
  if (!DECIBEL_API_KEY) throw new Error("Decibel API key not configured");
  const baseUrl = DECIBEL_API_BASE_URL.replace(/\/$/, "");
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${DECIBEL_API_KEY}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("Invalid response from Decibel API");
  }
  if (!res.ok) {
    const msg =
      typeof data === "object" && data !== null && "message" in (data as object)
        ? String((data as { message?: string }).message)
        : `Decibel API error: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export function normalizeDecibelMarketsPayload(data: unknown): DecibelMarketRow[] {
  if (Array.isArray(data)) return data as DecibelMarketRow[];
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  const candidates: unknown[] = [];
  if (Array.isArray(obj.items)) candidates.push(...obj.items);
  if (Array.isArray(obj.markets)) candidates.push(...obj.markets);
  if (Array.isArray(obj.data)) candidates.push(...obj.data);
  return candidates as DecibelMarketRow[];
}

export function resolveDecibelMarketByName(
  marketKey: string,
  markets: DecibelMarketRow[]
): (DecibelMarketRow & { market_addr: string; market_name: string }) | null {
  const normalized = marketKey.trim().replace(/-/g, "/").replace(/USDC/gi, "USD").toUpperCase();
  const selected = markets.find((m) => {
    const name = (m.market_name || "").trim().replace(/-/g, "/").replace(/USDC/gi, "USD").toUpperCase();
    return name === normalized;
  });
  if (!selected?.market_addr || !selected.market_name) return null;
  return {
    ...selected,
    market_addr: selected.market_addr,
    market_name: selected.market_name,
  };
}

export function resolveMarketForBtcOrApt(
  asset: "BTC" | "APT",
  markets: DecibelMarketRow[]
): (DecibelMarketRow & { market_addr: string; market_name: string }) | null {
  const extractBaseSymbol = (name: string): string => {
    const upper = name.toUpperCase();
    return upper.split(/[-/_\s]/)[0] || upper;
  };
  const candidates = markets.filter((m) => {
    const name = (m.market_name || "").toUpperCase();
    if (!name) return false;
    if (name.startsWith(`${asset}-`) || name.startsWith(`${asset}/`) || name.startsWith(`${asset}_`)) {
      return true;
    }
    return extractBaseSymbol(name) === asset;
  });
  const selected = candidates[0];
  if (!selected?.market_addr || !selected.market_name) return null;
  return {
    ...selected,
    market_addr: selected.market_addr,
    market_name: selected.market_name,
  };
}

export async function fetchDecibelMarkPx(marketAddr: string): Promise<number | null> {
  const prices = (await fetchDecibel(
    `/api/v1/prices?market=${encodeURIComponent(marketAddr)}`
  )) as Array<{ mark_px?: number; mid_px?: number }>;
  const first = Array.isArray(prices) ? prices[0] : null;
  const markPx = Number(first?.mark_px ?? first?.mid_px ?? NaN);
  return Number.isFinite(markPx) && markPx > 0 ? markPx : null;
}
