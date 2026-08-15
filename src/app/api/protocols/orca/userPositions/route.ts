import { NextRequest, NextResponse } from "next/server";
import { address as toAddress } from "@solana/addresses";
import { createSolanaRpc } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  decreaseLiquidityQuote,
  positionStatus,
  sqrtPriceToPrice,
  tickIndexToPrice,
} from "@orca-so/whirlpools-core";
import { getServerSolanaConnection } from "@/app/api/jupiter/_lib";
import { getSolanaRpcUrl } from "@/app/api/jupiter/_lib";
import { JupiterTokenMetadataService } from "@/lib/services/solana/tokenMetadata";
import { lookupWellKnownToken } from "@/lib/solana/wellKnownTokens";
import { fetchOrcaPoolAprMap } from "@/app/api/protocols/orca/_lib/fetchPoolApr";

export const dynamic = "force-dynamic";

const WHIRLPOOL_PROGRAM_ID = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const TOKEN_PROGRAMS = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
const ZERO_PUBKEY = "11111111111111111111111111111111";

type WalletNft = {
  mint: string;
  tokenAccount: string;
  programId: string;
};

type DecodedPosition = {
  address: string;
  positionMint: string;
  whirlpool: string;
  liquidity: bigint;
  tickLowerIndex: number;
  tickUpperIndex: number;
  feeOwedA: bigint;
  feeOwedB: bigint;
  rewardOwed: bigint[];
};

type DecodedWhirlpool = {
  address: string;
  tickSpacing: number;
  feeRate: number;
  liquidity: bigint;
  sqrtPrice: bigint;
  tickCurrentIndex: number;
  tokenMintA: string;
  tokenMintB: string;
  rewardMints: string[];
};

type TokenInfo = {
  mint: string;
  symbol: string;
  decimals: number;
  logoUrl?: string;
  priceUsd?: number;
  amount?: number;
  valueUsd?: number;
};

type LiveHarvestQuote = {
  feeOwedA: bigint;
  feeOwedB: bigint;
  rewardsOwed: bigint[];
};

function isLikelySolanaAddress(input: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input);
}

function readU128LE(buf: Buffer, offset: number): bigint {
  let out = 0n;
  for (let i = 15; i >= 0; i -= 1) {
    out = (out << 8n) + BigInt(buf[offset + i] ?? 0);
  }
  return out;
}

function readPubkey(buf: Buffer, offset: number): string {
  return new PublicKey(buf.subarray(offset, offset + 32)).toBase58();
}

function rawToUi(raw: bigint, decimals: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n / Math.pow(10, Math.max(0, decimals));
}

function finite(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function shortMint(mint: string): string {
  return mint ? `${mint.slice(0, 4)}...${mint.slice(-4)}` : "Token";
}

async function getWalletPositionNfts(ownerAddress: string): Promise<WalletNft[]> {
  const connection = getServerSolanaConnection();
  const owner = new PublicKey(ownerAddress);
  const out: WalletNft[] = [];

  for (const programId of TOKEN_PROGRAMS) {
    const accounts = await connection.getParsedTokenAccountsByOwner(owner, { programId }, "confirmed");
    for (const item of accounts.value) {
      const parsed = (item.account.data as { parsed?: { info?: Record<string, unknown> } })?.parsed?.info;
      const tokenAmount = parsed?.tokenAmount as Record<string, unknown> | undefined;
      const mint = typeof parsed?.mint === "string" ? parsed.mint : "";
      const amountRaw = typeof tokenAmount?.amount === "string" ? tokenAmount.amount : "0";
      const decimals = Number(tokenAmount?.decimals ?? 0);
      if (!mint || amountRaw !== "1" || decimals !== 0) continue;
      out.push({
        mint,
        tokenAccount: item.pubkey.toBase58(),
        programId: programId.toBase58(),
      });
    }
  }

  return out;
}

function decodePosition(data: Buffer, address: string): DecodedPosition | null {
  if (data.length < 216) return null;
  return {
    address,
    whirlpool: readPubkey(data, 8),
    positionMint: readPubkey(data, 40),
    liquidity: readU128LE(data, 72),
    tickLowerIndex: data.readInt32LE(88),
    tickUpperIndex: data.readInt32LE(92),
    feeOwedA: data.readBigUInt64LE(112),
    feeOwedB: data.readBigUInt64LE(136),
    rewardOwed: [
      data.readBigUInt64LE(144 + 16),
      data.readBigUInt64LE(168 + 16),
      data.readBigUInt64LE(192 + 16),
    ],
  };
}

function decodeWhirlpool(data: Buffer, address: string): DecodedWhirlpool | null {
  if (data.length < 653) return null;
  return {
    address,
    tickSpacing: data.readUInt16LE(41),
    feeRate: data.readUInt16LE(45),
    liquidity: readU128LE(data, 49),
    sqrtPrice: readU128LE(data, 65),
    tickCurrentIndex: data.readInt32LE(81),
    tokenMintA: readPubkey(data, 101),
    tokenMintB: readPubkey(data, 181),
    rewardMints: [readPubkey(data, 269), readPubkey(data, 397), readPubkey(data, 525)].filter(
      (mint) => mint !== ZERO_PUBKEY
    ),
  };
}

async function findOrcaPositions(nfts: WalletNft[]): Promise<Array<WalletNft & DecodedPosition>> {
  if (nfts.length === 0) return [];
  const connection = getServerSolanaConnection();
  const pdaRows = nfts.map((nft) => {
    const [positionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), new PublicKey(nft.mint).toBuffer()],
      WHIRLPOOL_PROGRAM_ID
    );
    return { nft, positionPda };
  });
  const accountInfos = await connection.getMultipleAccountsInfo(pdaRows.map((row) => row.positionPda), "confirmed");

  const positions: Array<WalletNft & DecodedPosition> = [];
  for (let i = 0; i < pdaRows.length; i += 1) {
    const accountInfo = accountInfos[i];
    if (!accountInfo || !accountInfo.owner.equals(WHIRLPOOL_PROGRAM_ID)) continue;
    const decoded = decodePosition(accountInfo.data, pdaRows[i].positionPda.toBase58());
    if (!decoded) continue;
    positions.push({ ...pdaRows[i].nft, ...decoded });
  }
  return positions;
}

