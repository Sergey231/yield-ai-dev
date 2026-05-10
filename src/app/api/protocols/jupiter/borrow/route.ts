import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getSolanaRpcUrl } from "@/app/api/jupiter/_lib";
import { Connection, clusterApiUrl } from "@solana/web3.js";
import { JupiterTokenMetadataService } from "@/lib/services/solana/tokenMetadata";
import BN from "bn.js";

export const dynamic = "force-dynamic";

type TimedCacheEntry<T> = { at: number; value: T };

function getJupiterApiKey(): string | undefined {
  return (
    process.env.JUP_API_KEY ||
    process.env.NEXT_PUBLIC_JUP_API_KEY ||
    process.env.JUPITER_API_KEY ||
    undefined
  )?.trim() || undefined;
}

function getGlobalMap<K, V>(key: string): Map<K, V> {
  const g = globalThis as any;
  g[key] ??= new Map();
  return g[key] as Map<K, V>;
}

function isFresh(at: number, ttlMs: number): boolean {
  return Date.now() - at < ttlMs;
}

function isLikelySolanaAddress(input: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input);
}

function pickYieldPct(yields: unknown): number | null {
  // OpenAPI uses `suppliedYields` / `borrowedYields` as `Yield[][]` (array of arrays),
  // but some asset-level payloads can be a flat `Yield[]`.
  const stack: unknown[] = Array.isArray(yields) ? [...yields] : [];
  while (stack.length) {
    const cur = stack.shift();
    if (!cur) continue;
    if (Array.isArray(cur)) {
      stack.push(...cur);
      continue;
    }
    if (typeof cur !== "object") continue;
    const apy = Number((cur as any).apy);
    const apr = Number((cur as any).apr);
    if (Number.isFinite(apy) && apy > 0) return apy * 100;
    if (Number.isFinite(apr) && apr > 0) return apr * 100;
  }
  return null;
}

function pickLargestTokenAsset(assets: unknown): any | null {
  const list = Array.isArray(assets) ? assets : [];
  let best: any | null = null;
  let bestValue = -Infinity;
  for (const a of list) {
    if (!a || typeof a !== "object") continue;
    const type = String((a as any).type ?? "").trim();
    if (type && type !== "token") continue;
    const v = Number((a as any).value);
    const value = Number.isFinite(v) ? v : 0;
    if (value > bestValue) {
      bestValue = value;
      best = a;
    }
  }
  return best;
}

async function fetchJupiterPortfolioBorrowLend(address: string): Promise<
  | { ok: true; elements: any[]; tokenInfoSolana: Record<string, any> }
  | { ok: false; status: number; errorHint: string }
> {
  const apiKey = getJupiterApiKey();
  if (!apiKey) return { ok: false, status: 0, errorHint: "missing_jup_api_key" };
  const url = new URL(`https://api.jup.ag/portfolio/v1/positions/${encodeURIComponent(address)}`);
  // Keep it broad; portfolio currently supports only Jupiter platforms anyway.
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json", "x-api-key": apiKey },
      cache: "no-store",
    });
    const status = res.status;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status, errorHint: text && text.length < 400 ? text : `http_${status}` };
    }
    const json = (await res.json().catch(() => null)) as any;
    const elements = Array.isArray(json?.elements) ? json.elements : Array.isArray(json?.data?.elements) ? json.data.elements : [];
    const tokenInfoSolana =
      (json?.tokenInfo?.solana && typeof json.tokenInfo.solana === "object" ? json.tokenInfo.solana : {}) as Record<string, any>;
    return { ok: true, elements, tokenInfoSolana };
  } catch (e) {
    return { ok: false, status: 0, errorHint: e instanceof Error ? e.message : "network_error" };
  }
}

function toDecimalFrom1e9(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return n / 1e9;
}

function toNullableNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  // Some SDK objects are BN-like and stringify to digits.
  try {
    const s = String((raw as any)?.toString?.() ?? "").trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function fetchJupiterUsdPriceMap(mints: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = Array.from(new Set(mints.map((m) => (m || "").trim()).filter(Boolean)));
  if (uniq.length === 0) return out;

  // Jupiter Price API: https://api.jup.ag/price/v3?ids=...
  const CHUNK = 50;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const chunk = uniq.slice(i, i + CHUNK);
    const url = new URL("https://api.jup.ag/price/v3");
    url.searchParams.set("ids", chunk.join(","));
    try {
      const apiKey = (process.env.JUPITER_API_KEY || process.env.JUP_API_KEY || process.env.NEXT_PUBLIC_JUP_API_KEY || "").trim();
      const headers: Record<string, string> = { Accept: "application/json" };
      if (apiKey) headers["x-api-key"] = apiKey;
      const res = await fetch(url.toString(), { method: "GET", headers, cache: "no-store" });
      if (!res.ok) continue;
      const json = (await res.json().catch(() => null)) as any;
      const dataObj = json && typeof json === "object" ? (json.data && typeof json.data === "object" ? json.data : json) : null;
      if (!dataObj) continue;
      for (const [mint, row] of Object.entries<any>(dataObj)) {
        const p = typeof row?.price === "number" ? row.price : typeof row?.usdPrice === "number" ? row.usdPrice : NaN;
        if (Number.isFinite(p) && p > 0) out.set(mint, p);
      }
    } catch {
      // ignore
    }
  }
  return out;
}

