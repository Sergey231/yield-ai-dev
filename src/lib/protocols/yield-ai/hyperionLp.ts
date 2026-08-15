/**
 * Hyperion CLMM LP helpers for the AI agent vault.
 *
 * Pure math + on-chain reads used to:
 *  - read the pool's current tick,
 *  - derive a tick range centered on the current tick for a given width,
 *  - compute the single-token (USDC) zap swap split (`swap_amount_in`),
 *  - decide whether a position is active (in range) or inactive (out of range).
 *
 * The contract entry `execute_hyperion_open_zap_usdc` takes an off-chain computed
 * `swap_amount_in` (the USDC portion to swap to the non-USDC leg before adding
 * liquidity). Because the contract returns leftovers to the safe, an approximate
 * split is safe — leftovers just come back. We still compute it accurately to
 * minimize dust.
 *
 * Tick note: Hyperion ticks are i32 but for BTC/ETH/USDC pools the active range
 * is large and positive (~66_000 for WBTC/USDC), so we treat them as positive u32.
 * Ranges must be multiples of the pool `tickSpacing`.
 */

const APTOS_FULLNODE = "https://api.mainnet.aptoslabs.com/v1";

import {
  HYPERION_POOL_VIEWS,
  YIELD_AI_HYPERION_POOLS,
  YIELD_AI_HYPERION_VIEWS,
  type HyperionPoolKey,
} from "@/lib/constants/yieldAiVault";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";

const APTOS_API_KEY = process.env.APTOS_API_KEY;

