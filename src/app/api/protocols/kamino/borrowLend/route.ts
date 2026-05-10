import { NextRequest, NextResponse } from "next/server";
import { JupiterTokenMetadataService } from "@/lib/services/solana/tokenMetadata";
import {
  buildKaminoLendInvestmentsFromBundle,
  fetchKaminoLendMarketsAndReserves,
  type KaminoLendMarketsAndReserves,
  type KaminoLendMarketRow,
  type KaminoLendReserveMetricsRow,
} from "@/lib/kamino/borrowLendApi";
import type { InvestmentData } from "@/types/investments";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 2 * 60 * 1000;
const CACHE_STALE_MAX_MS = 15 * 60 * 1000;

type BorrowLendCache = {
  atMs: number;
  bundle: KaminoLendMarketsAndReserves;
};

let cache: BorrowLendCache | null = null;
let inFlight: Promise<BorrowLendCache> | null = null;

function parseBoolParam(sp: URLSearchParams, key: string): boolean | null {
  if (!sp.has(key)) return null;
  const v = (sp.get(key) || "").trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return null;
}

function pickMarkets(
  all: KaminoLendMarketRow[],
  lendingMarketFilter: string | null
): KaminoLendMarketRow[] {
  if (!lendingMarketFilter) return all;
  return all.filter((m) => (m.lendingMarket || "").trim() === lendingMarketFilter);
}

function pickReservesByMarket(
  bundle: KaminoLendMarketsAndReserves,
  lendingMarketFilter: string | null
): Record<string, KaminoLendReserveMetricsRow[]> {
  if (!lendingMarketFilter) return bundle.reservesByMarket;
  const rows = bundle.reservesByMarket[lendingMarketFilter];
  return { [lendingMarketFilter]: rows ?? [] };
}

async function enrichInvestmentsWithTokenMeta(data: InvestmentData[]): Promise<InvestmentData[]> {
  const mints = Array.from(new Set(data.map((d) => (d.token || "").trim()).filter(Boolean)));
  let metadataMap: Record<string, { symbol?: string; decimals?: number; logoUrl?: string }> = {};
  if (mints.length > 0) {
    try {
      const metadataService = JupiterTokenMetadataService.getInstance();
      const raw = await metadataService.getMetadataMap(mints);
      metadataMap = raw as Record<string, { symbol?: string; decimals?: number; logoUrl?: string }>;
    } catch (e) {
      console.warn("[Kamino][BorrowLend] token metadata resolve failed, continuing without it", e);
    }
  }

  return data.map((row) => {
    const meta = metadataMap[row.token];
    return {
      ...row,
      tokenDecimals: typeof row.tokenDecimals === "number" ? row.tokenDecimals : meta?.decimals,
      logoUrl: row.logoUrl || meta?.logoUrl,
    } satisfies InvestmentData;
  });
}

function jsonHeaders(ttl: "fresh" | "stale") {
  if (ttl === "stale") {
    return {
      "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
      "Cdn-Cache-Control": "max-age=60",
      "Surrogate-Control": "max-age=60",
    };
  }
  return {
    "Cache-Control": "public, max-age=120, s-maxage=120, stale-while-revalidate=300",
    "Cdn-Cache-Control": "max-age=120",
    "Surrogate-Control": "max-age=120",
  };
}