async function mapWithConcurrencyLimit<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length) as R[];
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      const idx = next++;
      if (idx >= items.length) return;
      results[idx] = await mapper(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

async function resolveVaultIdByNftId(params: {
  client: any;
  nftId: number;
  minVaultId: number;
  maxVaultIdInclusive: number;
  ownerBase58: string;
}): Promise<number | null> {
  const { client, nftId, minVaultId, maxVaultIdInclusive, ownerBase58 } = params;
  const hasFn = typeof client?.vault?.getPositionByVaultId === "function";
  if (!hasFn) return null;
  if (!Number.isFinite(nftId) || nftId <= 0) return null;

  // Stable mapping (owner,nftId) -> vaultId. Safe to cache long-term.
  const VAULT_ID_BY_NFT_TTL_MS = 1000 * 60 * 60 * 24; // 24h
  const vaultIdByNftCache = getGlobalMap<string, TimedCacheEntry<number | null>>("__jupBorrowVaultIdByNftCache");
  const cacheKey = `${ownerBase58}:${nftId}`;
  const cached = vaultIdByNftCache.get(cacheKey);
  if (cached && isFresh(cached.at, VAULT_ID_BY_NFT_TTL_MS)) return cached.value;

  const ids: number[] = [];
  for (let i = Math.max(1, minVaultId); i <= Math.max(1, maxVaultIdInclusive); i++) ids.push(i);
  if (ids.length === 0) return null;

  let found: number | null = null;
  await mapWithConcurrencyLimit(
    ids,
    8,
    async (vaultId) => {
      if (found !== null) return null;
      try {
        // If the (vaultId, nftId) pair exists, SDK should be able to fetch it.
        const rich = await client.vault.getPositionByVaultId(vaultId, nftId);
        const owner = rich?.userPosition?.owner;
        const ownerB58 = typeof owner?.toBase58 === "function" ? owner.toBase58() : typeof owner === "string" ? owner : null;
        if (ownerB58 && ownerB58 === ownerBase58) {
          found = vaultId;
          return vaultId;
        }
        return null;
      } catch {
        return null;
      }
    }
  );
  vaultIdByNftCache.set(cacheKey, { at: Date.now(), value: found });
  return found;
}

function extractMintFromVaultLike(vaultLike: any, kind: "supply" | "borrow"): string | null {
  const directCandidates: any[] = kind === "supply"
    ? [
        vaultLike?.constantViews?.supplyToken,
        vaultLike?.constantViews?.collateralToken,
        vaultLike?.configs?.supplyToken,
        vaultLike?.configs?.collateralToken,
      ]
    : [
        vaultLike?.constantViews?.borrowToken,
        vaultLike?.configs?.borrowToken,
      ];

  for (const c of directCandidates) {
    if (typeof c?.toBase58 === "function") {
      try {
        const s = c.toBase58();
        if (isLikelySolanaAddress(s)) return s;
      } catch {
        // ignore
      }
    }
    if (typeof c === "string" && isLikelySolanaAddress(c)) return c;
  }

  // Heuristic deep search for keys that look like token mints
  const want = kind === "supply" ? ["supply", "collateral"] : ["borrow", "debt"];
  const stack: any[] = [vaultLike];
  const seen = new WeakSet<object>();
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const [k, v] of Object.entries(cur)) {
      const key = k.toLowerCase();
      if (want.some((w) => key.includes(w)) && (key.includes("token") || key.includes("mint"))) {
        if (typeof (v as any)?.toBase58 === "function") {
          try {
            const s = (v as any).toBase58();
            if (isLikelySolanaAddress(s)) return s;
          } catch {
            // ignore
          }
        }
        if (typeof v === "string" && isLikelySolanaAddress(v)) return v;
      }
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return null;
}

function sanitizeForJson(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof PublicKey) return value.toBase58();
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;

  // BN / BigNumber / etc.
  if (typeof value === "object" && value) {
    const anyVal = value as any;
    if (typeof anyVal?.toBase58 === "function") {
      try {
        return anyVal.toBase58();
      } catch {
        // ignore
      }
    }
    if (typeof anyVal?.toString === "function") {
      // Prefer stringification for BN-like objects (common in lend-read).
      try {
        const s = String(anyVal.toString());
        if (/^-?\d+$/.test(s.trim())) return s.trim();
      } catch {
        // ignore
      }
    }
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }

  if (Array.isArray(value)) {
    return value.map((x) => sanitizeForJson(x, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value as object)) return "[Circular]";
    seen.add(value as object);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      try {
        out[k] = sanitizeForJson(v, seen);
      } catch {
        out[k] = "[Unserializable]";
      }
    }
    return out;
  }

  return String(value);
}

function normalizeLiquidationThreshold(raw: unknown): { value: number | null; rawNumber: number | null } {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return { value: null, rawNumber: null };

  // Observed formats across SDK / vault configs:
  // - fraction: 0.85
  // - percent: 85 or 80
  // - "x10 percent" (buggy/legacy): 8.5 meaning 85%
  // - bps: 8500 or 8000
  // - "x10 bps" (buggy/legacy): 850 meaning 8500 bps = 85%
  if (n > 0 && n <= 1) return { value: n, rawNumber: n };
  if (n > 1 && n <= 10) return { value: n / 10, rawNumber: n }; // 8.5 -> 0.85
  if (n > 10 && n <= 100) return { value: n / 100, rawNumber: n }; // 85 -> 0.85
  if (n > 100 && n < 1_000) return { value: n / 1_000, rawNumber: n }; // 850 -> 0.85
  if (n >= 1_000 && n <= 10_000) return { value: n / 10_000, rawNumber: n }; // 8500 -> 0.85
  return { value: null, rawNumber: n };
}

function normalizeAprLike(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Normalize to "percent" number (e.g. 12.34 means 12.34%).
  if (n > 0 && n <= 1) return n * 100; // fraction
  if (n > 1 && n <= 100) return n; // percent
  if (n > 100 && n <= 100_000) return n / 100; // bps -> percent
  return null;
}

function extractAprPctFromVaultData(vd: any, kind: "supply" | "borrow"): number | null {
  if (!vd) return null;
  const candidates =
    kind === "supply"
      ? [
          vd?.constantViews?.supplyApr,
          vd?.constantViews?.supplyApy,
          vd?.constantViews?.supplyRate,
          vd?.constantViews?.supplyAprBps,
          vd?.constantViews?.supplyApyBps,
          vd?.constantViews?.supplyRateBps,
          vd?.constantViews?.aprBps,
          vd?.constantViews?.apyBps,
          vd?.views?.supplyAprBps,
          vd?.views?.supplyApyBps,
          vd?.views?.supplyRateBps,
          vd?.configs?.supplyAprBps,
          vd?.configs?.supplyApyBps,
          vd?.configs?.supplyRateBps,
        ]
      : [
          vd?.constantViews?.borrowApr,
          vd?.constantViews?.borrowApy,
          vd?.constantViews?.borrowRate,
          vd?.constantViews?.borrowAprBps,
          vd?.constantViews?.borrowApyBps,
          vd?.constantViews?.borrowRateBps,
          vd?.views?.borrowAprBps,
          vd?.views?.borrowApyBps,
          vd?.views?.borrowRateBps,
          vd?.configs?.borrowAprBps,
          vd?.configs?.borrowApyBps,
          vd?.configs?.borrowRateBps,
        ];

  for (const c of candidates) {
    const pct = normalizeAprLike(c);
    if (pct != null && Number.isFinite(pct) && pct > 0) return pct;
  }
  return null;
}

