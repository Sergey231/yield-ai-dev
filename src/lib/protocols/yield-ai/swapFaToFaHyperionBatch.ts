import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { submitExecutorEntryFunction } from "@/lib/protocols/decibel/executorSubmit";
import { getFaBalance } from "@/lib/protocols/yield-ai/engine/stateComputer";
import {
  YIELD_AI_VAULT_ENTRYPOINTS,
  YIELD_AI_VAULT_VIEWS,
  YIELD_AI_VAULT_FA_SWAP_CONFIG_TYPE,
  HYPERION_ROUTER_V3_VIEWS,
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

/** Aptos SDK function id shape: `0xaddr::module::function`. */
type FunctionId = `${string}::${string}::${string}`;

function toBigIntSafe(v: unknown): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    return BigInt(String(v));
  } catch {
    return 0n;
  }
}

/**
 * Off-chain quote for a fixed multi-pool Hyperion route via the on-chain view
 * `router_v3::get_batch_amount_out(lp_path, amount_in, from_token, to_token): u64`.
 *
 * Called immediately before the swap so `amount_out_min` reflects current pool state.
 * Returns the expected USDC output (base units) or `null` if the view is unavailable.
 */
export async function getHyperionBatchAmountOut(params: {
  lpPath: readonly string[];
  amountIn: bigint;
  fromMetadata: string;
  toMetadata: string;
}): Promise<bigint | null> {
  const { lpPath, amountIn, fromMetadata, toMetadata } = params;
  try {
    const res = await aptos.view({
      payload: {
        function: HYPERION_ROUTER_V3_VIEWS.getBatchAmountOut as FunctionId,
        typeArguments: [],
        functionArguments: [
          lpPath.map((p) => toCanonicalAddress(p)),
          amountIn.toString(),
          toCanonicalAddress(fromMetadata),
          toCanonicalAddress(toMetadata),
        ],
      },
    });
    const raw = Array.isArray(res) ? res[0] : (res as unknown);
    const out = toBigIntSafe(raw);
    return out > 0n ? out : null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Hyperion batch] get_batch_amount_out failed:", msg);
    return null;
  }
}

export type FaSwapLimits = {
  maxPerTxUsdc: bigint;
  maxDailyUsdc: bigint;
  day: bigint;
  spentTodayUsdc: bigint;
};

/**
 * Read the per-safe `VaultFaSwapConfig` (FA swap limits). Returns `null` when the resource is
 * absent. There is no dedicated getter view, so we read the resource group member directly.
 */
async function getFaSwapLimits(safe: string): Promise<FaSwapLimits | null> {
  try {
    const r = await aptos.getAccountResource<{
      max_per_tx_usdc: string | number;
      max_daily_usdc: string | number;
      day: string | number;
      spent_today_usdc: string | number;
    }>({
      accountAddress: toCanonicalAddress(safe),
      resourceType: YIELD_AI_VAULT_FA_SWAP_CONFIG_TYPE,
    });
    return {
      maxPerTxUsdc: toBigIntSafe(r.max_per_tx_usdc),
      maxDailyUsdc: toBigIntSafe(r.max_daily_usdc),
      day: toBigIntSafe(r.day),
      spentTodayUsdc: toBigIntSafe(r.spent_today_usdc),
    };
  } catch {
    return null;
  }
}

/**
 * Pre-flight a safe for the batch swap: the FA swap config must exist and carry non-zero limits.
 * The batch route itself is global (allowlisted on-chain), so no per-safe route enablement is
 * checked in the MVP. Returns `{ ok: true, limits }` or `{ ok: false, reason }`.
 */
export async function preflightFaSwapConfig(
  safe: string
): Promise<
  | { ok: true; limits: FaSwapLimits }
  | { ok: false; reason: string }
> {
  let exists = false;
  try {
    const res = await aptos.view({
      payload: {
        function: YIELD_AI_VAULT_VIEWS.faSwapConfigExists as FunctionId,
        typeArguments: [],
        functionArguments: [toCanonicalAddress(safe)],
      },
    });
    exists = Array.isArray(res) ? Boolean(res[0]) : Boolean(res);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `fa_swap_config_exists view failed: ${msg}` };
  }

  if (!exists) return { ok: false, reason: "fa-swap-config-missing" };

  const limits = await getFaSwapLimits(safe);
  if (!limits) return { ok: false, reason: "fa-swap-config-unreadable" };
  if (limits.maxPerTxUsdc <= 0n || limits.maxDailyUsdc <= 0n) {
    return { ok: false, reason: "fa-swap-limits-zero" };
  }

  return { ok: true, limits };
}

export type HyperionBatchSwapResult = {
  txHash: string | null;
  /** Quoted USDC output (base units) from `get_batch_amount_out`, or null if unavailable. */
  quote: bigint | null;
  /** `amount_out_min` passed to the swap (base units). */
  amountOutMin: bigint;
  /** Realized USDC delta on the safe (after - before); null on dry-run or when not measured. */
  realizedUsdcDelta: bigint | null;
  skipped: boolean;
  skippedReason?: string;
  dryRun: boolean;
};

