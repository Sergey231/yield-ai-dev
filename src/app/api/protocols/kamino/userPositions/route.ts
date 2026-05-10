import { NextRequest, NextResponse } from "next/server";
import { JupiterTokenMetadataService } from "@/lib/services/solana/tokenMetadata";
import { extractKvaultVaultAddress, isLikelySolanaAddress } from "@/lib/kamino/kvaultVaultAddress";
import Decimal from "decimal.js";
import { loadKaminoVaultForAddress } from "@/lib/solana/kaminoTxServer";

const KAMINO_API_BASE_URL = "https://api.kamino.finance";
const RETRY_ATTEMPTS = 5;
const RETRY_DELAY_MS = 2000;
const KNOWN_SOLANA_TOKEN_BY_MINT: Record<string, { symbol: string; logoUrl?: string }> = {
  // Wrapped SOL
  So11111111111111111111111111111111111111112: { symbol: "SOL", logoUrl: "/token_ico/sol.png" },
  // Stables / majors used across Jupiter/Kamino
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", logoUrl: "/token_ico/usdc.png" },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", logoUrl: "/token_ico/usdt.png" },
  "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH": { symbol: "USDG", logoUrl: "/token_ico/usdg.png" },
  USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA: { symbol: "USDS", logoUrl: "/token_ico/usds.png" },
  JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD: { symbol: "JupUSD", logoUrl: "/token_ico/jupusd.png" },
  HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr: { symbol: "EURC", logoUrl: "/token_ico/eurc.png" },
};

type JupiterTokenPriceRow = {
  id: string;
  usdPrice?: number;
};

type KaminoVaultMetrics = Record<string, unknown> & {
  apy?: string | number;
};

type KaminoMarketRow = {
  lendingMarket: string;
  name?: string;
  isPrimary?: boolean;
};

type KaminoReserveMetricsRow = Record<string, unknown>;

const DEFAULT_PUBKEY = "11111111111111111111111111111111";

type TimedCache<T> = { atMs: number; value: T };
const CACHE_MARKETS_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const CACHE_VAULTS_TTL_MS = 60 * 60 * 1000; // 1h
let marketsCache: TimedCache<KaminoMarketRow[]> | null = null;
let vaultCatalogCache: TimedCache<KaminoVaultCatalogRow[]> | null = null;

type KaminoUserPositionsApiResponse =
  | { success: true; data: unknown[]; count: number; meta?: any; debug?: any }
  | { success: false; error: string; data: unknown[]; count: number };

type KaminoUserPositionsSWR = {
  freshUntilMs: number;
  staleUntilMs: number;
  payload: KaminoUserPositionsApiResponse;
};

const USER_POSITIONS_FRESH_TTL_MS = 30_000;
const USER_POSITIONS_STALE_TTL_MS = 15 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getGlobalInFlight(): Map<string, Promise<unknown>> {
  const g = globalThis as any;
  g.__kaminoUserPositionsInFlight ??= new Map<string, Promise<unknown>>();
  return g.__kaminoUserPositionsInFlight as Map<string, Promise<unknown>>;
}

function getGlobalSWRCache(): Map<string, KaminoUserPositionsSWR> {
  const g = globalThis as any;
  g.__kaminoUserPositionsSWR ??= new Map<string, KaminoUserPositionsSWR>();
  return g.__kaminoUserPositionsSWR as Map<string, KaminoUserPositionsSWR>;
}

function getGlobalRefreshInFlight(): Map<string, Promise<void>> {
  const g = globalThis as any;
  g.__kaminoUserPositionsRefreshInFlight ??= new Map<string, Promise<void>>();
  return g.__kaminoUserPositionsRefreshInFlight as Map<string, Promise<void>>;
}

function isCacheFresh(entry: TimedCache<unknown> | null, ttlMs: number): boolean {
  if (!entry) return false;
  return Date.now() - entry.atMs <= ttlMs;
}

