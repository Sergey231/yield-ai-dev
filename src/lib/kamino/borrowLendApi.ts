import { InvestmentData } from "@/types/investments";
import { NATIVE_MINT } from "@solana/spl-token";

export const KAMINO_API_BASE_URL = "https://api.kamino.finance";

export type KaminoLendMarketRow = {
  name?: string;
  isPrimary?: boolean;
  description?: string;
  lendingMarket: string;
  lookupTable?: string;
  isCurated?: boolean;
};

export type KaminoLendReserveMetricsRow = Record<string, unknown> & {
  reserve?: string;
  liquidityToken?: string;
  liquidityTokenMint?: string;
  borrowApy?: string | number;
  supplyApy?: string | number;
  totalSupplyUsd?: string | number;
  totalBorrowUsd?: string | number;
  totalSupply?: string | number;
  totalBorrow?: string | number;
  maxLtv?: string | number;
};

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function toApyPercentFromFraction(apyFraction: unknown): number {
  const apy = toNumber(apyFraction, 0);
  return apy * 100;
}

function normalizeLiquiditySymbol(symbol: string, mint: string): string {
  const nativeMint = NATIVE_MINT.toBase58();
  if (mint === nativeMint) return "SOL";
  return symbol;
}

export async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    let retryAfterMs = 0;
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;

      const status = response.status;
      const shouldRetry = status === 429 || status === 502 || status === 503 || status === 504;

      const retryAfterHeader = response.headers.get("retry-after");
      retryAfterMs = retryAfterHeader ? Math.max(0, Math.floor(Number(retryAfterHeader) * 1000)) : 0;

      if (status === 429) {
        console.warn("[Kamino][BorrowLend] rate limited", { url, attempt, retryAfter: retryAfterHeader });
      }

      if (!shouldRetry || attempt === RETRY_ATTEMPTS) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === RETRY_ATTEMPTS) break;
    }

    const jitter = Math.floor(Math.random() * 250);
    await sleep(Math.max(RETRY_DELAY_MS, retryAfterMs) + jitter);
  }

  throw lastError instanceof Error ? lastError : new Error("Kamino request failed after retries");
}