async function fetchWhirlpools(addresses: string[]): Promise<Map<string, DecodedWhirlpool>> {
  const connection = getServerSolanaConnection();
  const unique = Array.from(new Set(addresses)).filter(Boolean);
  const out = new Map<string, DecodedWhirlpool>();
  if (unique.length === 0) return out;

  const accountInfos = await connection.getMultipleAccountsInfo(unique.map((addr) => new PublicKey(addr)), "confirmed");
  accountInfos.forEach((accountInfo, idx) => {
    if (!accountInfo || !accountInfo.owner.equals(WHIRLPOOL_PROGRAM_ID)) return;
    const decoded = decodeWhirlpool(accountInfo.data, unique[idx]);
    if (decoded) out.set(unique[idx], decoded);
  });

  return out;
}

async function fetchMintDecimals(mints: string[]): Promise<Record<string, number>> {
  const connection = getServerSolanaConnection();
  const unique = Array.from(new Set(mints)).filter(Boolean);
  const out: Record<string, number> = {};
  if (unique.length === 0) return out;

  const infos = await connection.getMultipleAccountsInfo(unique.map((mint) => new PublicKey(mint)), "confirmed");
  infos.forEach((info, idx) => {
    if (!info?.data || info.data.length <= 44) return;
    out[unique[idx]] = info.data[44];
  });
  return out;
}

async function fetchJupiterPrices(mints: string[]): Promise<Record<string, number>> {
  const unique = Array.from(new Set(mints)).filter(Boolean);
  if (unique.length === 0) return {};

  const url = new URL("https://api.jup.ag/price/v3");
  url.searchParams.set("ids", unique.join(","));
  const headers: HeadersInit = { Accept: "application/json" };
  const apiKey = process.env.NEXT_PUBLIC_JUP_API_KEY || process.env.JUP_API_KEY;
  if (apiKey) headers["x-api-key"] = apiKey;

  try {
    const response = await fetch(url.toString(), { cache: "no-store", headers });
    if (!response.ok) return {};
    const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const data = json?.data && typeof json.data === "object"
      ? (json.data as Record<string, unknown>)
      : json ?? {};
    const out: Record<string, number> = {};
    for (const mint of unique) {
      const row = data[mint] as Record<string, unknown> | undefined;
      const price = finite(row?.usdPrice ?? row?.price, NaN);
      if (Number.isFinite(price) && price > 0) out[mint] = price;
    }
    return out;
  } catch {
    return {};
  }
}

async function buildTokenMap(mints: string[]): Promise<Record<string, TokenInfo>> {
  const unique = Array.from(new Set(mints)).filter(Boolean);
  const [metadata, decimals, prices] = await Promise.all([
    JupiterTokenMetadataService.getInstance().getMetadataMap(unique),
    fetchMintDecimals(unique),
    fetchJupiterPrices(unique),
  ]);

  const out: Record<string, TokenInfo> = {};
  for (const mint of unique) {
    const fallback = lookupWellKnownToken(mint);
    out[mint] = {
      mint,
      symbol: metadata[mint]?.symbol || fallback?.symbol || shortMint(mint),
      decimals: metadata[mint]?.decimals ?? fallback?.decimals ?? decimals[mint] ?? 0,
      logoUrl: metadata[mint]?.logoUrl || fallback?.logoUrl,
      priceUsd: prices[mint],
    };
  }
  return out;
}

