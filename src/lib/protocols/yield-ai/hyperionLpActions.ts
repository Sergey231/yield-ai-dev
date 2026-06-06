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
  getPoolCurrentTick,
  isPositionActive,
  planHyperionOpen,
  readSafeHyperionPositions,
  type HyperionPositionView,
} from "@/lib/protocols/yield-ai/hyperionLp";
import {
  executeHyperionAddDual,
  executeHyperionClaimFees,
  executeHyperionClaimRewards,
  executeHyperionOpenDual,
  executeHyperionOpenZapUsdc,
  executeHyperionRemoveAll,
  executeSwapAptToUsdc,
  executeSwapFaToFa,
} from "@/lib/protocols/yield-ai/vaultExecutor";
import { PanoraPricesService } from "@/lib/services/panora/prices";

/** APT FA metadata (farm rewards report APT via the 0xa paired metadata). */
const APT_FA_METADATA = "0x000000000000000000000000000000000000000000000000000000000000000a";
import { getFaBalance } from "@/lib/protocols/yield-ai/engine/stateComputer";

export const DEFAULT_HALF_WIDTH_TICKS = 250; // ~±2.5% on WBTC/USDC (spacing 10)
export const DEFAULT_SWAP_SLIPPAGE_BPS = 100; // 1.0% on the balancing swap
const DEADLINE_SECS = 600;

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
  const halfWidthTicks = Math.max(10, Math.trunc(Number(params.halfWidthTicks ?? DEFAULT_HALF_WIDTH_TICKS)));
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
  if (plan.swapAmountIn > 0n) {
    const quotedOut = await getHyperionAmountOut({
      amountInBaseUnits: plan.swapAmountIn,
      fromMetadata: plan.pool.tokenB, // USDC
      toMetadata: plan.pool.tokenA, // non-USDC leg
    });
    swapAmountOutMin = (quotedOut * (10_000n - BigInt(slippageBps))) / 10_000n;
  }

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
    swapAmountOutMin: swapAmountOutMin.toString(),
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
  const halfWidthTicks = Math.max(10, Math.trunc(Number(params.halfWidthTicks ?? DEFAULT_HALF_WIDTH_TICKS)));
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
 * own range (no range planning); `min = 0` so the surplus leg returns to the
 * safe as leftover.
 */
export async function runHyperionAddDual(params: {
  safeAddress: string;
  position: string;
  amountABaseUnits: bigint;
  amountBBaseUnits: bigint;
  dryRun?: boolean;
}) {
  const result = await executeHyperionAddDual({
    safeAddress: toCanonicalAddress(params.safeAddress),
    position: toCanonicalAddress(params.position),
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

/**
 * Auto-claim pass for one safe: per open position, if uncollected (fees +
 * rewards) value ≥ `minClaimUsd`, claim fees (perf cut taken) and farm rewards.
 * Claimed fees stay in the safe (keep). Claimed APT rewards are then swapped to
 * USDC (delta only — measured before/after, never pre-existing APT). No
 * re-center, no compounding (per current policy).
 */
export async function runHyperionAutoClaim(params: {
  safeAddress: string;
  minClaimUsd?: number;
  minRewardClaimUsd?: number;
  minRewardSwapUsd?: number;
  swapRewardsToUsdc?: boolean;
  dryRun?: boolean;
}) {
  const safe = toCanonicalAddress(params.safeAddress);
  const minClaimUsd = params.minClaimUsd ?? DEFAULT_AUTO_CLAIM_MIN_USD;
  const minRewardClaimUsd = params.minRewardClaimUsd ?? minClaimUsd;
  const minRewardSwapUsd = params.minRewardSwapUsd ?? minRewardClaimUsd;
  const swapRewardsToUsdc = params.swapRewardsToUsdc !== false;
  const dryRun = Boolean(params.dryRun);

  const all = await readSafeHyperionPositions(safe);
  const open = all.filter((p) => !p.closed);
  if (open.length === 0) {
    return { safeAddress: safe, positions: [] as HyperionAutoClaimPositionResult[], rewardSwap: null };
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

  const results: HyperionAutoClaimPositionResult[] = [];
  let anyRewardsClaimed = false;

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

  return { safeAddress: safe, positions: results, rewardSwap };
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
  slippageBps?: number;
  dryRun?: boolean;
}) {
  const safe = toCanonicalAddress(params.safeAddress);
  const poolKey: HyperionPoolKey = params.poolKey ?? "wbtc_usdc";
  const pool = YIELD_AI_HYPERION_POOLS[poolKey];
  const slippageBps = clampSlippageBps(params.slippageBps);
  const dryRun = Boolean(params.dryRun);

  // Non-USDC leg is the token that is not USDC in this pool.
  const usdc = toCanonicalAddress(USDC_FA_METADATA_MAINNET);
  const nonUsdcMetadata =
    toCanonicalAddress(pool.tokenA) === usdc ? pool.tokenB : pool.tokenA;

  const aptos = buildAptos();
  const before = dryRun ? 0n : await getFaBalance(aptos, safe, nonUsdcMetadata);

  const closed = await runHyperionClose({
    safeAddress: safe,
    position: params.position,
    claimFirst: params.claimFirst,
    dryRun,
  });

  if (dryRun) {
    return { ...closed, convertSwapHash: null, convertedAmountIn: "0", convertAmountOutMin: "0" };
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
  action: "skip-in-range" | "skip-no-pool" | "skip-dust" | "recenter";
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
  dryRun?: boolean;
}): Promise<{ safeAddress: string; positions: HyperionRecenterPositionResult[] }> {
  const safe = toCanonicalAddress(params.safeAddress);
  const halfWidthTicks = Math.max(10, Math.trunc(Number(params.halfWidthTicks ?? DEFAULT_HALF_WIDTH_TICKS)));
  const edgeBufferTicks = Math.max(0, Math.trunc(Number(params.edgeBufferTicks ?? 0)));
  const minReopen = params.minReopenUsdcBaseUnits ?? 0n;
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