async function aptosView<T = unknown>(body: {
  function: string;
  type_arguments?: string[];
  arguments: unknown[];
}): Promise<T> {
  const res = await fetch(`${APTOS_FULLNODE}/view`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(APTOS_API_KEY ? { Authorization: `Bearer ${APTOS_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      function: body.function,
      type_arguments: body.type_arguments ?? [],
      arguments: body.arguments,
    }),
  });
  if (!res.ok) {
    throw new Error(`Aptos view ${body.function} HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return (await res.json()) as T;
}

const U32 = 4294967296; // 2^32

/**
 * Hyperion ticks are i32 but views return them as u32. Values ≥ 2^31 are
 * negative ticks (e.g. APT/USDC ≈ -47800 → 4294919488). Convert to signed.
 */
export function i32FromU32(n: number): number {
  return n >= 2147483648 ? n - U32 : n;
}

/** Convert a signed tick back to its u32 representation for on-chain args. */
export function u32FromI32(n: number): number {
  return n < 0 ? n + U32 : n;
}

/** Read the pool's current tick (signed i32; can be negative, e.g. APT/USDC). */
export async function getPoolCurrentTick(poolAddress: string): Promise<number> {
  const out = await aptosView<[number | string, string]>({
    function: HYPERION_POOL_VIEWS.currentTickAndPrice,
    arguments: [poolAddress],
  });
  const tick = Array.isArray(out) ? out[0] : undefined;
  const n = Number(tick);
  if (!Number.isFinite(n)) {
    throw new Error(`current_tick_and_price returned non-numeric tick: ${JSON.stringify(out)}`);
  }
  return i32FromU32(n);
}

function snapDown(tick: number, spacing: number): number {
  return Math.floor(tick / spacing) * spacing;
}

/**
 * Build a tick range centered on `currentTick`, half-width `halfWidthTicks`,
 * snapped to `spacing`. Guarantees lower < upper.
 */
export function computeCenteredRange(params: {
  currentTick: number;
  halfWidthTicks: number;
  spacing: number;
}): { tickLower: number; tickUpper: number } {
  const { currentTick, halfWidthTicks, spacing } = params;
  const tickLower = snapDown(currentTick - halfWidthTicks, spacing);
  let tickUpper = snapDown(currentTick + halfWidthTicks, spacing);
  if (tickUpper <= tickLower) tickUpper = tickLower + spacing;
  return { tickLower, tickUpper };
}

/** sqrt price (real, not Q64.64) for a tick: 1.0001^(tick/2). */
function tickToSqrtPrice(tick: number): number {
  return Math.pow(1.0001, tick / 2);
}

/**
 * Fraction of total USDC value that should end up in the non-USDC leg for a
 * CLMM position at `currentTick` over `[tickLower, tickUpper]`.
 *
 * Derived from the standard v3 amounts:
 *   amount_a (non-USDC) value ∝ sp - sp^2/spb
 *   amount_b (USDC)      value ∝ sp - spa
 * R = valueA / (valueA + valueB). Clamped to [0, 1].
 *
 * - currentTick <= tickLower → position is all USDC side or all non-USDC side
 *   depending on token order. We clamp so callers get a sane 0/1 and can decide
 *   single-sided behavior.
 */
export function computeZapValueFractionToNonUsdc(params: {
  currentTick: number;
  tickLower: number;
  tickUpper: number;
}): number {
  const { currentTick, tickLower, tickUpper } = params;
  const sp = tickToSqrtPrice(currentTick);
  const spa = tickToSqrtPrice(tickLower);
  const spb = tickToSqrtPrice(tickUpper);
  const valA = sp - (sp * sp) / spb; // non-USDC (token_a) value
  const valB = sp - spa; // USDC (token_b) value
  const denom = valA + valB;
  if (!Number.isFinite(denom) || denom <= 0) return 0;
  const r = valA / denom;
  if (r < 0) return 0;
  if (r > 1) return 1;
  return r;
}

/**
 * Safety haircut on the zap swap (bps). We deliberately swap slightly LESS
 * USDC→non-USDC than the exact split.
 *
 * Why: the balancing swap itself nudges the pool tick (buying the non-USDC leg
 * pushes its price up), so by the time `add_liquidity` runs, the position needs
 * a bit more USDC (token_b) than the exact split left behind — Hyperion aborts
 * with `pool_v3::EAMOUNT_B_INPUT_LESS`. We observed this on a 9-USDC open while a
 * 4-USDC open (smaller absolute mismatch) slipped through. Swapping a touch less
 * keeps USDC as the long side; the extra USDC is returned to the safe as
 * leftover (single-token zap returns leftovers — see HYPERION_LP_FRONTEND §1.5).
 */
export const ZAP_SWAP_SAFETY_BPS = 200; // swap 2% less to avoid token_b shortfall

/**
 * Compute the `swap_amount_in` (USDC base units to swap to the non-USDC leg)
 * for an open/add zap of `usdcAmountIn` USDC base units.
 *
 * For a USDC-is-token_b pool (WBTC/USDC), the non-USDC leg value fraction R maps
 * directly to the USDC portion to swap. Returns 0 when the range is entirely on
 * the USDC side (single-sided, no swap needed). A small safety haircut
 * (`ZAP_SWAP_SAFETY_BPS`) biases toward leaving USDC so `add_liquidity` never
 * comes up short on token_b.
 */
export function computeZapSwapAmountIn(params: {
  currentTick: number;
  tickLower: number;
  tickUpper: number;
  usdcAmountIn: bigint;
  safetyBps?: number;
}): bigint {
  const { currentTick, tickLower, tickUpper, usdcAmountIn } = params;
  // Range entirely below current tick (USDC side for token_b pools): no swap.
  if (currentTick >= tickUpper) return 0n;
  // Range entirely above current tick: would need all non-USDC; swap nearly all.
  const r = computeZapValueFractionToNonUsdc({ currentTick, tickLower, tickUpper });
  let swap = (usdcAmountIn * BigInt(Math.round(r * 1_000_000))) / 1_000_000n;
  // Apply the safety haircut (only when an actual two-sided swap is needed).
  const safetyBps = params.safetyBps ?? ZAP_SWAP_SAFETY_BPS;
  if (swap > 0n && safetyBps > 0) {
    swap = (swap * BigInt(10_000 - safetyBps)) / 10_000n;
  }
  if (swap < 0n) return 0n;
  if (swap > usdcAmountIn) return usdcAmountIn;
  return swap;
}

/** A position is active (earning fees) iff the current tick is inside its range. */
export function isPositionActive(params: {
  currentTick: number;
  tickLower: number;
  tickUpper: number;
}): boolean {
  const { currentTick, tickLower, tickUpper } = params;
  return currentTick >= tickLower && currentTick < tickUpper;
}

export function getHyperionPoolConfig(key: HyperionPoolKey) {
  return YIELD_AI_HYPERION_POOLS[key];
}

/** Snap an explicit tick to spacing and guarantee lower < upper. */
function snapExplicitRange(params: {
  tickLower: number;
  tickUpper: number;
  spacing: number;
}): { tickLower: number; tickUpper: number } {
  const { spacing } = params;
  const tickLower = snapDown(params.tickLower, spacing);
  let tickUpper = snapDown(params.tickUpper, spacing);
  if (tickUpper <= tickLower) tickUpper = tickLower + spacing;
  return { tickLower, tickUpper };
}

/**
 * One-shot planner for opening an LP position from USDC.
 * Reads current tick on-chain right before submit (avoids the tick race).
 *
 * Range selection: pass `tickLower`/`tickUpper` for an explicit (possibly
 * asymmetric) range — used by the %/price UI modes — otherwise a centered range
 * of half-width `halfWidthTicks` is derived from the live tick.
 */
export async function planHyperionOpen(params: {
  poolKey: HyperionPoolKey;
  usdcAmountIn: bigint;
  halfWidthTicks?: number;
  tickLower?: number;
  tickUpper?: number;
}): Promise<{
  tickLower: number;
  tickUpper: number;
  swapAmountIn: bigint;
  currentTick: number;
  pool: (typeof YIELD_AI_HYPERION_POOLS)[HyperionPoolKey];
}> {
  const pool = getHyperionPoolConfig(params.poolKey);
  const currentTick = await getPoolCurrentTick(pool.poolAddress);

  const explicit =
    Number.isFinite(params.tickLower as number) && Number.isFinite(params.tickUpper as number);
  const { tickLower, tickUpper } = explicit
    ? snapExplicitRange({
        tickLower: Math.trunc(params.tickLower as number),
        tickUpper: Math.trunc(params.tickUpper as number),
        spacing: pool.tickSpacing,
      })
    : computeCenteredRange({
        currentTick,
        halfWidthTicks: Math.max(1, Math.trunc(Number(params.halfWidthTicks ?? 250))),
        spacing: pool.tickSpacing,
      });

  const swapAmountIn = computeZapSwapAmountIn({
    currentTick,
    tickLower,
    tickUpper,
    usdcAmountIn: params.usdcAmountIn,
  });
  return { tickLower, tickUpper, swapAmountIn, currentTick, pool };
}

export type HyperionPositionView = {
  position: string;
  tokenA: string;
  tokenB: string;
  feeTier: number;
  tickLower: number;
  tickUpper: number;
  principalUsdc: string;
  openedAt: string;
  closed: boolean;
  liquidity: string;
  amountA: string;
  amountB: string;
  active: boolean;
  /** Uncollected swap fees (raw base units), [tokenA, tokenB]. Open positions only. */
  pendingFeeA?: string;
  pendingFeeB?: string;
  /** Uncollected farm rewards (raw base units) by reward FA metadata. Open positions only. */
  pendingRewards?: Array<{ metadata: string; amount: string }>;
};

type RawPositionView = {
  position: string;
  token_a: string;
  token_b: string;
  fee_tier: number | string;
  tick_lower: number | string;
  tick_upper: number | string;
  principal_usdc: string;
  opened_at: string;
  closed: boolean;
  liquidity: string;
  amount_a: string;
  amount_b: string;
};

/** Resolve the configured pool key whose (tokenA, tokenB) match a position. */
function matchPoolKey(tokenA: string, tokenB: string): HyperionPoolKey | null {
  const a = toCanonicalAddress(tokenA);
  const b = toCanonicalAddress(tokenB);
  for (const key of Object.keys(YIELD_AI_HYPERION_POOLS) as HyperionPoolKey[]) {
    const p = YIELD_AI_HYPERION_POOLS[key];
    const pa = toCanonicalAddress(p.tokenA);
    const pb = toCanonicalAddress(p.tokenB);
    if ((a === pa && b === pb) || (a === pb && b === pa)) return key;
  }
  return null;
}

/**
 * Read all Hyperion LP positions tracked on a safe (open + closed), enriched
 * with live composition and active/inactive flag. Read-only (no executor).
 */
export async function readSafeHyperionPositions(safeAddress: string): Promise<HyperionPositionView[]> {
  const configExists = await aptosView<[boolean]>({
    function: YIELD_AI_HYPERION_VIEWS.configExists,
    arguments: [safeAddress],
  }).then((r) => Boolean(r?.[0])).catch(() => false);
  if (!configExists) return [];

  const positionsRes = await aptosView<[string[]]>({
    function: YIELD_AI_HYPERION_VIEWS.getPositions,
    arguments: [safeAddress],
  });
  const addresses = Array.isArray(positionsRes?.[0]) ? positionsRes[0] : [];

  // Cache current tick per pool address.
  const tickCache = new Map<string, number>();

  const out: HyperionPositionView[] = [];
  for (const posAddr of addresses) {
    const viewRes = await aptosView<[RawPositionView]>({
      function: YIELD_AI_HYPERION_VIEWS.getPosition,
      arguments: [safeAddress, posAddr],
    }).catch(() => null);
    const raw = viewRes?.[0];
    if (!raw) continue;

    const tickLower = i32FromU32(Number(raw.tick_lower));
    const tickUpper = i32FromU32(Number(raw.tick_upper));

    const poolKey = matchPoolKey(raw.token_a, raw.token_b);
    let active = false;
    if (poolKey && !raw.closed) {
      const pool = YIELD_AI_HYPERION_POOLS[poolKey];
      let currentTick = tickCache.get(pool.poolAddress);
      if (currentTick === undefined) {
        currentTick = await getPoolCurrentTick(pool.poolAddress).catch(() => NaN);
        tickCache.set(pool.poolAddress, currentTick);
      }
      if (Number.isFinite(currentTick)) {
        active = isPositionActive({ currentTick, tickLower, tickUpper });
      }
    }

    // Uncollected fees + farm rewards (on-chain) for open positions only.
    // Closed positions have no live object — the views abort, so skip them.
    let pendingFeeA: string | undefined;
    let pendingFeeB: string | undefined;
    let pendingRewards: Array<{ metadata: string; amount: string }> | undefined;
    if (!raw.closed) {
      const feesRes = await aptosView<[Array<string | number>]>({
        function: HYPERION_POOL_VIEWS.getPendingFees,
        arguments: [posAddr],
      }).catch(() => null);
      const feeVec = feesRes?.[0];
      if (Array.isArray(feeVec)) {
        pendingFeeA = String(feeVec[0] ?? "0");
        pendingFeeB = String(feeVec[1] ?? "0");
      }

      const rewardsRes = await aptosView<[Array<{ amount_owed?: string | number; reward_fa?: { inner?: string } }>]>({
        function: HYPERION_POOL_VIEWS.getPendingRewards,
        arguments: [posAddr],
      }).catch(() => null);
      const rewardVec = rewardsRes?.[0];
      if (Array.isArray(rewardVec)) {
        pendingRewards = rewardVec
          .map((r) => ({ metadata: String(r?.reward_fa?.inner ?? ""), amount: String(r?.amount_owed ?? "0") }))
          .filter((r) => r.metadata && r.amount !== "0");
      }
    }

    out.push({
      position: posAddr,
      tokenA: raw.token_a,
      tokenB: raw.token_b,
      feeTier: Number(raw.fee_tier),
      tickLower,
      tickUpper,
      principalUsdc: String(raw.principal_usdc),
      openedAt: String(raw.opened_at),
      closed: Boolean(raw.closed),
      liquidity: String(raw.liquidity),
      amountA: String(raw.amount_a),
      amountB: String(raw.amount_b),
      active,
      pendingFeeA,
      pendingFeeB,
      pendingRewards,
    });
  }
  return out;
}
