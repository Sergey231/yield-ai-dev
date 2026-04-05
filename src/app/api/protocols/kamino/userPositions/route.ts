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

type KaminoVaultMetrics = {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCacheFresh(entry: TimedCache<unknown> | null, ttlMs: number): boolean {
  if (!entry) return false;
  return Date.now() - entry.atMs <= ttlMs;
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

type ReserveMeta = { mint?: string; symbol?: string; logoUrl?: string; priceUsd?: number };

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
    out[reserve] = { mint, symbol, priceUsd: typeof priceUsd === "number" && Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : undefined };
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
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;

      const shouldRetry =
        response.status === 502 || response.status === 503 || response.status === 504;

      if (!shouldRetry || attempt === RETRY_ATTEMPTS) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === RETRY_ATTEMPTS) break;
    }

    await sleep(RETRY_DELAY_MS);
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

async function fetchVaultAprPctMap(vaultAddresses: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = Array.from(new Set(vaultAddresses.map((v) => (v || "").trim()).filter(Boolean)));
  for (const va of uniq) {
    try {
      const res = await fetchWithRetry(`${KAMINO_API_BASE_URL}/kvaults/vaults/${va}/metrics`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) continue;
      const metrics = (await res.json().catch(() => null)) as KaminoVaultMetrics | null;
      const aprPct = toApyPct(metrics?.apy);
      if (Number.isFinite(aprPct) && aprPct > 0) out.set(va, aprPct);
    } catch {
      // ignore
    }
  }
  return out;
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

async function fetchVaultExchangeRateMap(vaultAddresses: string[]): Promise<Map<string, Decimal>> {
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

    const marketList = await getKaminoMarketsCached();

    // Preload reserve->mint/symbol maps for all markets.
    const reserveMetricsByMarket = await Promise.all(
      marketList.map(async (m) => {
        const mk = (m?.lendingMarket || "").trim();
        if (!mk) return { market: mk, rows: [] as KaminoReserveMetricsRow[] };
        const rows = await fetchMarketReservesMetricsCached(mk);
        return { market: mk, rows };
      })
    );
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

    // kVault catalog used to enrich both Earn positions and Farm aggregations.
    const vaultCatalog: KaminoVaultCatalogRow[] = await getKaminoVaultCatalogCached();
    const vaultMetaByAddress = buildVaultAddressToMetaMap(vaultCatalog);

    const obligationResults = await Promise.all(
      marketList.map(async (m) => {
        if (!m?.lendingMarket) {
          return { market: m, obligations: [] as unknown[] };
        }
        const url = `${KAMINO_API_BASE_URL}/kamino-market/${m.lendingMarket}/users/${address}/obligations?env=mainnet-beta`;
        try {
          const res = await fetchWithRetry(url, {
            method: "GET",
            headers: { Accept: "application/json" },
            cache: "no-store",
          });
          if (!res.ok) {
            return { market: m, obligations: [] as unknown[] };
          }
          const payload = await res.json().catch(() => []);
          return {
            market: m,
            obligations: Array.isArray(payload) ? payload : [],
          };
        } catch {
          return { market: m, obligations: [] as unknown[] };
        }
      })
    );

    const flat: KaminoUserPositionRow[] = [];

    // Prices for KLend deposits/borrows.
    const usdPriceByReserveMint = await fetchJupiterUsdPriceMap(reserveMints);
    // Ensure stables (and SOL) have sane fallback prices if missing.
    for (const [mint, meta] of Object.entries(KNOWN_SOLANA_TOKEN_BY_MINT)) {
      if (meta.symbol === "USDC" || meta.symbol === "USDT" || meta.symbol === "USDG" || meta.symbol === "USDS" || meta.symbol === "JupUSD" || meta.symbol === "EURC") {
        if (!usdPriceByReserveMint.has(mint)) usdPriceByReserveMint.set(mint, 1);
      }
    }

    const tokenMetaByMint = {
      ...buildKnownTokenMetaByMint(),
      ...(await fetchJupiterTokenMetaMap(reserveMints)),
    };

    const debugObligations: Array<{
      marketPubkey: string;
      marketName?: string;
      url: string;
      obligation: unknown;
    }> = [];

    for (const { market, obligations } of obligationResults) {
      if (!obligations.length) continue;
      for (const obligation of obligations) {
        const reserveMetaByReserve = reserveMetaByMarket.get((market?.lendingMarket || "").trim()) ?? {};
        if (debug) {
          debugObligations.push({
            marketPubkey: market.lendingMarket,
            marketName: market.name,
            url: `${KAMINO_API_BASE_URL}/kamino-market/${market.lendingMarket}/users/${address}/obligations?env=mainnet-beta`,
            obligation,
          });
        }
        flat.push({
          source: "kamino-lend",
          marketPubkey: market.lendingMarket,
          marketName: market.name,
          obligation: slimKaminoObligation(obligation, reserveMetaByReserve, usdPriceByReserveMint, tokenMetaByMint),
        });
      }
    }

    let earnRaw: unknown[] = [];
    try {
      const kvRes = await fetchWithRetry(
        `${KAMINO_API_BASE_URL}/kvaults/users/${address}/positions`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
        }
      );
      if (kvRes.ok) {
        const kvJson = await kvRes.json().catch(() => []);
        earnRaw = Array.isArray(kvJson) ? kvJson : [];
      }
    } catch {
      earnRaw = [];
    }

    // Preload rates and token prices for Earn positions.
    const earnEnrichedAll = earnRaw
      .filter((pos) => hasEarnVaultBalance(pos))
      .map((pos) => enrichEarnPositionPayload(pos, vaultMetaByAddress));
    const earnVaults = earnEnrichedAll
      .map((p) => extractKvaultVaultAddress(p))
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    const exchangeRateByVault = await fetchVaultExchangeRateMap(earnVaults);
    const aprPctByVault = await fetchVaultAprPctMap(earnVaults);
    const earnUnderlyingMints = earnEnrichedAll
      .map((p) => (p && typeof p === "object" ? String((p as Record<string, unknown>).tokenMint ?? "").trim() : ""))
      .filter(Boolean);
    const usdPriceByMint = await fetchJupiterUsdPriceMap(earnUnderlyingMints);

    // Always include hardcoded stables if missing from Jupiter.
    for (const [mint, meta] of Object.entries(KNOWN_SOLANA_TOKEN_BY_MINT)) {
      if (meta.symbol === "USDC" || meta.symbol === "USDT" || meta.symbol === "USDG" || meta.symbol === "USDS" || meta.symbol === "JupUSD" || meta.symbol === "EURC") {
        if (!usdPriceByMint.has(mint)) usdPriceByMint.set(mint, 1);
      }
    }

    for (const pos of earnEnrichedAll) {
      const vaultAddress = extractKvaultVaultAddress(pos);
      if (!vaultAddress || !pos || typeof pos !== "object") {
        flat.push({ source: "kamino-earn", position: pos });
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
          // Keep multiple aliases used by existing UI.
          totalUsdValue: valueUsd,
          totalValueUsd: valueUsd,
          usdValue: valueUsd,
          valueUsd: valueUsd,
          // Also expose computed token amount for future UI usage.
          underlyingTokenAmount: tokens.toString(),
          underlyingTokenPriceUsd: price,
          aprPct,
        };
        flat.push({ source: "kamino-earn", position: withUsd });
      } else {
        const withApr = aprPct != null ? ({ ...(rec as Record<string, unknown>), aprPct } as Record<string, unknown>) : rec;
        flat.push({ source: "kamino-earn", position: withApr });
      }
    }

    let farmTx: KaminoFarmTx[] = [];
    try {
      farmTx = await fetchAllFarmUserTransactions(address);
    } catch {
      farmTx = [];
    }

    const farmRows = aggregateFarmPositions(farmTx);
    const farmRowsWithMeta = await enrichFarmRowsWithTokenMetadata(farmRows);

    const farmToVault = buildFarmPubkeyToVaultMap(vaultCatalog);
    const farmRowsResolved = farmRowsWithMeta.map((r) => {
      if (r.source !== "kamino-farm") return r;
      const meta = farmToVault.get(r.farmPubkey.trim());
      if (!meta) return r;
      return {
        ...r,
        vaultAddress: meta.vaultAddress,
        vaultName: meta.vaultName,
      };
    });
    flat.push(...farmRowsResolved);

    return NextResponse.json({
      success: true,
      data: flat,
      count: flat.length,
      meta: {
        marketsQueried: marketList.length,
        lendPositions: flat.filter((r) => r.source === "kamino-lend").length,
        earnPositions: flat.filter((r) => r.source === "kamino-earn").length,
        farmPositions: flat.filter((r) => r.source === "kamino-farm").length,
        farmTransactionsFetched: farmTx.length,
        debug,
        refreshCache,
      },
      debug: debug
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
    });
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
