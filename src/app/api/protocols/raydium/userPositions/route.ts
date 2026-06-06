import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getServerSolanaConnection } from "@/app/api/jupiter/_lib";

export const dynamic = "force-dynamic";

const RAYDIUM_API_BASE = "https://api-v3.raydium.io";
const RAYDIUM_DYNAMIC_IPFS_BASE = "https://dynamic-ipfs.raydium.io";
const CLMM_PROGRAM_ID = new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
const LPS_CHUNK_SIZE = 40;

type WalletTokenBalance = {
  mint: string;
  amountRaw: string;
  amount: number;
  decimals: number;
  tokenAccount: string;
  programId: string;
};

type RaydiumFetchMeta = {
  ok: boolean;
  status: number;
  rows?: number;
  errorHint?: string;
};

type ClmmNftCandidate = WalletTokenBalance & {
  positionPda: string;
  tickLower?: number;
  tickUpper?: number;
};

function isLikelySolanaAddress(input: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input);
}

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getDeep(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    const rec = asRecord(cur);
    if (!rec) return undefined;
    cur = rec[part];
  }
  return cur;
}

function pickString(obj: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const v = getDeep(obj, path);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickNumber(obj: unknown, paths: string[]): number | undefined {
  for (const path of paths) {
    const v = getDeep(obj, path);
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const obj = asRecord(payload);
  if (!obj) return [];
  if (Array.isArray(obj.data)) return obj.data;
  const data = asRecord(obj.data);
  if (data) {
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.rows)) return data.rows;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.stakings)) return data.stakings;
  }
  if (Array.isArray(obj.rows)) return obj.rows;
  if (Array.isArray(obj.items)) return obj.items;
  if (Array.isArray(obj.stakings)) return obj.stakings;
  return [];
}

async function fetchJsonRows(
  url: string
): Promise<{ rows: unknown[]; meta: RaydiumFetchMeta; payload?: unknown }> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      return {
        rows: [],
        payload,
        meta: {
          ok: false,
          status: response.status,
          errorHint: text.slice(0, 240) || `http_${response.status}`,
        },
      };
    }

    const rows = extractRows(payload).filter((row) => row != null);
    return {
      rows,
      payload,
      meta: { ok: true, status: response.status, rows: rows.length },
    };
  } catch (error) {
    return {
      rows: [],
      meta: {
        ok: false,
        status: 0,
        errorHint: error instanceof Error ? error.message : "fetch_failed",
      },
    };
  }
}

async function getWalletTokenBalances(address: string): Promise<WalletTokenBalance[]> {
  const connection = getServerSolanaConnection();
  const owner = new PublicKey(address);
  const programs = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
  const all: WalletTokenBalance[] = [];

  for (const programId of programs) {
    const resp = await connection.getParsedTokenAccountsByOwner(owner, { programId });
    for (const item of resp.value) {
      const accountData = item.account.data as { parsed?: { info?: Record<string, unknown> } };
      const parsed = accountData.parsed;
      const info = parsed?.info;
      const mint = typeof info?.mint === "string" ? info.mint : "";
      const tokenAmount = asRecord(info?.tokenAmount);
      const amountRaw = typeof tokenAmount?.amount === "string" ? tokenAmount.amount : "0";
      const decimals = Number(tokenAmount?.decimals ?? 0);
      const amount = Number(tokenAmount?.uiAmountString ?? tokenAmount?.uiAmount ?? 0);
      if (!mint || !Number.isFinite(amount) || amount <= 0) continue;
      all.push({
        mint,
        amountRaw,
        amount,
        decimals: Number.isFinite(decimals) ? decimals : 0,
        tokenAccount: item.pubkey.toBase58(),
        programId: programId.toBase58(),
      });
    }
  }

  return all;
}

