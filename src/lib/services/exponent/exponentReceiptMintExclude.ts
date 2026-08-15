import type { Connection } from "@solana/web3.js";
import {
  fetchMarketsCatalog,
  getStrategyVaultMintMap,
} from "@/lib/services/exponent/exponentCatalog";

/** Bootstrap mints so exclusion works before catalog / RPC vault map is ready. */
const BOOTSTRAP_EXCLUDE_MINTS = new Set<string>([
  // PT-ONyc (test wallet)
  "2W5zZccVq8AMdrg7P4b3NvBKJyzbdnytRy2CKEDHvhiJ",
  // lsONyc OnRe Growth strategy vault share
  "G64HTm5asciRE78KqN8GZodhkDmP4TFyN6drzmWAwr6n",
]);

const EXCLUDE_CACHE_TTL_MS = 5 * 60_000;
let excludeCache: { atMs: number; mints: Set<string> } | null = null;

/**
 * SPL mints that represent Exponent positions (PT/YT receipts, strategy vault shares).
 * Excluded from the Solana wallet token list to avoid double-counting with protocol cards.
 */
export async function getExponentReceiptMintExclude(
  connection?: Connection
): Promise<Set<string>> {
  if (excludeCache && Date.now() - excludeCache.atMs <= EXCLUDE_CACHE_TTL_MS) {
    return excludeCache.mints;
  }

  const mints = new Set(BOOTSTRAP_EXCLUDE_MINTS);

  try {
    const markets = await fetchMarketsCatalog();
    for (const market of markets) {
      if (market.ptMint) mints.add(market.ptMint);
      if (market.ytMint) mints.add(market.ytMint);
    }
  } catch (error) {
    console.warn("[Exponent] Failed to load markets catalog for wallet exclude:", error);
  }

  if (connection) {
    try {
      const vaultMap = await getStrategyVaultMintMap(connection);
      for (const shareMint of vaultMap.keys()) {
        mints.add(shareMint);
      }
    } catch (error) {
      console.warn("[Exponent] Failed to load strategy vault mint map for wallet exclude:", error);
    }
  }

  excludeCache = { atMs: Date.now(), mints };
  return mints;
}