/** GET /v2/kamino-market — список рынков Kamino Lend. */
export async function fetchKaminoLendMarkets(): Promise<KaminoLendMarketRow[]> {
  const res = await fetchWithRetry(`${KAMINO_API_BASE_URL}/v2/kamino-market`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Kamino markets API returned ${res.status}${text ? `: ${text}` : ""}`);
  }
  const json = (await res.json().catch(() => [])) as unknown;
  return Array.isArray(json) ? (json as KaminoLendMarketRow[]) : [];
}

/** GET /kamino-market/{lendingMarket}/reserves/metrics — метрики резервов одного рынка. */
export async function fetchKaminoLendReserveMetrics(
  lendingMarketPubkey: string
): Promise<KaminoLendReserveMetricsRow[]> {
  const key = (lendingMarketPubkey || "").trim();
  if (!key) return [];
  const url = `${KAMINO_API_BASE_URL}/kamino-market/${key}/reserves/metrics?env=mainnet-beta`;
  const res = await fetchWithRetry(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    console.warn("[Kamino][BorrowLend] reserve metrics unavailable", { key, status: res.status });
    return [];
  }
  const json = (await res.json().catch(() => [])) as unknown;
  return Array.isArray(json) ? (json as KaminoLendReserveMetricsRow[]) : [];
}

export async function mapWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let nextIdx = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (true) {
      const i = nextIdx++;
      if (i >= items.length) break;
      out[i] = await mapper(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export type KaminoLendMarketsAndReserves = {
  markets: KaminoLendMarketRow[];
  reservesByMarket: Record<string, KaminoLendReserveMetricsRow[]>;
};

/** Загружает все рынки и параллельно — метрики резервов по каждому `lendingMarket`. */
export async function fetchKaminoLendMarketsAndReserves(opts?: {
  reserveMetricsConcurrency?: number;
}): Promise<KaminoLendMarketsAndReserves> {
  const markets = await fetchKaminoLendMarkets();
  const targets = markets;

  const concurrency = opts?.reserveMetricsConcurrency ?? 6;
  const pairs = await mapWithConcurrencyLimit(targets, concurrency, async (m) => {
    const lendingMarket = (m.lendingMarket || "").trim();
    if (!lendingMarket) return { lendingMarket: "", rows: [] as KaminoLendReserveMetricsRow[] };
    const rows = await fetchKaminoLendReserveMetrics(lendingMarket);
    return { lendingMarket, rows };
  });

  const reservesByMarket: Record<string, KaminoLendReserveMetricsRow[]> = {};
  for (const p of pairs) {
    if (!p.lendingMarket) continue;
    reservesByMarket[p.lendingMarket] = p.rows;
  }

  return { markets, reservesByMarket };
}

export function mapKaminoLendReserveRowToInvestment(
  row: KaminoLendReserveMetricsRow,
  ctx: { lendingMarket: string; marketName?: string },
  opts?: { minTvlUsd?: number }
): InvestmentData | null {
  const minTvlUsd = typeof opts?.minTvlUsd === "number" && opts.minTvlUsd > 0 ? opts.minTvlUsd : 50_000;

  const reserve = String(row.reserve ?? "").trim();
  const mint = String(row.liquidityTokenMint ?? "").trim();
  const rawSymbol = String(row.liquidityToken ?? "").trim();
  if (!reserve || !mint) return null;

  const tvlUSD = toNumber(row.totalSupplyUsd, 0);
  if (tvlUSD < minTvlUsd) return null;

  const depositApy = toApyPercentFromFraction(row.supplyApy);
  const borrowAPY = toApyPercentFromFraction(row.borrowApy);

  const symbol = normalizeLiquiditySymbol(rawSymbol || "Unknown", mint);
  const marketLabel = (ctx.marketName || "").trim();
  const asset = marketLabel ? `${symbol} · ${marketLabel}` : symbol;

  const totalSupply = toNumber(row.totalSupply, 0);
  const totalBorrow = toNumber(row.totalBorrow, 0);
  const utilization =
    totalSupply > 0 && Number.isFinite(totalBorrow) ? Math.min(1, Math.max(0, totalBorrow / totalSupply)) : undefined;

  return {
    asset,
    provider: "Kamino",
    totalAPY: depositApy,
    depositApy,
    borrowAPY,
    token: mint,
    protocol: "Kamino",
    tvlUSD,
    dailyVolumeUSD: 0,
    poolType: "Lending",
    marketAddress: ctx.lendingMarket,
    utilization,
    totalSupply,
    totalBorrow,
    originalPool: {
      kind: "kamino_lend_reserve",
      lendingMarket: ctx.lendingMarket,
      marketName: ctx.marketName,
      reserve,
      liquidityToken: rawSymbol,
      liquidityTokenMint: mint,
      maxLtv: row.maxLtv,
      borrowApy: row.borrowApy,
      supplyApy: row.supplyApy,
      totalSupplyUsd: row.totalSupplyUsd,
      totalBorrowUsd: row.totalBorrowUsd,
    },
  } satisfies InvestmentData;
}

export function buildKaminoLendInvestmentsFromBundle(
  bundle: KaminoLendMarketsAndReserves,
  opts?: { minTvlUsd?: number; lendingMarketFilter?: string | null }
): InvestmentData[] {
  const filter = (opts?.lendingMarketFilter || "").trim() || null;
  const marketNameByPubkey = new Map<string, string>();
  for (const m of bundle.markets) {
    const k = (m.lendingMarket || "").trim();
    if (!k) continue;
    marketNameByPubkey.set(k, String(m.name || "").trim());
  }

  const out: InvestmentData[] = [];
  for (const [lendingMarket, rows] of Object.entries(bundle.reservesByMarket)) {
    if (filter && lendingMarket !== filter) continue;
    const marketName = marketNameByPubkey.get(lendingMarket);
    for (const row of rows) {
      const inv = mapKaminoLendReserveRowToInvestment(row, { lendingMarket, marketName }, opts);
      if (inv) out.push(inv);
    }
  }

  out.sort((a, b) => (b.totalAPY || 0) - (a.totalAPY || 0));
  return out;
}
