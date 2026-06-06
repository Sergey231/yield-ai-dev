/**
 * Meteora DLMM "datapi" pool-meta lookup with an in-memory TTL cache.
 *
 * Endpoint: GET https://dlmm.datapi.meteora.ag/pools/{address}
 * Public, no auth, returns the same `apr` / `apy` numbers Meteora's own UI uses,
 * so we don't need to derive them client-side.
 *
 * Cached server-side because the same pool address gets requested once per
 * user-position fetch and Meteora's datapi rate-limits aggressively. TTL is
 * generous (5 min) — APR/TVL are slow-moving compared to per-second prices.
 */
export interface MeteoraPoolMeta {
  /** Daily fee yield in % (e.g. 0.12 = 0.12% in the last 24h). */
  apr24hPct: number;
  /** Annualized fee yield in % (e.g. 54.92). */
  apyPct: number;
  /** Farm/LM emissions APR — usually 0 for SOL/USDC, present on incentivized pools. */
  farmAprPct: number;
  /** Farm/LM emissions APY. */
  farmApyPct: number;
  /** Total APY = swap fees + farm. Convenience field for UI. */
  totalApyPct: number;
  tvlUsd: number;
  volume24hUsd: number;
  fees24hUsd: number;
  /** Mid-pool price in tokenY per tokenX. Useful as a cross-check vs `pricePerY`. */
  currentPrice: number;
}

interface CacheEntry {
  expiresAt: number;
  data: MeteoraPoolMeta | null; // null = recent miss, don't refetch instantly
}

const DATAPI_BASE = "https://dlmm.datapi.meteora.ag";
const TTL_MS = 5 * 60 * 1000; // 5 minutes for hits
const MISS_TTL_MS = 30 * 1000; // 30 seconds for misses (datapi 429s recover quickly)

function getCache(): Map<string, CacheEntry> {
  const g = globalThis as unknown as { __meteoraPoolMetaCache?: Map<string, CacheEntry> };
  if (!g.__meteoraPoolMetaCache) g.__meteoraPoolMetaCache = new Map();
  return g.__meteoraPoolMetaCache;
}

function pickNumber(obj: unknown, ...path: string[]): number {
  let cur: unknown = obj;
  for (const k of path) {
    if (!cur || typeof cur !== "object") return 0;
    cur = (cur as Record<string, unknown>)[k];
  }
  const n = Number(cur);
  return Number.isFinite(n) ? n : 0;
}

export async function getMeteoraPoolMeta(poolAddress: string): Promise<MeteoraPoolMeta | null> {
  if (!poolAddress) return null;
  const cache = getCache();
  const now = Date.now();
  const cached = cache.get(poolAddress);
  if (cached && cached.expiresAt > now) return cached.data;

  try {
    const resp = await fetch(`${DATAPI_BASE}/pools/${poolAddress}`, { cache: "no-store" });
    if (!resp.ok) {
      cache.set(poolAddress, { expiresAt: now + MISS_TTL_MS, data: null });
      return null;
    }
    const json = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
    if (!json) {
      cache.set(poolAddress, { expiresAt: now + MISS_TTL_MS, data: null });
      return null;
    }
    const apr24hPct = pickNumber(json, "apr");
    const apyPct = pickNumber(json, "apy");
    const farmAprPct = pickNumber(json, "farm_apr");
    const farmApyPct = pickNumber(json, "farm_apy");
    const meta: MeteoraPoolMeta = {
      apr24hPct,
      apyPct,
      farmAprPct,
      farmApyPct,
      totalApyPct: apyPct + farmApyPct,
      tvlUsd: pickNumber(json, "tvl"),
      volume24hUsd: pickNumber(json, "volume", "24h"),
      fees24hUsd: pickNumber(json, "fees", "24h"),
      currentPrice: pickNumber(json, "current_price"),
    };
    cache.set(poolAddress, { expiresAt: now + TTL_MS, data: meta });
    return meta;
  } catch {
    cache.set(poolAddress, { expiresAt: now + MISS_TTL_MS, data: null });
    return null;
  }
}

/** Batch helper — parallel fetches with shared cache. */
export async function getMeteoraPoolMetaMap(
  addresses: string[]
): Promise<Record<string, MeteoraPoolMeta | null>> {
  const unique = [...new Set(addresses.filter(Boolean))];
  const results = await Promise.all(unique.map((a) => getMeteoraPoolMeta(a).then((m) => [a, m] as const)));
  return Object.fromEntries(results);
}