function extractAprDebugFromVaultData(
  vd: any,
  kind: "supply" | "borrow"
): { pickedPct: number | null; pickedRaw: unknown; pickedKey: string | null } {
  if (!vd) return { pickedPct: null, pickedRaw: null, pickedKey: null };
  const keyed =
    kind === "supply"
      ? [
          ["constantViews.supplyApr", vd?.constantViews?.supplyApr],
          ["constantViews.supplyApy", vd?.constantViews?.supplyApy],
          ["constantViews.supplyRate", vd?.constantViews?.supplyRate],
          ["constantViews.supplyAprBps", vd?.constantViews?.supplyAprBps],
          ["constantViews.supplyApyBps", vd?.constantViews?.supplyApyBps],
          ["constantViews.supplyRateBps", vd?.constantViews?.supplyRateBps],
          ["constantViews.aprBps", vd?.constantViews?.aprBps],
          ["constantViews.apyBps", vd?.constantViews?.apyBps],
          ["views.supplyAprBps", vd?.views?.supplyAprBps],
          ["views.supplyApyBps", vd?.views?.supplyApyBps],
          ["views.supplyRateBps", vd?.views?.supplyRateBps],
          ["configs.supplyAprBps", vd?.configs?.supplyAprBps],
          ["configs.supplyApyBps", vd?.configs?.supplyApyBps],
          ["configs.supplyRateBps", vd?.configs?.supplyRateBps],
        ]
      : [
          ["constantViews.borrowApr", vd?.constantViews?.borrowApr],
          ["constantViews.borrowApy", vd?.constantViews?.borrowApy],
          ["constantViews.borrowRate", vd?.constantViews?.borrowRate],
          ["constantViews.borrowAprBps", vd?.constantViews?.borrowAprBps],
          ["constantViews.borrowApyBps", vd?.constantViews?.borrowApyBps],
          ["constantViews.borrowRateBps", vd?.constantViews?.borrowRateBps],
          ["views.borrowAprBps", vd?.views?.borrowAprBps],
          ["views.borrowApyBps", vd?.views?.borrowApyBps],
          ["views.borrowRateBps", vd?.views?.borrowRateBps],
          ["configs.borrowAprBps", vd?.configs?.borrowAprBps],
          ["configs.borrowApyBps", vd?.configs?.borrowApyBps],
          ["configs.borrowRateBps", vd?.configs?.borrowRateBps],
        ];

  for (const [key, raw] of keyed as Array<[string, unknown]>) {
    const pct = normalizeAprLike(raw);
    if (pct != null && Number.isFinite(pct) && pct > 0) return { pickedPct: pct, pickedRaw: raw, pickedKey: key };
  }
  return { pickedPct: null, pickedRaw: null, pickedKey: null };
}

/**
 * GET /api/protocols/jupiter/borrow?address=<solana_wallet>
 *
 * Jupiter Borrow REST API is "coming soon"; this endpoint uses the Jupiter Lend Read SDK
 * to read on-chain borrow positions. Jupiter Borrow positions can exist in:
 * - Vault module (NFT positions): `client.vault.getAllUserPositions(user)`
 * - Liquidity module (reserve-based borrows): `liquidity.getUserMultipleBorrowData(...)`
 * https://dev.jup.ag/docs/lend/borrow/read-vault-data
 */
