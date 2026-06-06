import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getServerSolanaConnection } from "@/app/api/jupiter/_lib";
import { JupiterTokenMetadataService } from "@/lib/services/solana/tokenMetadata";
import { getPreferredJupiterTokenIcon } from "@/lib/services/solana/jupiterTokenIcons";
import { lookupWellKnownToken } from "@/lib/solana/wellKnownTokens";
import { getMeteoraPoolMetaMap, type MeteoraPoolMeta } from "@/lib/services/meteora/poolMeta";

export const dynamic = "force-dynamic";

type DlmmSdkStatic = {
  /** SDK 1.9.x: `Map<string, PositionInfo>` — pool address (base58) -> one position aggregate per pool. */
  getAllLbPairPositionsByUser: (connection: unknown, user: PublicKey) => Promise<Map<string, unknown>>;
};

/**
 * GET /api/protocols/meteora/userPositions?address=<solana_wallet>&debug=1
 *
 * Uses Meteora DLMM SDK:
 * https://docs.meteora.ag/developer-guide/guides/dlmm/typescript-sdk/sdk-functions#getalllbpairpositionsbyuser
 *
 * `DLMM.getAllLbPairPositionsByUser(connection, userPubKey)` returns `Map<string, PositionInfo>`:
 * LB pair (pool) pubkey as **string** -> `PositionInfo` (see SDK typings; includes position / bin data).
 *
 * REST pool metadata (names, TVL) is separate: https://dlmm.datapi.meteora.ag (OpenAPI in docs).
 */

function isLikelySolanaAddress(input: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input);
}

/**
 * BN.js (used by Anchor / DLMM SDK) stores integers as little-endian 26-bit limbs.
 * In production builds class names are minified, so `constructor.name === "BN"` fails
 * and the raw `{ negative, words, length, red }` shape would leak through `JSON.stringify`
 * — every downstream `Number(...)` then evaluates to `NaN` and amounts collapse to 0.
 * Recognize the shape directly and convert to a decimal string.
 */
function isBnLike(value: unknown): value is { words: number[]; negative?: number } {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    Array.isArray(o.words) &&
    typeof o.length === "number" &&
    typeof o.negative === "number" &&
    (o.words as unknown[]).every((w) => typeof w === "number")
  );
}

function bnLikeToString(o: { words: number[]; negative?: number }): string {
  let acc = 0n;
  for (let i = o.words.length - 1; i >= 0; i -= 1) {
    acc = (acc << 26n) | BigInt(o.words[i] & 0x3ffffff);
  }
  if (o.negative) acc = -acc;
  return acc.toString();
}

