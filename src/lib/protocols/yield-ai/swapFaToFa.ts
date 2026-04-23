import { sdk as hyperionSdk } from "@/lib/hyperion";
import { submitExecutorEntryFunction } from "@/lib/protocols/decibel/executorSubmit";
import {
  SWAP_SQRT_PRICE_LIMIT,
  USDC_FA_METADATA_MAINNET,
  YIELD_AI_PACKAGE_ADDRESS,
} from "@/lib/constants/yieldAiVault";

/**
 * Hyperion / Uniswap V3 style pool uses `sqrt_price_limit` as a safety bound:
 *   - zero_for_one (token_in is token0): swap decreases price → limit MUST be strictly LESS
 *     than the current pool sqrtPrice, and greater than MIN_SQRT_PRICE.
 *   - one_for_zero (token_in is token1): swap increases price → limit MUST be strictly GREATER
 *     than the current pool sqrtPrice, and less than MAX_SQRT_PRICE.
 *
 * We retry with a few candidates to be resilient against off-by-one on the pool boundary.
 */

const MAX_U128 = (BigInt(1) << BigInt(128)) - BigInt(1);
// MAX side value used by the open path (USDC -> xBTC); kept here only as a last-resort fallback
// for MAX-side swaps. Do NOT use for zero_for_one (swaps to USDC) — it will abort.
const MAX_SIDE_SQRT_PRICE_LIMIT = BigInt("600000000000000000000");

export type SwapFaToFaDirection = "zeroForOne" | "oneForZero";

async function tryGetHyperionPoolSqrtPrice(params: {
  token1: string;
  token2: string;
  feeTier: number;
}): Promise<bigint | null> {
  const { token1, token2, feeTier } = params;
  try {
    const byPair = await hyperionSdk.Pool.getPoolByTokenPairAndFeeTier({
      token1,
      token2,
      feeTier,
    });
    const poolId =
      (byPair as any)?.poolId ??
      (byPair as any)?.id ??
      (byPair as any)?.pool?.poolId ??
      (byPair as any)?.pool?.id;
    const full = poolId
      ? await hyperionSdk.Pool.fetchPoolById({ poolId: String(poolId) })
      : null;
    const sqrt =
      (full as any)?.[0]?.pool?.sqrtPrice ??
      (full as any)?.pool?.sqrtPrice ??
      (full as any)?.sqrtPrice ??
      (byPair as any)?.sqrtPrice ??
      (byPair as any)?.sqrt_price ??
      (byPair as any)?.currentSqrtPrice;
    if (typeof sqrt === "string" && /^\d+$/.test(sqrt)) return BigInt(sqrt);
    if (typeof sqrt === "number" && Number.isFinite(sqrt) && sqrt >= 0) {
      return BigInt(Math.trunc(sqrt));
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Submit a vault::execute_swap_fa_to_fa transaction for a safe using the configured executor.
 * Retries on ESQRT_PRICE_LIMIT_UNAVAILABLE with direction-aware candidates.
 *
 * IMPORTANT: `poolSqrt ± 1` acts as a hard slippage stop (swap halts as soon as the pool's
 * `sqrtPrice` crosses that value). Using it as the FIRST candidate produces transactions
 * that succeed on-chain but swap almost nothing (near-zero price movement allowed) — the
 * caller is left with the input token unconsumed. Therefore we always probe with the
 * permissive, historically-working sentinel FIRST (MIN for zeroForOne, MAX for oneForZero),
 * and only fall back to pool-sqrt-based limits as a safety tail.
 *
 * Candidate order:
 *   - zeroForOne (… -> USDC): [SWAP_SQRT_PRICE_LIMIT (MIN+1), 1, poolSqrt-1, poolSqrt, 0]
 *   - oneForZero  (USDC -> …): [MAX_SIDE_SQRT_PRICE_LIMIT, MAX_U128, poolSqrt, poolSqrt+1]
 */
export async function submitSwapFaToFaWithFallbackLimits(params: {
  network: "mainnet" | "testnet";
  safe: string;
  feeTier: number;
  amountIn: bigint;
  amountOutMin?: bigint;
  fromMetadata: string;
  toMetadata: string;
  deadline: bigint;
  direction: SwapFaToFaDirection;
  maxGasAmount?: number;
}): Promise<{ swapTxHash: string; usedSqrtPriceLimit: bigint }> {
  const {
    network,
    safe,
    feeTier,
    amountIn,
    amountOutMin = BigInt(0),
    fromMetadata,
    toMetadata,
    deadline,
    direction,
    maxGasAmount = 80_000,
  } = params;

  const swapFn = `${YIELD_AI_PACKAGE_ADDRESS}::vault::execute_swap_fa_to_fa`;
  const poolSqrt =
    (await tryGetHyperionPoolSqrtPrice({
      token1: fromMetadata,
      token2: toMetadata,
      feeTier,
    })) ??
    (await tryGetHyperionPoolSqrtPrice({
      token1: toMetadata,
      token2: fromMetadata,
      feeTier,
    }));

  const tryLimits: bigint[] =
    direction === "zeroForOne"
      ? [
          // Permissive MIN-side limit — proven working for APT/xBTC -> USDC swaps.
          SWAP_SQRT_PRICE_LIMIT,
          BigInt(1),
          ...(poolSqrt != null && poolSqrt > BigInt(1) ? [poolSqrt - BigInt(1)] : []),
          ...(poolSqrt != null ? [poolSqrt] : []),
          BigInt(0),
        ]
      : [
          // Permissive MAX-side limit — proven working for USDC -> xBTC swaps.
          MAX_SIDE_SQRT_PRICE_LIMIT,
          MAX_U128,
          ...(poolSqrt != null ? [poolSqrt] : []),
          ...(poolSqrt != null ? [poolSqrt + BigInt(1)] : []),
        ];

  let lastErr: unknown = null;
  for (const limit of tryLimits) {
    try {
      const swapTxHash = await submitExecutorEntryFunction({
        network,
        fn: swapFn,
        functionArguments: [
          safe,
          feeTier,
          amountIn,
          amountOutMin,
          limit,
          fromMetadata,
          toMetadata,
          deadline,
        ],
        maxGasAmount,
      });
      return { swapTxHash, usedSqrtPriceLimit: limit };
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      // Retry only on known sqrt-limit aborts; surface anything else immediately.
      if (!msg.includes("ESQRT_PRICE_LIMIT_UNAVAILABLE")) throw e;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Swap failed (sqrt_price_limit retries exhausted)");
}

export { USDC_FA_METADATA_MAINNET };
