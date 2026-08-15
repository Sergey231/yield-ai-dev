import {
  Aptos,
  AptosConfig,
  Network,
} from "@aptos-labs/ts-sdk";
import { submitExecutorEntryFunction } from "@/lib/protocols/decibel/executorSubmit";
import {
  THALA_SWAP_ADAPTER_ADDRESS,
  THALA_CLMM_PACKAGE,
  THALA_ELON_USDC_POOL,
  THALA_SELL_ELON_SQRT_LIMIT,
  YIELD_AI_PACKAGE_ADDRESS,
  ELON_FA_METADATA_MAINNET,
  USDC_FA_METADATA_MAINNET,
} from "@/lib/constants/yieldAiVault";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";

const APTOS_API_KEY = process.env.APTOS_API_KEY;

const config = new AptosConfig({
  network: Network.MAINNET,
  ...(APTOS_API_KEY && {
    clientConfig: {
      HEADERS: { Authorization: `Bearer ${APTOS_API_KEY}` },
    },
  }),
});

const aptos = new Aptos(config);

// preview_swap returns a tuple: (u64 amount_in, u64 amount_out, u64 protocol_fee, u64 _).
// The Aptos SDK surfaces a Move tuple return as a MoveValue[] array.
type PreviewSwapResponse = [string, string, string, string];

/**
 * Fetch a preview_swap quote from Thala pool.
 * Returns amount_out (the second return value).
 */
async function getThalaPreviewSwap(params: {
  poolObj: string;
  fromMetadata: string;
  amountIn: bigint;
  sqrtPriceLimit: bigint;
}): Promise<bigint | null> {
  const { poolObj, fromMetadata, amountIn, sqrtPriceLimit } = params;

  try {
    const result = (await aptos.view({
      payload: {
        function: `${THALA_CLMM_PACKAGE}::pool::preview_swap`,
        typeArguments: [],
        functionArguments: [
          toCanonicalAddress(poolObj),
          toCanonicalAddress(fromMetadata),
          amountIn.toString(),
          sqrtPriceLimit.toString(),
          true, // exact_in
          null, // Option<address> = none
        ],
      },
    })) as unknown as PreviewSwapResponse;

    // amount_out is the second value in the returned tuple
    const amountOut = result?.[1];
    if (typeof amountOut === "string" && /^\d+$/.test(amountOut)) {
      return BigInt(amountOut);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Thala] preview_swap failed:", msg);
  }

  return null;
}

/**
 * Reference notional for the spot quote. Must be large enough that preview_swap does
 * NOT round the output down to zero (a 1-base-unit ELON quote returns 0 USDC, which would
 * make every amount look like 100% impact and shrink chunks to 1 unit). 0.01 ELON (1e6
 * base ≈ $0.009 at spot) is tiny relative to pool depth yet always returns a non-zero quote.
 */
const SPOT_REF_AMOUNT_BASE = BigInt(1_000_000);

/**
 * Estimate price impact (in bps) for a given swap amount.
 * impact_bps = 10000 * (1 - amount_out / amount_out_at_spot)
 *
 * Spot is approximated from a small reference quote (SPOT_REF_AMOUNT_BASE). For amounts at
 * or below the reference, impact is ~0 by construction.
 */
async function estimatePriceImpactBps(params: {
  poolObj: string;
  fromMetadata: string;
  toMetadata: string;
  amountIn: bigint;
  sqrtPriceLimit: bigint;
}): Promise<number> {
  const { poolObj, fromMetadata, amountIn, sqrtPriceLimit } = params;

  // Get the quoted output for this amount
  const amountOut = await getThalaPreviewSwap({
    poolObj,
    fromMetadata,
    amountIn,
    sqrtPriceLimit,
  });

  if (!amountOut || amountOut <= 0n) return 10_000; // worst case: 100% impact

  // Spot reference: a fixed small notional that won't round to zero. For swaps at or below
  // the reference, use the swap itself as its own spot → impact 0.
  const refIn = amountIn < SPOT_REF_AMOUNT_BASE ? amountIn : SPOT_REF_AMOUNT_BASE;
  const refOut = await getThalaPreviewSwap({
    poolObj,
    fromMetadata,
    amountIn: refIn,
    sqrtPriceLimit,
  });

  if (!refOut || refOut <= 0n) return 10_000;

  // Expected output at spot: amountIn * (refOut / refIn)
  const expectedAtSpot = (amountIn * refOut) / refIn;
  if (expectedAtSpot <= 0n) return 0;

  // Impact: 1 - (actual / expected). Negative (fee/rounding noise on small refs) → clamp to 0.
  const impact = (10_000n * (expectedAtSpot - amountOut)) / expectedAtSpot;

  return Math.max(0, Math.min(10_000, Number(impact)));
}