async function buildBorrowLendResponse(
  entry: BorrowLendCache,
  opts: {
    lendingMarketFilter: string | null;
    wantMarkets: boolean;
    wantReserves: boolean;
    wantPools: boolean;
    cacheTtl: "fresh" | "stale";
  }
): Promise<NextResponse> {
  const { lendingMarketFilter, wantMarkets, wantReserves, wantPools, cacheTtl } = opts;
  const { bundle, atMs } = entry;

  if (
    lendingMarketFilter &&
    !bundle.markets.some((m) => (m.lendingMarket || "").trim() === lendingMarketFilter)
  ) {
    return NextResponse.json({ success: false, error: "Неизвестный lending market" }, { status: 404 });
  }

  const payload: Record<string, unknown> = {
    success: true,
    meta: {
      fetchedAtMs: atMs,
      lendingMarketFilter,
    },
  };

  if (wantMarkets) {
    const marketsSlice = pickMarkets(bundle.markets, lendingMarketFilter);
    payload.markets = marketsSlice;
    payload.marketsCount = marketsSlice.length;
  }

  if (wantReserves) {
    payload.reservesByMarket = pickReservesByMarket(bundle, lendingMarketFilter);
  }

  if (wantPools) {
    const bundleForBuild: KaminoLendMarketsAndReserves = lendingMarketFilter
      ? {
          markets: pickMarkets(bundle.markets, lendingMarketFilter),
          reservesByMarket: pickReservesByMarket(bundle, lendingMarketFilter),
        }
      : bundle;
    const rawPools = buildKaminoLendInvestmentsFromBundle(bundleForBuild);
    payload.data = await enrichInvestmentsWithTokenMeta(rawPools);
    payload.count = (payload.data as InvestmentData[]).length;
  }

  return NextResponse.json(payload, { headers: jsonHeaders(cacheTtl) });
}

/**
 * GET /api/protocols/kamino/borrowLend
 *
 * Составной ответ (query):
 * - По умолчанию: только агрегированные пулы — `data` + `count` (резервы Kamino Lend → InvestmentData, poolType Lending).
 * - `markets=1` — добавить список рынков (`markets`, `marketsCount`).
 * - `reserves=1` — добавить сырые метрики резервов (`reservesByMarket`).
 * - `pools=0` — не включать `data` (удобно вместе с `markets=1` и/или `reserves=1`).
 * - `market=<lendingMarket_pubkey>` — сузить все секции до одного рынка.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lendingMarketFilter = (sp.get("market") || "").trim() || null;

  const wantMarkets = parseBoolParam(sp, "markets") === true;
  const wantReserves = parseBoolParam(sp, "reserves") === true;
  const poolsExplicit = parseBoolParam(sp, "pools");

  let wantPools: boolean;
  if (poolsExplicit === true) wantPools = true;
  else if (poolsExplicit === false) wantPools = false;
  else wantPools = !wantMarkets && !wantReserves;

  if (!wantPools && !wantMarkets && !wantReserves) {
    return NextResponse.json(
      {
        success: false,
        error: "Укажите хотя бы один фрагмент: pools (по умолчанию), markets=1 и/или reserves=1",
      },
      { status: 400 }
    );
  }

  try {
    const now = Date.now();

    if (cache && now - cache.atMs <= CACHE_TTL_MS) {
      return await buildBorrowLendResponse(cache, {
        lendingMarketFilter,
        wantMarkets,
        wantReserves,
        wantPools,
        cacheTtl: "fresh",
      });
    }

    if (inFlight) {
      if (cache && now - cache.atMs <= CACHE_STALE_MAX_MS) {
        return await buildBorrowLendResponse(cache, {
          lendingMarketFilter,
          wantMarkets,
          wantReserves,
          wantPools,
          cacheTtl: "stale",
        });
      }
      const refreshed = await inFlight;
      return await buildBorrowLendResponse(refreshed, {
        lendingMarketFilter,
        wantMarkets,
        wantReserves,
        wantPools,
        cacheTtl: "fresh",
      });
    }

    inFlight = (async (): Promise<BorrowLendCache> => {
      try {
        const bundle = await fetchKaminoLendMarketsAndReserves({ reserveMetricsConcurrency: 6 });
        const next: BorrowLendCache = { atMs: Date.now(), bundle };
        cache = next;
        return next;
      } catch (e) {
        console.warn("[Kamino][BorrowLend] upstream bundle fetch failed, returning empty", e);
        const empty: KaminoLendMarketsAndReserves = { markets: [], reservesByMarket: {} };
        const next: BorrowLendCache = { atMs: Date.now(), bundle: empty };
        cache = next;
        return next;
      }
    })();

    const refreshed = await inFlight;
    return await buildBorrowLendResponse(refreshed, {
      lendingMarketFilter,
      wantMarkets,
      wantReserves,
      wantPools,
      cacheTtl: "fresh",
    });
  } catch (error) {
    console.warn("[Kamino][BorrowLend] error", error);
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
