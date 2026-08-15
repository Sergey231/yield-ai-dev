/**
 * LP-hedge delta-neutral ADD (top-up with USDC).
 *
 * Grows an EXISTING LP-DN cycle from safe USDC: swap ~the range split USDC→base via the proven
 * router path, dual-add into the SAME Hyperion position (its own range — no re-range), then grow
 * the Decibel short to the new live LP base via `rehedgeLpDeltaNeutralCore` (bandBps=0 so the
 * resize always runs; the margin guard still applies to the grow). The whole add lands as ONE
 * `strategy_journal` LIQUIDITY_ADD action with usdc_delta = the actual USDC value added to the LP.
 *
 * Cost-basis extras are bumped so "deposited" stays correct:
 *   - `spot_usdc`          += actual added LP value (base@mark + USDC leg actually consumed)
 *   - `decibel_margin_open` += the grown short notional @1x (only when the grow ran)
 *
 * NOT a re-range: adding into a range the price has drifted to the edge of may be a worse deal
 * than close+reopen around the current price — the caller (UI) should surface where the price
 * sits in the range. Mainnet-only. Private-beta: the ROUTE gates the owner allowlist.
 */
import { normalizeAddress, toCanonicalAddress } from "@/lib/utils/addressNormalization";
import { submitExecutorEntryFunction } from "@/lib/protocols/decibel/executorSubmit";
import {
  ACTION_KIND,
  CYCLE_SPOT_USDC_KEY,
  STRATEGY_JOURNAL_ENTRIES,
  fetchCycleExtraU64,
  fetchOpenCycles,
  strategyIdBytes,
} from "@/lib/protocols/yield-ai/strategyJournal";
import { readSafeHyperionPositions } from "@/lib/protocols/yield-ai/hyperionLp";
import { runHyperionAddViaDualSwap } from "@/lib/protocols/yield-ai/hyperionLpActions";
import { assertOwnerManageAuth } from "@/lib/protocols/yield-ai/manageAuthServer";
import { aptosClient, fetchDecibel, normalizeMarkets } from "@/lib/protocols/decibel/lpDeltaNeutralOpen";
import { rehedgeLpDeltaNeutralCore } from "@/lib/protocols/decibel/lpDeltaNeutralRehedge";

const DECIBEL_API_BASE_URL =
  process.env.DECIBEL_API_BASE_URL || "https://api.testnet.aptoslabs.com/decibel";

export type LpDeltaNeutralAddParams = {
  owner: string;
  safeAddress: string;
  subaccount: string;
  cycleId: string | number;
  /** USDC to add, base units (6 dp). */
  usdcAmountInBaseUnits: bigint;
  slippageBps?: number;
  /** Plan only — no swap, no add, no order. */
  dryRun?: boolean;
  auth: unknown;
};