async function findClmmNftPositions(walletBalances: WalletTokenBalance[]): Promise<ClmmNftCandidate[]> {
  const nftCandidates = walletBalances.filter((balance) => balance.decimals === 0 && balance.amountRaw === "1");
  if (nftCandidates.length === 0) return [];

  const connection = getServerSolanaConnection();
  const pdaRows = nftCandidates.map((balance) => {
    const [positionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), new PublicKey(balance.mint).toBuffer()],
      CLMM_PROGRAM_ID
    );
    return { balance, positionPda };
  });

  const accountInfos = await connection.getMultipleAccountsInfo(pdaRows.map((row) => row.positionPda));
  const positions: ClmmNftCandidate[] = [];

  for (let i = 0; i < pdaRows.length; i += 1) {
    const accountInfo = accountInfos[i];
    if (!accountInfo || !accountInfo.owner.equals(CLMM_PROGRAM_ID)) continue;
    const tickRange = decodePersonalPositionTickRange(accountInfo.data);
    positions.push({
      ...pdaRows[i].balance,
      positionPda: pdaRows[i].positionPda.toBase58(),
      ...tickRange,
    });
  }

  return positions;
}

function decodePersonalPositionTickRange(data: Buffer): { tickLower?: number; tickUpper?: number } {
  // Raydium CLMM PersonalPositionState layout:
  // discriminator(8), bump(1), nftMint(32), poolId(32), tickLower(i32), tickUpper(i32).
  const tickLowerOffset = 8 + 1 + 32 + 32;
  const tickUpperOffset = tickLowerOffset + 4;
  if (data.length < tickUpperOffset + 4) return {};
  return {
    tickLower: data.readInt32LE(tickLowerOffset),
    tickUpper: data.readInt32LE(tickUpperOffset),
  };
}

function priceFromClmmTick(tick: number | undefined, decimalsA: number, decimalsB: number): number | undefined {
  if (!Number.isFinite(tick)) return undefined;
  const price = Math.pow(1.0001, Number(tick)) * Math.pow(10, decimalsA - decimalsB);
  return Number.isFinite(price) && price > 0 ? price : undefined;
}

function getPoolLpMint(pool: unknown): string | undefined {
  return pickString(pool, [
    "lpMint.address",
    "lpMint.mint",
    "lpMint.id",
    "lpMint",
    "lpMintAddress",
  ]);
}

function buildTokenInfo(pool: unknown, key: "mint1" | "mint2", sharePct: number) {
  const token = getDeep(pool, key);
  const mint = pickString(token, ["address", "mint", "id"]) || "";
  const symbol = pickString(token, ["symbol", "name"]) || mint.slice(0, 6);
  const decimals = pickNumber(token, ["decimals"]) ?? 0;
  const logoUrl = pickString(token, ["logoURI", "logoUrl", "icon"]);
  const priceUsd = pickNumber(token, ["price", "priceUsd", "usdPrice"]);
  const reserve = pickNumber(token, ["amount", "reserve", "vault.amount", "mintAmount"]);
  const amount = reserve != null && sharePct > 0 ? reserve * sharePct : undefined;
  const valueUsd = amount != null && priceUsd != null ? amount * priceUsd : undefined;

  return {
    mint,
    symbol,
    decimals,
    logoUrl,
    priceUsd,
    reserve,
    amount,
    valueUsd,
  };
}

