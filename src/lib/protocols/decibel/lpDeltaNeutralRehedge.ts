/**
 * LP-hedge delta-neutral REHEDGE (short-only).
 *
 * The CLMM LP's APT amount drifts with price, so the constant-size Decibel short slowly
 * de-syncs from the LP delta. Rehedge resizes ONLY the perp short to match the LP's current
 * APT amount — there is NO swap in the safe (the reverse APT→USDC swap belongs to close/re-range):
 *   - price up   → LP holds less APT → reduce the short (reduce-only BUY)
 *   - price down → LP holds more APT → grow the short (additional SELL)
 *   - price above range → LP is all USDC → short closes out
 *
 * Records `strategy_journal::record_action(REHEDGE, base_exposure_after, perp_short_size_after,
 * usdc_delta=0, related_tx_version)`. Mainnet-only.
 */
import { normalizeAddress, toCanonicalAddress } from "@/lib/utils/addressNormalization";
import {
  buildOpenMarketOrderPayload,
  buildCloseAtMarketPayload,
  type DecibelMarketConfig,
  decibelHumanAbsBaseToOrderChainUnits,
} from "@/lib/protocols/decibel/closePosition";
import { submitExecutorEntryFunction } from "@/lib/protocols/decibel/executorSubmit";
import { DECIBEL_APT_SPOT_ASSET } from "@/lib/protocols/decibel/deltaNeutralSpotAssets";
import {
  ACTION_KIND,
  CYCLE_MARGIN_OPEN_KEY,
  STRATEGY_JOURNAL_ENTRIES,
  fetchCycleExtraU64,
  fetchOpenCycles,
  strategyIdBytes,
} from "@/lib/protocols/yield-ai/strategyJournal";
import { readSafeHyperionPositions } from "@/lib/protocols/yield-ai/hyperionLp";
import { assertOwnerManageAuth } from "@/lib/protocols/yield-ai/manageAuthServer";
import { aptosClient, fetchDecibel, normalizeMarkets } from "@/lib/protocols/decibel/lpDeltaNeutralOpen";
import { fetchSubaccountUsdcBalanceUsd } from "@/lib/protocols/decibel/dnMultiChain/decibelShortLeg";
import type { Aptos } from "@aptos-labs/ts-sdk";

const DECIBEL_API_BASE_URL =
  process.env.DECIBEL_API_BASE_URL || "https://api.testnet.aptoslabs.com/decibel";

/** Default rehedge band: act only when |LP APT − short| exceeds 15% of the LP APT. */
const DEFAULT_BAND_BPS = 1500;

/** Default safety headroom required over the bare added margin before an auto-grow (20%). */
const DEFAULT_MARGIN_BUFFER_PCT = 0.2;