/**
 * Submit `vault::execute_swap_fa_to_fa_hyperion_batch` for a safe through a fixed, allowlisted
 * two-pool Hyperion route (e.g. thAPT -> APT -> USDC).
 *
 * Flow:
 *  1. Pre-flight the safe's `VaultFaSwapConfig` (exists + non-zero limits).
 *  2. Quote via `router_v3::get_batch_amount_out` and derive `amount_out_min` from `slippageBps`.
 *  3. Read the safe's USDC balance, submit, re-read, and log the realized delta vs quote.
 *
 * Output always lands in the safe; the contract charges swap limits by the actual USDC delta.
 */
export async function submitSwapFaToFaHyperionBatch(params: {
  network: "mainnet" | "testnet";
  safe: string;
  lpPath: readonly string[];
  amountIn: bigint;
  fromMetadata: string;
  toMetadata: string;
  slippageBps: number;
  dryRun: boolean;
  maxGasAmount?: number;
}): Promise<HyperionBatchSwapResult> {
  const {
    network,
    safe,
    lpPath,
    amountIn,
    fromMetadata,
    toMetadata,
    slippageBps,
    dryRun,
    maxGasAmount = 100_000,
  } = params;

  if (lpPath.length !== 2) {
    return {
      txHash: null,
      quote: null,
      amountOutMin: 0n,
      realizedUsdcDelta: null,
      skipped: true,
      skippedReason: `lp-path-len=${lpPath.length} (expected 2)`,
      dryRun,
    };
  }

  // 1. Pre-flight: FA swap config + non-zero limits.
  const pre = await preflightFaSwapConfig(safe);
  if (!pre.ok) {
    console.warn("[Hyperion batch] pre-flight skip:", { safe, reason: pre.reason });
    return {
      txHash: null,
      quote: null,
      amountOutMin: 0n,
      realizedUsdcDelta: null,
      skipped: true,
      skippedReason: pre.reason,
      dryRun,
    };
  }

  // 2. Quote immediately before submit, derive amount_out_min from slippage.
  const quote = await getHyperionBatchAmountOut({
    lpPath,
    amountIn,
    fromMetadata,
    toMetadata,
  });
  if (quote == null) {
    return {
      txHash: null,
      quote: null,
      amountOutMin: 0n,
      realizedUsdcDelta: null,
      skipped: true,
      skippedReason: "quote-unavailable",
      dryRun,
    };
  }
  const b = BigInt(Math.max(0, Math.min(10_000, Math.trunc(slippageBps))));
  const amountOutMin = (quote * (10_000n - b)) / 10_000n;

  console.log("[Hyperion batch] swap planned:", {
    safe,
    amountIn: amountIn.toString(),
    quote: quote.toString(),
    slippageBps,
    amountOutMin: amountOutMin.toString(),
    perTxLimitUsdc: pre.limits.maxPerTxUsdc.toString(),
    dailyLimitUsdc: pre.limits.maxDailyUsdc.toString(),
    spentTodayUsdc: pre.limits.spentTodayUsdc.toString(),
  });

  if (dryRun) {
    return {
      txHash: null,
      quote,
      amountOutMin,
      realizedUsdcDelta: null,
      skipped: false,
      dryRun: true,
    };
  }

  // 3. Measure realized USDC delta around the swap for monitoring.
  let usdcBefore: bigint | null = null;
  try {
    usdcBefore = await getFaBalance(aptos, safe, toMetadata);
  } catch {
    usdcBefore = null;
  }

  const txHash = await submitExecutorEntryFunction({
    network,
    fn: YIELD_AI_VAULT_ENTRYPOINTS.executeSwapFaToFaHyperionBatch,
    functionArguments: [
      toCanonicalAddress(safe),
      lpPath.map((p) => toCanonicalAddress(p)),
      amountIn,
      amountOutMin,
      toCanonicalAddress(fromMetadata),
      toCanonicalAddress(toMetadata),
    ],
    maxGasAmount,
  });

  let realizedUsdcDelta: bigint | null = null;
  if (usdcBefore != null) {
    try {
      const usdcAfter = await getFaBalance(aptos, safe, toMetadata);
      realizedUsdcDelta = usdcAfter - usdcBefore;
    } catch {
      realizedUsdcDelta = null;
    }
  }

  const slipVsQuoteBps =
    realizedUsdcDelta != null && quote > 0n
      ? Number(((quote - realizedUsdcDelta) * 10_000n) / quote)
      : null;

  console.log("[Hyperion batch] swap executed:", {
    safe,
    txHash,
    amountIn: amountIn.toString(),
    quote: quote.toString(),
    amountOutMin: amountOutMin.toString(),
    realizedUsdcDelta: realizedUsdcDelta?.toString() ?? "unknown",
    realizedVsQuoteBps: slipVsQuoteBps,
  });

  return {
    txHash,
    quote,
    amountOutMin,
    realizedUsdcDelta,
    skipped: false,
    dryRun: false,
  };
}