async function mapWithConcurrencyLimit<T, R>(
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

function shouldRetryStatus(status: number): boolean {
  return (
    status === 429 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

async function getKaminoMarketsCached(): Promise<KaminoMarketRow[]> {
  if (isCacheFresh(marketsCache, CACHE_MARKETS_TTL_MS)) return marketsCache!.value;
  const marketsRes = await fetchWithRetry(`${KAMINO_API_BASE_URL}/v2/kamino-market`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!marketsRes.ok) {
    const text = await marketsRes.text().catch(() => "");
    throw new Error(`Kamino markets API returned ${marketsRes.status}${text ? `: ${text}` : ""}`);
  }
  const markets = (await marketsRes.json()) as KaminoMarketRow[];
  const list = Array.isArray(markets) ? markets : [];
  marketsCache = { atMs: Date.now(), value: list };
  return list;
}

async function getKaminoVaultCatalogCached(): Promise<KaminoVaultCatalogRow[]> {
  if (isCacheFresh(vaultCatalogCache, CACHE_VAULTS_TTL_MS)) return vaultCatalogCache!.value;
  try {
    const vaultsRes = await fetchWithRetry(`${KAMINO_API_BASE_URL}/kvaults/vaults`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!vaultsRes.ok) {
      vaultCatalogCache = { atMs: Date.now(), value: [] };
      return [];
    }
    const j = await vaultsRes.json().catch(() => []);
    const list = Array.isArray(j) ? j : [];
    vaultCatalogCache = { atMs: Date.now(), value: list };
    return list;
  } catch {
    vaultCatalogCache = { atMs: Date.now(), value: [] };
    return [];
  }
}

function getDeep(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const p of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[p];
  }
  return current;
}

type ReserveMeta = {
  mint?: string;
  symbol?: string;
  logoUrl?: string;
  priceUsd?: number;
  /** Fraction, e.g. 0.054 = 5.4% */
  borrowApy?: number;
  /** Fraction, e.g. 0.038 = 3.8% */
  supplyApy?: number;
};

type TokenMeta = { symbol?: string; logoUrl?: string; decimals?: number };

function sfToDecimal(valueSf: unknown): Decimal | null {
  const d = parseDecimal(valueSf);
  if (!d) return null;
  // Kamino uses *_Sf fixed point numbers (commonly 1e18).
  // Treat as scaled if it's "big" (most are huge integers).
  return d.greaterThan(1_000_000) ? d.div(new Decimal("1e18")) : d;
}

function wadToDecimal(valueWad: unknown): Decimal | null {
  const d = parseDecimal(valueWad);
  if (!d) return null;
  return d.div(new Decimal("1e18"));
}

function baseUnitsToDecimal(value: unknown, decimals: number | undefined): Decimal | null {
  const d = parseDecimal(value);
  if (!d) return null;
  const dec = typeof decimals === "number" && Number.isFinite(decimals) && decimals >= 0 ? decimals : null;
  if (dec == null) return d;
  return d.div(new Decimal(10).pow(dec));
}

function buildKnownTokenMetaByMint(): Record<string, TokenMeta> {
  const out: Record<string, TokenMeta> = {};
  for (const [mint, meta] of Object.entries(KNOWN_SOLANA_TOKEN_BY_MINT)) {
    out[mint] = { symbol: meta.symbol, logoUrl: meta.logoUrl };
  }
  // Common decimals
  out["So11111111111111111111111111111111111111112"] = { ...(out["So11111111111111111111111111111111111111112"] ?? {}), decimals: 9 };
  out["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"] = { ...(out["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"] ?? {}), decimals: 6 };
  out["Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"] = { ...(out["Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"] ?? {}), decimals: 6 };
  return out;
}

async function fetchJupiterTokenMetaMap(mints: string[]): Promise<Record<string, TokenMeta>> {
  const out: Record<string, TokenMeta> = {};
  const uniq = Array.from(new Set(mints.map((m) => (m || "").trim()).filter(Boolean)));
  if (uniq.length === 0) return out;
  try {
    // Use the shared singleton (constructor is private).
    const svc = JupiterTokenMetadataService.getInstance();
    const map = await svc.getMetadataMap(uniq);
    for (const [mint, meta] of Object.entries(map)) {
      const m = (mint || "").trim();
      if (!m) continue;
      out[m] = {
        symbol: typeof meta?.symbol === "string" ? meta.symbol.trim() : undefined,
        logoUrl: typeof meta?.logoUrl === "string" ? meta.logoUrl.trim() : undefined,
        decimals: typeof meta?.decimals === "number" ? meta.decimals : undefined,
      };
    }
  } catch {
    // ignore
  }
  return out;
}

function buildReserveMetaByReservePubkey(rows: KaminoReserveMetricsRow[]): Record<string, ReserveMeta> {
  const out: Record<string, ReserveMeta> = {};
  for (const r of rows) {
    const reserve =
      String(getDeep(r, "reserve") ?? getDeep(r, "reservePubkey") ?? getDeep(r, "reserveAddress") ?? "").trim();
    if (!reserve || reserve === DEFAULT_PUBKEY) continue;
    const mint =
      String(
        // Kamino reserves metrics fields (2026):
        // { reserve, liquidityToken, liquidityTokenMint, ... }
        getDeep(r, "liquidityTokenMint") ??
          getDeep(r, "liquidityMint") ??
          getDeep(r, "liquidityMintPubkey") ??
          getDeep(r, "mint") ??
          getDeep(r, "mintAddress") ??
          ""
      ).trim() || undefined;
    const symbol = String(
      getDeep(r, "liquidityToken") ?? getDeep(r, "liquiditySymbol") ?? getDeep(r, "symbol") ?? ""
    ).trim() || undefined;
    const totalSupply = parseDecimal(getDeep(r, "totalSupply"));
    const totalSupplyUsd = parseDecimal(getDeep(r, "totalSupplyUsd"));
    const priceUsd =
      totalSupply && totalSupplyUsd && totalSupply.greaterThan(0)
        ? totalSupplyUsd.div(totalSupply).toNumber()
        : undefined;
    const borrowApyRaw = Number(getDeep(r, "borrowApy"));
    const supplyApyRaw = Number(getDeep(r, "supplyApy"));
    const borrowApy =
      Number.isFinite(borrowApyRaw) && borrowApyRaw > 0 ? borrowApyRaw : undefined;
    const supplyApy =
      Number.isFinite(supplyApyRaw) && supplyApyRaw > 0 ? supplyApyRaw : undefined;
    out[reserve] = {
      mint,
      symbol,
      priceUsd:
        typeof priceUsd === "number" && Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : undefined,
      borrowApy,
      supplyApy,
    };
  }
  return out;
}

async function fetchMarketReservesMetricsCached(marketPubkey: string): Promise<KaminoReserveMetricsRow[]> {
  const key = (marketPubkey || "").trim();
  if (!key) return [];
  // Cache alongside other Kamino caches (same TTL as markets).
  const cacheKey = `reserves:${key}`;
  (globalThis as any).__kaminoReservesCache ??= new Map<string, TimedCache<KaminoReserveMetricsRow[]>>();
  const cache: Map<string, TimedCache<KaminoReserveMetricsRow[]>> = (globalThis as any).__kaminoReservesCache;
  const cached = cache.get(cacheKey) ?? null;
  if (cached && isCacheFresh(cached, CACHE_MARKETS_TTL_MS)) return cached.value;

  try {
    const url = `${KAMINO_API_BASE_URL}/kamino-market/${key}/reserves/metrics?env=mainnet-beta`;
    const res = await fetchWithRetry(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      cache.set(cacheKey, { atMs: Date.now(), value: [] });
      return [];
    }
    const json = await res.json().catch(() => []);
    const list = Array.isArray(json) ? (json as KaminoReserveMetricsRow[]) : [];
    cache.set(cacheKey, { atMs: Date.now(), value: list });
    return list;
  } catch {
    cache.set(cacheKey, { atMs: Date.now(), value: [] });
    return [];
  }
}

function slimKaminoObligation(
  obligation: unknown,
  reserveMetaByReserve: Record<string, ReserveMeta>,
  usdPriceByMint: Map<string, number>,
  tokenMetaByMint: Record<string, TokenMeta>
): unknown {
  if (!obligation || typeof obligation !== "object") return obligation;
  // This endpoint's payload can be extremely large. We only need the deposit USD totals for UI.
  // Keep a minimal subset to preserve value calculations in both sidebar and manage positions,
  // plus deposit/borrow summary for net asset computation and proper token labels/icons.
  const refreshedUserTotalDeposit = getDeep(obligation, "refreshedStats.userTotalDeposit");
  const refreshedUserTotalBorrow = getDeep(obligation, "refreshedStats.userTotalBorrow");
  const refreshedNetAccountValue = getDeep(obligation, "refreshedStats.netAccountValue");
  const refreshedBorrowLiquidationLimit = getDeep(obligation, "refreshedStats.borrowLiquidationLimit");
  const statsUserTotalDeposit = getDeep(obligation, "obligationStats.userTotalDeposit");
  const userTotalDeposit = getDeep(obligation, "userTotalDeposit");
  const depositedValueUsd = getDeep(obligation, "depositedValueUsd");
  const totalDepositUsd = getDeep(obligation, "totalDepositUsd");

  const rawDeposits = getDeep(obligation, "state.deposits");
  const deposits = Array.isArray(rawDeposits)
    ? rawDeposits
        .map((d) => {
          if (!d || typeof d !== "object") return null;
          const o = d as Record<string, unknown>;
          const depositReserve = String(o.depositReserve ?? "").trim();
          const depositedAmountSf = String(o.depositedAmountSf ?? "").trim();
          const marketValueSf = String(o.marketValueSf ?? "").trim();
          const hasDeposit = String(o.hasDeposit ?? "").trim() === "1" || Boolean(o.hasDeposit);
          if (!depositReserve || depositReserve === DEFAULT_PUBKEY) return null;
          if (!hasDeposit && depositedAmountSf === "0") return null;

          const meta = reserveMetaByReserve[depositReserve] ?? {};
          const supplyApyPct =
            typeof meta.supplyApy === "number" && Number.isFinite(meta.supplyApy) && meta.supplyApy > 0
              ? meta.supplyApy * 100
              : 0;
          const mint = (meta.mint || "").trim();
          const symbol = (meta.symbol || "").trim();
          const known = mint ? KNOWN_SOLANA_TOKEN_BY_MINT[mint] : undefined;
          const logoUrl = known?.logoUrl || (symbol ? `/token_ico/${symbol.toLowerCase()}.png` : undefined);
          const tokenMeta = mint ? tokenMetaByMint[mint] : undefined;
          const decimals = tokenMeta?.decimals;
          const usdPrice =
            typeof meta.priceUsd === "number" && Number.isFinite(meta.priceUsd) && meta.priceUsd > 0
              ? meta.priceUsd
              : mint
                ? usdPriceByMint.get(mint)
                : undefined;

          // Kamino raw obligation uses base units `depositedAmount` (integer) + token decimals.
          const depositedAmount = String(o.depositedAmount ?? "").trim();

          let marketValueUsd: number | undefined;
          const amountTokens = baseUnitsToDecimal(depositedAmount, decimals);
          if (amountTokens && typeof usdPrice === "number" && Number.isFinite(usdPrice) && usdPrice > 0) {
            marketValueUsd = amountTokens.mul(usdPrice).toNumber();
          } else {
            // fallback: use Kamino-provided market value (risk/discounted) if we can't price it
            const mv = sfToDecimal(marketValueSf);
            if (mv) marketValueUsd = mv.toNumber();
          }

          return {
            depositReserve,
            depositedAmount,
            marketValueSf,
            marketValueUsd,
            tokenMint: mint || undefined,
            tokenSymbol: tokenMeta?.symbol || known?.symbol || symbol || undefined,
            tokenLogoUrl: tokenMeta?.logoUrl || logoUrl,
            tokenDecimals: typeof decimals === "number" ? decimals : undefined,
            supplyApyPct,
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x))
    : [];

  const rawBorrows = getDeep(obligation, "state.borrows");
  const borrows = Array.isArray(rawBorrows)
    ? rawBorrows
        .map((b) => {
          if (!b || typeof b !== "object") return null;
          const o = b as Record<string, unknown>;
          const borrowReserve = String(o.borrowReserve ?? "").trim();
          const borrowedAmountSf = String(o.borrowedAmountSf ?? "").trim();
          const marketValueSf = String(o.marketValueSf ?? "").trim();
          const hasDebt = String(o.hasDebt ?? "").trim() === "1" || Boolean(o.hasDebt);
          if (!borrowReserve || borrowReserve === DEFAULT_PUBKEY) return null;
          if (!hasDebt && borrowedAmountSf === "0") return null;

          // `*_Sf` values are typically fixed-point (1e18). We only need USD value for UI.
          let marketValueUsd: number | undefined;
          const mv = sfToDecimal(marketValueSf);
          if (mv) marketValueUsd = mv.toNumber();

          const meta = reserveMetaByReserve[borrowReserve] ?? {};
          const borrowApyPct =
            typeof meta.borrowApy === "number" && Number.isFinite(meta.borrowApy) && meta.borrowApy > 0
              ? meta.borrowApy * 100
              : 0;
          const mint = (meta.mint || "").trim();
          const symbol = (meta.symbol || "").trim();
          const known = mint ? KNOWN_SOLANA_TOKEN_BY_MINT[mint] : undefined;
          const logoUrl = known?.logoUrl || (symbol ? `/token_ico/${symbol.toLowerCase()}.png` : undefined);
          const tokenMeta = mint ? tokenMetaByMint[mint] : undefined;
          const decimals = tokenMeta?.decimals;
          const usdPrice =
            typeof meta.priceUsd === "number" && Number.isFinite(meta.priceUsd) && meta.priceUsd > 0
              ? meta.priceUsd
              : mint
                ? usdPriceByMint.get(mint)
                : undefined;

          // Use base units `borrowedAmountOutsideElevationGroups` for UI amount (matches Kamino UI),
          // not borrowedAmountSf (which is scaled/interest-adjusted).
          const borrowedAmountOutsideElevationGroups = String(o.borrowedAmountOutsideElevationGroups ?? "").trim();
          const amountTokens = baseUnitsToDecimal(borrowedAmountOutsideElevationGroups, decimals);
          if (amountTokens && typeof usdPrice === "number" && Number.isFinite(usdPrice) && usdPrice > 0) {
            marketValueUsd = amountTokens.mul(usdPrice).toNumber();
          } else {
            const mv = sfToDecimal(marketValueSf);
            if (mv) marketValueUsd = mv.toNumber();
          }

          return {
            borrowReserve,
            borrowedAmountSf,
            borrowedAmountOutsideElevationGroups,
            marketValueSf,
            marketValueUsd,
            tokenMint: mint || undefined,
            tokenSymbol: tokenMeta?.symbol || known?.symbol || symbol || undefined,
            tokenLogoUrl: tokenMeta?.logoUrl || logoUrl,
            tokenDecimals: typeof decimals === "number" ? decimals : undefined,
            borrowApyPct,
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x))
    : [];

  scaleLineItemsUsdToRefreshedTotal(deposits, refreshedUserTotalDeposit);
  scaleLineItemsUsdToRefreshedTotal(borrows, refreshedUserTotalBorrow);

  return {
    refreshedStats: {
      userTotalDeposit: refreshedUserTotalDeposit,
      userTotalBorrow: refreshedUserTotalBorrow,
      netAccountValue: refreshedNetAccountValue,
      borrowLiquidationLimit: refreshedBorrowLiquidationLimit,
    },
    obligationStats: { userTotalDeposit: statsUserTotalDeposit },
    userTotalDeposit,
    depositedValueUsd,
    totalDepositUsd,
    state: { deposits, borrows },
  };
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    let retryAfterMs = 0;
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;

      const status = response.status;
      const retryable = shouldRetryStatus(status);
      const retryAfterHeader = response.headers.get("retry-after");
      retryAfterMs = retryAfterHeader
        ? Math.max(0, Math.floor(Number(retryAfterHeader) * 1000))
        : 0;

      if (status === 429) {
        console.warn("[Kamino] rate limited", { url, attempt, status, retryAfterHeader });
      }

      if (!retryable || attempt === RETRY_ATTEMPTS) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === RETRY_ATTEMPTS) break;
    }

    // Respect Retry-After when present; otherwise use fixed backoff.
    // Add a small jitter to spread concurrent retries.
    const jitter = Math.floor(Math.random() * 250);
    const waitMs = Math.max(RETRY_DELAY_MS, retryAfterMs) + jitter;
    await sleep(waitMs);
  }

  throw lastError instanceof Error ? lastError : new Error("Kamino request failed after retries");
}

async function fetchJupiterUsdPriceMap(mints: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = Array.from(new Set(mints.map((m) => (m || "").trim()).filter(Boolean)));
  if (uniq.length === 0) return out;

  // Jupiter search supports comma-separated mint ids in query.
  // Keep chunk size conservative.
  const CHUNK = 80;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const chunk = uniq.slice(i, i + CHUNK);
    const url = `https://api.jup.ag/tokens/v2/search?query=${encodeURIComponent(chunk.join(","))}`;
    try {
      const res = await fetchWithRetry(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const rows = (await res.json().catch(() => [])) as JupiterTokenPriceRow[];
      if (!Array.isArray(rows)) continue;
      for (const r of rows) {
        const id = typeof r?.id === "string" ? r.id.trim() : "";
        const p = typeof r?.usdPrice === "number" ? r.usdPrice : undefined;
        if (id && typeof p === "number" && Number.isFinite(p) && p > 0) out.set(id, p);
      }
    } catch {
      // ignore
    }
  }
  return out;
}

function parseDecimal(value: unknown): Decimal | null {
  try {
    const d = new Decimal(String(value ?? ""));
    if (!d.isFinite()) return null;
    return d;
  } catch {
    return null;
  }
}

/**
 * Kamino's app shows supply/borrow USD from refreshed obligation stats (userTotalDeposit / userTotalBorrow).
 * Per-reserve amount × oracle/metrics price can drift from that; scale positive line items to match the aggregates.
 */
function scaleLineItemsUsdToRefreshedTotal(
  items: Array<{ marketValueUsd?: number }>,
  refreshedTotalUsd: unknown
): void {
  const target = parseDecimal(refreshedTotalUsd);
  if (!target || !target.gt(0)) return;
  let sum = new Decimal(0);
  for (const it of items) {
    const v = it.marketValueUsd;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) sum = sum.add(v);
  }
  if (!sum.gt(0)) return;
  const factor = target.div(sum);
  for (const it of items) {
    const v = it.marketValueUsd;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      it.marketValueUsd = new Decimal(v).mul(factor).toNumber();
    }
  }
}