type DecibelPositionRow = { market?: string; size?: number; is_deleted?: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Live short size for (subaccount, market) in human base (abs); 0 if no short. */
async function readShortHuman(subaccount: string, marketAddr: string): Promise<number> {
  const want = normalizeAddress(toCanonicalAddress(marketAddr));
  const raw = (await fetchDecibel(
    `/api/v1/account_positions?account=${encodeURIComponent(subaccount)}`
  ).catch(() => null)) as unknown;
  const list = Array.isArray(raw) ? (raw as DecibelPositionRow[]) : [];
  const row = list.find(
    (p) => p && !p.is_deleted && normalizeAddress(toCanonicalAddress(String(p.market || ""))) === want && Number(p.size) < 0
  );
  const abs = row ? Math.abs(Number(row.size)) : 0;
  return Number.isFinite(abs) && abs > 0 ? abs : 0;
}

/** Live leverage for the (subaccount, market) short; 1 if unknown (conservative for the guard). */
async function readShortLeverage(subaccount: string, marketAddr: string): Promise<number> {
  const want = normalizeAddress(toCanonicalAddress(marketAddr));
  const raw = (await fetchDecibel(
    `/api/v1/account_positions?account=${encodeURIComponent(subaccount)}`
  ).catch(() => null)) as unknown;
  const list = Array.isArray(raw)
    ? (raw as Array<{ market?: string; size?: number; is_deleted?: boolean; user_leverage?: number }>)
    : [];
  const row = list.find(
    (p) =>
      p &&
      !p.is_deleted &&
      normalizeAddress(toCanonicalAddress(String(p.market || ""))) === want &&
      Number(p.size) < 0
  );
  return row && Number.isFinite(Number(row.user_leverage)) && Number(row.user_leverage) > 0
    ? Number(row.user_leverage)
    : 1;
}

/** Poll the post-adjust short size to chain units (0 if the short fully closed). */
async function pollShortChainUnits(params: {
  subaccount: string;
  marketAddr: string;
  marketConfig: DecibelMarketConfig;
  expectedHuman: number;
  timeoutMs?: number;
}): Promise<bigint> {
  const { subaccount, marketAddr, marketConfig, expectedHuman, timeoutMs = 16_000 } = params;
  const started = Date.now();
  let last = 0n;
  while (Date.now() - started <= timeoutMs) {
    const human = await readShortHuman(subaccount, marketAddr);
    const chain = human > 0 ? BigInt(decibelHumanAbsBaseToOrderChainUnits(human, marketConfig)) : 0n;
    last = chain;
    // Settle once the live size is within ~half a lot of the target (indexer caught up).
    if (expectedHuman <= 0 ? human === 0 : Math.abs(human - expectedHuman) <= expectedHuman * 0.05 + 1e-9) {
      return chain;
    }
    await sleep(2_000);
  }
  return last;
}

async function getTxVersion(aptos: Aptos, hash: string | null): Promise<bigint> {
  if (!hash) return 0n;
  try {
    const tx = (await aptos.getTransactionByHash({ transactionHash: hash })) as { version?: unknown };
    const v = tx?.version;
    if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
    if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
  } catch {
    /* ignore */
  }
  return 0n;
}

export type LpDeltaNeutralRehedgeParams = {
  owner: string;
  safeAddress: string;
  subaccount: string;
  cycleId: string | number;
  /** Rehedge band in bps of the LP APT amount (default 1500 = 15%). */
  bandBps?: number;
  /** Plan only — compute the adjustment, do not place the order or record the action. */
  dryRun?: boolean;
  auth: unknown;
};

/** Core params — no owner/auth. ONLY for secret-gated automation (the executor signs on-chain). */
export type LpDeltaNeutralRehedgeCoreParams = {
  safeAddress: string;
  subaccount: string;
  cycleId: string | number;
  /** Rehedge band in bps of the LP APT amount (default 1500 = 15%). */
  bandBps?: number;
  /** Plan only — compute the adjustment, do not place the order or record the action. */
  dryRun?: boolean;
  /** Headroom over the bare added margin required before an auto-grow (default 0.2 = 20%);
   * negative disables the guard. */
  marginBufferPct?: number;
  /** Journal action kind for the record (default REHEDGE). The LP top-up flow passes
   * LIQUIDITY_ADD so the add lands as ONE journal action instead of ADD+REHEDGE noise. */
  recordActionKind?: number;
  /** usdc_delta for the journal record (default 0 — a pure rehedge never moves safe USDC).
   * The LP top-up flow passes the actual USDC value added to the LP. */
  recordUsdcDeltaBaseUnits?: bigint;
};

export async function rehedgeLpDeltaNeutral(params: LpDeltaNeutralRehedgeParams) {
  const owner = toCanonicalAddress(params.owner);
  const safe = toCanonicalAddress(params.safeAddress);
  const cycleId = String(params.cycleId);

  if (DECIBEL_API_BASE_URL.includes("testnet")) {
    throw new Error("LP-hedge delta-neutral is mainnet-only.");
  }

  // Owner consent gate (per-action manage-auth). The automated path (auto-rehedge cron) calls
  // `rehedgeLpDeltaNeutralCore` directly — secret-gated — since the executor already signs on-chain.
  const { ownerAddress: verifiedOwner } = await assertOwnerManageAuth({
    action: "decibel_dn_rehedge",
    fields: { safeAddress: params.safeAddress, subaccount: params.subaccount, cycleId },
    auth: params.auth,
    safeAddress: safe,
  });
  if (normalizeAddress(verifiedOwner) !== normalizeAddress(owner)) {
    throw new Error("owner does not match the signed authorization");
  }

  return rehedgeLpDeltaNeutralCore({
    safeAddress: params.safeAddress,
    subaccount: params.subaccount,
    cycleId: params.cycleId,
    bandBps: params.bandBps,
    dryRun: params.dryRun,
  });
}

/**
 * Manage-auth-free rehedge core. The executor signs the Decibel order + journal record on-chain,
 * so the only thing dropped vs `rehedgeLpDeltaNeutral` is the app-level owner consent gate — this
 * MUST stay secret-gated (cron) and never be exposed to an unauthenticated caller. Includes a
 * margin guard: an auto-grow is skipped (never forced) when the subaccount lacks free collateral,
 * so automation can't push the perp toward liquidation.
 */
export async function rehedgeLpDeltaNeutralCore(params: LpDeltaNeutralRehedgeCoreParams) {
  const safe = toCanonicalAddress(params.safeAddress);
  const subaccount = toCanonicalAddress(params.subaccount);
  const cycleId = String(params.cycleId);
  const bandBps = Number.isFinite(params.bandBps) ? Number(params.bandBps) : DEFAULT_BAND_BPS;
  const dryRun = Boolean(params.dryRun);
  const marginBufferPct = Number.isFinite(params.marginBufferPct)
    ? Number(params.marginBufferPct)
    : DEFAULT_MARGIN_BUFFER_PCT;

  if (DECIBEL_API_BASE_URL.includes("testnet")) {
    throw new Error("LP-hedge delta-neutral is mainnet-only.");
  }

  const aptos = aptosClient();

  // 1) Load the cycle — must be open and LP-backed.
  const cycle = (await fetchOpenCycles(aptos, safe)).find((c) => String(c.cycleId) === cycleId);
  if (!cycle) throw new Error(`Open cycle #${cycleId} not found for this safe`);
  const lpPosition = toCanonicalAddress(cycle.lpPosition);
  if (!lpPosition || /^0x0+$/.test(normalizeAddress(lpPosition))) {
    throw new Error(`Cycle #${cycleId} has no LP leg (not an LP-hedge cycle)`);
  }
  const marketAddr = toCanonicalAddress(cycle.perpMarket);

  // 2) Resolve the perp market config + mark price.
  const markets = normalizeMarkets(await fetchDecibel("/api/v1/markets"));
  const market = markets.find(
    (m) => m.market_addr && normalizeAddress(toCanonicalAddress(m.market_addr)) === normalizeAddress(marketAddr)
  );
  if (!market?.market_addr) throw new Error("Perp market config not found for this cycle");
  const marketConfig = { ...market, market_addr: market.market_addr } as DecibelMarketConfig & { market_addr: string };
  const prices = (await fetchDecibel(
    `/api/v1/prices?market=${encodeURIComponent(marketConfig.market_addr)}`
  )) as Array<{ mark_px?: number; mid_px?: number }>;
  const markPx = Number(prices?.[0]?.mark_px ?? prices?.[0]?.mid_px ?? NaN);
  if (!Number.isFinite(markPx) || markPx <= 0) throw new Error("Failed to resolve mark price");

  // 3) Live LP APT (the hedge target) and live short.
  const lp = (await readSafeHyperionPositions(safe)).find(
    (p) => toCanonicalAddress(p.position) === lpPosition
  );
  if (!lp) throw new Error(`LP position ${lpPosition} is no longer tracked by the safe`);
  const aptDecimals = DECIBEL_APT_SPOT_ASSET.decimals; // 8
  const targetAptBaseUnits = (() => {
    try {
      return BigInt(lp.amountA);
    } catch {
      return 0n;
    }
  })();
  const targetAptHuman = Number(targetAptBaseUnits) / 10 ** aptDecimals;
  const currentShortHuman = await readShortHuman(subaccount, marketConfig.market_addr);

  // 4) Decide. delta > 0 ⇒ grow short; delta < 0 ⇒ reduce short.
  const szDecimals = marketConfig.sz_decimals ?? 5;
  const lotApt = (marketConfig.lot_size ?? 10_000) / 10 ** szDecimals;
  const minApt = (marketConfig.min_size ?? 100_000) / 10 ** szDecimals;
  const snapDownToLot = (x: number) => (lotApt > 0 ? Math.floor(x / lotApt) * lotApt : x);

  const delta = targetAptHuman - currentShortHuman;
  const bandApt = Math.max(minApt, (targetAptHuman * bandBps) / 10_000);
  const inRange = lp.active;

  const basePlan = {
    cycleId,
    lpPosition,
    marketAddr: marketConfig.market_addr,
    marketName: (market as { market_name?: string }).market_name ?? null,
    markPx,
    inRange,
    targetAptHuman,
    currentShortHuman,
    deltaApt: delta,
    bandApt,
    bandBps,
  };

  if (Math.abs(delta) < bandApt) {
    return { ...basePlan, action: "in-band" as const, adjustedApt: 0, dryRun };
  }

  // Adjustment, snapped to a lot. Reduce is capped so we never flip the short to long.
  let adjustApt = snapDownToLot(Math.abs(delta));
  const isGrow = delta > 0;
  if (!isGrow) adjustApt = snapDownToLot(Math.min(adjustApt, currentShortHuman));
  if (adjustApt < minApt || adjustApt <= 0) {
    return { ...basePlan, action: "in-band" as const, adjustedApt: 0, dryRun, note: "adjustment below min order size" };
  }

  // Margin guard (grow only): growing the short consumes collateral. Skip — never force — when the
  // subaccount lacks free collateral for the added margin (+ buffer), so auto-rehedge can't push
  // the perp toward liquidation. Reduce-short frees margin and is never gated. Evaluated before the
  // dryRun return so observe-only runs surface the would-be skip.
  if (isGrow && marginBufferPct >= 0) {
    const addedNotionalUsd = adjustApt * markPx;
    const lev = await readShortLeverage(subaccount, marketConfig.market_addr);
    const requiredMarginUsd = (addedNotionalUsd / lev) * (1 + marginBufferPct);
    const freeMarginUsd = await fetchSubaccountUsdcBalanceUsd(subaccount);
    if (freeMarginUsd == null || freeMarginUsd < requiredMarginUsd) {
      return {
        ...basePlan,
        action: "margin-skip" as const,
        adjustedApt: 0,
        dryRun,
        freeMarginUsd,
        requiredMarginUsd,
        note: `grow needs ~$${requiredMarginUsd.toFixed(2)} free margin (lev ${lev}x); have $${
          freeMarginUsd != null ? freeMarginUsd.toFixed(2) : "?"
        }`,
      };
    }
  }

  if (dryRun) {
    return {
      ...basePlan,
      action: isGrow ? ("grow-short" as const) : ("reduce-short" as const),
      adjustedApt: adjustApt,
      dryRun: true,
    };
  }

  // 5) Place the adjust order (no builder fee on rehedge — keep it lean).
  const payload = isGrow
    ? buildOpenMarketOrderPayload({
        subaccountAddr: subaccount,
        marketAddr: marketConfig.market_addr,
        orderSizeUsd: adjustApt * markPx,
        markPx,
        marketConfig,
        isLong: false, // add to the short
        slippageBps: 50,
        isTestnet: false,
        builderAddr: null,
        builderFeeBps: null,
      })
    : buildCloseAtMarketPayload({
        subaccountAddr: subaccount,
        marketAddr: marketConfig.market_addr,
        size: adjustApt, // reduce-only buy of `adjustApt` APT
        isLong: false, // the position being reduced is a short
        markPx,
        marketConfig,
        slippageBps: 50,
        isTestnet: false,
        builderAddr: null,
        builderFeeBps: null,
      });

  const orderTxHash = await submitExecutorEntryFunction({
    network: "mainnet",
    fn: payload.function,
    functionArguments: payload.functionArguments as (string | number | boolean | bigint | null)[],
    maxGasAmount: 30_000,
  });

  const expectedShortHuman = isGrow ? currentShortHuman + adjustApt : Math.max(0, currentShortHuman - adjustApt);
  const newShortChainUnits = await pollShortChainUnits({
    subaccount,
    marketAddr: marketConfig.market_addr,
    marketConfig,
    expectedHuman: expectedShortHuman,
  });
  const relatedTxVersion = await getTxVersion(aptos, orderTxHash);

  // 6) Journal the action: base_exposure_after = live LP APT, perp_short_size_after = new short.
  // Defaults to REHEDGE with usdc_delta=0; the LP top-up flow overrides to LIQUIDITY_ADD with the
  // added USDC so the whole add lands as one journal action.
  const recordTxHash = await submitExecutorEntryFunction({
    network: "mainnet",
    fn: STRATEGY_JOURNAL_ENTRIES.recordAction,
    functionArguments: [
      safe,
      cycleId,
      params.recordActionKind ?? ACTION_KIND.rehedge,
      targetAptBaseUnits, // base_exposure_after (APT 8dp)
      newShortChainUnits, // perp_short_size_after (Decibel sz units)
      params.recordUsdcDeltaBaseUnits ?? 0,
      relatedTxVersion,
    ],
    maxGasAmount: 60_000,
  });

  // 7) Keep the margin anchor (decibel_margin_open extra) = margin actually committed to the
  // short: a reduce frees margin back to the subaccount's free collateral (no longer "deposited"),
  // a grow locks more of it. Without this the anchor drifts on every reduce↔grow cycle (double
  // counts re-grown margin, misses cron grows). Adjust by the resize notional at the action mark —
  // stable between actions, auditable via the journal. Only for cycles that HAVE the anchor;
  // legacy cycles (no extra) use the live-margin fallback and must stay on it. Best-effort.
  let marginAnchorTxHash: string | null = null;
  try {
    const prevAnchor = await fetchCycleExtraU64(aptos, safe, cycleId, CYCLE_MARGIN_OPEN_KEY);
    if (prevAnchor != null) {
      const deltaUsdc = BigInt(Math.max(0, Math.round(adjustApt * markPx * 1e6)));
      const nextAnchor = isGrow
        ? prevAnchor + deltaUsdc
        : prevAnchor > deltaUsdc
          ? prevAnchor - deltaUsdc
          : 0n;
      marginAnchorTxHash = await submitExecutorEntryFunction({
        network: "mainnet",
        fn: STRATEGY_JOURNAL_ENTRIES.setCycleExtraU64,
        functionArguments: [safe, cycleId, strategyIdBytes(CYCLE_MARGIN_OPEN_KEY), nextAnchor],
        maxGasAmount: 30_000,
      });
    }
  } catch (err) {
    console.warn("[Decibel] rehedge core: margin-anchor adjust failed; non-fatal", err);
  }

  return {
    ...basePlan,
    success: true as const,
    action: isGrow ? ("grow-short" as const) : ("reduce-short" as const),
    adjustedApt: adjustApt,
    expectedShortHuman,
    newShortChainUnits: newShortChainUnits.toString(),
    orderTxHash,
    recordTxHash,
    marginAnchorTxHash,
    relatedTxVersion: relatedTxVersion.toString(),
    dryRun: false,
  };
}
