import { NextRequest, NextResponse } from "next/server";
import { Connection, clusterApiUrl } from "@solana/web3.js";
import { JupiterTokenMetadataService } from "@/lib/services/solana/tokenMetadata";
import type { InvestmentData } from "@/types/investments";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 2 * 60 * 1000;
const CACHE_STALE_MAX_MS = 15 * 60 * 1000;

type TimedCache<T> = { atMs: number; value: T };

type JupiterBorrowLendVaultRow = {
  vaultId: number;
  supplyMint: string | null;
  borrowMint: string | null;
  supplyAprPct: number;
  borrowAprPct: number;
  tvlUsd?: number;
  logoUrl?: string;
  tokenDecimals?: number;
  assetLabel: string;
  originalVault?: unknown;
};

type Bundle = {
  vaults: JupiterBorrowLendVaultRow[];
};

let cache: TimedCache<Bundle> | null = null;
let inFlight: Promise<TimedCache<Bundle>> | null = null;

function parseBoolParam(sp: URLSearchParams, key: string): boolean | null {
  if (!sp.has(key)) return null;
  const v = (sp.get(key) || "").trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return null;
}

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function isLikelySolanaAddress(input: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test((input || "").trim());
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

function extractAprPctFromVaultData(vd: any, kind: "supply" | "borrow"): number {
  // 2026 lend-read shape uses exchangePricesAndRates with hex-encoded rates.
  const ex = vd?.exchangePricesAndRates;
  const raw = kind === "supply" ? ex?.supplyRateVault ?? ex?.supplyRateLiquidity : ex?.borrowRateVault ?? ex?.borrowRateLiquidity;
  const s = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? raw.toString(16) : "";
  if (!s) return 0;
  // Hex string without 0x prefix (e.g. "0279"). Treat as bps.
  const bps = Number.parseInt(s, 16);
  if (!Number.isFinite(bps) || bps <= 0) return 0;
  return bps / 100;
}

async function fetchWithRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i === attempts) break;
      const delay = i === 1 ? 400 : i === 2 ? 900 : 1500;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw last instanceof Error ? last : new Error("request failed");
}

