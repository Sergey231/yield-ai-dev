import { YIELD_AI_HYPERION_POOLS, type HyperionPoolKey } from "@/lib/constants/yieldAiVault";

export type HyperionStablePoolSnapshot = {
  poolKey: HyperionPoolKey;
  unixTime: number;
  tick: number;
  value: number;
};

export function isHyperionStablePoolKey(poolKey: string): poolKey is HyperionPoolKey {
  const key = poolKey as HyperionPoolKey;
  const p = (YIELD_AI_HYPERION_POOLS as Record<string, any>)[key];
  return Boolean(p?.ui?.isStable);
}

/**
 * Convert CLMM tick → price (tokenB per tokenA), adjusted for decimals.
 *
 * Hyperion pools define `tokenA`/`tokenB` in `YIELD_AI_HYPERION_POOLS` and stable pools
 * are listed as (stablecoin, USDC), so this yields ~1.0 for stable pairs.
 */
export function hyperionTickToPriceTokenBPerTokenA(params: {
  tick: number;
  decimalsA: number;
  decimalsB: number;
}): number {
  const { tick, decimalsA, decimalsB } = params;
  const p = Math.pow(1.0001, tick) * Math.pow(10, decimalsA - decimalsB);
  return Number.isFinite(p) ? p : NaN;
}

export function buildHyperionStableSnapshot(params: {
  poolKey: HyperionPoolKey;
  tick: number;
  unixTime: number;
}): HyperionStablePoolSnapshot {
  const pool = YIELD_AI_HYPERION_POOLS[params.poolKey];
  const value = hyperionTickToPriceTokenBPerTokenA({
    tick: params.tick,
    decimalsA: pool.decimalsA,
    decimalsB: pool.decimalsB,
  });
  return { poolKey: params.poolKey, unixTime: params.unixTime, tick: params.tick, value };
}