function buildLpPosition(pool: unknown, balance: WalletTokenBalance) {
  const lpPrice = pickNumber(pool, ["lpPrice", "lp.price", "lpMint.price"]);
  const tvl = pickNumber(pool, ["tvl", "liquidity"]);
  const valueUsd = lpPrice != null ? balance.amount * lpPrice : undefined;
  const sharePct =
    valueUsd != null && tvl != null && tvl > 0
      ? valueUsd / tvl
      : undefined;
  const tokenA = buildTokenInfo(pool, "mint1", sharePct ?? 0);
  const tokenB = buildTokenInfo(pool, "mint2", sharePct ?? 0);
  const poolId = pickString(pool, ["id", "poolId", "address"]) || "";
  const poolType = pickString(pool, ["type", "poolType"]) || "unknown";
  const label = `${tokenA.symbol}/${tokenB.symbol}`;
  const apr24h = pickNumber(pool, ["day.apr", "day.apr24h", "apr24h"]);
  const fee24h = pickNumber(pool, ["day.feeApr", "day.fee24h", "fee24h"]);

  return {
    id: `raydium-lp-${balance.mint}`,
    protocol: "raydium",
    type: "lp-token",
    label,
    poolId,
    poolType,
    programId: pickString(pool, ["programId"]),
    lpMint: balance.mint,
    tokenAccount: balance.tokenAccount,
    lpAmount: balance.amount,
    lpAmountRaw: balance.amountRaw,
    lpDecimals: balance.decimals,
    lpPrice,
    valueUsd: valueUsd ?? 0,
    sharePct,
    tvl,
    apr24h,
    fee24h,
    tokens: [tokenA, tokenB],
    rawPool: pool,
  };
}

async function fetchClmmMetadata(positionPda: string): Promise<{ ok: boolean; status: number; payload?: unknown; errorHint?: string }> {
  const url = `${RAYDIUM_DYNAMIC_IPFS_BASE}/clmm/position?id=${encodeURIComponent(positionPda)}`;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        payload,
        errorHint: text.slice(0, 240) || `http_${response.status}`,
      };
    }

    return { ok: true, status: response.status, payload };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      errorHint: error instanceof Error ? error.message : "fetch_failed",
    };
  }
}

function buildClmmPosition(candidate: ClmmNftCandidate, metadata: unknown) {
  const poolInfo = getDeep(metadata, "poolInfo");
  const positionInfo = getDeep(metadata, "positionInfo");
  const mintA = getDeep(poolInfo, "mintA");
  const mintB = getDeep(poolInfo, "mintB");
  const symbolA = pickString(mintA, ["symbol", "name"]) || "";
  const symbolB = pickString(mintB, ["symbol", "name"]) || "";
  const unclaimedFee = getDeep(positionInfo, "unclaimedFee");
  const principalUsd = pickNumber(positionInfo, ["usdValue"]) ?? 0;
  const feesUsd = pickNumber(unclaimedFee, ["usdFeeValue"]) ?? 0;
  const rewardsUsd = pickNumber(unclaimedFee, ["usdRewardValue"]) ?? 0;
  const unclaimedUsd = pickNumber(unclaimedFee, ["usdValue"]) ?? feesUsd + rewardsUsd;
  const totalUsd = principalUsd + unclaimedUsd;
  const decimalsA = pickNumber(mintA, ["decimals"]) ?? 0;
  const decimalsB = pickNumber(mintB, ["decimals"]) ?? 0;
  const lowerPrice = priceFromClmmTick(candidate.tickLower, decimalsA, decimalsB);
  const upperPrice = priceFromClmmTick(candidate.tickUpper, decimalsA, decimalsB);

  return {
    id: `raydium-clmm-${candidate.positionPda}`,
    protocol: "raydium",
    type: "clmm-nft",
    label: symbolA && symbolB ? `${symbolA}/${symbolB}` : "Raydium CLMM",
    poolId: pickString(poolInfo, ["id"]) || "",
    poolType: pickString(poolInfo, ["type"]) || "Concentrated",
    programId: pickString(poolInfo, ["programId"]) || CLMM_PROGRAM_ID.toBase58(),
    nftMint: candidate.mint,
    tokenAccount: candidate.tokenAccount,
    positionPda: candidate.positionPda,
    tickLower: candidate.tickLower,
    tickUpper: candidate.tickUpper,
    lowerPrice,
    upperPrice,
    valueUsd: totalUsd,
    principalUsd,
    feesUsd,
    rewardsUsd,
    unclaimedUsd,
    amountA: pickNumber(positionInfo, ["amountA"]) ?? 0,
    amountB: pickNumber(positionInfo, ["amountB"]) ?? 0,
    tokenA: {
      mint: pickString(mintA, ["address"]) || "",
      symbol: symbolA,
      decimals: decimalsA,
      logoUrl: pickString(mintA, ["logoURI", "logoUrl", "icon"]),
    },
    tokenB: {
      mint: pickString(mintB, ["address"]) || "",
      symbol: symbolB,
      decimals: decimalsB,
      logoUrl: pickString(mintB, ["logoURI", "logoUrl", "icon"]),
    },
    poolPrice: pickNumber(poolInfo, ["price"]),
    tvl: pickNumber(poolInfo, ["tvl"]),
    apr24h: pickNumber(poolInfo, ["day.apr"]),
    feeApr24h: pickNumber(poolInfo, ["day.feeApr"]),
    image: pickString(metadata, ["image"]),
    rawMetadata: metadata,
  };
}