export async function addLpDeltaNeutral(params: LpDeltaNeutralAddParams) {
  const owner = toCanonicalAddress(params.owner);
  const safe = toCanonicalAddress(params.safeAddress);
  const subaccount = toCanonicalAddress(params.subaccount);
  const cycleId = String(params.cycleId);
  const dryRun = Boolean(params.dryRun);

  if (DECIBEL_API_BASE_URL.includes("testnet")) {
    throw new Error("LP-hedge delta-neutral is mainnet-only.");
  }
  if (params.usdcAmountInBaseUnits <= 0n) {
    throw new Error("usdcAmountInBaseUnits must be > 0");
  }

  const { ownerAddress: verifiedOwner } = await assertOwnerManageAuth({
    action: "decibel_dn_lp_add",
    fields: {
      safeAddress: params.safeAddress,
      subaccount: params.subaccount,
      cycleId,
      usdcAmountInBaseUnits: params.usdcAmountInBaseUnits.toString(),
    },
    auth: params.auth,
    safeAddress: safe,
  });
  if (normalizeAddress(verifiedOwner) !== normalizeAddress(owner)) {
    throw new Error("owner does not match the signed authorization");
  }

  const aptos = aptosClient();

  // 1) The cycle must be open and LP-backed; its LP position is the add target.
  const cycle = (await fetchOpenCycles(aptos, safe)).find((c) => String(c.cycleId) === cycleId);
  if (!cycle) throw new Error(`Open cycle #${cycleId} not found for this safe`);
  const lpPosition = toCanonicalAddress(cycle.lpPosition);
  if (!lpPosition || /^0x0+$/.test(normalizeAddress(lpPosition))) {
    throw new Error(`Cycle #${cycleId} has no LP leg (not an LP-hedge cycle)`);
  }

  // 2) Mark price for valuing the added base leg (same source as open/rehedge).
  const markets = normalizeMarkets(await fetchDecibel("/api/v1/markets"));
  const market = markets.find(
    (m) =>
      m.market_addr &&
      normalizeAddress(toCanonicalAddress(m.market_addr)) ===
        normalizeAddress(toCanonicalAddress(cycle.perpMarket))
  );
  if (!market?.market_addr) throw new Error("Perp market config not found for this cycle");
  const prices = (await fetchDecibel(
    `/api/v1/prices?market=${encodeURIComponent(market.market_addr)}`
  )) as Array<{ mark_px?: number; mid_px?: number }>;
  const markPx = Number(prices?.[0]?.mark_px ?? prices?.[0]?.mid_px ?? NaN);
  if (!Number.isFinite(markPx) || markPx <= 0) throw new Error("Failed to resolve mark price");

  // 3) LP composition before (to measure what the add actually consumed — leftovers return
  // to the safe and must not count toward the cost basis).
  const findLp = async () =>
    (await readSafeHyperionPositions(safe)).find(
      (p) => toCanonicalAddress(p.position) === lpPosition
    );
  const lpBefore = await findLp();
  if (!lpBefore || lpBefore.closed) throw new Error(`LP position ${lpPosition} is not open on this safe`);

  // 4) Add into the SAME position via the dual-swap workaround.
  const addResult = await runHyperionAddViaDualSwap({
    safeAddress: safe,
    position: lpPosition,
    usdcAmountInBaseUnits: params.usdcAmountInBaseUnits,
    slippageBps: params.slippageBps,
    dryRun,
  });

  if (dryRun) {
    return {
      dryRun: true as const,
      mode: "lp-add" as const,
      cycleId,
      lpPosition,
      marketName: (market as { market_name?: string }).market_name ?? null,
      markPx,
      addPlan: addResult,
    };
  }

  // 5) Measure the actual added LP value (8dp base leg @ mark + 6dp USDC leg).
  const lpAfter = await findLp();
  if (!lpAfter) throw new Error("LP position not readable after the add");
  const toBig = (v: string) => {
    try {
      return BigInt(v);
    } catch {
      return 0n;
    }
  };
  const addedBase = toBig(lpAfter.amountA) - toBig(lpBefore.amountA);
  const addedUsdcLeg = toBig(lpAfter.amountB) - toBig(lpBefore.amountB);
  const addedBaseHuman = Number(addedBase > 0n ? addedBase : 0n) / 1e8;
  const lpAddedValueUsdc = BigInt(
    Math.max(
      0,
      Math.round(addedBaseHuman * markPx * 1e6) + Number(addedUsdcLeg > 0n ? addedUsdcLeg : 0n)
    )
  );

  // 6) Grow the short to the NEW live LP base. bandBps=0 → always resize (add must not leave the
  // position under-hedged behind the 15% cron band); records ONE LIQUIDITY_ADD with usdc_delta.
  const shortAdjust = await rehedgeLpDeltaNeutralCore({
    safeAddress: safe,
    subaccount,
    cycleId,
    bandBps: 0,
    recordActionKind: ACTION_KIND.liquidityAdd,
    recordUsdcDeltaBaseUnits: lpAddedValueUsdc,
  });

  // 7) Bump cost-basis extras (best-effort — valuation falls back gracefully without them).
  let spotUsdcExtraTxHash: string | null = null;
  let marginExtraTxHash: string | null = null;
  try {
    const prevSpot =
      (await fetchCycleExtraU64(aptos, safe, cycleId, CYCLE_SPOT_USDC_KEY)) ??
      toBig(cycle.usdcNotionalOpen);
    const r = await submitExecutorEntryFunction({
      network: "mainnet",
      fn: STRATEGY_JOURNAL_ENTRIES.setCycleExtraU64,
      functionArguments: [safe, cycleId, strategyIdBytes(CYCLE_SPOT_USDC_KEY), prevSpot + lpAddedValueUsdc],
      maxGasAmount: 30_000,
    });
    spotUsdcExtraTxHash = r ?? null;
  } catch (err) {
    console.warn("[Decibel] addLpDeltaNeutral: set_cycle_extra_u64(spot_usdc) failed; non-fatal", err);
  }
  // Margin anchor: the rehedge core now adjusts `decibel_margin_open` itself on every resize
  // (grow AND reduce), so the add flow must NOT bump it too — that would double count.
  marginExtraTxHash =
    ((shortAdjust as { marginAnchorTxHash?: string | null }).marginAnchorTxHash ?? null) || null;

  return {
    success: true as const,
    mode: "lp-add" as const,
    cycleId,
    lpPosition,
    marketName: (market as { market_name?: string }).market_name ?? null,
    markPx,
    usdcAmountIn: params.usdcAmountInBaseUnits.toString(),
    addedBaseUnits: (addedBase > 0n ? addedBase : 0n).toString(),
    addedBaseHuman,
    addedUsdcLegBaseUnits: (addedUsdcLeg > 0n ? addedUsdcLeg : 0n).toString(),
    lpAddedValueUsdc: lpAddedValueUsdc.toString(),
    lpAdd: addResult,
    // "grow-short" = hedged; "margin-skip" = LP grew but the short could NOT grow (no free
    // margin) — the position runs under-hedged until margin is topped up or the cron catches up.
    shortAdjust,
    spotUsdcExtraTxHash,
    marginExtraTxHash,
  };
}
