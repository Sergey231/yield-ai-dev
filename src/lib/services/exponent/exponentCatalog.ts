import { ExponentVaultsFetcher } from "@exponent-labs/exponent-sdk";
import type { Connection } from "@solana/web3.js";

const EXPONENT_MARKETS_URL = "https://api.exponent.finance/markets";

type TimedCache<T> = { atMs: number; value: T };
const MARKETS_CACHE_TTL_MS = 5 * 60_000;
const STRATEGY_VAULT_MAP_CACHE_TTL_MS = 60 * 60_000;

let marketsCache: TimedCache<ExponentMarketRow[]> | null = null;
let strategyVaultMintMapCache: TimedCache<Map<string, string>> | null = null;

export type ExponentMarketRow = {
  vaultAddress?: string;
  ptMint?: string;
  ytMint?: string;
  impliedApy?: number;
  ptPriceInAsset?: number;
  ytPriceInAsset?: number;
  maturityDateUnixTs?: number;
  platform?: string;
  platformName?: string;
  tokenName?: string;
  underlyingAsset?: { ticker?: string; mint?: string };
  quoteAsset?: { ticker?: string; mint?: string };
  decimals?: number;
};

export async function fetchMarketsCatalog(): Promise<ExponentMarketRow[]> {
  if (marketsCache && Date.now() - marketsCache.atMs <= MARKETS_CACHE_TTL_MS) {
    return marketsCache.value;
  }
  const res = await fetch(EXPONENT_MARKETS_URL, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Exponent markets API returned ${res.status}`);
  }
  const rows = (await res.json()) as ExponentMarketRow[];
  marketsCache = { atMs: Date.now(), value: rows };
  return rows;
}

export async function getStrategyVaultMintMap(connection: Connection): Promise<Map<string, string>> {
  if (
    strategyVaultMintMapCache &&
    Date.now() - strategyVaultMintMapCache.atMs <= STRATEGY_VAULT_MAP_CACHE_TTL_MS
  ) {
    return strategyVaultMintMapCache.value;
  }

  const vaults = await new ExponentVaultsFetcher(connection).fetchAllVaults();
  const map = new Map<string, string>();
  for (const row of vaults) {
    const mintLp =
      row.account?.mintLp?.toBase58?.() ??
      (typeof row.account?.mintLp === "string" ? row.account.mintLp : "");
    if (mintLp) map.set(mintLp, row.publicKey.toBase58());
  }
  strategyVaultMintMapCache = { atMs: Date.now(), value: map };
  return map;
}