export async function GET(request: NextRequest) {
  const started = Date.now();
  try {
    const { searchParams } = new URL(request.url);
    const address = (searchParams.get("address") || "").trim();
    const debug = (searchParams.get("debug") || "").trim() === "1";

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

    const walletBalances = await getWalletTokenBalances(address);
    const balancesByMint = new Map(walletBalances.map((b) => [b.mint, b]));
    const walletMints = uniq(walletBalances.map((b) => b.mint));

    const lpFetches = await Promise.all(
      chunk(walletMints, LPS_CHUNK_SIZE).map((mints) => {
        const url = `${RAYDIUM_API_BASE}/pools/info/lps?lps=${encodeURIComponent(mints.join(","))}`;
        return fetchJsonRows(url);
      })
    );

    const lpPositions = lpFetches.flatMap(({ rows }) =>
      rows
        .map((pool) => {
          const lpMint = getPoolLpMint(pool);
          const balance = lpMint ? balancesByMint.get(lpMint) : undefined;
          return balance ? buildLpPosition(pool, balance) : null;
        })
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
    );

    const clmmNftCandidates = await findClmmNftPositions(walletBalances);
    const clmmMetadataFetches = await Promise.all(
      clmmNftCandidates.map((candidate) => fetchClmmMetadata(candidate.positionPda))
    );
    const clmmPositions = clmmMetadataFetches
      .map((result, idx) =>
        result.ok && result.payload
          ? buildClmmPosition(clmmNftCandidates[idx], result.payload)
          : null
      )
      .filter((p): p is NonNullable<typeof p> => Boolean(p));

    const positions = [...lpPositions, ...clmmPositions].sort(
      (a, b) => (Number(b.valueUsd) || 0) - (Number(a.valueUsd) || 0)
    );
    const totalUsd = positions.reduce((sum, p) => sum + (Number(p.valueUsd) || 0), 0);

    const payload: Record<string, unknown> = {
      success: true,
      address,
      data: positions,
      count: positions.length,
      totalUsd,
      lpPositionCount: lpPositions.length,
      clmmPositionCount: clmmPositions.length,
    };

    if (debug) {
      payload.meta = {
        ms: Date.now() - started,
        walletTokenAccounts: walletBalances.length,
        walletTokenMints: walletMints.length,
        walletTokenMintsSample: walletMints.slice(0, 20),
        raydiumLpFetches: lpFetches.map((r) => r.meta),
        raydiumMatchedPools: lpPositions.length,
        clmmNftCandidates: clmmNftCandidates.length,
        clmmMetadataFetches: clmmMetadataFetches.map((r) => ({
          ok: r.ok,
          status: r.status,
          errorHint: r.errorHint,
        })),
        sources: {
          lpTokens: `${RAYDIUM_API_BASE}/pools/info/lps`,
          clmmMetadata: `${RAYDIUM_DYNAMIC_IPFS_BASE}/clmm/position`,
        },
        limitations: {
          farmStakedLp:
            "Raydium API v3 Swagger does not expose a wallet farm-stake endpoint; staked LP needs a separate on-chain farm decode path.",
        },
      };
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[Raydium] userPositions error:", error);
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