export async function GET(request: NextRequest) {
  const started = Date.now();
  try {
    const { searchParams } = new URL(request.url);
    const address = (searchParams.get("address") || "").trim();
    const debug = (searchParams.get("debug") || "").trim() === "1";

    // Fast path: short-lived cache for the full response (positions + liquidity).
    // This endpoint can be slow due to RPC reads; caching smooths UI without losing correctness.
    if (!debug && address) {
      const cacheKey = address;
      const now = Date.now();
      const cacheRoot = ((globalThis as any).__jupiterBorrowResponseCache ??
        ((globalThis as any).__jupiterBorrowResponseCache = new Map())) as Map<
        string,
        { at: number; payload: any }
      >;
      const hit = cacheRoot.get(cacheKey);
      // Short-lived cache for dynamic values (amounts/prices/health).
      // Keep a bit longer than the client query staleTime to avoid repeated heavy RPC bursts.
      const TTL_MS = 120_000;
      if (hit && now - hit.at < TTL_MS) {
        return NextResponse.json(hit.payload, {
          headers: {
            "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
          },
        });
      }
    }

    if (!address) {
      return NextResponse.json({ success: false, error: "Address parameter is required", data: [] }, { status: 400 });
    }
    if (!isLikelySolanaAddress(address)) {
      return NextResponse.json({ success: false, error: "Invalid Solana wallet address", data: [] }, { status: 400 });
    }

    // Preferred fast path: Jupiter Portfolio API (1 HTTP request) instead of heavy Solana RPC.
    // Falls back to RPC-based read SDK if Portfolio API is unavailable.
    const portfolioAttempt = await fetchJupiterPortfolioBorrowLend(address);
    if (portfolioAttempt.ok) {
      const borrowlend = portfolioAttempt.elements.filter((e) => String(e?.type ?? "").trim() === "borrowlend");
      const normalizedVault = borrowlend
        .map((el: any, idx: number) => {
          const data = el?.data ?? {};
          const suppliedValue = Number(data?.suppliedValue);
          const borrowedValue = Number(data?.borrowedValue);
          const supplyUsd = Number.isFinite(suppliedValue) ? suppliedValue : 0;
          const borrowUsd = Number.isFinite(borrowedValue) ? borrowedValue : 0;
          const supplyAsset = pickLargestTokenAsset(data?.suppliedAssets);
          const borrowAsset = pickLargestTokenAsset(data?.borrowedAssets);
          const supplyMint = String(supplyAsset?.data?.address ?? "").trim() || null;
          const borrowMint = String(borrowAsset?.data?.address ?? "").trim() || null;
          const supplyAmountNum = Number(supplyAsset?.data?.amount);
          const borrowAmountNum = Number(borrowAsset?.data?.amount);
          const supplyPrice = Number(supplyAsset?.data?.price);
          const borrowPrice = Number(borrowAsset?.data?.price);
          const supplyMeta = supplyMint ? portfolioAttempt.tokenInfoSolana[supplyMint] : null;
          const borrowMeta = borrowMint ? portfolioAttempt.tokenInfoSolana[borrowMint] : null;
          const healthRatio = data?.healthRatio === null || data?.healthRatio === undefined ? null : Number(data.healthRatio);
          const supplyAprPct = pickYieldPct(supplyAsset?.data?.yields ?? data?.suppliedYields);
          const borrowAprPct = pickYieldPct(borrowAsset?.data?.yields ?? data?.borrowedYields);
          const riskFrac =
            typeof healthRatio === "number" && Number.isFinite(healthRatio) ? 1 - healthRatio : null;
          const riskRatioPct =
            typeof riskFrac === "number" && Number.isFinite(riskFrac) ? Math.max(0, Math.min(999, riskFrac * 100)) : null;
          const healthFactor =
            typeof riskFrac === "number" && Number.isFinite(riskFrac) && riskFrac > 0 ? 1 / riskFrac : null;

          const out: any = {
            source: "vault",
            // vaultId/nftId are not provided by Portfolio API; keep null.
            vaultId: null,
            nftId: null,
            supplyMint: supplyMint && isLikelySolanaAddress(supplyMint) ? supplyMint : null,
            borrowMint: borrowMint && isLikelySolanaAddress(borrowMint) ? borrowMint : null,
            supplyAmount: Number.isFinite(supplyAmountNum) ? String(supplyAmountNum) : "0",
            borrowAmount: Number.isFinite(borrowAmountNum) ? String(borrowAmountNum) : "0",
            ...(supplyUsd > 0 ? { supplyUsd } : {}),
            ...(borrowUsd > 0 ? { borrowUsd } : {}),
            ...(typeof supplyAprPct === "number" && Number.isFinite(supplyAprPct) && supplyAprPct > 0
              ? { supplyAprPct }
              : {}),
            ...(typeof borrowAprPct === "number" && Number.isFinite(borrowAprPct) && borrowAprPct > 0
              ? { borrowAprPct }
              : {}),
            ...(typeof riskRatioPct === "number" && Number.isFinite(riskRatioPct) ? { liquidationPct: riskRatioPct } : {}),
            ...(typeof healthFactor === "number" && Number.isFinite(healthFactor) && healthFactor > 0 ? { healthFactor } : {}),
            supplyToken:
              supplyMint && supplyMeta
                ? {
                    mint: supplyMint,
                    symbol: typeof supplyMeta.symbol === "string" ? supplyMeta.symbol : undefined,
                    name: typeof supplyMeta.name === "string" ? supplyMeta.name : undefined,
                    logoUrl: typeof supplyMeta.logoURI === "string" ? supplyMeta.logoURI : typeof supplyMeta.logoUrl === "string" ? supplyMeta.logoUrl : undefined,
                    priceUsd: Number.isFinite(supplyPrice) && supplyPrice > 0 ? supplyPrice : undefined,
                  }
                : supplyMint
                  ? {
                      mint: supplyMint,
                      priceUsd: Number.isFinite(supplyPrice) && supplyPrice > 0 ? supplyPrice : undefined,
                    }
                  : undefined,
            borrowToken:
              borrowMint && borrowMeta
                ? {
                    mint: borrowMint,
                    symbol: typeof borrowMeta.symbol === "string" ? borrowMeta.symbol : undefined,
                    name: typeof borrowMeta.name === "string" ? borrowMeta.name : undefined,
                    logoUrl: typeof borrowMeta.logoURI === "string" ? borrowMeta.logoURI : typeof borrowMeta.logoUrl === "string" ? borrowMeta.logoUrl : undefined,
                    priceUsd: Number.isFinite(borrowPrice) && borrowPrice > 0 ? borrowPrice : undefined,
                  }
                : borrowMint
                  ? {
                      mint: borrowMint,
                      priceUsd: Number.isFinite(borrowPrice) && borrowPrice > 0 ? borrowPrice : undefined,
                    }
                  : undefined,
            // Expose Portfolio API health as Jupiter-style positionHealthPct (if available).
            ...(Number.isFinite(healthRatio as number)
              ? {
                  jupiter: {
                    positionHealthPct: Math.max(0, Math.min(100, (healthRatio as number) * 100)),
                    riskRatioPct:
                      typeof riskRatioPct === "number" && Number.isFinite(riskRatioPct)
                        ? Math.max(0, Math.min(100, riskRatioPct))
                        : Math.max(0, Math.min(100, (1 - (healthRatio as number)) * 100)),
                  },
                }
              : {}),
          };

          if (debug) {
            out.__portfolioDiag = {
              elementIndex: idx,
              platformId: el?.platformId ?? null,
              label: el?.label ?? null,
              netApy: el?.netApy ?? null,
              healthRatio: healthRatio,
              suppliedAssetsCount: Array.isArray(data?.suppliedAssets) ? data.suppliedAssets.length : 0,
              borrowedAssetsCount: Array.isArray(data?.borrowedAssets) ? data.borrowedAssets.length : 0,
            };
          }

          return out;
        })
        // keep only rows that have a real borrow value (matches UI expectation)
        .filter((p: any) => (typeof p?.borrowUsd === "number" ? p.borrowUsd > 0 : false));

      const payload: Record<string, unknown> = {
        success: true,
        address,
        data: {
          vault: [],
          liquidity: [],
          positions: normalizedVault,
        },
        count: {
          vault: 0,
          liquidity: 0,
          total: 0,
          positions: normalizedVault.length,
        },
        meta: debug
          ? {
              ms: Date.now() - started,
              source: "portfolio-api",
              portfolioBorrowlendElements: borrowlend.length,
            }
          : undefined,
      };

      if (!debug && address) {
        const cacheRoot = ((globalThis as any).__jupiterBorrowResponseCache ??
          ((globalThis as any).__jupiterBorrowResponseCache = new Map())) as Map<
          string,
          { at: number; payload: any }
        >;
        cacheRoot.set(address, { at: Date.now(), payload });
      }

      return NextResponse.json(payload, {
        headers: {
          "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
        },
      });
    }

    let Client: any = null;
    try {
      const mod = (await import("@jup-ag/lend-read")) as any;
      Client = mod?.Client ?? mod?.default ?? null;
      if (!Client) throw new Error("Missing Client export");
    } catch (e) {
      console.error("[JupiterBorrow] Failed to load @jup-ag/lend-read:", e);
      return NextResponse.json(
        {
          success: false,
          error: "Jupiter Lend Read SDK is not installed or failed to load",
          hint: "npm i @jup-ag/lend-read",
          data: [],
        },
        { status: 503 }
      );
    }

    const user = new PublicKey(address);

    const rpcCandidates = Array.from(
      new Set([getSolanaRpcUrl(), "https://rpc.ankr.com/solana", clusterApiUrl("mainnet-beta")].filter(Boolean))
    );

    const attemptWithConnections = async <T,>(
      fn: (connection: Connection) => Promise<T>
    ): Promise<{ ok: true; value: T; rpc: string } | { ok: false; error: unknown }> => {
      let lastErr: unknown = null;
      for (const rpc of rpcCandidates) {
        try {
          const connection = new Connection(rpc, "confirmed");
          const value = await fn(connection);
          return { ok: true, value, rpc };
        } catch (e) {
          lastErr = e;
          continue;
        }
      }
      return { ok: false, error: lastErr };
    };

    // 1) Vault borrow positions (NFT positions)
    let vaultPositions: unknown[] = [];
    const vaultRpc = { value: null as string | null };
    const vaultAttempt = await attemptWithConnections(async (connection) => {
      const client = new Client(connection);
      const positions = (await client.vault.getAllUserPositions(user)) as unknown[];
      const list = Array.isArray(positions) ? positions : [];

      return list;
    });
    if (vaultAttempt.ok) {
      vaultPositions = vaultAttempt.value;
      vaultRpc.value = vaultAttempt.rpc;
    } else {
      console.error("[JupiterBorrow] vault.getAllUserPositions failed on all RPCs:", vaultAttempt.error);
      vaultPositions = [];
    }

    // 2) Liquidity borrow positions (reserve-based)
    let liquidityBorrowings: unknown[] = [];
    const liquidityAttempt = await attemptWithConnections(async (connection) => {
      const { Liquidity } = (await import("@jup-ag/lend-read")) as any;
      const liquidity = new Liquidity(connection);
      const listed = (await liquidity.listedTokens()) as unknown[];
      const borrowTokens = Array.isArray(listed) ? (listed as PublicKey[]) : [];
      const resp = await liquidity.getUserMultipleBorrowData(user, borrowTokens);
      const rows = (resp as any)?.userBorrowingsData;
      const list = Array.isArray(rows) ? rows : [];
      // Attach mint by index (SDK rows don't carry it).
      return list.map((row: unknown, idx: number) => ({
        mint: borrowTokens[idx]?.toBase58?.() ?? null,
        ...(row && typeof row === "object" ? (row as Record<string, unknown>) : { value: row }),
      }));
    });
    if (liquidityAttempt.ok) {
      liquidityBorrowings = liquidityAttempt.value;
    } else {
      console.error("[JupiterBorrow] liquidity.getUserMultipleBorrowData failed on all RPCs:", liquidityAttempt.error);
      liquidityBorrowings = [];
    }

    // Normalized "positions" array for UI:
    // - we focus on vault positions (NFT positions) because those are the borrow accounts users care about
    // - amounts are expressed in 1e9 units per SDK docs
    type NormalizedBorrowPosition = {
      source: "vault";
      vaultId: number | null;
      nftId: number | null;
      supplyMint: string | null;
      borrowMint: string | null;
      supplyAmount: string; // ui string (token units, 1e9 scaling)
      borrowAmount: string; // ui string (token units, 1e9 scaling)
      supplyUsd?: number;
      borrowUsd?: number;
      supplyAprPct?: number;
      borrowAprPct?: number;
      healthFactor?: number;
      liquidationPct?: number;
      supplyToken?: { mint: string; symbol?: string; name?: string; logoUrl?: string; priceUsd?: number };
      borrowToken?: { mint: string; symbol?: string; name?: string; logoUrl?: string; priceUsd?: number };
      sdk?: { healthFactor?: number; liquidationPct?: number };
      jupiter?: {
        riskRatio?: number;
        riskRatioPct?: number;
        positionHealthPct?: number;
      };
    };

    const normalizedVault: NormalizedBorrowPosition[] = [];
    const supplyMints: string[] = [];
    const borrowMints: string[] = [];

    // Stable cache: vaultId -> (supplyMint, borrowMint). These do not change in practice.
    const VAULT_MINTS_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
    const vaultMintsCache = getGlobalMap<number, TimedCacheEntry<{ supplyMint: string | null; borrowMint: string | null }>>(
      "__jupBorrowVaultMintsByVaultIdCache"
    );

    for (const p of vaultPositions as any[]) {
      const vaultIdRaw = p?.vault?.constantViews?.vaultId ?? p?.vaultId ?? null;
      const vaultId = toNullableNumber(vaultIdRaw);
      const nftIdRaw = p?.nftId ?? p?.positionId ?? null;
      const nftId = toNullableNumber(nftIdRaw);

      const vaultLike = p?.vault ?? p?.vaultData ?? p?.vaultEntireData ?? null;
      const supplyMint =
        extractMintFromVaultLike(vaultLike, "supply") ??
        (typeof p?.supplyToken?.toBase58 === "function" ? p.supplyToken.toBase58() : null) ??
        (typeof p?.collateralToken?.toBase58 === "function" ? p.collateralToken.toBase58() : null);
      const borrowMint =
        extractMintFromVaultLike(vaultLike, "borrow") ??
        (typeof p?.borrowToken?.toBase58 === "function" ? p.borrowToken.toBase58() : null);

      if (supplyMint) supplyMints.push(supplyMint);
      if (borrowMint) borrowMints.push(borrowMint);

      const supplyRaw = String(p?.supply?.toString?.() ?? p?.supply ?? "0");
      const borrowRaw = String(p?.borrow?.toString?.() ?? p?.borrow ?? "0");
      const supplyAmount = toDecimalFrom1e9(supplyRaw);
      const borrowAmount = toDecimalFrom1e9(borrowRaw);

      normalizedVault.push({
        source: "vault",
        vaultId,
        nftId,
        supplyMint,
        borrowMint,
        supplyAmount: String(supplyAmount),
        borrowAmount: String(borrowAmount),
      });
    }

    // Fill missing mints from stable vaultId->mints cache before doing any extra RPC calls.
    for (const row of normalizedVault) {
      const vid = row.vaultId;
      if (typeof vid !== "number" || !Number.isFinite(vid) || vid <= 0) continue;
      const cached = vaultMintsCache.get(vid);
      if (!cached || !isFresh(cached.at, VAULT_MINTS_TTL_MS)) continue;
      if (!row.supplyMint && cached.value.supplyMint) row.supplyMint = cached.value.supplyMint;
      if (!row.borrowMint && cached.value.borrowMint) row.borrowMint = cached.value.borrowMint;
      if (cached.value.supplyMint) supplyMints.push(cached.value.supplyMint);
      if (cached.value.borrowMint) borrowMints.push(cached.value.borrowMint);
    }

    // Fallback: some SDK responses omit vault constantViews (supplyToken/borrowToken).
    // If we have vaultId+nftId, refetch a richer position view.
    try {
      if (vaultRpc.value) {
        const connection = new Connection(vaultRpc.value, "confirmed");
        const client = new Client(connection);
        const hasGetPos = typeof client?.vault?.getPositionByVaultId === "function";
        if (hasGetPos) {
          // If vaultId is missing, try to resolve it by probing vault IDs.
          // The SDK exposes total vaults via VaultAdmin; we use that to bound the scan.
          let totalVaults: number | null = null;
          try {
            if (typeof client?.vault?.getTotalVaults === "function") {
              const tv = await client.vault.getTotalVaults();
              const n = toNullableNumber(tv);
              if (typeof n === "number" && Number.isFinite(n) && n > 0) totalVaults = n;
            }
          } catch {
            totalVaults = null;
          }

          if (totalVaults && totalVaults > 1) {
            const missingVaultId = normalizedVault
              .map((row, idx) => ({ row, idx }))
              .filter(({ row }) => row.vaultId === null)
              .filter(({ row }) => typeof row.nftId === "number" && Number.isFinite(row.nftId) && row.nftId > 0);

            // Resolve vaultId per nftId (usually only a few positions).
            const resolved = await mapWithConcurrencyLimit(
              missingVaultId,
              2,
              async ({ row, idx }) => {
                const vaultId = await resolveVaultIdByNftId({
                  client,
                  nftId: row.nftId as number,
                  minVaultId: 1,
                  maxVaultIdInclusive: Math.min(2048, Math.max(1, totalVaults - 1)),
                  ownerBase58: user.toBase58(),
                });
                return { idx, vaultId };
              }
            );
            for (const r of resolved) {
              if (typeof r?.vaultId === "number" && Number.isFinite(r.vaultId)) normalizedVault[r.idx].vaultId = r.vaultId;
            }
          }

          const needsRefetch = normalizedVault
            .map((row, idx) => ({ row, idx }))
            .filter(({ row }) => !row.supplyMint || !row.borrowMint)
            .filter(({ row }) => typeof row.vaultId === "number" && Number.isFinite(row.vaultId))
            .filter(({ row }) => typeof row.nftId === "number" && Number.isFinite(row.nftId));

          const refetched = await mapWithConcurrencyLimit(
            needsRefetch,
            3,
            async ({ row, idx }) => {
              try {
                const rich = await client.vault.getPositionByVaultId(row.vaultId as number, row.nftId as number);
                const sMint =
                  typeof rich?.vaultData?.constantViews?.supplyToken?.toBase58 === "function"
                    ? rich.vaultData.constantViews.supplyToken.toBase58()
                    : null;
                const bMint =
                  typeof rich?.vaultData?.constantViews?.borrowToken?.toBase58 === "function"
                    ? rich.vaultData.constantViews.borrowToken.toBase58()
                    : null;
                // Update stable cache for this vaultId (safe long TTL).
                if (typeof row.vaultId === "number" && Number.isFinite(row.vaultId)) {
                  vaultMintsCache.set(row.vaultId, { at: Date.now(), value: { supplyMint: sMint, borrowMint: bMint } });
                }
                return { idx, sMint, bMint };
              } catch {
                return { idx, sMint: null as string | null, bMint: null as string | null };
              }
            }
          );

          for (const r of refetched) {
            if (r?.sMint && !normalizedVault[r.idx].supplyMint) normalizedVault[r.idx].supplyMint = r.sMint;
            if (r?.bMint && !normalizedVault[r.idx].borrowMint) normalizedVault[r.idx].borrowMint = r.bMint;
            if (r?.sMint) supplyMints.push(r.sMint);
            if (r?.bMint) borrowMints.push(r.bMint);
          }
        }
      }
    } catch {
      // ignore
    }

    const tokenMints = Array.from(new Set([...supplyMints, ...borrowMints].filter((m) => isLikelySolanaAddress(m))));
    const metadataService = JupiterTokenMetadataService.getInstance();
    const metadataMap = (await metadataService.getMetadataMap(tokenMints).catch(() => ({}))) as Record<
      string,
      { symbol?: string; name?: string; logoUrl?: string }
    >;
    const priceMap = await fetchJupiterUsdPriceMap(tokenMints);

    // Prefetch vault data (used for mint extraction + liquidation threshold for healthFactor fallback).
    const vaultDataById = new Map<number, any>();
    try {
      if (vaultRpc.value) {
        const connection = new Connection(vaultRpc.value, "confirmed");
        const client = new Client(connection);
        const uniqueVaultIds = Array.from(
          new Set(
            normalizedVault
              .map((r) => (typeof r.vaultId === "number" && Number.isFinite(r.vaultId) ? r.vaultId : null))
              .filter(Boolean)
          )
        ) as number[];

        await mapWithConcurrencyLimit(uniqueVaultIds, 4, async (vaultId) => {
          try {
            // Mint pairs may be cached long-term, but we still need full vaultData (oracle, liquidation
            // threshold, etc.) for health metrics. Never skip getVaultByVaultId just because mints are cached.
            if (vaultDataById.has(vaultId)) return null;
            const vd = typeof client?.vault?.getVaultByVaultId === "function" ? await client.vault.getVaultByVaultId(vaultId) : null;
            if (vd) {
              vaultDataById.set(vaultId, vd);
              const s =
                typeof vd?.constantViews?.supplyToken?.toBase58 === "function" ? vd.constantViews.supplyToken.toBase58() : null;
              const b =
                typeof vd?.constantViews?.borrowToken?.toBase58 === "function" ? vd.constantViews.borrowToken.toBase58() : null;
              vaultMintsCache.set(vaultId, { at: Date.now(), value: { supplyMint: s, borrowMint: b } });
            }
          } catch {
            // ignore
          }
          return null;
        });
      }
    } catch {
      // ignore
    }

    // If we still don't have mints, fetch vault data by vaultId (this is cheap and reliable).
    try {
      if (vaultRpc.value) {
        for (const row of normalizedVault) {
          if (!row.vaultId || typeof row.vaultId !== "number") continue;
          // Try stable cache first.
          const cached = vaultMintsCache.get(row.vaultId);
          if (cached && isFresh(cached.at, VAULT_MINTS_TTL_MS)) {
            if (!row.supplyMint && cached.value.supplyMint) row.supplyMint = cached.value.supplyMint;
            if (!row.borrowMint && cached.value.borrowMint) row.borrowMint = cached.value.borrowMint;
            continue;
          }
          const vd = vaultDataById.get(row.vaultId);
          if (!vd) continue;
          if (!row.supplyMint) {
            const s =
              typeof vd?.constantViews?.supplyToken?.toBase58 === "function" ? vd.constantViews.supplyToken.toBase58() : null;
            if (s) row.supplyMint = s;
          }
          if (!row.borrowMint) {
            const b =
              typeof vd?.constantViews?.borrowToken?.toBase58 === "function" ? vd.constantViews.borrowToken.toBase58() : null;
            if (b) row.borrowMint = b;
          }
          vaultMintsCache.set(row.vaultId, { at: Date.now(), value: { supplyMint: row.supplyMint, borrowMint: row.borrowMint } });
        }
      }
    } catch {
      // ignore
    }

    // If available, compute accurate risk metrics via SDK for each position.
    // This can be heavy, so we do it with a small concurrency limit.
    let sdkRiskByNftId = new Map<number, { healthFactor?: number; liquidationPct?: number }>();
    try {
      if (vaultRpc.value && Array.isArray(vaultPositions) && vaultPositions.length > 0) {
        const connection = new Connection(vaultRpc.value, "confirmed");
        const client = new Client(connection);
        const hasFn = typeof client?.vault?.getCurrentPositionState === "function" && typeof client?.vault?.getUserPosition === "function";
        if (hasFn) {
          const computed = await mapWithConcurrencyLimit(
            vaultPositions as any[],
            3,
            async (p: any) => {
              const nftIdRaw = p?.nftId ?? p?.positionId ?? null;
              const nftId = toNullableNumber(nftIdRaw);
              if (!nftId) return { nftId: null as number | null, risk: null as any };
              try {
                const vaultIdRaw = p?.vault?.constantViews?.vaultId ?? p?.vaultId ?? null;
                const vaultId = toNullableNumber(vaultIdRaw);
                if (!vaultId) return { nftId, risk: null as any };
                const positionAcc = await client.vault.getUserPosition({ vaultId, positionId: nftId });
                if (!positionAcc) return { nftId, risk: null as any };
                const state = await client.vault.getCurrentPositionState({ vaultId, position: positionAcc });
                const hf =
                  typeof state?.healthFactor === "number"
                    ? state.healthFactor
                    : Number.isFinite(Number(state?.healthFactor))
                      ? Number(state.healthFactor)
                      : undefined;
                const liqPct =
                  typeof state?.liquidationPct === "number"
                    ? state.liquidationPct
                    : Number.isFinite(Number(state?.liquidationPct))
                      ? Number(state.liquidationPct)
                      : undefined;
                const risk = {
                  healthFactor: Number.isFinite(hf as number) ? (hf as number) : undefined,
                  liquidationPct: Number.isFinite(liqPct as number) ? (liqPct as number) : undefined,
                };
                return { nftId, risk };
              } catch {
                return { nftId, risk: null as any };
              }
            }
          );
          for (const row of computed) {
            if (row?.nftId && row.risk) sdkRiskByNftId.set(row.nftId, row.risk);
          }
        }
      }
    } catch {
      // ignore
    }

    // Enrich with borrow token info + risk estimate when possible.
    for (const row of normalizedVault) {
      const supplyMint = row.supplyMint;
      const borrowMint = row.borrowMint;
      const supplyPrice = supplyMint ? priceMap.get(supplyMint) : undefined;
      const borrowPrice = borrowMint ? priceMap.get(borrowMint) : undefined;
      const supplyUsd =
        typeof supplyPrice === "number" && Number.isFinite(supplyPrice) ? Number(row.supplyAmount) * supplyPrice : undefined;
      const borrowUsd =
        typeof borrowPrice === "number" && Number.isFinite(borrowPrice) ? Number(row.borrowAmount) * borrowPrice : undefined;
      if (typeof supplyUsd === "number") row.supplyUsd = supplyUsd;
      if (typeof borrowUsd === "number") row.borrowUsd = borrowUsd;

      if (supplyMint) {
        const meta = metadataMap[supplyMint] || {};
        row.supplyToken = {
          mint: supplyMint,
          symbol: meta.symbol,
          name: meta.name,
          logoUrl: meta.logoUrl,
          priceUsd: typeof supplyPrice === "number" ? supplyPrice : undefined,
        };
      }
      if (borrowMint) {
        const meta = metadataMap[borrowMint] || {};
        row.borrowToken = {
          mint: borrowMint,
          symbol: meta.symbol,
          name: meta.name,
          logoUrl: meta.logoUrl,
          priceUsd: typeof borrowPrice === "number" ? borrowPrice : undefined,
        };
      }

      // APR/APY (optional): surface if SDK provides it in vault data we already prefetched.
      if (typeof row.vaultId === "number" && Number.isFinite(row.vaultId) && row.vaultId > 0) {
        const vd = vaultDataById.get(row.vaultId);
        if (vd) {
          const s = extractAprPctFromVaultData(vd, "supply");
          const b = extractAprPctFromVaultData(vd, "borrow");
          if (typeof s === "number" && Number.isFinite(s) && s > 0) row.supplyAprPct = s;
          if (typeof b === "number" && Number.isFinite(b) && b > 0) row.borrowAprPct = b;
          if (debug) {
            const sDbg = extractAprDebugFromVaultData(vd, "supply");
            const bDbg = extractAprDebugFromVaultData(vd, "borrow");
            (row as any).__aprDiag = {
              supply: { key: sDbg.pickedKey, raw: sanitizeForJson(sDbg.pickedRaw), pct: sDbg.pickedPct },
              borrow: { key: bDbg.pickedKey, raw: sanitizeForJson(bDbg.pickedRaw), pct: bDbg.pickedPct },
            };
          }
        }
      }

      const sdkRisk = row.nftId ? sdkRiskByNftId.get(row.nftId) : undefined;
      if (sdkRisk?.healthFactor || sdkRisk?.liquidationPct) row.sdk = sdkRisk;
      // NOTE: SDK "healthFactor" field has been observed to disagree with Jupiter UI for some vaults.
      // We keep it in `row.sdk.healthFactor` for debugging, but prefer the LT-based computation below for display.
      if (typeof sdkRisk?.liquidationPct === "number" && Number.isFinite(sdkRisk.liquidationPct)) {
        row.liquidationPct = sdkRisk.liquidationPct;
      }

      // Jupiter-native "Position Health" approximation:
      // lend-read computes `riskRatio` for a vault position as borrow / (supply * oraclePriceAdj).
      // We expose both `riskRatioPct` and `positionHealthPct = 100 - riskRatioPct` so UI can match Jupiter-style display.
      const jupDiag = {
        attempted: 0,
        computed: 0,
        errors: [] as Array<{ vaultId: number; nftId: number; step: string; message: string; context?: Record<string, unknown> }>,
      };
      if (debug) {
        (row as any).__jupDiag = jupDiag;
      }
      try {
        if (vaultRpc.value && typeof row.vaultId === "number" && typeof row.nftId === "number") {
          jupDiag.attempted += 1;
          const vd = vaultDataById.get(row.vaultId);
          if (!vd) {
            throw new Error("Missing vaultData for vaultId");
          }
          if (vd?.configs?.oracle && typeof (vd.configs.oracle as any)?.toBase58 === "function") {
            // Cache oracle liquidatePrice per vaultId.
            const oracleCache = (globalThis as any).__jupBorrow_oracleCache ?? ((globalThis as any).__jupBorrow_oracleCache = new Map());
            let liquidatePrice: BN | null = oracleCache.get(row.vaultId) ?? null;
            if (!liquidatePrice) {
              const connection = new Connection(vaultRpc.value, "confirmed");
              const client = new Client(connection);
              if (typeof client?.vault?.getOraclePrice === "function") {
                let op: any = null;
                try {
                  op = await client.vault.getOraclePrice(vd.configs.oracle);
                } catch (e) {
                  // Fallback: some oracle configs contain null sources; SDK helper may throw.
                  try {
                    const oracleProgram = (client as any)?.vault?.oracle;
                    let oracleData: any = null;
                    try {
                      oracleData = await oracleProgram?.account?.oracle?.fetch?.(vd.configs.oracle);
                    } catch (eFetch) {
                      throw new Error(`oracle.fetch failed: ${eFetch instanceof Error ? eFetch.message : String(eFetch)}`);
                    }

                    const sources = Array.isArray(oracleData?.sources) ? oracleData.sources : [];
                    const remainingAccounts = sources
                      .map((s: any) => s?.source)
                      .filter((pk: any) => pk && typeof pk?.toBase58 === "function")
                      .map((pk: any) => ({ pubkey: pk, isWritable: false, isSigner: false }));

                    const nonce = oracleData?.nonce;

                    let liq: any = null;
                    let oper: any = null;
                    try {
                      liq = await oracleProgram?.methods
                        ?.getExchangeRateLiquidate?.(nonce)
                        ?.accounts?.({ oracle: vd.configs.oracle })
                        ?.remainingAccounts?.(remainingAccounts)
                        ?.view?.();
                    } catch (eLiq) {
                      throw new Error(
                        `oracle.view(liquidate) failed: ${eLiq instanceof Error ? eLiq.message : String(eLiq)}`
                      );
                    }
                    try {
                      oper = await oracleProgram?.methods
                        ?.getExchangeRateOperate?.(nonce)
                        ?.accounts?.({ oracle: vd.configs.oracle })
                        ?.remainingAccounts?.(remainingAccounts)
                        ?.view?.();
                    } catch (eOper) {
                      throw new Error(
                        `oracle.view(operate) failed: ${eOper instanceof Error ? eOper.message : String(eOper)}`
                      );
                    }

                    op = {
                      liquidatePrice: liq?.toString?.() ?? String(liq),
                      operatePrice: oper?.toString?.() ?? String(oper),
                      __fallback: true,
                      __sourcesTotal: sources.length,
                      __sourcesUsed: remainingAccounts.length,
                      __nonce: typeof nonce === "number" || typeof nonce === "string" ? nonce : nonce?.toString?.() ?? null,
                    };
                  } catch (e2) {
                    throw new Error(
                      `getOraclePrice failed: ${e instanceof Error ? e.message : String(e)}; fallback failed: ${
                        e2 instanceof Error ? e2.message : String(e2)
                      }`
                    );
                  }
                }
                const lp = op?.liquidatePrice;
                try {
                  liquidatePrice = lp ? new BN(lp) : null;
                } catch {
                  liquidatePrice = null;
                }
                if (liquidatePrice) oracleCache.set(row.vaultId, liquidatePrice);
              }
            }

            if (liquidatePrice) {
              // Get exact userPosition for this vaultId/nftId and compute riskRatio as in lend-read:
              // riskRatio = borrow / ( supply * oraclePrice / 0x38d7ea4c68000 )
              const connection = new Connection(vaultRpc.value, "confirmed");
              const client = new Client(connection);
              if (typeof client?.vault?.getPositionByVaultId === "function") {
                let rich: any = null;
                try {
                  rich = await client.vault.getPositionByVaultId(row.vaultId, row.nftId);
                } catch (e) {
                  throw new Error(`getPositionByVaultId failed: ${e instanceof Error ? e.message : String(e)}`);
                }
                const up = rich?.userPosition;
                let supply: BN | null = null;
                let borrow: BN | null = null;
                try {
                  supply = up?.supply ? new BN(up.supply) : null;
                  borrow = up?.borrow ? new BN(up.borrow) : null;
                } catch {
                  supply = null;
                  borrow = null;
                }
                if (!supply || !borrow) throw new Error("Missing supply/borrow BN in userPosition");
                if (!supply.isZero()) {
                  const SCALE = new BN(0x38d7ea4c68000); // same constant as lend-read
                  const denom = supply.mul(liquidatePrice).div(SCALE);
                  if (!denom.isZero()) {
                    const rr = borrow.toNumber() / denom.toNumber();
                    const rrPct = rr * 100;
                    row.jupiter = {
                      riskRatio: rr,
                      riskRatioPct: rrPct,
                      positionHealthPct: 100 - rrPct,
                    };
                    jupDiag.computed += 1;
                  }
                }
              }
            }
          } else {
            throw new Error("Missing vd.configs.oracle");
          }
        }
      } catch (e) {
        if (debug && typeof row.vaultId === "number" && typeof row.nftId === "number") {
          jupDiag.errors.push({
            vaultId: row.vaultId,
            nftId: row.nftId,
            step: "compute",
            message: e instanceof Error ? e.message : String(e),
            context: {
              hasVaultData: vaultDataById.has(row.vaultId),
              hasOracle: Boolean(vaultDataById.get(row.vaultId)?.configs?.oracle),
            },
          });
        }
      }

      // liquidation threshold: best-effort (SDK field name can vary by version)
      const lt = (() => {
        const v = (vaultPositions as any[]).find((p) => (p?.nftId ?? null) === row.nftId);
        const raw =
          v?.vault?.configs?.liquidationThreshold ??
          v?.vault?.configs?.liquidation_threshold ??
          v?.vault?.configs?.liquidationThresholdBps ??
          null;
        return normalizeLiquidationThreshold(raw).value;
      })();

      // LT-based health metrics (preferred for UI): compute whenever possible.
      // Do NOT gate this on row.liquidationPct, because SDK may provide a liquidationPct even when its healthFactor differs from UI.
      if (
        typeof supplyUsd === "number" &&
        typeof borrowUsd === "number" &&
        supplyUsd > 0 &&
        borrowUsd > 0 &&
        ((lt && lt > 0) || (typeof row.vaultId === "number" && vaultDataById.has(row.vaultId)))
      ) {
        const lt2 = (() => {
          if (lt && lt > 0) return lt;
          if (typeof row.vaultId !== "number") return null;
          const vd = vaultDataById.get(row.vaultId);
          const raw =
            vd?.configs?.liquidationThreshold ??
            vd?.configs?.liquidation_threshold ??
            vd?.configs?.liquidationThresholdBps ??
            null;
          return normalizeLiquidationThreshold(raw).value;
        })();
        if (!lt2 || !(lt2 > 0)) continue;

        const liquidationValue = supplyUsd * lt2;
        // Prefer LT-based values for display; keep any SDK values in row.sdk for debugging.
        row.liquidationPct = Math.min(999, (borrowUsd / liquidationValue) * 100);
        row.healthFactor = liquidationValue / borrowUsd;
      }
    }

    const vaultOut = vaultPositions;
    const liquidityOut = liquidityBorrowings;

    const payload: Record<string, unknown> = {
      success: true,
      address,
      data: {
        vault: sanitizeForJson(vaultOut),
        liquidity: sanitizeForJson(liquidityOut),
        positions: normalizedVault,
      },
      count: {
        vault: vaultOut.length,
        liquidity: liquidityOut.length,
        total: vaultOut.length + liquidityOut.length,
        positions: normalizedVault.length,
      },
    };
    if (debug) {
      // Aggregate Jupiter-native health debug info (if any rows emitted it).
      const jupiterHealth = {
        attempted: 0,
        computed: 0,
        errors: [] as Array<{ vaultId: number; nftId: number; step: string; message: string }>,
      };
      for (const r of normalizedVault) {
        const jd = (r as any)?.__jupDiag;
        if (!jd) continue;
        jupiterHealth.attempted += jd.attempted ?? 0;
        jupiterHealth.computed += jd.computed ?? 0;
        if (Array.isArray(jd.errors)) jupiterHealth.errors.push(...jd.errors);
      }
      payload.meta = {
        ms: Date.now() - started,
        rpcCandidates,
        vaultRpc: vaultAttempt.ok ? vaultAttempt.rpc : null,
        liquidityRpc: liquidityAttempt.ok ? liquidityAttempt.rpc : null,
        vaultError: !vaultAttempt.ok ? String((vaultAttempt as any).error?.message ?? vaultAttempt.error) : null,
        liquidityError: !liquidityAttempt.ok ? String((liquidityAttempt as any).error?.message ?? liquidityAttempt.error) : null,
        jupiterHealth,
      };
    }

    // Save cache (only when not debugging).
    if (!debug && address) {
      const cacheRoot = ((globalThis as any).__jupiterBorrowResponseCache ??
        ((globalThis as any).__jupiterBorrowResponseCache = new Map())) as Map<
        string,
        { at: number; payload: any }
      >;
      cacheRoot.set(address, { at: Date.now(), payload });
    }

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[JupiterBorrow] error:", e);
    return NextResponse.json(
      { success: false, error: msg, data: [], count: 0, meta: { ms: Date.now() - started } },
      { status: 500 }
    );
  }
}