/**
 * Binary search to find the max chunk size such that price impact <= maxImpactBps.
 */
async function findMaxChunkSize(params: {
  poolObj: string;
  fromMetadata: string;
  toMetadata: string;
  totalAmount: bigint;
  maxImpactBps: number;
  sqrtPriceLimit: bigint;
}): Promise<bigint> {
  const {
    poolObj,
    fromMetadata,
    toMetadata,
    totalAmount,
    maxImpactBps,
    sqrtPriceLimit,
  } = params;

  // Common case: the whole amount is already under the impact cap → swap it in one chunk.
  // Without this short-circuit, binary search can't pin the exact top within 20 iterations
  // and leaves a tiny dust remainder, forcing a pointless extra (possibly sub-minimum) tx.
  const fullImpact = await estimatePriceImpactBps({
    poolObj,
    fromMetadata,
    toMetadata,
    amountIn: totalAmount,
    sqrtPriceLimit,
  });
  if (fullImpact <= maxImpactBps) return totalAmount;

  let low = BigInt(1);
  let high = totalAmount;
  let bestChunk = low;

  // Binary search with max 20 iterations
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / BigInt(2);
    if (mid === bestChunk) break; // converged

    const impact = await estimatePriceImpactBps({
      poolObj,
      fromMetadata,
      toMetadata,
      amountIn: mid,
      sqrtPriceLimit,
    });

    if (impact <= maxImpactBps) {
      bestChunk = mid;
      low = mid + BigInt(1);
    } else {
      high = mid - BigInt(1);
    }
  }

  return bestChunk > BigInt(0) ? bestChunk : BigInt(1);
}

/**
 * Plan chunks for a swap, respecting maxImpactBps.
 * Returns array of (chunkAmount, expectedAmountOut, amountOutMin) tuples.
 */
async function planChunks(params: {
  poolObj: string;
  fromMetadata: string;
  toMetadata: string;
  totalAmount: bigint;
  maxImpactBps: number;
  slippageBps: number;
  sqrtPriceLimit: bigint;
}): Promise<
  Array<{
    chunkAmount: bigint;
    expectedAmountOut: bigint;
    amountOutMin: bigint;
  }>
> {
  const {
    poolObj,
    fromMetadata,
    toMetadata,
    totalAmount,
    maxImpactBps,
    slippageBps,
    sqrtPriceLimit,
  } = params;

  const chunks: Array<{
    chunkAmount: bigint;
    expectedAmountOut: bigint;
    amountOutMin: bigint;
  }> = [];

  let remaining = totalAmount;

  while (remaining > BigInt(0)) {
    const chunkSize = await findMaxChunkSize({
      poolObj,
      fromMetadata,
      toMetadata,
      totalAmount: remaining,
      maxImpactBps,
      sqrtPriceLimit,
    });

    if (chunkSize <= BigInt(0)) {
      // Impact cap prevents even a 1-unit chunk — abort
      console.warn(
        "[Thala] Unable to find a chunk under maxImpactBps; skipping remaining"
      );
      break;
    }

    const amountOut = await getThalaPreviewSwap({
      poolObj,
      fromMetadata,
      amountIn: chunkSize,
      sqrtPriceLimit,
    });

    if (!amountOut || amountOut <= 0n) {
      console.warn(
        "[Thala] preview_swap failed for chunk; stopping chunked execution"
      );
      break;
    }

    // Apply slippage
    const b = BigInt(Math.max(0, Math.min(10_000, Math.trunc(slippageBps))));
    const amountOutMin = (amountOut * (10_000n - b)) / 10_000n;

    chunks.push({
      chunkAmount: chunkSize,
      expectedAmountOut: amountOut,
      amountOutMin,
    });

    remaining -= chunkSize;
  }

  return chunks;
}

/**
 * Submit a vault::execute_swap_fa_to_fa_thala transaction with chunking support.
 * Dry-run: logs planned chunks but does not submit.
 * Live: re-quotes each chunk immediately before submit.
 */