async function fetchJupiterUsdPriceMap(mints: string[]): Promise<Map<string, number>> {
  const uniq = Array.from(new Set(mints.map((m) => (m || "").trim()).filter(Boolean)));
  if (uniq.length === 0) return new Map();

  const out = new Map<string, number>();
  const chunkSize = 80;
  for (let i = 0; i < uniq.length; i += chunkSize) {
    const chunk = uniq.slice(i, i + chunkSize);
    const url = new URL("https://api.jup.ag/price/v3");
    url.searchParams.set("ids", chunk.join(","));
    const res = await fetch(url.toString(), { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) continue;
    const json = (await res.json().catch(() => null)) as any;
    const data = json?.data && typeof json.data === "object" ? json.data : {};
    for (const mint of chunk) {
      const price = Number(data?.[mint]?.price);
      if (Number.isFinite(price) && price > 0) out.set(mint, price);
    }
  }
  return out;
}

function getSolanaRpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    (process.env.NEXT_PUBLIC_SOLANA_RPC_API_KEY || process.env.SOLANA_RPC_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${process.env.NEXT_PUBLIC_SOLANA_RPC_API_KEY || process.env.SOLANA_RPC_API_KEY}`
      : "")
  );
}

async function loadClient(): Promise<any> {
  const mod = (await import("@jup-ag/lend-read")) as any;
  const Client = mod?.Client ?? mod?.default ?? null;
  if (!Client) throw new Error("Missing Client export from @jup-ag/lend-read");
  return Client;
}

async function fetchAllVaultsBundle(): Promise<Bundle> {
  let Client: any;
  try {
    Client = await loadClient();
  } catch (e) {
    console.error("[JupiterBorrowLend] Failed to load @jup-ag/lend-read:", e);
    return { vaults: [] };
  }

  // Prefer public RPC first; some providers (e.g. Ankr) can 403 without key.
  const rpcCandidates = Array.from(
    new Set([getSolanaRpcUrl(), clusterApiUrl("mainnet-beta")].filter(Boolean))
  );

  const attempt = async <T,>(fn: (connection: Connection) => Promise<T>): Promise<T | null> => {
    for (const rpc of rpcCandidates) {
      try {
        const connection = new Connection(rpc, "confirmed");
        return await fn(connection);
      } catch {
        continue;
      }
    }
    return null;
  };

  const vaults = await attempt(async (connection) => {
    const client = new Client(connection);
    const tvRaw = typeof client?.vault?.getTotalVaults === "function" ? await fetchWithRetry(() => client.vault.getTotalVaults(), 4) : null;
    const totalVaults = Math.max(0, Math.floor(toNumber(typeof tvRaw === "object" && tvRaw?.toString ? tvRaw.toString() : tvRaw, 0)));
    const maxId = Math.min(4096, totalVaults > 0 ? totalVaults - 1 : 0);
    const ids = Array.from({ length: maxId }, (_, i) => i + 1);

    // Conservative concurrency to avoid 429 on public RPC.
    const rows = await mapWithConcurrencyLimit(ids, 3, async (vaultId) => {
      try {
        const vd: any =
          typeof client?.vault?.getVaultByVaultId === "function"
            ? await fetchWithRetry(() => client.vault.getVaultByVaultId(vaultId), 3)
            : null;
        if (!vd) return null;

        const supplyMint =
          typeof vd?.constantViews?.supplyToken?.toBase58 === "function"
            ? vd.constantViews.supplyToken.toBase58()
            : null;
        const borrowMint =
          typeof vd?.constantViews?.borrowToken?.toBase58 === "function"
            ? vd.constantViews.borrowToken.toBase58()
            : null;

        return {
          vaultId,
          supplyMint: supplyMint && isLikelySolanaAddress(supplyMint) ? supplyMint : null,
          borrowMint: borrowMint && isLikelySolanaAddress(borrowMint) ? borrowMint : null,
          supplyAprPct: extractAprPctFromVaultData(vd, "supply"),
          borrowAprPct: extractAprPctFromVaultData(vd, "borrow"),
          assetLabel: "",
          originalVault: vd,
        } as JupiterBorrowLendVaultRow;
      } catch {
        return null;
      }
    });

    return rows.filter(Boolean) as JupiterBorrowLendVaultRow[];
  });

  const list = Array.isArray(vaults) ? vaults : [];
  const mints = Array.from(new Set(list.flatMap((v) => [v.supplyMint, v.borrowMint]).filter(Boolean))) as string[];
  const metadataService = JupiterTokenMetadataService.getInstance();
  const metadataMap = (await metadataService.getMetadataMap(mints).catch(() => ({}))) as Record<
    string,
    { symbol?: string; decimals?: number; logoUrl?: string }
  >;
  const priceMap = await fetchJupiterUsdPriceMap(mints);

  for (const v of list) {
    const sMeta = v.supplyMint ? metadataMap[v.supplyMint] : undefined;
    const bMeta = v.borrowMint ? metadataMap[v.borrowMint] : undefined;
    const sSymbol = (sMeta?.symbol || (v.supplyMint ? `${v.supplyMint.slice(0, 4)}…` : "Unknown")).toUpperCase();
    const bSymbol = (bMeta?.symbol || (v.borrowMint ? `${v.borrowMint.slice(0, 4)}…` : "Unknown")).toUpperCase();
    v.assetLabel = `${sSymbol}/${bSymbol}`;
    v.logoUrl = sMeta?.logoUrl || bMeta?.logoUrl;
    v.tokenDecimals = typeof sMeta?.decimals === "number" ? sMeta.decimals : undefined;

    // Best-effort TVL: some SDK variants carry supply totals in constantViews; otherwise omit.
    const supplyTotalRaw =
      (v.originalVault as any)?.constantViews?.totalSupply ??
      (v.originalVault as any)?.constantViews?.totalAssets ??
      (v.originalVault as any)?.views?.totalSupply ??
      null;
    const supplyTotal = toNumber(typeof supplyTotalRaw === "object" && supplyTotalRaw?.toString ? supplyTotalRaw.toString() : supplyTotalRaw, 0);
    const dec = typeof sMeta?.decimals === "number" && Number.isFinite(sMeta.decimals) ? sMeta.decimals : 0;
    const price = v.supplyMint ? priceMap.get(v.supplyMint) : undefined;
    if (price && supplyTotal > 0 && dec >= 0) {
      const units = dec > 0 ? supplyTotal / Math.pow(10, dec) : supplyTotal;
      const tvlUsd = units * price;
      if (Number.isFinite(tvlUsd) && tvlUsd > 0) v.tvlUsd = tvlUsd;
    }
  }

  // Keep only vaults that have both sides identified.
  const filtered = list.filter((v) => !!v.supplyMint && !!v.borrowMint);
  filtered.sort((a, b) => (b.supplyAprPct || 0) - (a.supplyAprPct || 0));
  return { vaults: filtered };
}

function mapVaultToInvestment(v: JupiterBorrowLendVaultRow): InvestmentData {
  return {
    asset: v.assetLabel,
    provider: "Jupiter",
    totalAPY: v.supplyAprPct,
    depositApy: v.supplyAprPct,
    borrowAPY: v.borrowAprPct,
    token: v.supplyMint || "",
    tokenDecimals: v.tokenDecimals,
    protocol: "Jupiter",
    logoUrl: v.logoUrl,
    tvlUSD: typeof v.tvlUsd === "number" ? v.tvlUsd : 0,
    poolType: "Lending",
    originalPool: {
      kind: "jupiter_lend_vault",
      vaultId: v.vaultId,
      supplyMint: v.supplyMint,
      borrowMint: v.borrowMint,
      supplyAprPct: v.supplyAprPct,
      borrowAprPct: v.borrowAprPct,
    },
  } satisfies InvestmentData;
}

/**
 * GET /api/protocols/jupiter/borrowLend
 *
 * Составной ответ (query):
 * - По умолчанию: `pools=1` → `data` + `count` (vaults → InvestmentData, poolType Lending).
 * - `vaults=1` → добавить `vaults` (нормализованные vault-строки).
 * - `pools=0` → не отдавать `data`.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const wantVaults = parseBoolParam(sp, "vaults") === true;
  const poolsExplicit = parseBoolParam(sp, "pools");
  const wantPools = poolsExplicit === false ? false : true;

  if (!wantPools && !wantVaults) {
    return NextResponse.json(
      { success: false, error: "Укажите хотя бы один фрагмент: pools (по умолчанию) и/или vaults=1" },
      { status: 400 }
    );
  }

  try {
    const now = Date.now();
    if (cache && now - cache.atMs <= CACHE_TTL_MS) {
      const payload: any = { success: true, meta: { fetchedAtMs: cache.atMs } };
      if (wantVaults) payload.vaults = cache.value.vaults;
      if (wantPools) {
        const data = cache.value.vaults.map(mapVaultToInvestment);
        payload.data = data;
        payload.count = data.length;
      }
      return NextResponse.json(payload, {
        headers: {
          "Cache-Control": "public, max-age=120, s-maxage=120, stale-while-revalidate=300",
          "Cdn-Cache-Control": "max-age=120",
          "Surrogate-Control": "max-age=120",
        },
      });
    }

    if (inFlight) {
      if (cache && now - cache.atMs <= CACHE_STALE_MAX_MS) {
        const payload: any = { success: true, meta: { fetchedAtMs: cache.atMs, stale: true } };
        if (wantVaults) payload.vaults = cache.value.vaults;
        if (wantPools) {
          const data = cache.value.vaults.map(mapVaultToInvestment);
          payload.data = data;
          payload.count = data.length;
        }
        return NextResponse.json(payload, {
          headers: {
            "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
            "Cdn-Cache-Control": "max-age=60",
            "Surrogate-Control": "max-age=60",
          },
        });
      }
      const refreshed = await inFlight;
      const payload: any = { success: true, meta: { fetchedAtMs: refreshed.atMs } };
      if (wantVaults) payload.vaults = refreshed.value.vaults;
      if (wantPools) {
        const data = refreshed.value.vaults.map(mapVaultToInvestment);
        payload.data = data;
        payload.count = data.length;
      }
      return NextResponse.json(payload, {
        headers: {
          "Cache-Control": "public, max-age=120, s-maxage=120, stale-while-revalidate=300",
          "Cdn-Cache-Control": "max-age=120",
          "Surrogate-Control": "max-age=120",
        },
      });
    }

    inFlight = (async (): Promise<TimedCache<Bundle>> => {
      const bundle = await fetchAllVaultsBundle();
      const next: TimedCache<Bundle> = { atMs: Date.now(), value: bundle };
      cache = next;
      return next;
    })();

    const refreshed = await inFlight;
    const payload: any = { success: true, meta: { fetchedAtMs: refreshed.atMs } };
    if (wantVaults) payload.vaults = refreshed.value.vaults;
    if (wantPools) {
      const data = refreshed.value.vaults.map(mapVaultToInvestment);
      payload.data = data;
      payload.count = data.length;
    }

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, max-age=120, s-maxage=120, stale-while-revalidate=300",
        "Cdn-Cache-Control": "max-age=120",
        "Surrogate-Control": "max-age=120",
      },
    });
  } catch (error) {
    console.warn("[Jupiter][BorrowLend] error", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error", data: [], count: 0 },
      { status: 500 }
    );
  } finally {
    inFlight = null;
  }
}