function sanitizeForJson(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof PublicKey) return value.toBase58();
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;

  if (isBnLike(value)) return bnLikeToString(value);

  if (typeof (value as { toBase58?: () => string }).toBase58 === "function") {
    try {
      return (value as PublicKey).toBase58();
    } catch {
      // fall through
    }
  }

  if (typeof (value as { toString?: () => string }).toString === "function") {
    const ctor = (value as object).constructor?.name;
    if (ctor === "BN" || ctor === "BigNumber") {
      try {
        return (value as { toString: () => string }).toString();
      } catch {
        return String(value);
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

interface EnrichedTokenInfo {
  mint: string;
  symbol: string;
  decimals: number;
  logoUrl?: string;
  priceUsd?: number;
}

interface EnrichedBin {
  binId: number;
  xAmount: number;
  yAmount: number;
  /** USD value of (xAmount × priceX + yAmount × priceY). Zero when prices missing. */
  usd: number;
  /** Bin price in tokenY per 1 tokenX (USDC per SOL etc.). Derived from positionBinData.pricePerToken. */
  price?: number;
}

interface EnrichedPosition {
  positionAddress: string;
  owner: string;
  lowerBinId: number;
  upperBinId: number;
  inRange: boolean;
  amountX: number;
  amountY: number;
  feeX: number;
  feeY: number;
  valueUsd: number;
  feesUsd: number;
  totalUsd: number;
  /** Per-bin liquidity breakdown for chart rendering; ordered ascending by binId. */
  bins: EnrichedBin[];
  /** Lower bound of the range in tokenY-per-tokenX units (e.g. USDC per SOL). */
  lowerBinPrice?: number;
  /** Upper bound of the range in tokenY-per-tokenX units. */
  upperBinPrice?: number;
  /** Current pool price in the same units, derived from activeBinId. */
  activeBinPrice?: number;
}

interface EnrichedPool {
  poolAddress: string;
  binStep: number;
  baseFactor: number;
  /** Base fee in percent, derived from binStep × baseFactor / 1e8 (DLMM convention). */
  baseFeePct: number;
  activeBinId: number;
  /** Pool price as USDC per SOL etc., derived from priceX/priceY. */
  pricePerY?: number;
  tokenX: EnrichedTokenInfo;
  tokenY: EnrichedTokenInfo;
  positions: EnrichedPosition[];
  totalUsd: number;
  /** Meteora datapi metadata (APR / APY / TVL / volume). Null when datapi miss. */
  meta?: MeteoraPoolMeta | null;
}

function rawToUi(raw: unknown, decimals: number): number {
  if (raw == null) return 0;
  let s: string;
  if (typeof raw === "string" || typeof raw === "number") {
    s = String(raw);
  } else if (isBnLike(raw)) {
    s = bnLikeToString(raw);
  } else {
    s = String(raw);
  }
  const n = Number(s);
  if (!Number.isFinite(n) || !Number.isFinite(decimals) || decimals < 0) return 0;
  return n / Math.pow(10, decimals);
}

function pickNumber(obj: unknown, key: string): number | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function pickString(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}

async function fetchJupiterPricesOnce(mints: string[]): Promise<Record<string, number>> {
  if (mints.length === 0) return {};
  const url = new URL("https://api.jup.ag/price/v3");
  url.searchParams.set("ids", mints.join(","));
  const headers: HeadersInit = { Accept: "application/json" };
  const apiKey = process.env.NEXT_PUBLIC_JUP_API_KEY || process.env.JUP_API_KEY;
  if (apiKey) headers["x-api-key"] = apiKey;

  try {
    const resp = await fetch(url.toString(), { cache: "no-store", headers });
    if (!resp.ok) return {};
    const json = (await resp.json().catch(() => null)) as unknown;
    if (!json || typeof json !== "object") return {};
    const o = json as Record<string, unknown>;
    const dataObj =
      (o.data && typeof o.data === "object" ? (o.data as Record<string, unknown>) : o) ?? {};
    const out: Record<string, number> = {};
    for (const mint of mints) {
      const entry = (dataObj as Record<string, unknown>)[mint];
      if (entry && typeof entry === "object") {
        const r = entry as Record<string, unknown>;
        const p = Number(r.usdPrice ?? r.price);
        if (Number.isFinite(p) && p > 0) out[mint] = p;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Retry Jupiter price fetch up to `maxAttempts` times, merging partial results.
 * A single transient miss has caused positions to render as $0.00 in the UI; we keep
 * trying until every requested mint has a price or we run out of attempts.
 */
async function fetchJupiterPrices(
  mints: string[],
  maxAttempts = 3
): Promise<Record<string, number>> {
  if (mints.length === 0) return {};
  const merged: Record<string, number> = {};
  let pending = [...mints];
  for (let attempt = 1; attempt <= maxAttempts && pending.length > 0; attempt += 1) {
    const partial = await fetchJupiterPricesOnce(pending);
    for (const [mint, price] of Object.entries(partial)) merged[mint] = price;
    pending = pending.filter((m) => merged[m] == null);
    if (pending.length > 0 && attempt < maxAttempts) {
      // Brief linear backoff; Jupiter price API is usually fine on the second try.
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
  if (pending.length > 0) {
    console.warn("[Meteora] Jupiter price miss after retries:", pending.join(", "));
  }
  return merged;
}

function buildEnrichedPools(
  rawPools: Array<{ lbPair: string; positions: unknown[] }>,
  metadata: Record<string, { symbol?: string; name?: string; logoUrl?: string; decimals?: number }>,
  prices: Record<string, number>,
  poolMetaMap: Record<string, MeteoraPoolMeta | null>
): EnrichedPool[] {
  const out: EnrichedPool[] = [];

  for (const pool of rawPools) {
    const poolAddress = pool.lbPair;
    const first = (pool.positions ?? [])[0] as Record<string, unknown> | undefined;
    if (!first) continue;

    const lbPair = first.lbPair as Record<string, unknown> | undefined;
    const tokenXRaw = first.tokenX as Record<string, unknown> | undefined;
    const tokenYRaw = first.tokenY as Record<string, unknown> | undefined;
    const mintX = pickString(lbPair, "tokenXMint") || pickString(tokenXRaw, "publicKey") || "";
    const mintY = pickString(lbPair, "tokenYMint") || pickString(tokenYRaw, "publicKey") || "";
    // Fallback to hard-coded well-known tokens (SOL / USDC / USDT / USDS) when
    // Jupiter's token-search returns nothing — most often a transient 429 on
    // Vercel. Without this fallback the UI shows `So11…` / `EPjF…` for the SOL/
    // USDC pool, which is what the user reported.
    const fallbackX = lookupWellKnownToken(mintX);
    const fallbackY = lookupWellKnownToken(mintY);
    const decimalsX =
      pickNumber(tokenXRaw?.mint as unknown, "decimals") ??
      metadata[mintX]?.decimals ??
      fallbackX?.decimals ??
      0;
    const decimalsY =
      pickNumber(tokenYRaw?.mint as unknown, "decimals") ??
      metadata[mintY]?.decimals ??
      fallbackY?.decimals ??
      0;
    const binStep = pickNumber(lbPair, "binStep") ?? 0;
    const activeBinId = pickNumber(lbPair, "activeId") ?? 0;
    const baseFactor =
      pickNumber(lbPair?.parameters as unknown, "baseFactor") ?? 0;
    const baseFeePct = (binStep * baseFactor) / 1e8 * 100; // %

    const metaX = metadata[mintX];
    const metaY = metadata[mintY];
    const symbolX =
      (metaX?.symbol || "").trim() ||
      fallbackX?.symbol ||
      `${mintX.slice(0, 4)}…`;
    const symbolY =
      (metaY?.symbol || "").trim() ||
      fallbackY?.symbol ||
      `${mintY.slice(0, 4)}…`;
    const logoX =
      getPreferredJupiterTokenIcon(symbolX, metaX?.logoUrl) || fallbackX?.logoUrl;
    const logoY =
      getPreferredJupiterTokenIcon(symbolY, metaY?.logoUrl) || fallbackY?.logoUrl;
    const priceX = prices[mintX];
    const priceY = prices[mintY];

    const positions: EnrichedPosition[] = [];
    for (const pinfo of pool.positions ?? []) {
      if (!pinfo || typeof pinfo !== "object") continue;
      const lbPositions = (pinfo as Record<string, unknown>).lbPairPositionsData;
      if (!Array.isArray(lbPositions)) continue;

      for (const row of lbPositions) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const positionAddress = pickString(r, "publicKey") || "";
        const positionData = r.positionData as Record<string, unknown> | undefined;
        if (!positionData) continue;

        const totalX = positionData.totalXAmountExcludeTransferFee ?? positionData.totalXAmount;
        const totalY = positionData.totalYAmountExcludeTransferFee ?? positionData.totalYAmount;
        const feeX = positionData.feeXExcludeTransferFee ?? positionData.feeX;
        const feeY = positionData.feeYExcludeTransferFee ?? positionData.feeY;
        const lowerBinId = pickNumber(positionData, "lowerBinId") ?? 0;
        const upperBinId = pickNumber(positionData, "upperBinId") ?? 0;
        const owner = pickString(positionData, "owner") || "";

        const amountX = rawToUi(totalX, decimalsX);
        const amountY = rawToUi(totalY, decimalsY);
        const feeXUi = rawToUi(feeX, decimalsX);
        const feeYUi = rawToUi(feeY, decimalsY);

        const valueUsd =
          (priceX != null ? amountX * priceX : 0) + (priceY != null ? amountY * priceY : 0);
        const feesUsd =
          (priceX != null ? feeXUi * priceX : 0) + (priceY != null ? feeYUi * priceY : 0);

        // Skip positions that are effectively empty — DLMM keeps the on-chain account
        // around after a full withdraw, which would render as a $0.00 ghost row.
        const dust = 1e-9;
        if (
          amountX < dust &&
          amountY < dust &&
          feeXUi < dust &&
          feeYUi < dust
        ) {
          continue;
        }

        // Compact per-bin breakdown for the chart.
        const rawBins = Array.isArray(positionData.positionBinData)
          ? (positionData.positionBinData as unknown[])
          : [];
        const bins: EnrichedBin[] = [];
        for (const b of rawBins) {
          if (!b || typeof b !== "object") continue;
          const bo = b as Record<string, unknown>;
          const binId = pickNumber(bo, "binId");
          if (binId == null) continue;
          const xAmount = rawToUi(bo.positionXAmount, decimalsX);
          const yAmount = rawToUi(bo.positionYAmount, decimalsY);
          const usd =
            (priceX != null ? xAmount * priceX : 0) + (priceY != null ? yAmount * priceY : 0);
          // DLMM stores price as raw token-amount ratio. pricePerToken includes
          // the decimal-scaling factor (USDC per SOL etc.) — use it directly.
          const priceRaw = (bo as Record<string, unknown>).pricePerToken;
          const priceNum = priceRaw != null ? Number(priceRaw) : NaN;
          const price = Number.isFinite(priceNum) && priceNum > 0 ? priceNum : undefined;
          bins.push({ binId, xAmount, yAmount, usd, price });
        }
        bins.sort((a, b) => a.binId - b.binId);

        // Bin price formula: raw ratio = (1 + binStep/10000)^binId is the
        // tokenY/tokenX ratio in base units. Convert to UI-units price (tokenY
        // per 1 tokenX) by multiplying by 10^(decimalsX - decimalsY). Matches
        // positionBinData.pricePerToken from the SDK, and lets us derive the
        // upper / active bin prices even when those bins aren't materialized
        // in positionBinData (active bin can sit outside the user's range).
        const decimalScale = Math.pow(10, decimalsX - decimalsY);
        const priceForBin = (id: number): number | undefined => {
          if (!Number.isFinite(binStep) || binStep <= 0) return undefined;
          const ratio = Math.pow(1 + binStep / 10_000, id);
          const p = ratio * decimalScale;
          return Number.isFinite(p) && p > 0 ? p : undefined;
        };
        const lowerBinPrice = bins[0]?.price ?? priceForBin(lowerBinId);
        const upperBinPrice = bins[bins.length - 1]?.price ?? priceForBin(upperBinId);
        const activeBinPrice = priceForBin(activeBinId);

        positions.push({
          positionAddress,
          owner,
          lowerBinId,
          upperBinId,
          inRange: activeBinId >= lowerBinId && activeBinId <= upperBinId,
          amountX,
          amountY,
          feeX: feeXUi,
          feeY: feeYUi,
          valueUsd,
          feesUsd,
          totalUsd: valueUsd + feesUsd,
          bins,
          lowerBinPrice,
          upperBinPrice,
          activeBinPrice,
        });
      }
    }

    if (positions.length === 0) continue;
    const totalUsd = positions.reduce((s, p) => s + p.totalUsd, 0);

    const pricePerY =
      priceX != null && priceY != null && priceY > 0 ? priceX / priceY : undefined;

    out.push({
      poolAddress,
      binStep,
      baseFactor,
      baseFeePct,
      activeBinId,
      pricePerY,
      tokenX: { mint: mintX, symbol: symbolX, decimals: decimalsX, logoUrl: logoX, priceUsd: priceX },
      tokenY: { mint: mintY, symbol: symbolY, decimals: decimalsY, logoUrl: logoY, priceUsd: priceY },
      positions,
      totalUsd,
      meta: poolMetaMap[poolAddress] ?? null,
    });
  }

  return out;
}

export async function GET(request: NextRequest) {
  const started = Date.now();
  try {
    const { searchParams } = new URL(request.url);
    const address = (searchParams.get("address") || "").trim();
    const debug = (searchParams.get("debug") || "").trim() === "1";

    if (!address) {
      return NextResponse.json({ success: false, error: "Address parameter is required" }, { status: 400 });
    }
    if (!isLikelySolanaAddress(address)) {
      return NextResponse.json({ success: false, error: "Invalid Solana wallet address" }, { status: 400 });
    }

    // Package may export default or `DLMM` named export depending on version/bundler.
    let DLMM: DlmmSdkStatic;
    try {
      const mod = (await import("@meteora-ag/dlmm")) as { default?: unknown; DLMM?: unknown };
      const Ctor = (mod.default ?? mod.DLMM) as { getAllLbPairPositionsByUser?: unknown } | undefined;
      if (!Ctor || typeof Ctor.getAllLbPairPositionsByUser !== "function") {
        throw new Error("DLMM export missing getAllLbPairPositionsByUser");
      }
      DLMM = Ctor as DlmmSdkStatic;
    } catch (e) {
      console.error("[Meteora] Failed to load @meteora-ag/dlmm:", e);
      return NextResponse.json(
        {
          success: false,
          error:
            "Meteora DLMM SDK is not installed or failed to load. Run `npm install --legacy-peer-deps` if peer resolution fails.",
          hint: "https://www.npmjs.com/package/@meteora-ag/dlmm",
        },
        { status: 503 }
      );
    }

    const connection = getServerSolanaConnection();
    const owner = new PublicKey(address);

    const positionsByPool = await DLMM.getAllLbPairPositionsByUser(connection, owner);

    const pools: Array<{ lbPair: string; positions: unknown[] }> = [];
    let positionCount = 0;

    const lbPairKeyToString = (k: unknown): string => {
      if (typeof k === "string") return k;
      if (k instanceof PublicKey) return k.toBase58();
      const t = k as { toBase58?: () => string; toString?: () => string };
      if (typeof t?.toBase58 === "function") return t.toBase58();
      if (typeof t?.toString === "function") return String(t.toString());
      return String(k);
    };

    positionsByPool.forEach((positionInfo, lbPairKey) => {
      const lbPair = lbPairKeyToString(lbPairKey);
      const rows: unknown[] = Array.isArray(positionInfo)
        ? positionInfo
        : positionInfo != null
          ? [positionInfo]
          : [];
      positionCount += rows.length;
      pools.push({
        lbPair,
        positions: sanitizeForJson(rows) as unknown[],
      });
    });

    const uniqueMints = new Set<string>();
    for (const pool of pools) {
      const first = (pool.positions ?? [])[0] as Record<string, unknown> | undefined;
      if (!first) continue;
      const lbPair = first.lbPair as Record<string, unknown> | undefined;
      const mx = pickString(lbPair, "tokenXMint");
      const my = pickString(lbPair, "tokenYMint");
      if (mx) uniqueMints.add(mx);
      if (my) uniqueMints.add(my);
    }
    const mintList = [...uniqueMints];
    const poolAddressList = pools.map((p) => p.lbPair);
    const [metadata, prices, poolMetaMap] = await Promise.all([
      mintList.length > 0
        ? JupiterTokenMetadataService.getInstance().getMetadataMap(mintList)
        : Promise.resolve({} as Record<string, { symbol?: string; name?: string; logoUrl?: string; decimals?: number }>),
      fetchJupiterPrices(mintList),
      poolAddressList.length > 0
        ? getMeteoraPoolMetaMap(poolAddressList)
        : Promise.resolve({} as Record<string, MeteoraPoolMeta | null>),
    ]);

    const enriched = buildEnrichedPools(pools, metadata, prices, poolMetaMap);
    const totalUsd = enriched.reduce((s, p) => s + p.totalUsd, 0);

    const payload: Record<string, unknown> = {
      success: true,
      address,
      data: pools,
      poolCount: pools.length,
      positionCount,
      enriched,
      totalUsd,
      note:
        "Raw on-chain DLMM positions per LB pair. `enriched` contains symbol/decimals/price-resolved positions. Pool metadata also at https://dlmm.datapi.meteora.ag/pools/{address}",
    };

    if (debug) {
      payload.meta = {
        ms: Date.now() - started,
        rpcHost: (() => {
          try {
            return new URL((connection as any).rpcEndpoint || "").host || "unknown";
          } catch {
            return "unknown";
          }
        })(),
      };
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[Meteora] userPositions error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        data: [],
        poolCount: 0,
        positionCount: 0,
      },
      { status: 500 }
    );
  }
}