function createAddressOnlySigner(ownerBase58: string) {
  const signerAddress = toAddress(ownerBase58.trim());
  return {
    address: signerAddress,
    signTransactions: async () => {
      throw new Error("Server cannot sign transactions");
    },
  };
}

async function fetchLiveHarvestQuotes(
  ownerAddress: string,
  positions: Array<WalletNft & DecodedPosition>
): Promise<Map<string, LiveHarvestQuote>> {
  const out = new Map<string, LiveHarvestQuote>();
  if (positions.length === 0) return out;

  let sdk: typeof import("@orca-so/whirlpools");
  try {
    sdk = await import("@orca-so/whirlpools");
  } catch (error) {
    console.warn("[Orca] live harvest quote SDK unavailable:", error);
    return out;
  }

  const rpc = createSolanaRpc(getSolanaRpcUrl() as Parameters<typeof createSolanaRpc>[0]);
  const authority = createAddressOnlySigner(ownerAddress);

  for (const position of positions) {
    try {
      const quote = await sdk.harvestPositionInstructions(rpc, toAddress(position.positionMint), authority);
      out.set(position.address, {
        feeOwedA: quote.feesQuote.feeOwedA,
        feeOwedB: quote.feesQuote.feeOwedB,
        rewardsOwed: quote.rewardsQuote.rewards.map((reward) => reward.rewardsOwed),
      });
    } catch (error) {
      console.warn("[Orca] live harvest quote failed:", {
        position: position.address,
        mint: position.positionMint,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return out;
}

function enrichPosition(
  position: WalletNft & DecodedPosition,
  whirlpool: DecodedWhirlpool,
  tokenMap: Record<string, TokenInfo>,
  liveHarvestQuote?: LiveHarvestQuote,
  poolApr?: { aprPct: number; apr24hPct: number }
) {
  const tokenA = tokenMap[whirlpool.tokenMintA] ?? {
    mint: whirlpool.tokenMintA,
    symbol: shortMint(whirlpool.tokenMintA),
    decimals: 0,
  };
  const tokenB = tokenMap[whirlpool.tokenMintB] ?? {
    mint: whirlpool.tokenMintB,
    symbol: shortMint(whirlpool.tokenMintB),
    decimals: 0,
  };

  let amountARaw = 0n;
  let amountBRaw = 0n;
  try {
    if (position.liquidity > 0n) {
      const quote = decreaseLiquidityQuote(
        position.liquidity,
        0,
        whirlpool.sqrtPrice,
        position.tickLowerIndex,
        position.tickUpperIndex
      );
      amountARaw = quote.tokenEstA;
      amountBRaw = quote.tokenEstB;
    }
  } catch {
    amountARaw = 0n;
    amountBRaw = 0n;
  }

  const amountA = rawToUi(amountARaw, tokenA.decimals);
  const amountB = rawToUi(amountBRaw, tokenB.decimals);
  const feeOwedA = liveHarvestQuote?.feeOwedA ?? position.feeOwedA;
  const feeOwedB = liveHarvestQuote?.feeOwedB ?? position.feeOwedB;
  const rewardOwed = liveHarvestQuote?.rewardsOwed ?? position.rewardOwed;
  const feeA = rawToUi(feeOwedA, tokenA.decimals);
  const feeB = rawToUi(feeOwedB, tokenB.decimals);
  const amountAUsd = amountA * finite(tokenA.priceUsd);
  const amountBUsd = amountB * finite(tokenB.priceUsd);
  const feesUsd = feeA * finite(tokenA.priceUsd) + feeB * finite(tokenB.priceUsd);
  const rewardTokens = whirlpool.rewardMints.map((mint, idx) => {
    const token = tokenMap[mint] ?? { mint, symbol: shortMint(mint), decimals: 0 };
    const amount = rawToUi(rewardOwed[idx] ?? 0n, token.decimals);
    const valueUsd = amount * finite(token.priceUsd);
    return { ...token, amount, valueUsd };
  });
  const rewardsUsd = rewardTokens.reduce((sum, reward) => sum + finite(reward.valueUsd), 0);
  const principalUsd = amountAUsd + amountBUsd;
  const currentPrice = sqrtPriceToPrice(whirlpool.sqrtPrice, tokenA.decimals, tokenB.decimals);
  const lowerPrice = tickIndexToPrice(position.tickLowerIndex, tokenA.decimals, tokenB.decimals);
  const upperPrice = tickIndexToPrice(position.tickUpperIndex, tokenA.decimals, tokenB.decimals);
  const status = positionStatus(whirlpool.sqrtPrice, position.tickLowerIndex, position.tickUpperIndex);

  return {
    id: `orca-whirlpool-${position.address}`,
    protocol: "orca",
    type: "whirlpool-nft",
    label: `${tokenA.symbol}/${tokenB.symbol}`,
    poolId: whirlpool.address,
    poolType: "Whirlpool",
    programId: WHIRLPOOL_PROGRAM_ID.toBase58(),
    nftMint: position.mint,
    tokenAccount: position.tokenAccount,
    positionPda: position.address,
    tickLower: position.tickLowerIndex,
    tickUpper: position.tickUpperIndex,
    tickCurrent: whirlpool.tickCurrentIndex,
    tickSpacing: whirlpool.tickSpacing,
    lowerPrice,
    upperPrice,
    poolPrice: currentPrice,
    inRange: status === "priceInRange",
    rangeStatus: status,
    liquidity: position.liquidity.toString(),
    poolLiquidity: whirlpool.liquidity.toString(),
    feeRate: whirlpool.feeRate / 1_000_000,
    aprPct: poolApr && poolApr.aprPct > 0 ? poolApr.aprPct : undefined,
    apr24hPct: poolApr && poolApr.apr24hPct > 0 ? poolApr.apr24hPct : undefined,
    valueUsd: principalUsd + feesUsd + rewardsUsd,
    principalUsd,
    feesUsd,
    rewardsUsd,
    unclaimedUsd: feesUsd + rewardsUsd,
    amountA,
    amountB,
    feeA,
    feeB,
    tokenA: { ...tokenA, amount: amountA, valueUsd: amountAUsd },
    tokenB: { ...tokenB, amount: amountB, valueUsd: amountBUsd },
    rewardMints: whirlpool.rewardMints,
    rewardOwedRaw: rewardOwed.map((value) => value.toString()),
    rewardTokens,
    actions: {
      harvestSupportedBySdk: true,
      closeSupportedBySdk: true,
      uiEnabled: true,
    },
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

    const nfts = await getWalletPositionNfts(address);
    const decodedPositions = await findOrcaPositions(nfts);
    const whirlpools = await fetchWhirlpools(decodedPositions.map((position) => position.whirlpool));
    const mints = decodedPositions.flatMap((position) => {
      const whirlpool = whirlpools.get(position.whirlpool);
      return whirlpool ? [whirlpool.tokenMintA, whirlpool.tokenMintB, ...whirlpool.rewardMints] : [];
    });
    const [tokenMap, liveHarvestQuotes, poolAprMap] = await Promise.all([
      buildTokenMap(mints),
      fetchLiveHarvestQuotes(address, decodedPositions),
      fetchOrcaPoolAprMap(decodedPositions.map((position) => position.whirlpool)),
    ]);
    const positions = decodedPositions
      .map((position) => {
        const whirlpool = whirlpools.get(position.whirlpool);
        return whirlpool
          ? enrichPosition(
              position,
              whirlpool,
              tokenMap,
              liveHarvestQuotes.get(position.address),
              poolAprMap.get(whirlpool.address)
            )
          : null;
      })
      .filter((position): position is NonNullable<typeof position> => Boolean(position))
      .sort((a, b) => finite(b.valueUsd) - finite(a.valueUsd));
    const totalUsd = positions.reduce((sum, position) => sum + finite(position.valueUsd), 0);

    const payload: Record<string, unknown> = {
      success: true,
      address,
      data: positions,
      count: positions.length,
      totalUsd,
    };

    if (debug) {
      payload.meta = {
        ms: Date.now() - started,
        scannedNfts: nfts.length,
        orcaPositions: decodedPositions.length,
        sources: {
          onChain: WHIRLPOOL_PROGRAM_ID.toBase58(),
          prices: "https://api.jup.ag/price/v3",
          tokenMetadata: "https://api.jup.ag/tokens/v2/search",
          poolApr: "https://api.orca.so/v2/solana/pools/{address}",
        },
        limitations: {
          fees:
            "Stored fee counters are shown. Building claim transactions should run updateFeesAndRewards before harvest.",
          bundles: "Position bundle NFTs are not decoded in this MVP.",
        },
      };
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[Orca] userPositions error:", error);
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