function isTruthyParam(value: string | null): boolean {
  const v = (value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "y" || v === "on";
}

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function toApyPct(apyFraction: unknown): number {
  // API returns APY as a fraction, e.g. 0.038... for 3.8%
  const apy = toNumber(apyFraction, 0);
  return apy * 100;
}

function extractExchangeRateFromVaultMetrics(metrics: KaminoVaultMetrics | null): Decimal | null {
  if (!metrics || typeof metrics !== "object") return null;
  const candidates = [
    // Common names used across vault implementations.
    "exchangeRate",
    "pricePerShare",
    "sharePrice",
    "tokensPerShare",
    "shareToTokenRate",
    "rate",
    // Sometimes nested
    "data.exchangeRate",
    "data.pricePerShare",
  ];
  for (const key of candidates) {
    const v = key.includes(".") ? getDeep(metrics, key) : (metrics as any)[key];
    const d = parseDecimal(v);
    if (d && d.isFinite() && d.greaterThan(0)) return d;
  }
  return null;
}

async function fetchVaultMetricsSummaryMap(vaultAddresses: string[]): Promise<{
  aprPctByVault: Map<string, number>;
  exchangeRateByVault: Map<string, Decimal>;
}> {
  const aprPctByVault = new Map<string, number>();
  const exchangeRateByVault = new Map<string, Decimal>();
  const uniq = Array.from(new Set(vaultAddresses.map((v) => (v || "").trim()).filter(Boolean)));
  if (uniq.length === 0) return { aprPctByVault, exchangeRateByVault };

  const CONCURRENCY = 6;
  await mapWithConcurrencyLimit(uniq, CONCURRENCY, async (va) => {
    try {
      const res = await fetchWithRetry(`${KAMINO_API_BASE_URL}/kvaults/vaults/${va}/metrics`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) return;
      const metrics = (await res.json().catch(() => null)) as KaminoVaultMetrics | null;

      const aprPct = toApyPct(metrics?.apy);
      if (Number.isFinite(aprPct) && aprPct > 0) aprPctByVault.set(va, aprPct);

      const rate = extractExchangeRateFromVaultMetrics(metrics);
      if (rate) exchangeRateByVault.set(va, rate);
    } catch {
      // ignore
    }
  });

  return { aprPctByVault, exchangeRateByVault };
}

function hasEarnVaultBalance(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  const o = item as Record<string, unknown>;
  const total = Number.parseFloat(String(o.totalShares ?? "0"));
  const staked = Number.parseFloat(String(o.stakedShares ?? "0"));
  const unstaked = Number.parseFloat(String(o.unstakedShares ?? "0"));
  return (
    (Number.isFinite(total) && total > 0) ||
    (Number.isFinite(staked) && staked > 0) ||
    (Number.isFinite(unstaked) && unstaked > 0)
  );
}

type KaminoVaultMeta = {
  vaultAddress: string;
  vaultName?: string;
  tokenMint?: string;
  tokenSymbol?: string;
  tokenLogoUrl?: string;
};

function buildVaultAddressToMetaMap(vaults: KaminoVaultCatalogRow[]): Map<string, KaminoVaultMeta> {
  const m = new Map<string, KaminoVaultMeta>();
  for (const v of vaults) {
    const addr = typeof v?.address === "string" ? v.address.trim() : "";
    if (!addr) continue;
    const vaultName = typeof v.state?.name === "string" ? v.state.name.trim() : undefined;
    const tokenMint = typeof v.state?.tokenMint === "string" ? v.state.tokenMint.trim() : undefined;
    const known = tokenMint ? KNOWN_SOLANA_TOKEN_BY_MINT[tokenMint] : undefined;
    m.set(addr, {
      vaultAddress: addr,
      vaultName,
      tokenMint,
      tokenSymbol: known?.symbol,
      tokenLogoUrl: known?.logoUrl,
    });
  }
  return m;
}

function enrichEarnPositionPayload(pos: unknown, vaultMetaByAddress: Map<string, KaminoVaultMeta>): unknown {
  const vaultAddress = extractKvaultVaultAddress(pos);
  if (!vaultAddress || !pos || typeof pos !== "object") return pos;
  const o = pos as Record<string, unknown>;
  const meta = vaultMetaByAddress.get(vaultAddress);

  const out: Record<string, unknown> = { ...o, vaultAddress };
  if (meta?.vaultName && typeof out.vaultName !== "string") out.vaultName = meta.vaultName;
  if (meta?.tokenMint && typeof out.tokenMint !== "string") out.tokenMint = meta.tokenMint;
  if (meta?.tokenSymbol && typeof out.tokenSymbol !== "string") out.tokenSymbol = meta.tokenSymbol;
  if (meta?.tokenLogoUrl && typeof out.tokenLogoUrl !== "string") out.tokenLogoUrl = meta.tokenLogoUrl;
  return out;
}

async function fetchVaultExchangeRateMapViaSdk(vaultAddresses: string[]): Promise<Map<string, Decimal>> {
  const out = new Map<string, Decimal>();
  const uniq = Array.from(new Set(vaultAddresses.map((v) => (v || "").trim()).filter(Boolean)));
  for (const va of uniq) {
    try {
      const { vault } = await loadKaminoVaultForAddress({ vaultAddress: va });
      const rate = (await vault.getExchangeRate()) as unknown;
      const d = parseDecimal(rate);
      if (d) out.set(va, d);
    } catch {
      // ignore
    }
  }
  return out;
}

export type KaminoUserPositionRow =
  | {
      source: "kamino-lend";
      marketPubkey: string;
      marketName?: string;
      obligation: unknown;
    }
  | {
      source: "kamino-earn";
      position: unknown;
    }
  | {
      /** Steakhouse / vault “farms” — not KLend obligations; see GET /farms/users/{wallet}/transactions */
      source: "kamino-farm";
      farmPubkey: string;
      tokenMint: string;
      tokenSymbol?: string;
      tokenLogoUrl?: string;
      netTokenAmount: string;
      netUsdAmount: string;
      lastActivity: string;
      transactionCount: number;
      /** kVault vault pubkey for SDK (resolved from /kvaults/vaults via vault address or state.vaultFarm). */
      vaultAddress?: string;
      vaultName?: string;
    };

type KaminoVaultCatalogRow = {
  address: string;
  state?: {
    name?: string;
    tokenMint?: string;
    vaultFarm?: string;
  };
};

/** Map farm transaction `farm` field and vault pubkey to the kVault address used by the SDK. */
function buildFarmPubkeyToVaultMap(vaults: KaminoVaultCatalogRow[]): Map<string, { vaultAddress: string; vaultName?: string }> {
  const m = new Map<string, { vaultAddress: string; vaultName?: string }>();
  for (const v of vaults) {
    if (!v?.address) continue;
    const name = typeof v.state?.name === "string" ? v.state.name.trim() : undefined;
    const info = { vaultAddress: v.address, vaultName: name };
    m.set(v.address, info);
    const vf = v.state?.vaultFarm;
    if (typeof vf === "string" && vf.trim()) {
      m.set(vf.trim(), info);
    }
  }
  return m;
}

type KaminoFarmTx = {
  instruction?: string;
  createdOn?: string;
  transactionSignature?: string;
  tokenAmount?: string;
  usdAmount?: string;
  farm?: string;
  token?: string;
};

function parseAmountSigned(tx: KaminoFarmTx): { token: number; usd: number } {
  const token = Number.parseFloat(String(tx.tokenAmount ?? "0"));
  const usd = Number.parseFloat(String(tx.usdAmount ?? "0"));
  const ins = String(tx.instruction ?? "").toLowerCase();
  let sign = 0;
  if (ins === "deposit" || ins === "claim" || ins === "compound" || ins === "stake") sign = 1;
  else if (ins === "withdraw" || ins === "unstake") sign = -1;
  else if (ins === "pending-withdraw") sign = 0;
  else sign = 0;
  return {
    token: Number.isFinite(token) ? token * sign : 0,
    usd: Number.isFinite(usd) ? usd * sign : 0,
  };
}

async function fetchAllFarmUserTransactions(address: string): Promise<KaminoFarmTx[]> {
  const out: KaminoFarmTx[] = [];
  let paginationToken: string | undefined;

  for (let page = 0; page < 25; page++) {
    const url = new URL(`${KAMINO_API_BASE_URL}/farms/users/${address}/transactions`);
    url.searchParams.set("limit", "200");
    if (paginationToken) url.searchParams.set("paginationToken", paginationToken);

    const res = await fetchWithRetry(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!res.ok) break;

    const payload = (await res.json().catch(() => null)) as {
      result?: KaminoFarmTx[];
      paginationToken?: string;
    } | null;

    const batch = Array.isArray(payload?.result) ? payload.result : [];
    out.push(...batch);

    paginationToken =
      typeof payload?.paginationToken === "string" && payload.paginationToken.length > 0
        ? payload.paginationToken
        : undefined;

    if (!paginationToken || batch.length === 0) break;
  }

  return out;
}

function aggregateFarmPositions(transactions: KaminoFarmTx[]): KaminoUserPositionRow[] {
  type Agg = {
    farm: string;
    token: string;
    netToken: number;
    netUsd: number;
    lastActivity: string;
    count: number;
  };

  const map = new Map<string, Agg>();

  for (const tx of transactions) {
    const farm = typeof tx.farm === "string" ? tx.farm.trim() : "";
    const token = typeof tx.token === "string" ? tx.token.trim() : "";
    if (!farm || !token) continue;

    const { token: dToken, usd: dUsd } = parseAmountSigned(tx);
    if (dToken === 0 && dUsd === 0) continue;

    const key = `${farm}:${token}`;
    const prev = map.get(key);
    const created = String(tx.createdOn ?? "");
    const next: Agg = prev ?? {
      farm,
      token,
      netToken: 0,
      netUsd: 0,
      lastActivity: created,
      count: 0,
    };

    next.netToken += dToken;
    next.netUsd += dUsd;
    next.count += 1;
    if (created && (!next.lastActivity || created > next.lastActivity)) {
      next.lastActivity = created;
    }

    map.set(key, next);
  }

  const rows: KaminoUserPositionRow[] = [];
  for (const a of map.values()) {
    if (Math.abs(a.netToken) < 1e-12 && Math.abs(a.netUsd) < 1e-12) continue;
    rows.push({
      source: "kamino-farm",
      farmPubkey: a.farm,
      tokenMint: a.token,
      netTokenAmount: String(a.netToken),
      netUsdAmount: String(a.netUsd),
      lastActivity: a.lastActivity,
      transactionCount: a.count,
    });
  }

  return rows;
}

async function enrichFarmRowsWithTokenMetadata(rows: KaminoUserPositionRow[]): Promise<KaminoUserPositionRow[]> {
  const farmRows = rows.filter(
    (r): r is Extract<KaminoUserPositionRow, { source: "kamino-farm" }> => r.source === "kamino-farm"
  );
  if (farmRows.length === 0) return rows;

  const mints = Array.from(new Set(farmRows.map((r) => r.tokenMint).filter(Boolean)));
  if (mints.length === 0) return rows;

  let metadataMap: Record<string, { symbol?: string; logoUrl?: string }> = {};
  try {
    const metadataService = JupiterTokenMetadataService.getInstance();
    metadataMap = (await metadataService.getMetadataMap(mints)) as Record<string, { symbol?: string; logoUrl?: string }>;
  } catch {
    metadataMap = {};
  }

  return rows.map((r) => {
    if (r.source !== "kamino-farm") return r;
    const meta = metadataMap[r.tokenMint] || {};
    const known = KNOWN_SOLANA_TOKEN_BY_MINT[r.tokenMint];
    return {
      ...r,
      tokenSymbol: meta.symbol || known?.symbol || undefined,
      tokenLogoUrl: meta.logoUrl || known?.logoUrl || undefined,
    };
  });
}

/**
 * GET /api/protocols/kamino/userPositions?address=<solana_wallet>
 *
 * Aggregates:
 * - Kamino Lend: GET /kamino-market/{market}/users/{wallet}/obligations (all markets from v2/kamino-market)
 * - Kamino Earn: GET /kvaults/users/{wallet}/positions
 * - Kamino Farms (Steakhouse-style vaults): GET /farms/users/{wallet}/transactions (aggregated net per farm+token)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = (searchParams.get("address") || "").trim();
    const debug = isTruthyParam(searchParams.get("debug"));
    const refreshCache = isTruthyParam(searchParams.get("refreshcache"));
    const tStart = Date.now();
    const timingsMs: Record<string, number> = {};
    const mark = (k: string, startedAt: number) => {
      timingsMs[k] = Date.now() - startedAt;
    };

    if (!address) {
      return NextResponse.json(
        { success: false, error: "Address parameter is required", data: [], count: 0 },
        { status: 400 }
      );
    }

    if (!isLikelySolanaAddress(address)) {
      return NextResponse.json(
        { success: false, error: "Invalid Solana wallet address", data: [], count: 0 },
        { status: 400 }
      );
    }

    if (refreshCache) {
      marketsCache = null;
      vaultCatalogCache = null;
      const reservesCache = (globalThis as any).__kaminoReservesCache as Map<string, TimedCache<KaminoReserveMetricsRow[]>> | undefined;
      reservesCache?.clear();
    }

    const computePayloadInternal = async (opts: {
      debugFlag: boolean;
      refreshCacheFlag: boolean;
    }): Promise<KaminoUserPositionsApiResponse> => {
      const tStartLocal = Date.now();
      const timingsLocal: Record<string, number> = {};
      const markLocal = (k: string, startedAt: number) => {
        timingsLocal[k] = Date.now() - startedAt;
      };

      const debugFlag = opts.debugFlag;
      const refreshCacheFlag = opts.refreshCacheFlag;

      const tMarkets = Date.now();
      const tVaultCatalog = Date.now();
      const [marketList, vaultCatalog] = await Promise.all([
        getKaminoMarketsCached(),
        getKaminoVaultCatalogCached(),
      ]);
      markLocal("markets", tMarkets);
      markLocal("vaultCatalog", tVaultCatalog);

      const vaultMetaByAddress = buildVaultAddressToMetaMap(vaultCatalog);

      const lendPromise = (async () => {
        const tReserves = Date.now();
        const tObligations = Date.now();
        const RESERVE_CONCURRENCY = 6;
        const OBLIGATIONS_CONCURRENCY = 6;

        const reserveMetricsP = mapWithConcurrencyLimit(marketList, RESERVE_CONCURRENCY, async (m) => {
          const mk = (m?.lendingMarket || "").trim();
          if (!mk) return { market: mk, rows: [] as KaminoReserveMetricsRow[] };
          const rows = await fetchMarketReservesMetricsCached(mk);
          return { market: mk, rows };
        });

        const obligationsP = mapWithConcurrencyLimit(marketList, OBLIGATIONS_CONCURRENCY, async (m) => {
          if (!m?.lendingMarket) return { market: m, obligations: [] as unknown[] };
          const url = `${KAMINO_API_BASE_URL}/kamino-market/${m.lendingMarket}/users/${address}/obligations?env=mainnet-beta`;
          try {
            const res = await fetchWithRetry(url, {
              method: "GET",
              headers: { Accept: "application/json" },
              cache: "no-store",
            });
            if (!res.ok) {
              if (res.status === 429) console.warn("[Kamino] obligations rate limited", { market: m.lendingMarket, url });
              return { market: m, obligations: [] as unknown[] };
            }
            const payload = await res.json().catch(() => []);
            return { market: m, obligations: Array.isArray(payload) ? payload : [] };
          } catch {
            return { market: m, obligations: [] as unknown[] };
          }
        });

        const [reserveMetricsByMarket, obligationResults] = await Promise.all([reserveMetricsP, obligationsP]);
        markLocal("reserveMetrics", tReserves);
        markLocal("obligations", tObligations);

        const reserveMetaByMarket = new Map<string, Record<string, ReserveMeta>>();
        const reserveMints: string[] = [];
        for (const r of reserveMetricsByMarket) {
          if (!r.market) continue;
          const metaByReserve = buildReserveMetaByReservePubkey(r.rows);
          reserveMetaByMarket.set(r.market, metaByReserve);
          for (const meta of Object.values(metaByReserve)) {
            if (meta.mint) reserveMints.push(meta.mint);
          }
        }

        const tReservePricing = Date.now();
        const usdPriceByReserveMint = await fetchJupiterUsdPriceMap(reserveMints);
        for (const [mint, meta] of Object.entries(KNOWN_SOLANA_TOKEN_BY_MINT)) {
          if (meta.symbol === "USDC" || meta.symbol === "USDT" || meta.symbol === "USDG" || meta.symbol === "USDS" || meta.symbol === "JupUSD" || meta.symbol === "EURC") {
            if (!usdPriceByReserveMint.has(mint)) usdPriceByReserveMint.set(mint, 1);
          }
        }
        markLocal("reservePricing", tReservePricing);

        const tReserveTokenMeta = Date.now();
        const tokenMetaByMint = {
          ...buildKnownTokenMetaByMint(),
          ...(await fetchJupiterTokenMetaMap(reserveMints)),
        };
        markLocal("reserveTokenMeta", tReserveTokenMeta);

        const rows: KaminoUserPositionRow[] = [];
        const debugObligations: Array<{ marketPubkey: string; marketName?: string; url: string; obligation: unknown }> = [];

        for (const { market, obligations } of obligationResults) {
          if (!obligations.length) continue;
          for (const obligation of obligations) {
            const reserveMetaByReserve = reserveMetaByMarket.get((market?.lendingMarket || "").trim()) ?? {};
            if (debugFlag) {
              debugObligations.push({
                marketPubkey: market.lendingMarket,
                marketName: market.name,
                url: `${KAMINO_API_BASE_URL}/kamino-market/${market.lendingMarket}/users/${address}/obligations?env=mainnet-beta`,
                obligation,
              });
            }
            rows.push({
              source: "kamino-lend",
              marketPubkey: market.lendingMarket,
              marketName: market.name,
              obligation: slimKaminoObligation(obligation, reserveMetaByReserve, usdPriceByReserveMint, tokenMetaByMint),
            });
          }
        }

        return { rows, reserveMints, reserveMetaByMarket, debugObligations };
      })();

      const earnPromise = (async () => {
        let earnRaw: unknown[] = [];
        const tEarnPositions = Date.now();
        try {
          const kvRes = await fetchWithRetry(`${KAMINO_API_BASE_URL}/kvaults/users/${address}/positions`, {
            method: "GET",
            headers: { Accept: "application/json" },
            cache: "no-store",
          });
          if (kvRes.ok) {
            const kvJson = await kvRes.json().catch(() => []);
            earnRaw = Array.isArray(kvJson) ? kvJson : [];
          } else if (kvRes.status === 429) {
            console.warn("[Kamino] kvaults positions rate limited", { address });
          }
        } catch {
          earnRaw = [];
        }
        markLocal("earnPositions", tEarnPositions);

        const tEarnEnrich = Date.now();
        const earnEnrichedAll = earnRaw
          .filter((pos) => hasEarnVaultBalance(pos))
          .map((pos) => enrichEarnPositionPayload(pos, vaultMetaByAddress));
        const earnVaults = earnEnrichedAll
          .map((p) => extractKvaultVaultAddress(p))
          .filter((x): x is string => typeof x === "string" && x.trim().length > 0);
        markLocal("earnEnrich", tEarnEnrich);

        const tEarnMetrics = Date.now();
        const { aprPctByVault, exchangeRateByVault } = await fetchVaultMetricsSummaryMap(earnVaults);
        markLocal("earnVaultMetrics", tEarnMetrics);

        const missingVaults = earnVaults.filter((v) => !exchangeRateByVault.has(v.trim()));
        if (missingVaults.length > 0) {
          const tEarnExchangeRpc = Date.now();
          const fromRpc = await fetchVaultExchangeRateMapViaSdk(missingVaults);
          for (const [k, v] of fromRpc.entries()) exchangeRateByVault.set(k, v);
          markLocal("earnExchangeRateRpc", tEarnExchangeRpc);
        }

        const tEarnPricing = Date.now();
        const earnUnderlyingMints = earnEnrichedAll
          .map((p) => (p && typeof p === "object" ? String((p as Record<string, unknown>).tokenMint ?? "").trim() : ""))
          .filter(Boolean);
        const usdPriceByMint = await fetchJupiterUsdPriceMap(earnUnderlyingMints);
        markLocal("earnPricing", tEarnPricing);

        for (const [mint, meta] of Object.entries(KNOWN_SOLANA_TOKEN_BY_MINT)) {
          if (meta.symbol === "USDC" || meta.symbol === "USDT" || meta.symbol === "USDG" || meta.symbol === "USDS" || meta.symbol === "JupUSD" || meta.symbol === "EURC") {
            if (!usdPriceByMint.has(mint)) usdPriceByMint.set(mint, 1);
          }
        }

        const rows: KaminoUserPositionRow[] = [];
        const tEarnAssemble = Date.now();
        for (const pos of earnEnrichedAll) {
          const vaultAddress = extractKvaultVaultAddress(pos);
          if (!vaultAddress || !pos || typeof pos !== "object") {
            rows.push({ source: "kamino-earn", position: pos });
            continue;
          }

          const rec = pos as Record<string, unknown>;
          const shares = parseDecimal(rec.totalShares);
          const rate = exchangeRateByVault.get(vaultAddress.trim());
          const mint = typeof rec.tokenMint === "string" ? rec.tokenMint.trim() : "";
          const price = mint ? usdPriceByMint.get(mint) : undefined;
          const aprPct = aprPctByVault.get(vaultAddress.trim());

          if (shares && rate && typeof price === "number" && Number.isFinite(price) && price > 0) {
            const tokens = shares.mul(rate);
            const valueUsd = tokens.mul(price).toNumber();
            const withUsd: Record<string, unknown> = {
              ...rec,
              totalUsdValue: valueUsd,
              totalValueUsd: valueUsd,
              usdValue: valueUsd,
              valueUsd: valueUsd,
              underlyingTokenAmount: tokens.toString(),
              underlyingTokenPriceUsd: price,
              aprPct,
            };
            rows.push({ source: "kamino-earn", position: withUsd });
          } else {
            const withApr =
              aprPct != null ? ({ ...(rec as Record<string, unknown>), aprPct } as Record<string, unknown>) : rec;
            rows.push({ source: "kamino-earn", position: withApr });
          }
        }
        markLocal("earnAssemble", tEarnAssemble);

        return rows;
      })();

      const farmPromise = (async () => {
        let farmTx: KaminoFarmTx[] = [];
        const tFarmTx = Date.now();
        try {
          farmTx = await fetchAllFarmUserTransactions(address);
        } catch {
          farmTx = [];
        }
        markLocal("farmTx", tFarmTx);

        const tFarmAgg = Date.now();
        const farmRows = aggregateFarmPositions(farmTx);
        const farmRowsWithMeta = await enrichFarmRowsWithTokenMetadata(farmRows);
        const farmToVault = buildFarmPubkeyToVaultMap(vaultCatalog);
        const farmRowsResolved = farmRowsWithMeta.map((r) => {
          if (r.source !== "kamino-farm") return r;
          const meta = farmToVault.get(r.farmPubkey.trim());
          if (!meta) return r;
          return { ...r, vaultAddress: meta.vaultAddress, vaultName: meta.vaultName };
        });
        markLocal("farmAgg", tFarmAgg);
        return { rows: farmRowsResolved, txCount: farmTx.length };
      })();

      const flat: KaminoUserPositionRow[] = [];
      let reserveMints: string[] = [];
      let reserveMetaByMarket = new Map<string, Record<string, ReserveMeta>>();
      let debugObligations: Array<{ marketPubkey: string; marketName?: string; url: string; obligation: unknown }> = [];
      let farmTxCount = 0;

      const [lendRes, earnRes, farmRes] = await Promise.allSettled([lendPromise, earnPromise, farmPromise]);
      if (lendRes.status === "fulfilled") {
        flat.push(...lendRes.value.rows);
        reserveMints = lendRes.value.reserveMints;
        reserveMetaByMarket = lendRes.value.reserveMetaByMarket;
        debugObligations = lendRes.value.debugObligations;
      }
      if (earnRes.status === "fulfilled") {
        flat.push(...earnRes.value);
      }
      if (farmRes.status === "fulfilled") {
        flat.push(...farmRes.value.rows);
        farmTxCount = farmRes.value.txCount;
      }

      timingsLocal.total = Date.now() - tStartLocal;
      if (timingsLocal.total > 4000) {
        console.warn("[Kamino] userPositions slow", { address, timingsMs: timingsLocal });
      }

      return {
        success: true,
        data: flat,
        count: flat.length,
        meta: {
          marketsQueried: marketList.length,
          lendPositions: flat.filter((r) => r.source === "kamino-lend").length,
          earnPositions: flat.filter((r) => r.source === "kamino-earn").length,
          farmPositions: flat.filter((r) => r.source === "kamino-farm").length,
          farmTransactionsFetched: farmTxCount,
          debug: debugFlag,
          refreshCache: refreshCacheFlag,
          timingsMs: timingsLocal,
        },
        debug: debugFlag
          ? {
              address,
              reserveMintsCount: Array.from(new Set(reserveMints.map((m) => (m || "").trim()).filter(Boolean))).length,
              reserveMetaByMarketSizes: Array.from(reserveMetaByMarket.entries()).map(([mk, meta]) => ({
                marketPubkey: mk,
                reserveCount: Object.keys(meta || {}).length,
              })),
              sampleReserveMeta: Array.from(reserveMetaByMarket.entries()).slice(0, 1).map(([mk, meta]) => ({
                marketPubkey: mk,
                firstReserve: Object.entries(meta || {})[0] ?? null,
              })),
              obligationsRaw: debugObligations,
            }
          : undefined,
      };
    };

    // SWR cache (no debug): return stale instantly, refresh in background.
    if (!debug && !refreshCache) {
      const swr = getGlobalSWRCache();
      const refreshers = getGlobalRefreshInFlight();
      const cached = swr.get(address);
      const now = Date.now();
      if (cached && now < cached.freshUntilMs) {
        return NextResponse.json(cached.payload, {
          headers: { "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=900" },
        });
      }
      if (cached && now < cached.staleUntilMs) {
        if (!refreshers.has(address)) {
          const p = (async () => {
            try {
              const payload = await computePayloadInternal({ debugFlag: false, refreshCacheFlag: false });
              const next: KaminoUserPositionsSWR = {
                freshUntilMs: Date.now() + USER_POSITIONS_FRESH_TTL_MS,
                staleUntilMs: Date.now() + USER_POSITIONS_STALE_TTL_MS,
                payload,
              };
              swr.set(address, next);
            } catch {
              // keep stale
            }
          })().finally(() => {
            refreshers.delete(address);
          });
          refreshers.set(address, p);
        }
        return NextResponse.json(cached.payload, {
          headers: { "Cache-Control": "public, max-age=5, s-maxage=5, stale-while-revalidate=900" },
        });
      }
    }

    // Coalesce concurrent requests per address to avoid bursty refresh loops and 429s.
    const inFlight = getGlobalInFlight();
    const key = `${address}|refresh=${refreshCache ? "1" : "0"}|debug=${debug ? "1" : "0"}`;
    const existing = inFlight.get(key);
    if (existing) {
      const payload = (await existing) as any;
      return NextResponse.json(payload);
    }

    const run = computePayloadInternal({ debugFlag: debug, refreshCacheFlag: refreshCache });

    inFlight.set(key, run);
    try {
      const payload = (await run) as KaminoUserPositionsApiResponse;
      if (!debug) {
        const swr = getGlobalSWRCache();
        swr.set(address, {
          freshUntilMs: Date.now() + USER_POSITIONS_FRESH_TTL_MS,
          staleUntilMs: Date.now() + USER_POSITIONS_STALE_TTL_MS,
          payload,
        });
      }
      return NextResponse.json(payload);
    } finally {
      inFlight.delete(key);
    }
  } catch (error) {
    console.error("[Kamino] userPositions error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        data: [],
        count: 0,
      },
      { status: 500 }
    );
  }
}
