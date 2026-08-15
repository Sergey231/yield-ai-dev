/**
 * High-level Hyperion CLMM LP actions (executor-signed).
 *
 * These wrap the low-level `vaultExecutor` entrypoints with the planning,
 * quoting and slippage logic shared by:
 *  - the secret-gated routes (`/api/protocols/yield-ai/hyperion-lp/{open,close}`)
 *    used by the admin "secret button" and the cron, and
 *  - the user-facing proxy routes (`.../hyperion-lp/manage/*`), which keep the
 *    executor authorization server-side (no secret in the browser).
 *
 * Keeping one implementation here means range/swap planning, the perf-cut
 * `claim → remove` ordering, and the delta-only convert all behave identically
 * regardless of who triggers them.
 */
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { normalizeAddress, toCanonicalAddress } from "@/lib/utils/addressNormalization";
import {
  APTOS_COIN_TYPE,
  SWAP_FEE_TIER,
  SWAP_SQRT_PRICE_LIMIT,
  USDC_FA_METADATA_MAINNET,
  YIELD_AI_HYPERION_POOLS,
  type HyperionPoolKey,
} from "@/lib/constants/yieldAiVault";
import { getHyperionAmountOut } from "@/lib/protocols/yield-ai/engine/hyperionQuote";
import {
  computeZapSwapAmountIn,
  computeZapValueFractionToNonUsdc,
  getPoolCurrentTick,
  isPositionActive,
  planHyperionOpen,
  readSafeHyperionPositions,
  type HyperionPositionView,
} from "@/lib/protocols/yield-ai/hyperionLp";
import { loadHyperionLpEventTotalsBySafe } from "@/lib/protocols/yield-ai/hyperionLpEvents";
import {
  executeHyperionAddDual,
  executeHyperionAddZapUsdc,
  executeHyperionClaimFees,
  executeHyperionClaimRewards,
  executeHyperionOpenDual,
  executeHyperionOpenZapUsdc,
  executeHyperionRemoveAll,
  executeSwapAptToUsdc,
  executeSwapFaToFa,
} from "@/lib/protocols/yield-ai/vaultExecutor";
import {
  submitSwapFaToFaWithFallbackLimits,
  type SwapFaToFaDirection,
} from "@/lib/protocols/yield-ai/swapFaToFa";
import { PanoraPricesService } from "@/lib/services/panora/prices";

/** APT FA metadata (farm rewards report APT via the 0xa paired metadata). */
const APT_FA_METADATA = "0x000000000000000000000000000000000000000000000000000000000000000a";
import { getFaBalance } from "@/lib/protocols/yield-ai/engine/stateComputer";

export const DEFAULT_HALF_WIDTH_TICKS = 250; // ~±2.5% on WBTC/USDC (spacing 10)
export const DEFAULT_SWAP_SLIPPAGE_BPS = 100; // 1.0% on the balancing swap
const DEADLINE_SECS = 600;

/**
 * Pad on the token_b leg when pairing a dual (re)open. Hyperion sizes the
 * liquidity from `amount_a` and aborts with `pool_v3::EAMOUNT_B_INPUT_LESS`
 * when `amount_b` comes up short — surplus token_b is returned as leftover,
 * surplus token_a aborts the whole tx. So always err on the token_b side and
 * shave token_a instead; the shaved dust stays in the safe.
 */
const DUAL_REOPEN_B_PAD = 1.01;

const APTOS_API_KEY = process.env.APTOS_API_KEY;

function buildAptos(): Aptos {
  const config = new AptosConfig({
    network: Network.MAINNET,
    ...(APTOS_API_KEY && {
      clientConfig: { HEADERS: { Authorization: `Bearer ${APTOS_API_KEY}` } },
    }),
  });
  return new Aptos(config);
}

function deadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECS);
}

function clampSlippageBps(raw: unknown): number {
  return Math.max(0, Math.min(10_000, Math.trunc(Number(raw ?? DEFAULT_SWAP_SLIPPAGE_BPS))));
}

function tickToTokenAPriceUsdc(tick: number, decimalsA: number, decimalsB: number): number {
  return Math.pow(1.0001, tick) * 10 ** (decimalsA - decimalsB);
}