export async function submitSwapFaToFaThala(params: {
  network: "mainnet" | "testnet";
  safe: string;
  amountIn: bigint;
  fromMetadata: string;
  toMetadata: string;
  maxImpactBps: number;
  slippageBps: number;
  dryRun: boolean;
  deadline: bigint;
  maxGasAmount?: number;
}): Promise<{ txHashes: string[]; totalChunks: number; dryRun: boolean }> {
  const {
    network,
    safe,
    amountIn,
    fromMetadata,
    toMetadata,
    maxImpactBps,
    slippageBps,
    dryRun,
    deadline,
    maxGasAmount = 80_000,
  } = params;

  // For now, only ELON→USDC via the dedicated pool is supported
  if (
    toCanonicalAddress(fromMetadata) !==
      toCanonicalAddress(ELON_FA_METADATA_MAINNET) ||
    toCanonicalAddress(toMetadata) !==
      toCanonicalAddress(USDC_FA_METADATA_MAINNET)
  ) {
    throw new Error(
      "Thala swap currently supports only ELON→USDC pair (dedicated pool)"
    );
  }

  const poolObj = THALA_ELON_USDC_POOL;
  const sqrtPriceLimit = THALA_SELL_ELON_SQRT_LIMIT;

  if (dryRun) {
    // Dry-run: plan chunks and log, but do not submit
    console.log("[Thala] Dry-run swap planning:", {
      amountIn: amountIn.toString(),
      maxImpactBps,
      slippageBps,
    });

    const chunks = await planChunks({
      poolObj,
      fromMetadata,
      toMetadata,
      totalAmount: amountIn,
      maxImpactBps,
      slippageBps,
      sqrtPriceLimit,
    });

    if (chunks.length === 0) {
      console.log("[Thala] No viable chunks under maxImpactBps; swap skipped");
      return { txHashes: [], totalChunks: 0, dryRun: true };
    }

    let totalOut = BigInt(0);
    chunks.forEach((chunk, i) => {
      console.log(`[Thala] Chunk ${i + 1}/${chunks.length}:`, {
        amount: chunk.chunkAmount.toString(),
        expectedOut: chunk.expectedAmountOut.toString(),
        amountOutMin: chunk.amountOutMin.toString(),
      });
      totalOut += chunk.expectedAmountOut;
    });

    console.log("[Thala] Dry-run totals:", {
      totalIn: amountIn.toString(),
      totalExpectedOut: totalOut.toString(),
      chunks: chunks.length,
    });

    return { txHashes: [], totalChunks: chunks.length, dryRun: true };
  }

  // Live: execute chunks sequentially, re-quoting each before submit
  const txHashes: string[] = [];
  let remaining = amountIn;
  let chunkIndex = 0;

  while (remaining > BigInt(0)) {
    const chunkSize = await findMaxChunkSize({
      poolObj,
      fromMetadata,
      toMetadata,
      totalAmount: remaining,
      maxImpactBps,
      sqrtPriceLimit,
    });

    if (chunkSize <= BigInt(0)) {
      console.warn(
        "[Thala] Unable to find chunk under maxImpactBps; halting chunked execution"
      );
      break;
    }

    // Re-quote immediately before submit
    const amountOut = await getThalaPreviewSwap({
      poolObj,
      fromMetadata,
      amountIn: chunkSize,
      sqrtPriceLimit,
    });

    if (!amountOut || amountOut <= 0n) {
      console.error("[Thala] Re-quote failed; skipping chunk");
      break;
    }

    // Apply slippage for protection
    const b = BigInt(Math.max(0, Math.min(10_000, Math.trunc(slippageBps))));
    const amountOutMin = (amountOut * (10_000n - b)) / 10_000n;

    chunkIndex++;
    console.log(`[Thala] Submitting chunk ${chunkIndex}:`, {
      amount: chunkSize.toString(),
      quotedOut: amountOut.toString(),
      minOut: amountOutMin.toString(),
    });

    try {
      const txHash = await submitExecutorEntryFunction({
        network,
        fn: `${YIELD_AI_PACKAGE_ADDRESS}::vault::execute_swap_fa_to_fa_thala`,
        functionArguments: [
          toCanonicalAddress(safe),
          toCanonicalAddress(THALA_SWAP_ADAPTER_ADDRESS),
          toCanonicalAddress(poolObj),
          chunkSize,
          amountOutMin,
          sqrtPriceLimit,
          toCanonicalAddress(fromMetadata),
          toCanonicalAddress(toMetadata),
          deadline,
        ],
        maxGasAmount,
      });

      txHashes.push(txHash);
      remaining -= chunkSize;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Thala] Chunk submission failed:", msg);
      throw e;
    }
  }

  return { txHashes, totalChunks: chunkIndex, dryRun: false };
}
