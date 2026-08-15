import { NextResponse } from "next/server";
import { InvestmentData, TokenInfo } from "@/types/investments";
import { getPreferredJupiterTokenIcon } from "@/lib/services/solana/jupiterTokenIcons";
import { resolveOrcaPoolAprPct } from "@/lib/services/orca/poolApr";
import {
  getSolanaSwapAllowlistMints,
  poolUsesOnlySwapAllowlistedMints,
} from "@/lib/solana/swapAllowlist";

export const dynamic = "force-dynamic";

const ORCA_API_BASE = "https://api.orca.so/v2/solana";
const MIN_TVL_USD = 1_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

type OrcaToken = {
  address: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  imageUrl?: string;
};

type OrcaPoolStats = {
  volume?: string | null;
  fees?: string | null;
  rewards?: string | null;
  yieldOverTvl?: string | null;
};

type OrcaPool = {
  address: string;
  tokenMintA: string;
  tokenMintB: string;
  tokenA?: OrcaToken;
  tokenB?: OrcaToken;
  tvlUsdc?: string;
  feeRate?: number;
  tickSpacing?: number;
  poolType?: string;
  hasWarning?: boolean;
  yieldOverTvl?: string;
  stats?: Record<string, OrcaPoolStats>;
};

type OrcaPoolsResponse = {
  data?: OrcaPool[];
};

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSymbol(symbol: string | undefined, mint: string): string {
  const raw = (symbol || "").trim();
  if (raw.toUpperCase() === "WSOL") return "SOL";
  if (raw) return raw;
  return `${mint.slice(0, 4)}…`;
}

function mapTokenInfo(token: OrcaToken | undefined, mint: string): TokenInfo {
  const symbol = normalizeSymbol(token?.symbol, mint);
  return {
    symbol,
    name: token?.name || symbol,
    decimals: typeof token?.decimals === "number" ? token.decimals : 9,
    logoUrl: getPreferredJupiterTokenIcon(symbol, token?.imageUrl),
  };
}

function mapPoolToInvestment(pool: OrcaPool): InvestmentData {
  const mintA = pool.tokenMintA;
  const mintB = pool.tokenMintB;
  const token1Info = mapTokenInfo(pool.tokenA, mintA);
  const token2Info = mapTokenInfo(pool.tokenB, mintB);
  const totalAPY = resolveOrcaPoolAprPct(pool);
  const tvlUSD = toNumber(pool.tvlUsdc, 0);
  const volume24h = toNumber(pool.stats?.["24h"]?.volume, 0);
  const feeRateBps = typeof pool.feeRate === "number" ? pool.feeRate : 0;

  return {
    asset: `${token1Info.symbol}/${token2Info.symbol}`,
    provider: "Orca",
    totalAPY,
    depositApy: totalAPY,
    borrowAPY: 0,
    token: pool.address,
    protocol: "Orca",
    tvlUSD,
    dailyVolumeUSD: volume24h,
    poolType: "DEX",
    feeTier: feeRateBps > 0 ? feeRateBps / 10_000 : undefined,
    token1Info,
    token2Info,
    originalPool: {
      poolAddress: pool.address,
      tokenMintA: mintA,
      tokenMintB: mintB,
      tickSpacing: pool.tickSpacing,
      poolType: pool.poolType,
      hasWarning: pool.hasWarning,
    },
  };
}

async function fetchPoolsPage(cursor?: string): Promise<{ pools: OrcaPool[]; next?: string }> {
  const params = new URLSearchParams({
    size: String(PAGE_SIZE),
    stats: "24h,7d",
    sortBy: "tvl",
    sortDirection: "desc",
    minTvl: String(MIN_TVL_USD),
  });
  if (cursor) params.set("next", cursor);

  const response = await fetch(`${ORCA_API_BASE}/pools?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Orca API returned ${response.status}`);
  }

  const payload = (await response.json()) as OrcaPoolsResponse & {
    meta?: { cursor?: { next?: string | null } };
  };
  const pools = Array.isArray(payload.data) ? payload.data : [];
  const next = payload.meta?.cursor?.next ?? undefined;
  return { pools, next: next || undefined };
}

async function fetchAllowlistedPools(): Promise<OrcaPool[]> {
  const allowlist = getSolanaSwapAllowlistMints();
  const byAddress = new Map<string, OrcaPool>();
  let cursor: string | undefined;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const { pools, next } = await fetchPoolsPage(cursor);
    for (const pool of pools) {
      if (!pool?.address) continue;
      if (!poolUsesOnlySwapAllowlistedMints(pool.tokenMintA, pool.tokenMintB, allowlist)) {
        continue;
      }
      const tvlUSD = toNumber(pool.tvlUsdc, 0);
      if (tvlUSD < MIN_TVL_USD) continue;
      byAddress.set(pool.address, pool);
    }

    if (!next) break;
    cursor = next;
    pages += 1;
  }

  return Array.from(byAddress.values());
}

type OrcaPoolsCache = {
  atMs: number;
  payload: { success: true; data: InvestmentData[]; count: number };
};

const CACHE_TTL_MS = 2 * 60 * 1000;
let cache: OrcaPoolsCache | null = null;
let inFlight: Promise<OrcaPoolsCache> | null = null;

/**
 * GET /api/protocols/orca/pools
 * Orca Whirlpool CLMM pools for Ideas, filtered to swap-allowlisted token pairs.
 */
export async function GET() {
  try {
    const now = Date.now();
    if (cache && now - cache.atMs <= CACHE_TTL_MS) {
      return NextResponse.json(cache.payload, {
        headers: {
          "Cache-Control": "public, max-age=120, s-maxage=120, stale-while-revalidate=300",
          "Cdn-Cache-Control": "max-age=120",
          "Surrogate-Control": "max-age=120",
        },
      });
    }

    if (inFlight) {
      const refreshed = await inFlight;
      return NextResponse.json(refreshed.payload, {
        headers: {
          "Cache-Control": "public, max-age=120, s-maxage=120, stale-while-revalidate=300",
          "Cdn-Cache-Control": "max-age=120",
          "Surrogate-Control": "max-age=120",
        },
      });
    }

    inFlight = (async (): Promise<OrcaPoolsCache> => {
      const pools = await fetchAllowlistedPools();
      const data = pools
        .map(mapPoolToInvestment)
        .filter((row) => row.totalAPY > 0)
        .sort((a, b) => (b.totalAPY || 0) - (a.totalAPY || 0));

      const payload = { success: true as const, data, count: data.length };
      const nextCache: OrcaPoolsCache = { atMs: Date.now(), payload };
      cache = nextCache;
      return nextCache;
    })();

    const refreshed = await inFlight;
    return NextResponse.json(refreshed.payload, {
      headers: {
        "Cache-Control": "public, max-age=120, s-maxage=120, stale-while-revalidate=300",
        "Cdn-Cache-Control": "max-age=120",
        "Surrogate-Control": "max-age=120",
      },
    });
  } catch (error) {
    console.error("[Orca][Pools] error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        data: [],
        count: 0,
      },
      { status: 500 }
    );
  } finally {
    inFlight = null;
  }
}