function baseUnitsToNumber(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

/** Open a centered LP position from USDC (plans range + zap swap off the live tick). */
export async function runHyperionOpen(params: {
  safeAddress: string;
  usdcAmountInBaseUnits: bigint;
  poolKey?: HyperionPoolKey;
  halfWidthTicks?: number;
  /** Explicit (possibly asymmetric) range — used by the %/price UI modes. */
  tickLower?: number;
  tickUpper?: number;
  slippageBps?: number;
  dryRun?: boolean;
}) {
  const poolKey: HyperionPoolKey = params.poolKey ?? "wbtc_usdc";
  const hasExplicit =
    Number.isFinite(params.tickLower as number) && Number.isFinite(params.tickUpper as number);
  const halfWidthTicks = Math.max(1, Math.trunc(Number(params.halfWidthTicks ?? DEFAULT_HALF_WIDTH_TICKS)));
  const slippageBps = clampSlippageBps(params.slippageBps);
  const dryRun = Boolean(params.dryRun);

  // Plan against the live current tick (avoids the tick race).
  const plan = await planHyperionOpen({
    poolKey,
    usdcAmountIn: params.usdcAmountInBaseUnits,
    ...(hasExplicit
      ? { tickLower: params.tickLower, tickUpper: params.tickUpper }
      : { halfWidthTicks }),
  });

  // Slippage floor for the balancing swap (USDC -> non-USDC leg).
  let swapAmountOutMin = 0n;
  let quotedSwapAmountOut = 0n;
  if (plan.swapAmountIn > 0n) {
    quotedSwapAmountOut = await getHyperionAmountOut({
      amountInBaseUnits: plan.swapAmountIn,
      fromMetadata: plan.pool.tokenB, // USDC
      toMetadata: plan.pool.tokenA, // non-USDC leg
    });
    swapAmountOutMin = (quotedSwapAmountOut * (10_000n - BigInt(slippageBps))) / 10_000n;
  }

  const swapAmountInUsdc = baseUnitsToNumber(plan.swapAmountIn, plan.pool.decimalsB);
  const spotPriceUsdc = tickToTokenAPriceUsdc(plan.currentTick, plan.pool.decimalsA, plan.pool.decimalsB);
  const estimatedSwapValueUsdc =
    baseUnitsToNumber(quotedSwapAmountOut, plan.pool.decimalsA) * spotPriceUsdc;
  const estimatedSwapLossUsdc = Math.max(0, swapAmountInUsdc - estimatedSwapValueUsdc);
  const estimatedSwapLossBps =
    swapAmountInUsdc > 0 ? (estimatedSwapLossUsdc / swapAmountInUsdc) * 10_000 : 0;
  const remainingUsdcBeforeLp = params.usdcAmountInBaseUnits - plan.swapAmountIn;

  const result = await executeHyperionOpenZapUsdc({
    safeAddress: toCanonicalAddress(params.safeAddress),
    tokenA: plan.pool.tokenA,
    tokenB: plan.pool.tokenB,
    feeTier: plan.pool.feeTier,
    tickLower: plan.tickLower,
    tickUpper: plan.tickUpper,
    usdcAmountInBaseUnits: params.usdcAmountInBaseUnits,
    swapAmountInBaseUnits: plan.swapAmountIn,
    swapAmountOutMinBaseUnits: swapAmountOutMin,
    deadlineUnixSeconds: deadline(),
    dryRun,
  });

  return {
    ...result,
    poolKey,
    currentTick: plan.currentTick,
    tickLower: plan.tickLower,
    tickUpper: plan.tickUpper,
    usdcAmountIn: params.usdcAmountInBaseUnits.toString(),
    swapAmountIn: plan.swapAmountIn.toString(),
    quotedSwapAmountOut: quotedSwapAmountOut.toString(),
    swapAmountOutMin: swapAmountOutMin.toString(),
    remainingUsdcBeforeLp: remainingUsdcBeforeLp.toString(),
    spotPriceUsdc,
    estimatedSwapValueUsdc,
    estimatedSwapLossUsdc,
    estimatedSwapLossBps,
  };
}

/**
 * Open a centered LP position from USDC WITHOUT the on-chain adapter zap.
 *
 * The adapter's `zap_split` calls `pool_v3::swap` directly with a hardcoded a2b + sqrt limit,
 * which mis-routes USDC→APT to a 0-fill on the apt_usdc pool (aborts E_HYPERION_SLIPPAGE / opens
 * an APT-less position). Instead we swap the zap split USDC→non-USDC via the PROVEN router path
 * (`execute_swap_fa_to_fa`, with fallback sqrt limits), then `open_dual` with the received
 * non-USDC leg + the remaining USDC. Both legs are mainnet-proven. Returns the dual-open result.
 */
export async function runHyperionOpenViaDualSwap(params: {
  safeAddress: string;
  usdcAmountInBaseUnits: bigint;
  poolKey?: HyperionPoolKey;
  halfWidthTicks?: number;
  tickLower?: number;
  tickUpper?: number;
  slippageBps?: number;
  dryRun?: boolean;
}) {
  const poolKey: HyperionPoolKey = params.poolKey ?? "wbtc_usdc";
  const pool = YIELD_AI_HYPERION_POOLS[poolKey];
  if (pool.usdcIsTokenA) {
    throw new Error(`runHyperionOpenViaDualSwap assumes USDC is token_b — not ${pool.label}`);
  }
  const safe = toCanonicalAddress(params.safeAddress);
  const slippageBps = clampSlippageBps(params.slippageBps);
  const dryRun = Boolean(params.dryRun);
  const hasExplicit =
    Number.isFinite(params.tickLower as number) && Number.isFinite(params.tickUpper as number);
  const halfWidthTicks = Math.max(1, Math.trunc(Number(params.halfWidthTicks ?? DEFAULT_HALF_WIDTH_TICKS)));

  // Plan the range + the zap split (USDC to convert into the non-USDC leg).
  const plan = await planHyperionOpen({
    poolKey,
    usdcAmountIn: params.usdcAmountInBaseUnits,
    ...(hasExplicit ? { tickLower: params.tickLower, tickUpper: params.tickUpper } : { halfWidthTicks }),
  });

  // Swap a touch UNDER the exact split so USDC (token_b) is the SURPLUS leg on the dual add: a
  // token_b shortfall aborts the add (EAMOUNT_B_INPUT_LESS); surplus just returns as leftover.
  const swapUsdc = (plan.swapAmountIn * 97n) / 100n;

  if (dryRun) {
    return {
      dryRun: true,
      mode: "dual-swap" as const,
      poolKey,
      currentTick: plan.currentTick,
      tickLower: plan.tickLower,
      tickUpper: plan.tickUpper,
      usdcAmountIn: params.usdcAmountInBaseUnits.toString(),
      plannedSwapUsdc: swapUsdc.toString(),
    };
  }

  const aptos = buildAptos();
  let swapHash: string | null = null;
  let nonUsdcReceived = 0n;
  if (swapUsdc > 0n) {
    let amountOutMin = 0n;
    try {
      const quoted = await getHyperionAmountOut({
        amountInBaseUnits: swapUsdc,
        fromMetadata: pool.tokenB, // USDC
        toMetadata: pool.tokenA, // non-USDC (APT)
      });
      amountOutMin = (quoted * (10_000n - BigInt(slippageBps))) / 10_000n;
    } catch {
      amountOutMin = 0n;
    }
    const before = await getFaBalance(aptos, safe, pool.tokenA);
    const s = await submitSwapFaToFaWithFallbackLimits({
      network: "mainnet",
      safe,
      feeTier: Number(pool.feeTier),
      amountIn: swapUsdc,
      amountOutMin,
      fromMetadata: pool.tokenB,
      toMetadata: pool.tokenA,
      deadline: deadline(),
      direction: "oneForZero", // token_b (USDC) -> token_a (APT)
    });
    swapHash = s.swapTxHash ?? null;
    const after = await getFaBalance(aptos, safe, pool.tokenA);
    nonUsdcReceived = after > before ? after - before : 0n;
  }
  const remainingUsdc = params.usdcAmountInBaseUnits - swapUsdc;

  // open_dual at the planned range: liquidity sized from token_a (APT), USDC surplus → leftover.
  const dual = await runHyperionOpenDual({
    safeAddress: safe,
    amountABaseUnits: nonUsdcReceived,
    amountBBaseUnits: remainingUsdc,
    poolKey,
    tickLower: plan.tickLower,
    tickUpper: plan.tickUpper,
  });

  return {
    ...dual,
    mode: "dual-swap" as const,
    swapHash,
    swapUsdc: swapUsdc.toString(),
    nonUsdcReceived: nonUsdcReceived.toString(),
    remainingUsdc: remainingUsdc.toString(),
    currentTick: plan.currentTick,
    tickLower: plan.tickLower,
    tickUpper: plan.tickUpper,
  };
}

/**
 * Open a position from BOTH legs already in the safe (dual / two-sided) — no
 * swap. The range is planned off the live tick; `amountA`/`amountB` are taken
 * directly from the safe, with `min = 0` so the over-supplied leg's excess is
 * returned to the safe as leftover. Use when the safe already holds both tokens.
 */
export async function runHyperionOpenDual(params: {
  safeAddress: string;
  amountABaseUnits: bigint;
  amountBBaseUnits: bigint;
  poolKey?: HyperionPoolKey;
  halfWidthTicks?: number;
  tickLower?: number;
  tickUpper?: number;
  dryRun?: boolean;
}) {
  const poolKey: HyperionPoolKey = params.poolKey ?? "wbtc_usdc";
  const hasExplicit =
    Number.isFinite(params.tickLower as number) && Number.isFinite(params.tickUpper as number);
  const halfWidthTicks = Math.max(1, Math.trunc(Number(params.halfWidthTicks ?? DEFAULT_HALF_WIDTH_TICKS)));
  const dryRun = Boolean(params.dryRun);

  // Reuse the live-tick planner only for the range (swapAmountIn is irrelevant
  // for dual — there is no swap; pass 0 so the planner does no work on it).
  const plan = await planHyperionOpen({
    poolKey,
    usdcAmountIn: 0n,
    ...(hasExplicit
      ? { tickLower: params.tickLower, tickUpper: params.tickUpper }
      : { halfWidthTicks }),
  });

  const result = await executeHyperionOpenDual({
    safeAddress: toCanonicalAddress(params.safeAddress),
    tokenA: plan.pool.tokenA,
    tokenB: plan.pool.tokenB,
    feeTier: plan.pool.feeTier,
    tickLower: plan.tickLower,
    tickUpper: plan.tickUpper,
    amountABaseUnits: params.amountABaseUnits,
    amountBBaseUnits: params.amountBBaseUnits,
    deadlineUnixSeconds: deadline(),
    dryRun,
  });

  return {
    ...result,
    mode: "dual" as const,
    poolKey,
    currentTick: plan.currentTick,
    tickLower: plan.tickLower,
    tickUpper: plan.tickUpper,
    amountA: params.amountABaseUnits.toString(),
    amountB: params.amountBBaseUnits.toString(),
  };
}

/**
 * Add both legs (dual) to an EXISTING position — no swap. Uses the position's
 * own range (no range planning).
 *
 * Hyperion sizes the added liquidity from `amount_a` and requires the matching
 * `amount_b` at the execution tick — a token_b shortfall aborts with
 * `pool_v3::EAMOUNT_B_INPUT_LESS`; it does NOT scale down to the smaller leg
 * (`min = 0` only lets the token_b SURPLUS return to the safe as leftover).
 * We re-check the leg ratio against the live tick here so callers get a
 * readable error instead of a Move abort.
 */
export async function runHyperionAddDual(params: {
  safeAddress: string;
  position: string;
  amountABaseUnits: bigint;
  amountBBaseUnits: bigint;
  dryRun?: boolean;
}) {
  const safe = toCanonicalAddress(params.safeAddress);
  const pos = toCanonicalAddress(params.position);

  const { tracked, poolKey } = await resolveOpenPosition({ safeAddress: safe, position: pos });
  const pool = YIELD_AI_HYPERION_POOLS[poolKey];
  const currentTick = await getPoolCurrentTick(pool.poolAddress);
  const amountA = baseUnitsToNumber(params.amountABaseUnits, pool.decimalsA);
  const amountB = baseUnitsToNumber(params.amountBBaseUnits, pool.decimalsB);

  if (currentTick >= tracked.tickUpper) {
    if (amountA > 0) {
      throw new Error(
        `Price is above the position's range — the add takes only ${pool.symbolB}; set the ${pool.symbolA} amount to 0`
      );
    }
  } else if (currentTick <= tracked.tickLower) {
    if (amountB > 0) {
      throw new Error(
        `Price is below the position's range — the add takes only ${pool.symbolA}; set the ${pool.symbolB} amount to 0`
      );
    }
  } else {
    if (amountA <= 0) {
      throw new Error(`In-range adds are sized from the ${pool.symbolA} leg — provide a ${pool.symbolA} amount`);
    }
    const r = computeZapValueFractionToNonUsdc({
      currentTick,
      tickLower: tracked.tickLower,
      tickUpper: tracked.tickUpper,
    });
    if (r > 0 && r < 1) {
      const price = tickToTokenAPriceUsdc(currentTick, pool.decimalsA, pool.decimalsB);
      const requiredB = amountA * price * ((1 - r) / r);
      // 0.1% tolerance for float rounding; real shortfalls are far larger.
      if (amountB < requiredB * 0.999) {
        throw new Error(
          `Add needs ≈${requiredB.toFixed(Math.min(pool.decimalsB, 4))} ${pool.symbolB} to pair with ` +
            `${amountA} ${pool.symbolA} at the current price — got ${amountB}. ` +
            `Lower the ${pool.symbolA} amount or add more ${pool.symbolB} to the safe.`
        );
      }
    }
  }

  const result = await executeHyperionAddDual({
    safeAddress: safe,
    position: pos,
    amountABaseUnits: params.amountABaseUnits,
    amountBBaseUnits: params.amountBBaseUnits,
    deadlineUnixSeconds: deadline(),
    dryRun: Boolean(params.dryRun),
  });
  return {
    ...result,
    mode: "dual" as const,
    amountA: params.amountABaseUnits.toString(),
    amountB: params.amountBBaseUnits.toString(),
  };
}

/**
 * Add liquidity to an EXISTING position from USDC only, via the dual-swap workaround
 * (router swap USDC→token_a, then dual add at the position's OWN range). Same reason as
 * `runHyperionOpenViaDualSwap`: the adapter zap's internal `pool_v3::swap` 0-fills USDC→base
 * on the apt_usdc/wbtc_usdc pools, so the single-tx `execute_hyperion_add_zap_usdc` cannot
 * be used there. The split fraction comes from the position's own ticks at the live price;
 * the swap is shaved 3% under the exact split so USDC (token_b) stays the surplus leg —
 * a token_b shortfall aborts the add, surplus just returns to the safe as leftover.
 */
export async function runHyperionAddViaDualSwap(params: {
  safeAddress: string;
  position: string;
  usdcAmountInBaseUnits: bigint;
  slippageBps?: number;
  dryRun?: boolean;
}) {
  const safe = toCanonicalAddress(params.safeAddress);
  const pos = toCanonicalAddress(params.position);
  const slippageBps = clampSlippageBps(params.slippageBps);
  const dryRun = Boolean(params.dryRun);

  const { tracked, poolKey } = await resolveOpenPosition({ safeAddress: safe, position: pos });
  const pool = YIELD_AI_HYPERION_POOLS[poolKey];
  if (pool.usdcIsTokenA) {
    throw new Error(`runHyperionAddViaDualSwap assumes USDC is token_b — not ${pool.label}`);
  }
  const currentTick = await getPoolCurrentTick(pool.poolAddress);

  // Value fraction that must sit in token_a at the position's own range. Out-of-range clamps:
  // above range → all USDC (no swap), below range → all token_a (swap everything).
  const r =
    currentTick >= tracked.tickUpper
      ? 0
      : currentTick <= tracked.tickLower
        ? 1
        : computeZapValueFractionToNonUsdc({
            currentTick,
            tickLower: tracked.tickLower,
            tickUpper: tracked.tickUpper,
          });
  const exactSwapUsdc = BigInt(Math.round(Number(params.usdcAmountInBaseUnits) * r));
  const swapUsdc = r >= 1 ? params.usdcAmountInBaseUnits : (exactSwapUsdc * 97n) / 100n;

  if (dryRun) {
    return {
      dryRun: true,
      mode: "add-dual-swap" as const,
      poolKey,
      currentTick,
      tickLower: tracked.tickLower,
      tickUpper: tracked.tickUpper,
      usdcAmountIn: params.usdcAmountInBaseUnits.toString(),
      plannedSwapUsdc: swapUsdc.toString(),
    };
  }

  const aptos = buildAptos();
  let swapHash: string | null = null;
  let nonUsdcReceived = 0n;
  if (swapUsdc > 0n) {
    let amountOutMin = 0n;
    try {
      const quoted = await getHyperionAmountOut({
        amountInBaseUnits: swapUsdc,
        fromMetadata: pool.tokenB, // USDC
        toMetadata: pool.tokenA,
      });
      amountOutMin = (quoted * (10_000n - BigInt(slippageBps))) / 10_000n;
    } catch {
      amountOutMin = 0n;
    }
    const before = await getFaBalance(aptos, safe, pool.tokenA);
    const s = await submitSwapFaToFaWithFallbackLimits({
      network: "mainnet",
      safe,
      feeTier: Number(pool.feeTier),
      amountIn: swapUsdc,
      amountOutMin,
      fromMetadata: pool.tokenB,
      toMetadata: pool.tokenA,
      deadline: deadline(),
      direction: "oneForZero",
    });
    swapHash = s.swapTxHash ?? null;
    const after = await getFaBalance(aptos, safe, pool.tokenA);
    nonUsdcReceived = after > before ? after - before : 0n;
  }
  const remainingUsdc = params.usdcAmountInBaseUnits - swapUsdc;

  const dual = await runHyperionAddDual({
    safeAddress: safe,
    position: pos,
    amountABaseUnits: nonUsdcReceived,
    amountBBaseUnits: remainingUsdc,
  });

  return {
    ...dual,
    mode: "add-dual-swap" as const,
    poolKey,
    swapHash,
    swapUsdc: swapUsdc.toString(),
    nonUsdcReceived: nonUsdcReceived.toString(),
    remainingUsdc: remainingUsdc.toString(),
    currentTick,
    tickLower: tracked.tickLower,
    tickUpper: tracked.tickUpper,
  };
}

/**
 * Pad on the token_a → USDC swap of a single-token (token_a) zap add: swap
 * slightly MORE than the exact range split so USDC ends up the long side.
 * Surplus token_b returns to the safe as leftover; a token_b shortfall aborts
 * the whole add (`pool_v3::EAMOUNT_B_INPUT_LESS`).
 */
const ADD_ZAP_TOKEN_A_SWAP_PAD_BPS = 100; // swap 1% more than the exact split

/**
 * Add liquidity to an EXISTING position from a SINGLE token ("zap add").
 *
 * - `inputToken: "usdc"` — contract zap (`execute_hyperion_add_zap_usdc`): the
 *   adapter swaps `swap_amount_in` USDC → token_a internally and adds at the
 *   position's own range. One transaction; leftovers return to the safe.
 * - `inputToken: "token_a"` (e.g. idle USDt) — no contract entry exists, so the
 *   executor swaps the surplus token_a → USDC first (vault swap, measured as a
 *   USDC balance delta), then dual-adds the pair. Two transactions.
 */
export async function runHyperionAddZap(params: {
  safeAddress: string;
  position: string;
  inputToken: "usdc" | "token_a";
  amountBaseUnits: bigint;
  slippageBps?: number;
  dryRun?: boolean;
}) {
  const safe = toCanonicalAddress(params.safeAddress);
  const pos = toCanonicalAddress(params.position);
  const slippageBps = clampSlippageBps(params.slippageBps);
  const dryRun = Boolean(params.dryRun);
  if (params.amountBaseUnits <= 0n) {
    throw new Error("amountBaseUnits must be > 0");
  }

  const { tracked, poolKey } = await resolveOpenPosition({ safeAddress: safe, position: pos });
  const pool = YIELD_AI_HYPERION_POOLS[poolKey];
  if (pool.usdcIsTokenA) {
    throw new Error(`Zap add assumes USDC is token_b — not supported for ${pool.label}`);
  }
  const currentTick = await getPoolCurrentTick(pool.poolAddress);

  if (params.inputToken === "usdc") {
    const swapAmountIn = computeZapSwapAmountIn({
      currentTick,
      tickLower: tracked.tickLower,
      tickUpper: tracked.tickUpper,
      usdcAmountIn: params.amountBaseUnits,
    });
    let swapAmountOutMin = 0n;
    if (swapAmountIn > 0n) {
      const quoted = await getHyperionAmountOut({
        amountInBaseUnits: swapAmountIn,
        fromMetadata: pool.tokenB, // USDC
        toMetadata: pool.tokenA,
      });
      swapAmountOutMin = (quoted * (10_000n - BigInt(slippageBps))) / 10_000n;
    }
    const result = await executeHyperionAddZapUsdc({
      safeAddress: safe,
      position: pos,
      usdcAmountInBaseUnits: params.amountBaseUnits,
      swapAmountInBaseUnits: swapAmountIn,
      swapAmountOutMinBaseUnits: swapAmountOutMin,
      deadlineUnixSeconds: deadline(),
      dryRun,
    });
    return {
      mode: "zap" as const,
      inputToken: "usdc" as const,
      addHash: result.hash ?? null,
      swapHash: null as string | null,
      currentTick,
      amountIn: params.amountBaseUnits.toString(),
      swapAmountIn: swapAmountIn.toString(),
      swapAmountOutMin: swapAmountOutMin.toString(),
      dryRun: Boolean(result.dryRun),
    };
  }

  // token_a input. Fraction of value the range wants in token_a (R): swap the
  // rest to USDC, padded up (see ADD_ZAP_TOKEN_A_SWAP_PAD_BPS).
  let swapFracMicro: bigint; // fraction of the input to swap, in 1e-6 units
  if (currentTick <= tracked.tickLower) {
    swapFracMicro = 0n; // below range — position takes only token_a
  } else if (currentTick >= tracked.tickUpper) {
    swapFracMicro = 1_000_000n; // above range — position takes only USDC
  } else {
    const r = computeZapValueFractionToNonUsdc({
      currentTick,
      tickLower: tracked.tickLower,
      tickUpper: tracked.tickUpper,
    });
    const padded = (1 - r) * (1 + ADD_ZAP_TOKEN_A_SWAP_PAD_BPS / 10_000);
    swapFracMicro = BigInt(Math.min(1_000_000, Math.max(0, Math.round(padded * 1_000_000))));
  }
  const swapIn = (params.amountBaseUnits * swapFracMicro) / 1_000_000n;
  const addAmountA = params.amountBaseUnits - swapIn;

  if (dryRun) {
    return {
      mode: "zap" as const,
      inputToken: "token_a" as const,
      addHash: null as string | null,
      swapHash: null as string | null,
      currentTick,
      amountIn: params.amountBaseUnits.toString(),
      swapAmountIn: swapIn.toString(),
      plannedAddAmountA: addAmountA.toString(),
      dryRun: true,
    };
  }

  const aptos = buildAptos();
  const usdc = toCanonicalAddress(USDC_FA_METADATA_MAINNET);
  let swapHash: string | null = null;
  let usdcReceived = 0n;
  if (swapIn > 0n) {
    let amountOutMin = 0n;
    try {
      const quoted = await getHyperionAmountOut({
        amountInBaseUnits: swapIn,
        fromMetadata: pool.tokenA,
        toMetadata: pool.tokenB,
      });
      amountOutMin = (quoted * (10_000n - BigInt(slippageBps))) / 10_000n;
    } catch {
      amountOutMin = 0n;
    }
    const beforeUsdc = await getFaBalance(aptos, safe, usdc);
    const swap = await submitSwapFaToFaWithFallbackLimits({
      network: "mainnet",
      safe,
      feeTier: Number(pool.feeTier),
      amountIn: swapIn,
      amountOutMin,
      fromMetadata: pool.tokenA,
      toMetadata: pool.tokenB,
      deadline: deadline(),
      direction: "zeroForOne", // token_a (token0) → USDC (token1)
    });
    swapHash = swap.swapTxHash ?? null;
    const afterUsdc = await getFaBalance(aptos, safe, usdc);
    usdcReceived = afterUsdc > beforeUsdc ? afterUsdc - beforeUsdc : 0n;
  }

  // Dual-add the pair; runHyperionAddDual re-checks the leg ratio on the live
  // tick and fails with a readable error instead of a Move abort.
  const add = await runHyperionAddDual({
    safeAddress: safe,
    position: pos,
    amountABaseUnits: addAmountA,
    amountBBaseUnits: usdcReceived,
    dryRun: false,
  });

  return {
    mode: "zap" as const,
    inputToken: "token_a" as const,
    addHash: add.hash ?? null,
    swapHash,
    currentTick,
    amountIn: params.amountBaseUnits.toString(),
    swapAmountIn: swapIn.toString(),
    usdcReceived: usdcReceived.toString(),
    addAmountA: addAmountA.toString(),
    dryRun: false,
  };
}

/**
 * OPEN a new position from a SINGLE non-USDC token ("token_a zap open"), e.g. a
 * safe that holds only USDt for a USDt/USDC pool. No contract entry takes a
 * single token_a, so the executor swaps ~the range split of token_a → USDC
 * (vault swap, measured as a USDC delta), then opens a dual position at a
 * centered (or explicit) range. token_a is capped to what the received USDC can
 * pair with at the live tick (`DUAL_REOPEN_B_PAD`) so the open never aborts on a
 * token_b shortfall; the shaved token_a dust stays in the safe.
 */
export async function runHyperionOpenZapTokenA(params: {
  safeAddress: string;
  amountBaseUnits: bigint;
  poolKey?: HyperionPoolKey;
  halfWidthTicks?: number;
  tickLower?: number;
  tickUpper?: number;
  slippageBps?: number;
  dryRun?: boolean;
}) {
  const poolKey: HyperionPoolKey = params.poolKey ?? "wbtc_usdc";
  const pool = YIELD_AI_HYPERION_POOLS[poolKey];
  if (pool.usdcIsTokenA) {
    throw new Error(`token_a zap open assumes USDC is token_b — not supported for ${pool.label}`);
  }
  const slippageBps = clampSlippageBps(params.slippageBps);
  const dryRun = Boolean(params.dryRun);
  if (params.amountBaseUnits <= 0n) {
    throw new Error("amountBaseUnits must be > 0");
  }

  const hasExplicit =
    Number.isFinite(params.tickLower as number) && Number.isFinite(params.tickUpper as number);
  const halfWidthTicks = Math.max(1, Math.trunc(Number(params.halfWidthTicks ?? DEFAULT_HALF_WIDTH_TICKS)));
  const plan = await planHyperionOpen({
    poolKey,
    usdcAmountIn: 0n,
    ...(hasExplicit ? { tickLower: params.tickLower, tickUpper: params.tickUpper } : { halfWidthTicks }),
  });

  // Fraction of the input to swap to USDC so the position opens at the range
  // ratio. Pad up so USDC ends the long side (token_b shortfall would abort).
  let swapFracMicro: bigint;
  if (plan.currentTick <= plan.tickLower) {
    swapFracMicro = 0n; // below range — position takes only token_a
  } else if (plan.currentTick >= plan.tickUpper) {
    swapFracMicro = 1_000_000n; // above range — position takes only USDC
  } else {
    const r = computeZapValueFractionToNonUsdc({
      currentTick: plan.currentTick,
      tickLower: plan.tickLower,
      tickUpper: plan.tickUpper,
    });
    const padded = (1 - r) * (1 + ADD_ZAP_TOKEN_A_SWAP_PAD_BPS / 10_000);
    swapFracMicro = BigInt(Math.min(1_000_000, Math.max(0, Math.round(padded * 1_000_000))));
  }
  const swapIn = (params.amountBaseUnits * swapFracMicro) / 1_000_000n;
  const keepA = params.amountBaseUnits - swapIn;

  if (dryRun) {
    return {
      mode: "zap" as const,
      inputToken: "token_a" as const,
      openHash: null as string | null,
      swapHash: null as string | null,
      poolKey,
      currentTick: plan.currentTick,
      tickLower: plan.tickLower,
      tickUpper: plan.tickUpper,
      amountIn: params.amountBaseUnits.toString(),
      swapAmountIn: swapIn.toString(),
      plannedAmountA: keepA.toString(),
      dryRun: true,
    };
  }

  const safe = toCanonicalAddress(params.safeAddress);
  const aptos = buildAptos();
  const usdc = toCanonicalAddress(USDC_FA_METADATA_MAINNET);
  let swapHash: string | null = null;
  let usdcReceived = 0n;
  if (swapIn > 0n) {
    let amountOutMin = 0n;
    try {
      const quoted = await getHyperionAmountOut({
        amountInBaseUnits: swapIn,
        fromMetadata: pool.tokenA,
        toMetadata: pool.tokenB,
      });
      amountOutMin = (quoted * (10_000n - BigInt(slippageBps))) / 10_000n;
    } catch {
      amountOutMin = 0n;
    }
    const beforeUsdc = await getFaBalance(aptos, safe, usdc);
    const swap = await submitSwapFaToFaWithFallbackLimits({
      network: "mainnet",
      safe,
      feeTier: Number(pool.feeTier),
      amountIn: swapIn,
      amountOutMin,
      fromMetadata: pool.tokenA,
      toMetadata: pool.tokenB,
      deadline: deadline(),
      direction: "zeroForOne", // token_a (token0) → USDC (token1)
    });
    swapHash = swap.swapTxHash ?? null;
    const afterUsdc = await getFaBalance(aptos, safe, usdc);
    usdcReceived = afterUsdc > beforeUsdc ? afterUsdc - beforeUsdc : 0n;
  }

  // Cap token_a to what the received USDC can pair with at the live tick (the
  // swap moved it) so open_dual never comes up short on token_b.
  const pairingTick = swapHash ? await getPoolCurrentTick(pool.poolAddress) : plan.currentTick;
  let amountA = keepA;
  let amountB = usdcReceived;
  if (pairingTick >= plan.tickUpper) {
    amountA = 0n;
  } else if (pairingTick <= plan.tickLower) {
    amountB = 0n;
  } else {
    const rA = computeZapValueFractionToNonUsdc({
      currentTick: pairingTick,
      tickLower: plan.tickLower,
      tickUpper: plan.tickUpper,
    });
    if (rA > 0 && rA < 1) {
      const priceA = tickToTokenAPriceUsdc(pairingTick, pool.decimalsA, pool.decimalsB);
      const bPerA = priceA * ((1 - rA) / rA);
      const aHuman = baseUnitsToNumber(amountA, pool.decimalsA);
      const bHuman = baseUnitsToNumber(amountB, pool.decimalsB);
      if (bHuman < aHuman * bPerA * DUAL_REOPEN_B_PAD) {
        const aCap = bHuman / DUAL_REOPEN_B_PAD / bPerA;
        amountA = BigInt(Math.floor(aCap * 10 ** pool.decimalsA));
      }
    }
  }

  const open = await runHyperionOpenDual({
    safeAddress: safe,
    amountABaseUnits: amountA,
    amountBBaseUnits: amountB,
    poolKey,
    tickLower: plan.tickLower,
    tickUpper: plan.tickUpper,
    dryRun: false,
  });

  return {
    mode: "zap" as const,
    inputToken: "token_a" as const,
    openHash: open.hash ?? null,
    swapHash,
    poolKey,
    currentTick: plan.currentTick,
    tickLower: plan.tickLower,
    tickUpper: plan.tickUpper,
    amountIn: params.amountBaseUnits.toString(),
    swapAmountIn: swapIn.toString(),
    usdcReceived: usdcReceived.toString(),
    amountA: amountA.toString(),
    amountB: amountB.toString(),
    dryRun: false,
  };
}

/** Claim accrued CLMM fees on a position (perf cut taken on-chain). */
export async function runHyperionClaim(params: {
  safeAddress: string;
  position: string;
  dryRun?: boolean;
}) {
  const claim = await executeHyperionClaimFees({
    safeAddress: toCanonicalAddress(params.safeAddress),
    position: toCanonicalAddress(params.position),
    dryRun: Boolean(params.dryRun),
  });
  return { claimFeesHash: claim.hash ?? null, dryRun: Boolean(claim.dryRun) };
}

export const DEFAULT_AUTO_CLAIM_MIN_USD = 0.1;

type ClaimPriceInfo = { usd: number; decimals: number };

/** Fetch a USD-price + decimals map (by normalized address) for the given tokens. */
async function fetchPriceMap(addresses: string[]): Promise<Map<string, ClaimPriceInfo>> {
  const map = new Map<string, ClaimPriceInfo>();
  try {
    const pr = await PanoraPricesService.getInstance().getPrices(1, Array.from(new Set(addresses)));
    const list: Array<Record<string, unknown>> = Array.isArray(pr)
      ? (pr as Array<Record<string, unknown>>)
      : ((pr as { data?: unknown })?.data as Array<Record<string, unknown>>) ?? [];
    for (const it of list) {
      const info: ClaimPriceInfo = {
        usd: parseFloat(String(it.usdPrice ?? "0")) || 0,
        decimals: Number(it.decimals ?? 0) || 0,
      };
      if (typeof it.faAddress === "string") map.set(normalizeAddress(it.faAddress), info);
      if (typeof it.tokenAddress === "string") map.set(normalizeAddress(it.tokenAddress), info);
    }
  } catch {
    /* no prices → callers treat USD as 0 */
  }
  return map;
}

export type HyperionAutoClaimPositionResult = {
  position: string;
  feesUsd: number;
  rewardsUsd: number;
  action: "claimed" | "skip-below-threshold";
  claimFeesHash?: string | null;
  claimRewardsHash?: string | null;
};

/** A non-USDC fee-leg delta swept to USDC after a claim (convertFeesToUsdc mode). */
export type HyperionAutoClaimFeeSwap = {
  symbol: string;
  amountIn: string;
  decimals: number;
  hash: string | null;
};

/**
 * Auto-claim pass for one safe: per open position, if uncollected (fees +
 * rewards) value ≥ `minClaimUsd`, claim fees (perf cut taken) and farm rewards.
 * Claimed fees stay in the safe (keep). Claimed APT rewards are then swapped to
 * USDC (delta only — measured before/after, never pre-existing APT). No
 * re-center, no compounding (per current policy).
 *
 * `convertFeesToUsdc` (opt-in — the DN-autoclaim cron sets it, plain LP keeps the
 * default "fees stay as claimed" policy): also sweep the claimed VOLATILE fee legs
 * (WBTC/APT — any non-stable pool's token_a) → USDC, same delta-measurement approach.
 * Stable legs (USDt/USD1, tickSpacing-1 pools) are never swept — already ≈$1,
 * swapping is pure fee churn.
 */
export async function runHyperionAutoClaim(params: {
  safeAddress: string;
  minClaimUsd?: number;
  minRewardClaimUsd?: number;
  minRewardSwapUsd?: number;
  swapRewardsToUsdc?: boolean;
  convertFeesToUsdc?: boolean;
  dryRun?: boolean;
}) {
  const safe = toCanonicalAddress(params.safeAddress);
  const minClaimUsd = params.minClaimUsd ?? DEFAULT_AUTO_CLAIM_MIN_USD;
  const minRewardClaimUsd = params.minRewardClaimUsd ?? minClaimUsd;
  const minRewardSwapUsd = params.minRewardSwapUsd ?? minRewardClaimUsd;
  const swapRewardsToUsdc = params.swapRewardsToUsdc !== false;
  const convertFeesToUsdc = Boolean(params.convertFeesToUsdc);
  const dryRun = Boolean(params.dryRun);

  const all = await readSafeHyperionPositions(safe);
  const open = all.filter((p) => !p.closed);
  if (open.length === 0) {
    return {
      safeAddress: safe,
      positions: [] as HyperionAutoClaimPositionResult[],
      rewardSwap: null,
      feeSwaps: [] as HyperionAutoClaimFeeSwap[],
    };
  }

  // Prices for fee legs + reward tokens (+ APT for the reward swap).
  const priceAddrs: string[] = [APTOS_COIN_TYPE, APT_FA_METADATA];
  for (const p of open) {
    priceAddrs.push(p.tokenA, p.tokenB);
    for (const r of p.pendingRewards ?? []) priceAddrs.push(r.metadata);
  }
  const prices = await fetchPriceMap(priceAddrs);
  const priceOf = (addr: string): ClaimPriceInfo | undefined =>
    prices.get(normalizeAddress(addr)) ??
    (normalizeAddress(addr) === normalizeAddress(APT_FA_METADATA) ? prices.get(normalizeAddress(APTOS_COIN_TYPE)) : undefined);
  const usd = (raw: string | undefined, info?: ClaimPriceInfo): number => {
    if (!info || raw == null) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? (n / 10 ** info.decimals) * info.usd : 0;
  };

  const aptInfo = priceOf(APT_FA_METADATA);
  const aptBefore = dryRun ? 0n : await getFaBalance(buildAptos(), safe, APT_FA_METADATA).catch(() => 0n);

  // convertFeesToUsdc: snapshot each distinct VOLATILE non-USDC fee-leg token BEFORE any claim, so
  // the post-claim delta is exactly what this pass claimed — pre-existing balances stay untouched.
  // Stable pools (tickSpacing 1: USDt/USD1) are excluded — swapping ≈$1 → $1 is pure fee churn.
  type FeeSweepToken = { metadata: string; decimals: number; feeTier: number; symbol: string; before: bigint };
  const feeSweepTokens = new Map<string, FeeSweepToken>();
  if (convertFeesToUsdc && !dryRun) {
    for (const p of open) {
      const poolKey = matchPoolKeyForPosition(p);
      if (!poolKey) continue;
      const pool = YIELD_AI_HYPERION_POOLS[poolKey];
      if (pool.usdcIsTokenA || pool.tickSpacing === 1) continue;
      const norm = normalizeAddress(toCanonicalAddress(pool.tokenA));
      if (feeSweepTokens.has(norm)) continue;
      const before = await getFaBalance(buildAptos(), safe, pool.tokenA).catch(() => 0n);
      feeSweepTokens.set(norm, {
        metadata: pool.tokenA,
        decimals: pool.decimalsA,
        feeTier: Number(pool.feeTier),
        symbol: pool.symbolA,
        before,
      });
    }
  }

  const results: HyperionAutoClaimPositionResult[] = [];
  let anyRewardsClaimed = false;
  let anyFeesClaimed = false;

  for (const p of open) {
    const pa = priceOf(p.tokenA);
    const pb = priceOf(p.tokenB);
    const feesUsd = usd(p.pendingFeeA, pa) + usd(p.pendingFeeB, pb);
    let rewardsUsd = 0;
    for (const r of p.pendingRewards ?? []) rewardsUsd += usd(r.amount, priceOf(r.metadata));

    const hasFees = (p.pendingFeeA && p.pendingFeeA !== "0") || (p.pendingFeeB && p.pendingFeeB !== "0");
    const hasRewards = (p.pendingRewards ?? []).length > 0;
    const shouldClaimFees = hasFees && feesUsd >= minClaimUsd;
    const shouldClaimRewards = hasRewards && rewardsUsd >= minRewardClaimUsd;

    if (!shouldClaimFees && !shouldClaimRewards) {
      results.push({ position: p.position, feesUsd, rewardsUsd, action: "skip-below-threshold" });
      continue;
    }

    let claimFeesHash: string | null = null;
    let claimRewardsHash: string | null = null;
    if (shouldClaimFees) {
      const r = await executeHyperionClaimFees({ safeAddress: safe, position: toCanonicalAddress(p.position), dryRun });
      claimFeesHash = r.hash ?? null;
      anyFeesClaimed = true;
    }
    if (shouldClaimRewards) {
      const r = await executeHyperionClaimRewards({ safeAddress: safe, position: toCanonicalAddress(p.position), dryRun });
      claimRewardsHash = r.hash ?? null;
      anyRewardsClaimed = true;
    }
    results.push({ position: p.position, feesUsd, rewardsUsd, action: "claimed", claimFeesHash, claimRewardsHash });
  }

  // Swap the claimed APT (delta) → USDC, never touching pre-existing APT.
  let rewardSwap: { aptIn: string; hash: string | null } | null = null;
  if (!dryRun && swapRewardsToUsdc && anyRewardsClaimed) {
    const aptAfter = await getFaBalance(buildAptos(), safe, APT_FA_METADATA).catch(() => 0n);
    const aptDelta = aptAfter > aptBefore ? aptAfter - aptBefore : 0n;
    // Only swap if the newly claimed reward delta is large enough for Hyperion's direct APT -> USDC route.
    const aptDeltaUsd = aptInfo ? (Number(aptDelta) / 10 ** aptInfo.decimals) * aptInfo.usd : 0;
    if (aptDelta > 0n && aptDeltaUsd >= minRewardSwapUsd) {
      let amountOutMin = 0n;
      try {
        const quoted = await getHyperionAmountOut({
          amountInBaseUnits: aptDelta,
          fromMetadata: APT_FA_METADATA,
          toMetadata: USDC_FA_METADATA_MAINNET,
        });
        amountOutMin = (quoted * 9900n) / 10000n; // 1% slippage
      } catch {
        amountOutMin = 0n; // test fallback
      }
      const swap = await executeSwapAptToUsdc({
        safeAddress: safe,
        feeTier: SWAP_FEE_TIER,
        amountInBaseUnits: aptDelta,
        amountOutMinBaseUnits: amountOutMin,
        sqrtPriceLimit: SWAP_SQRT_PRICE_LIMIT,
        toToken: USDC_FA_METADATA_MAINNET,
        deadlineUnixSeconds: deadline(),
      });
      rewardSwap = { aptIn: aptDelta.toString(), hash: swap.hash ?? null };
    }
  }

  // convertFeesToUsdc: sweep each volatile fee-leg delta → USDC. Runs AFTER the legacy APT reward
  // swap on purpose: if that already swept the APT delta, this re-measure sees ≈0 and no-ops; if it
  // didn't run (fees claimed but no rewards), this catches the APT fee leg too. Delta-based, so
  // pre-existing balances (and dust below the threshold) are never touched.
  const feeSwaps: HyperionAutoClaimFeeSwap[] = [];
  if (convertFeesToUsdc && !dryRun && anyFeesClaimed) {
    for (const t of feeSweepTokens.values()) {
      try {
        const after = await getFaBalance(buildAptos(), safe, t.metadata).catch(() => 0n);
        const delta = after > t.before ? after - t.before : 0n;
        if (delta <= 0n) continue;
        const info = priceOf(t.metadata);
        const deltaUsd = info ? (Number(delta) / 10 ** info.decimals) * info.usd : 0;
        if (deltaUsd < minRewardSwapUsd) continue;
        let amountOutMin = 0n;
        try {
          const quoted = await getHyperionAmountOut({
            amountInBaseUnits: delta,
            fromMetadata: t.metadata,
            toMetadata: USDC_FA_METADATA_MAINNET,
          });
          amountOutMin = (quoted * 9900n) / 10000n; // 1% slippage
        } catch {
          amountOutMin = 0n;
        }
        const swap = await submitSwapFaToFaWithFallbackLimits({
          network: "mainnet",
          safe,
          feeTier: t.feeTier,
          amountIn: delta,
          amountOutMin,
          fromMetadata: t.metadata,
          toMetadata: USDC_FA_METADATA_MAINNET,
          deadline: deadline(),
          direction: "zeroForOne", // token_a → USDC (token_b)
        });
        feeSwaps.push({
          symbol: t.symbol,
          amountIn: delta.toString(),
          decimals: t.decimals,
          hash: swap.swapTxHash ?? null,
        });
      } catch (err) {
        console.warn(`[Yield AI] autoclaim fee sweep failed for ${t.symbol}; kept in safe`, err);
      }
    }
  }

  return { safeAddress: safe, positions: results, rewardSwap, feeSwaps };
}

/**
 * Close a position: claim fees first (so the protocol perf cut is taken —
 * Hyperion otherwise auto-claims remaining fees to the safe on remove,
 * bypassing the cut), then remove all liquidity. Both legs land in the safe.
 */
export async function runHyperionClose(params: {
  safeAddress: string;
  position: string;
  claimFirst?: boolean;
  dryRun?: boolean;
}) {
  const safe = toCanonicalAddress(params.safeAddress);
  const pos = toCanonicalAddress(params.position);
  const dryRun = Boolean(params.dryRun);
  const claimFirst = params.claimFirst !== false; // default true

  let claimFeesHash: string | null = null;
  if (claimFirst) {
    const claim = await executeHyperionClaimFees({ safeAddress: safe, position: pos, dryRun });
    claimFeesHash = claim.hash ?? null;
  }

  const remove = await executeHyperionRemoveAll({
    safeAddress: safe,
    position: pos,
    deadlineUnixSeconds: deadline(),
    dryRun,
  });

  return { claimFeesHash, removeAllHash: remove.hash, dryRun: Boolean(remove.dryRun) };
}

async function resolveOpenPosition(params: {
  safeAddress: string;
  position: string;
}): Promise<{ tracked: HyperionPositionView; poolKey: HyperionPoolKey }> {
  const safe = toCanonicalAddress(params.safeAddress);
  const pos = toCanonicalAddress(params.position);
  const positions = await readSafeHyperionPositions(safe);
  const tracked = positions.find((p) => toCanonicalAddress(p.position) === pos);
  if (!tracked) {
    throw new Error(`Hyperion position ${pos} is not tracked by safe ${safe}`);
  }
  if (tracked.closed) {
    throw new Error(`Hyperion position ${pos} is already closed`);
  }

  const poolKey = matchPoolKeyForPosition(tracked);
  if (!poolKey) {
    throw new Error(`Hyperion position ${pos} uses an unsupported pool`);
  }
  return { tracked, poolKey };
}

async function resolveOpenPositionPoolKey(params: {
  safeAddress: string;
  position: string;
}): Promise<HyperionPoolKey> {
  return (await resolveOpenPosition(params)).poolKey;
}

/**
 * Close a position and convert the freed non-USDC leg back to USDC.
 *
 * Critical: we swap ONLY the delta produced by this close, never pre-existing
 * safe holdings of the non-USDC token. We measure the delta = post − pre balance
 * of the non-USDC leg around the remove (as done manually in mainnet testing).
 *
 * In `dryRun`, no state changes so the delta cannot be measured; we report the
 * plan (claim/remove dry-run) without a convert swap.
 */
export async function runHyperionCloseConvert(params: {
  safeAddress: string;
  position: string;
  poolKey?: HyperionPoolKey;
  claimFirst?: boolean;
  /** Claim farm/gauge rewards (perf cut → treasury, rest → safe) BEFORE the remove burns the
   * position, otherwise pending rewards are lost. Foreign reward tokens stay in the safe as-is
   * (not converted). Non-fatal: an empty/aborting gauge call never blocks the close. */
  claimRewardsFirst?: boolean;
  slippageBps?: number;
  dryRun?: boolean;
}) {
  const safe = toCanonicalAddress(params.safeAddress);
  const poolKey = await resolveOpenPositionPoolKey({ safeAddress: safe, position: params.position });
  const pool = YIELD_AI_HYPERION_POOLS[poolKey];
  const slippageBps = clampSlippageBps(params.slippageBps);
  const dryRun = Boolean(params.dryRun);

  // Non-USDC leg is the token that is not USDC in this position's pool.
  const usdc = toCanonicalAddress(USDC_FA_METADATA_MAINNET);
  const nonUsdcMetadata =
    toCanonicalAddress(pool.tokenA) === usdc ? pool.tokenB : pool.tokenA;

  const aptos = buildAptos();

  // Claim rewards FIRST (before measuring `before`), so foreign reward tokens are not swept into
  // the APT→USDC convert; the LP's APT leg is still converted via the remove delta below.
  let claimRewardsHash: string | null = null;
  if (params.claimRewardsFirst && !dryRun) {
    try {
      const r = await executeHyperionClaimRewards({
        safeAddress: safe,
        position: toCanonicalAddress(params.position),
        dryRun: false,
      });
      claimRewardsHash = r.hash ?? null;
    } catch (e) {
      console.warn("[Yield AI] runHyperionCloseConvert: claim rewards failed (non-fatal)", e);
    }
  }

  const before = dryRun ? 0n : await getFaBalance(aptos, safe, nonUsdcMetadata);

  const closed = await runHyperionClose({
    safeAddress: safe,
    position: params.position,
    claimFirst: params.claimFirst,
    dryRun,
  });

  if (dryRun) {
    return { ...closed, claimRewardsHash, convertSwapHash: null, convertedAmountIn: "0", convertAmountOutMin: "0" };
  }

  const after = await getFaBalance(aptos, safe, nonUsdcMetadata);
  const delta = after > before ? after - before : 0n;

  let convertSwapHash: string | null = null;
  let convertAmountOutMin = 0n;
  if (delta > 0n) {
    const quotedOut = await getHyperionAmountOut({
      amountInBaseUnits: delta,
      fromMetadata: nonUsdcMetadata,
      toMetadata: usdc,
    });
    convertAmountOutMin = (quotedOut * (10_000n - BigInt(slippageBps))) / 10_000n;
    const swap = await executeSwapFaToFa({
      safeAddress: safe,
      feeTier: pool.feeTier,
      amountInBaseUnits: delta,
      amountOutMinBaseUnits: convertAmountOutMin,
      sqrtPriceLimit: SWAP_SQRT_PRICE_LIMIT,
      fromTokenMetadata: nonUsdcMetadata,
      toTokenMetadata: usdc,
      deadlineUnixSeconds: deadline(),
    });
    convertSwapHash = swap.hash ?? null;
  }

  return {
    ...closed,
    claimRewardsHash,
    convertSwapHash,
    convertedAmountIn: delta.toString(),
    convertAmountOutMin: convertAmountOutMin.toString(),
  };
}

/** Resolve the pool key that matches a tracked position by its (tokenA, tokenB). */
function matchPoolKeyForPosition(p: HyperionPositionView): HyperionPoolKey | null {
  const a = toCanonicalAddress(p.tokenA);
  const b = toCanonicalAddress(p.tokenB);
  for (const key of Object.keys(YIELD_AI_HYPERION_POOLS) as HyperionPoolKey[]) {
    const pool = YIELD_AI_HYPERION_POOLS[key];
    const pa = toCanonicalAddress(pool.tokenA);
    const pb = toCanonicalAddress(pool.tokenB);
    if ((a === pa && b === pb) || (a === pb && b === pa)) return key;
  }
  return null;
}

export type HyperionRecenterPositionResult = {
  position: string;
  poolKey: HyperionPoolKey | null;
  action: "skip-in-range" | "skip-no-pool" | "skip-pool-filter" | "skip-dust" | "recenter";
  currentTick?: number;
  outOfRange?: boolean;
  closeHashes?: { claimFeesHash: string | null; removeAllHash: string | null; convertSwapHash: string | null };
  usdcRecovered?: string;
  reopen?: Awaited<ReturnType<typeof runHyperionOpen>> | null;
  error?: string;
};

/**
 * Re-center one safe's Hyperion LP positions that have drifted out of range.
 *
 * Per open position: if the live tick is outside the position range (or within
 * `edgeBufferTicks` of an edge), close+convert the position to USDC, then re-open
 * a centered range with the exact USDC recovered (principal + fees + converted
 * non-USDC leg) — never pre-existing safe holdings. In-range positions are left
 * untouched. `dryRun` reports the decision without submitting.
 */
export async function runHyperionRecenter(params: {
  safeAddress: string;
  halfWidthTicks?: number;
  edgeBufferTicks?: number;
  slippageBps?: number;
  /** Minimum USDC recovered (base units) to bother re-opening. Skips dust. */
  minReopenUsdcBaseUnits?: bigint;
  /** Only touch positions in these pools (phased rollout, e.g. stables first). Undefined/empty = all. */
  poolKeys?: HyperionPoolKey[];
  dryRun?: boolean;
}): Promise<{ safeAddress: string; positions: HyperionRecenterPositionResult[] }> {
  const safe = toCanonicalAddress(params.safeAddress);
  const halfWidthTicks = Math.max(1, Math.trunc(Number(params.halfWidthTicks ?? DEFAULT_HALF_WIDTH_TICKS)));
  const edgeBufferTicks = Math.max(0, Math.trunc(Number(params.edgeBufferTicks ?? 0)));
  const minReopen = params.minReopenUsdcBaseUnits ?? 0n;
  const poolFilter = params.poolKeys?.length ? new Set(params.poolKeys) : null;
  const dryRun = Boolean(params.dryRun);

  const aptos = buildAptos();
  const usdc = toCanonicalAddress(USDC_FA_METADATA_MAINNET);
  const all = await readSafeHyperionPositions(safe);
  const open = all.filter((p) => !p.closed);

  const results: HyperionRecenterPositionResult[] = [];
  const tickCache = new Map<string, number>();

  for (const p of open) {
    const poolKey = matchPoolKeyForPosition(p);
    if (!poolKey) {
      results.push({ position: p.position, poolKey: null, action: "skip-no-pool" });
      continue;
    }
    if (poolFilter && !poolFilter.has(poolKey)) {
      results.push({ position: p.position, poolKey, action: "skip-pool-filter" });
      continue;
    }
    const pool = YIELD_AI_HYPERION_POOLS[poolKey];

    try {
      let currentTick = tickCache.get(pool.poolAddress);
      if (currentTick === undefined) {
        currentTick = await getPoolCurrentTick(pool.poolAddress);
        tickCache.set(pool.poolAddress, currentTick);
      }

      // Out of range, or within the edge buffer of either bound.
      const inRange = isPositionActive({ currentTick, tickLower: p.tickLower, tickUpper: p.tickUpper });
      const nearEdge =
        currentTick - p.tickLower <= edgeBufferTicks || p.tickUpper - currentTick <= edgeBufferTicks;
      const shouldRecenter = !inRange || nearEdge;

      if (!shouldRecenter) {
        results.push({ position: p.position, poolKey, action: "skip-in-range", currentTick, outOfRange: false });
        continue;
      }

      if (dryRun) {
        results.push({ position: p.position, poolKey, action: "recenter", currentTick, outOfRange: !inRange });
        continue;
      }

      const usdcBefore = await getFaBalance(aptos, safe, usdc);
      const closed = await runHyperionCloseConvert({
        safeAddress: safe,
        position: p.position,
        poolKey,
        claimFirst: true,
        slippageBps: params.slippageBps,
        dryRun: false,
      });
      const usdcAfter = await getFaBalance(aptos, safe, usdc);
      const recovered = usdcAfter > usdcBefore ? usdcAfter - usdcBefore : 0n;

      if (recovered < minReopen || recovered <= 0n) {
        results.push({
          position: p.position,
          poolKey,
          action: "skip-dust",
          currentTick,
          outOfRange: !inRange,
          closeHashes: {
            claimFeesHash: closed.claimFeesHash,
            removeAllHash: closed.removeAllHash,
            convertSwapHash: closed.convertSwapHash,
          },
          usdcRecovered: recovered.toString(),
          reopen: null,
        });
        continue;
      }

      const reopen = await runHyperionOpen({
        safeAddress: safe,
        usdcAmountInBaseUnits: recovered,
        poolKey,
        halfWidthTicks,
        slippageBps: params.slippageBps,
        dryRun: false,
      });

      results.push({
        position: p.position,
        poolKey,
        action: "recenter",
        currentTick,
        outOfRange: !inRange,
        closeHashes: {
          claimFeesHash: closed.claimFeesHash,
          removeAllHash: closed.removeAllHash,
          convertSwapHash: closed.convertSwapHash,
        },
        usdcRecovered: recovered.toString(),
        reopen,
      });
    } catch (err) {
      results.push({
        position: p.position,
        poolKey,
        action: "recenter",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { safeAddress: safe, positions: results };
}

export type HyperionRecenterDualPositionResult = {
  position: string;
  poolKey: HyperionPoolKey | null;
  action:
    | "skip-in-range"
    | "skip-no-pool"
    | "skip-too-young"
    | "skip-below-cost-gate"
    | "skip-pool-filter"
    | "skip-dust"
    | "recenter";
  currentTick?: number;
  outOfRange?: boolean;
  ageSeconds?: number;
  feesUsd?: number;
  recoveredA?: string;
  recoveredB?: string;
  closeHashes?: { claimFeesHash: string | null; removeAllHash: string | null };
  rebalanceSwapHash?: string | null;
  reopen?: Awaited<ReturnType<typeof runHyperionOpenDual>> | null;
  error?: string;
};

/**
 * Re-center a safe's Hyperion LP positions WITHOUT swaps (stable-pair friendly).
 *
 * Per open position: claim fees + remove all liquidity (both legs land in the safe),
 * then re-open a centered range with the EXACT recovered legs via dual mode — no USDC
 * round-trip, no zap swap. Halves the re-center cost vs the close→convert path and
 * avoids slippage on stable pairs. Only the legs freed by this close are redeployed
 * (measured as a balance delta), never pre-existing safe holdings.
 *
 * Gating (skipped when `forceRerange` is true — used for a manual band-width change):
 *  - re-center only when out of range or within `edgeBufferTicks` of an edge;
 *  - `minPositionAgeSeconds`: skip positions younger than this. The current position's
 *    `openedAt` is the age clock (a re-center opens a fresh position), so no off-chain
 *    store is needed for the throttle;
 *  - `minFeesUsd`: skip until this position has EARNED at least this much since it was
 *    opened — pending (uncollected) fees/rewards PLUS already-claimed fees/rewards, from
 *    vault events scoped to this position's address. Using pending-only would make the
 *    gate depend on the unrelated claim cron's cadence (a claim zeroes pending fees right
 *    before this check runs, even though that money is genuinely earned and sitting in
 *    the safe) — seen in production keeping a stable position stuck below the gate
 *    indefinitely. Claimed totals are scoped to this exact position's on-chain address,
 *    so a re-center still resets the gate to ~0 via a brand-new position object — no new
 *    flapping risk. This is the cost gate that stops flapping from eating the yield.
 *
 * `forceRerange` bypasses every gate and re-ranges all open positions to
 * `halfWidthTicks`, even if in range — use it to change the band width on demand.
 */
export async function runHyperionRecenterDual(params: {
  safeAddress: string;
  halfWidthTicks?: number;
  edgeBufferTicks?: number;
  minPositionAgeSeconds?: number;
  minFeesUsd?: number;
  forceRerange?: boolean;
  /** Swap only the recovered-leg imbalance to the new range's target ratio before the
   * dual add, so a drifted position redeploys fully instead of leaving the surplus leg
   * idle. Default true. Set false for a pure swap-free re-range of a balanced position. */
  rebalance?: boolean;
  slippageBps?: number;
  /** Only touch positions in these pools (phased rollout, e.g. stables first). Undefined/empty = all. */
  poolKeys?: HyperionPoolKey[];
  dryRun?: boolean;
}): Promise<{ safeAddress: string; positions: HyperionRecenterDualPositionResult[] }> {
  const safe = toCanonicalAddress(params.safeAddress);
  const halfWidthTicks = Math.max(2, Math.trunc(Number(params.halfWidthTicks ?? DEFAULT_HALF_WIDTH_TICKS)));
  const edgeBufferTicks = Math.max(0, Math.trunc(Number(params.edgeBufferTicks ?? 0)));
  const minAge = Math.max(0, Math.trunc(Number(params.minPositionAgeSeconds ?? 0)));
  const minFeesUsd = Math.max(0, Number(params.minFeesUsd ?? 0));
  const force = Boolean(params.forceRerange);
  const rebalance = params.rebalance !== false; // default true
  const rebalanceSlippageBps = clampSlippageBps(params.slippageBps ?? 50);
  const poolFilter = params.poolKeys?.length ? new Set(params.poolKeys) : null;
  const dryRun = Boolean(params.dryRun);

  const aptos = buildAptos();
  const usdc = toCanonicalAddress(USDC_FA_METADATA_MAINNET);
  const nowSec = Math.floor(Date.now() / 1000);
  const all = await readSafeHyperionPositions(safe);
  const open = all.filter((p) => !p.closed);

  // Per-position lifetime claimed fees/rewards (vault events, scoped to the
  // safe — see hyperionLpEvents.ts) so the cost gate below can count money
  // already claimed to the safe, not just what's still pending on-chain.
  const eventTotalsByPosition = await loadHyperionLpEventTotalsBySafe(safe);

  // Price the fee/reward legs for the cost gate (generic — works for any pool,
  // not just stables). Includes reward metadata (e.g. APT) so farm rewards —
  // pending AND claimed — count toward "earned", same as swap fees.
  const priceAddrs: string[] = [];
  for (const p of open) {
    priceAddrs.push(p.tokenA, p.tokenB);
    for (const r of p.pendingRewards ?? []) priceAddrs.push(r.metadata);
    const totals = eventTotalsByPosition.get(toCanonicalAddress(p.position));
    if (totals) for (const meta of totals.rewardsClaimed.keys()) priceAddrs.push(meta);
  }
  const prices = priceAddrs.length ? await fetchPriceMap(priceAddrs) : new Map<string, ClaimPriceInfo>();
  const feeUsd = (raw: string | undefined, addr: string): number => {
    const info = prices.get(normalizeAddress(addr));
    if (!info || raw == null) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? (n / 10 ** info.decimals) * info.usd : 0;
  };
  const rawUsd = (raw: bigint, addr: string): number => {
    const info = prices.get(normalizeAddress(addr));
    if (!info || raw <= 0n) return 0;
    return (Number(raw) / 10 ** info.decimals) * info.usd;
  };

  const results: HyperionRecenterDualPositionResult[] = [];
  const tickCache = new Map<string, number>();

  for (const p of open) {
    const poolKey = matchPoolKeyForPosition(p);
    if (!poolKey) {
      results.push({ position: p.position, poolKey: null, action: "skip-no-pool" });
      continue;
    }
    if (poolFilter && !poolFilter.has(poolKey)) {
      results.push({ position: p.position, poolKey, action: "skip-pool-filter" });
      continue;
    }
    const pool = YIELD_AI_HYPERION_POOLS[poolKey];

    try {
      let currentTick = tickCache.get(pool.poolAddress);
      if (currentTick === undefined) {
        currentTick = await getPoolCurrentTick(pool.poolAddress);
        tickCache.set(pool.poolAddress, currentTick);
      }

      const inRange = isPositionActive({ currentTick, tickLower: p.tickLower, tickUpper: p.tickUpper });
      const nearEdge =
        currentTick - p.tickLower <= edgeBufferTicks || p.tickUpper - currentTick <= edgeBufferTicks;
      const ageSeconds = Math.max(0, nowSec - (Number(p.openedAt) || 0));

      const pendingUsd =
        feeUsd(p.pendingFeeA, p.tokenA) +
        feeUsd(p.pendingFeeB, p.tokenB) +
        (p.pendingRewards ?? []).reduce((sum, r) => sum + feeUsd(r.amount, r.metadata), 0);
      const evTotals = eventTotalsByPosition.get(toCanonicalAddress(p.position));
      let claimedUsd = 0;
      if (evTotals) {
        claimedUsd = rawUsd(evTotals.feesClaimedA, p.tokenA) + rawUsd(evTotals.feesClaimedB, p.tokenB);
        for (const [meta, amount] of evTotals.rewardsClaimed) claimedUsd += rawUsd(amount, meta);
      }
      // Total earned since this position was opened — see the cost-gate note
      // in the doc comment above for why pending-only undercounts.
      const earnedUsd = pendingUsd + claimedUsd;
      const base = { position: p.position, poolKey, currentTick, outOfRange: !inRange, ageSeconds, feesUsd: earnedUsd };

      if (!force) {
        if (inRange && !nearEdge) {
          results.push({ ...base, action: "skip-in-range", outOfRange: false });
          continue;
        }
        if (ageSeconds < minAge) {
          results.push({ ...base, action: "skip-too-young" });
          continue;
        }
        if (earnedUsd < minFeesUsd) {
          results.push({ ...base, action: "skip-below-cost-gate" });
          continue;
        }
      }

      if (dryRun) {
        results.push({ ...base, action: "recenter", reopen: null });
        continue;
      }

      // Non-USDC leg is whichever token isn't USDC. Measure only the legs this close
      // frees (delta), so pre-existing safe balances are never redeployed.
      const nonUsdc = toCanonicalAddress(pool.tokenA) === usdc ? pool.tokenB : pool.tokenA;
      const beforeNon = await getFaBalance(aptos, safe, nonUsdc);
      const beforeUsdc = await getFaBalance(aptos, safe, usdc);

      const closed = await runHyperionClose({ safeAddress: safe, position: p.position, claimFirst: true, dryRun: false });

      const afterNon = await getFaBalance(aptos, safe, nonUsdc);
      const afterUsdc = await getFaBalance(aptos, safe, usdc);
      const recoveredNon = afterNon > beforeNon ? afterNon - beforeNon : 0n;
      const recoveredUsdc = afterUsdc > beforeUsdc ? afterUsdc - beforeUsdc : 0n;
      const closeHashes = { claimFeesHash: closed.claimFeesHash, removeAllHash: closed.removeAllHash };

      if (recoveredNon <= 0n && recoveredUsdc <= 0n) {
        results.push({ ...base, action: "skip-dust", closeHashes, recoveredA: "0", recoveredB: "0", reopen: null });
        continue;
      }

      // Plan the new centered range once: explicit ticks for the dual add + the target
      // value-fraction for the rebalance.
      const plan = await planHyperionOpen({ poolKey, usdcAmountIn: 0n, halfWidthTicks });
      const decimalsNon = toCanonicalAddress(pool.tokenA) === usdc ? pool.decimalsB : pool.decimalsA;
      const priceNon = prices.get(normalizeAddress(nonUsdc))?.usd ?? 1;

      // Rebalance ONLY the recovered-leg imbalance to the range's target ratio (not the
      // whole leg) so a drifted position redeploys fully instead of leaving the surplus
      // leg idle. The swap touches the safe total, but we redeploy only the delta below,
      // so pre-existing idle balances stay untouched.
      let rebalanceSwapHash: string | null = null;
      if (rebalance) {
        const nonVal = (Number(recoveredNon) / 10 ** decimalsNon) * priceNon;
        const usdcVal = Number(recoveredUsdc) / 1e6;
        const totalVal = nonVal + usdcVal;
        const R = Math.max(
          0,
          Math.min(
            1,
            computeZapValueFractionToNonUsdc({
              currentTick: plan.currentTick,
              tickLower: plan.tickLower,
              tickUpper: plan.tickUpper,
            })
          )
        );
        const targetNonVal = R * totalVal;
        const MIN_REBALANCE_USD = 1;
        const doSwap = async (from: string, to: string, amountInBaseUnits: bigint): Promise<string | null> => {
          if (amountInBaseUnits <= 0n) return null;
          let outMin = 0n;
          try {
            const q = await getHyperionAmountOut({ amountInBaseUnits, fromMetadata: from, toMetadata: to });
            outMin = (q * (10_000n - BigInt(rebalanceSlippageBps))) / 10_000n;
          } catch {
            outMin = 0n;
          }
          // Direction-aware sqrt-price limit. zeroForOne (token0 -> token1) needs the
          // MIN-side limit; oneForZero (token1 -> token0) the MAX-side. The rebalance
          // can swap EITHER way (USDC -> non-USDC or non-USDC -> USDC), so a single fixed
          // SWAP_SQRT_PRICE_LIMIT (MIN-side) aborts the USDC -> non-USDC leg (vault 0xe).
          // The shared helper picks per-direction limits with fallbacks. token0 == pool.tokenA.
          const direction: SwapFaToFaDirection =
            toCanonicalAddress(from) === toCanonicalAddress(pool.tokenA) ? "zeroForOne" : "oneForZero";
          const s = await submitSwapFaToFaWithFallbackLimits({
            network: "mainnet",
            safe,
            feeTier: Number(pool.feeTier),
            amountIn: amountInBaseUnits,
            amountOutMin: outMin,
            fromMetadata: from,
            toMetadata: to,
            deadline: deadline(),
            direction,
          });
          return s.swapTxHash ?? null;
        };
        if (nonVal - targetNonVal > MIN_REBALANCE_USD) {
          const swapIn = BigInt(Math.floor(((nonVal - targetNonVal) / priceNon) * 10 ** decimalsNon));
          rebalanceSwapHash = await doSwap(nonUsdc, usdc, swapIn);
        } else if (targetNonVal - nonVal > MIN_REBALANCE_USD) {
          const swapIn = BigInt(Math.floor((targetNonVal - nonVal) * 1e6));
          rebalanceSwapHash = await doSwap(usdc, nonUsdc, swapIn);
        }
      }

      // Deployable amounts = delta from the pre-close balances (recovered ± rebalance
      // swap). Excludes pre-existing idle, so multi-position safes stay correct.
      const deployNonBal = await getFaBalance(aptos, safe, nonUsdc);
      const deployUsdcBal = await getFaBalance(aptos, safe, usdc);
      const deployNon = deployNonBal > beforeNon ? deployNonBal - beforeNon : 0n;
      const deployUsdc = deployUsdcBal > beforeUsdc ? deployUsdcBal - beforeUsdc : 0n;

      const usdcIsA = toCanonicalAddress(pool.tokenA) === usdc;
      let amountA = usdcIsA ? deployUsdc : deployNon;
      let amountB = usdcIsA ? deployNon : deployUsdc;

      // Cap token_a to what the recovered token_b can actually pair with at the
      // live tick. The rebalance swap above leaves token_b short of the exact
      // split by its fee/slippage/price drift, and a token_b shortfall would
      // abort the reopen (see DUAL_REOPEN_B_PAD) AFTER the position is already
      // closed — stranding the legs idle in the safe with no retry.
      const pairingTick = rebalanceSwapHash
        ? await getPoolCurrentTick(pool.poolAddress) // the swap itself moves the tick
        : plan.currentTick;
      if (pairingTick >= plan.tickUpper) {
        amountA = 0n; // price above range — the position takes only token_b
      } else if (pairingTick <= plan.tickLower) {
        amountB = 0n; // price below range — the position takes only token_a
      } else {
        const rA = computeZapValueFractionToNonUsdc({
          currentTick: pairingTick,
          tickLower: plan.tickLower,
          tickUpper: plan.tickUpper,
        });
        if (rA > 0 && rA < 1) {
          const priceA = tickToTokenAPriceUsdc(pairingTick, pool.decimalsA, pool.decimalsB);
          const bPerA = priceA * ((1 - rA) / rA); // token_b needed per 1 token_a
          const aHuman = baseUnitsToNumber(amountA, pool.decimalsA);
          const bHuman = baseUnitsToNumber(amountB, pool.decimalsB);
          if (bHuman < aHuman * bPerA * DUAL_REOPEN_B_PAD) {
            const aCap = bHuman / DUAL_REOPEN_B_PAD / bPerA;
            amountA = BigInt(Math.floor(aCap * 10 ** pool.decimalsA));
          }
        }
      }

      const reopen = await runHyperionOpenDual({
        safeAddress: safe,
        amountABaseUnits: amountA,
        amountBBaseUnits: amountB,
        poolKey,
        tickLower: plan.tickLower,
        tickUpper: plan.tickUpper,
        dryRun: false,
      });

      results.push({
        ...base,
        action: "recenter",
        closeHashes,
        rebalanceSwapHash,
        recoveredA: amountA.toString(),
        recoveredB: amountB.toString(),
        reopen,
      });
    } catch (err) {
      results.push({
        position: p.position,
        poolKey,
        action: "recenter",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { safeAddress: safe, positions: results };
}
