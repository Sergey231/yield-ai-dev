import { NextRequest, NextResponse } from "next/server";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { normalizeAddress, toCanonicalAddress } from "@/lib/utils/addressNormalization";
import { USDC_FA_METADATA_MAINNET, YIELD_AI_HYPERION_POOLS } from "@/lib/constants/yieldAiVault";
import { getHyperionAmountOut } from "@/lib/protocols/yield-ai/engine/hyperionQuote";
import { readSafeHyperionPositions, type HyperionPositionView } from "@/lib/protocols/yield-ai/hyperionLp";
import { rangeAdjustedAprFromTicks } from "@/lib/protocols/yield-ai/hyperionRangeApr";
import { sdk as hyperionSdk } from "@/lib/hyperion";
import {
  CYCLE_MARGIN_OPEN_KEY,
  CYCLE_SPOT_USDC_KEY,
  CYCLE_SUBACCOUNT_KEY,
  fetchCycleExtraU64,
  fetchCycleString,
  fetchOpenCycles,
  isJournalInitialized,
  type CycleViewParsed,
} from "@/lib/protocols/yield-ai/strategyJournal";

const APTOS_API_KEY = process.env.APTOS_API_KEY;
const DECIBEL_API_KEY = process.env.DECIBEL_API_KEY;
const DECIBEL_API_BASE_URL =
  process.env.DECIBEL_API_BASE_URL || "https://api.testnet.aptoslabs.com/decibel";

/** Decibel Tier-0 taker fee (per docs.decibel.trade/for-traders/fees). */
const DECIBEL_TAKER_FEE_BPS = 3.4;

const aptos = new Aptos(
  new AptosConfig({
    network: Network.MAINNET,
    ...(APTOS_API_KEY && {
      clientConfig: { HEADERS: { Authorization: `Bearer ${APTOS_API_KEY}` } },
    }),
  })
);

/** Enriched journal cycle for the UI (snapshot + Decibel market metadata + live valuation). */
export type DeltaNeutralCycleDto = CycleViewParsed & {
  marketName: string | null;
  szDecimals: number | null;
  /** perpShortSize as a human base amount (perpShortSize / 10^szDecimals); null if unknown.
   * NOTE: this is the JOURNAL-RECORDED size — it can lag the live position by a lot when a
   * rehedge order landed but its record_action tx failed. Prefer `liveShortSizeHuman` for
   * anything user-facing (hedge gauge, drift %); fall back to this only when live is null. */
  shortSizeHuman: number | null;
  /** LIVE short size from Decibel account_positions (abs, human); null without `subaccount`
   * or in light mode. Source of truth for the hedge drift — matches what the rehedge cron uses. */
  liveShortSizeHuman: number | null;
  /** Decibel mark price for the market; null if unavailable. */
  markPx: number | null;
  /** Real USD value of the spot leg right now: Hyperion exact-in quote base_exposure -> USDC. */
  spotValueUsd: number | null;
  /** Live short entry price from Decibel (per the subaccount), if provided. */
  perpEntryPx: number | null;
  /** Short unrealized PnL = (entry - mark) * |size|; null if entry/mark missing. */
  perpUPnlUsd: number | null;
  /** Estimated USDC realized closing both legs now: spotValue (net of slippage) + perpUPnl - taker fee. */
  estCloseUsd: number | null;
  /** Perp collateral (margin) = |size| * entry / leverage. */
  perpMarginUsd: number | null;
  /** Funding earned by the position so far (= -unrealized_funding); positive = we receive. */
  perpFundingUsd: number | null;
  /** Funding APR (%) from the short's perspective: positive = short receives (longs pay shorts). */
  fundingAprPct: number | null;
  /** Decibel-side equity = perp margin + perp uPnL. */
  decibelEquityUsd: number | null;
  /** Total position value now = Decibel equity + spot value (real quote). */
  totalValueUsd: number | null;
  /** Price PnL (spot + perp, excludes funding) = (spotValue - spotCostBasis) + perpUPnl. */
  pnlPriceUsd: number | null;
  /** Total USDC deployed (spot cost basis + perp margin anchor) — the "deposited" base. */
  deployedUsd: number | null;
  /** Realized APR (%) on deployed USDC: total economic PnL / deployed, annualised by age. */
  realizedAprPct: number | null;
  /** Position age in days (for gating/labelling the noisy young-position realized APR). */
  realizedAgeDays: number | null;
  /** Decibel subaccount pinned at open (string KV); null for cycles opened before this was recorded. */
  decibelSubaccount: string | null;
  /** Long leg for LP-hedge cycles (lp_position != 0x0); null for spot-hold cycles. */
  lpLeg?: DeltaNeutralLpLeg | null;
};

/** Live Hyperion LP long-leg snapshot attached to LP-hedge DN cycles. */
export type DeltaNeutralLpLeg = {
  position: string;
  tokenA: string;
  tokenB: string;
  feeTier: number;
  tickLower: number;
  tickUpper: number;
  /** Live base-unit amounts in the position (token_a = APT 8dp, token_b = USDC 6dp). */
  amountA: string;
  amountB: string;
  aptHuman: number;
  usdcHuman: number;
  /** True when the live tick is inside the position range (earning fees). */
  inRange: boolean;
  pendingFeeA: string | null;
  pendingFeeB: string | null;
  /** LP USD value = APT leg (× markPx) + USDC leg. */
  valueUsd: number;
  /** Range-adjusted pool APR for THIS position's range (fee×concentration + farm), percent. */
  rangeAprPct?: number | null;
  /** Concentrated fee APR (fee × range ratio) and flat farm APR, percent — for the breakdown. */
  feeAprPct?: number | null;
  farmAprPct?: number | null;
  /** USD of UNcollected trading fees (Hyperion amountUSD). */
  claimableFeesUsd?: number | null;
  /** USD of UNcollected farm rewards (Hyperion amountUSD). */
  claimableRewardsUsd?: number | null;
  /** USD of already-COLLECTED trading fees over the position's life (Hyperion `claimed`). */
  claimedFeesUsd?: number | null;
  /** USD of already-COLLECTED farm rewards over the position's life. */
  claimedRewardsUsd?: number | null;
  /** Number of pending farm/gauge reward entries. */
  rewardCount?: number | null;
  /** Set when the cycle references an LP position the safe no longer tracks. */
  unresolved?: boolean;
};

/** True for the canonical zero address ("0x0" / all-zero) used when a cycle has no LP leg. */
function isZeroAddress(addr: string | null | undefined): boolean {
  if (!addr) return true;
  const n = normalizeAddress(toCanonicalAddress(addr));
  return n === normalizeAddress("0x0") || /^0x0+$/.test(n);
}

/** Wired LP-hedge pools (token_a = non-USDC asset). Match a position's (tokenA, tokenB) to a key. */
const LP_DN_POOL_KEYS = ["apt_usdc", "wbtc_usdc"] as const;
type LpDnPoolKey = (typeof LP_DN_POOL_KEYS)[number];
function matchLpPoolKey(tokenA: string, tokenB: string): LpDnPoolKey | null {
  const a = normalizeAddress(toCanonicalAddress(tokenA));
  const b = normalizeAddress(toCanonicalAddress(tokenB));
  for (const k of LP_DN_POOL_KEYS) {
    const pa = normalizeAddress(toCanonicalAddress(YIELD_AI_HYPERION_POOLS[k].tokenA));
    const pb = normalizeAddress(toCanonicalAddress(YIELD_AI_HYPERION_POOLS[k].tokenB));
    if ((a === pa && b === pb) || (a === pb && b === pa)) return k;
  }
  return null;
}

export type DeltaNeutralCyclesResponse = {
  journalInitialized: boolean;
  cycles: DeltaNeutralCycleDto[];
};

type DecibelMarketRow = { market_addr?: string; market_name?: string; sz_decimals?: number };
type DecibelPositionRow = {
  market?: string;
  size?: number;
  entry_price?: number;
  unrealized_funding?: number;
  user_leverage?: number;
  is_deleted?: boolean;
};

async function fetchDecibel(path: string): Promise<unknown> {
  if (!DECIBEL_API_KEY) return null;
  try {
    const baseUrl = DECIBEL_API_BASE_URL.replace(/\/$/, "");
    const res = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${DECIBEL_API_KEY}`, "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function normalizeListPayload<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.items)) return obj.items as T[];
    if (Array.isArray(obj.markets)) return obj.markets as T[];
    if (Array.isArray(obj.data)) return obj.data as T[];
  }
  return [];
}

async function fetchMarkAndFunding(
  marketAddr: string
): Promise<{ markPx: number | null; fundingAprPct: number | null }> {
  const raw = await fetchDecibel(`/api/v1/prices?market=${encodeURIComponent(marketAddr)}`);
  const list = normalizeListPayload<{
    mark_px?: number;
    mid_px?: number;
    funding_rate_bps?: number;
    is_funding_positive?: boolean;
    funding_period_s?: number;
  }>(raw);
  const row = list[0];
  const px = Number(row?.mark_px ?? row?.mid_px ?? NaN);
  const markPx = Number.isFinite(px) && px > 0 ? px : null;
  // Funding APR from the SHORT's perspective: positive when longs pay shorts (is_funding_positive).
  // Annualize the per-period bps rate using funding_period_s.
  let fundingAprPct: number | null = null;
  const bps = Number(row?.funding_rate_bps);
  const periodS = Number(row?.funding_period_s);
  if (Number.isFinite(bps) && Number.isFinite(periodS) && periodS > 0) {
    const periodsPerYear = 31_536_000 / periodS;
    const mag = (Math.abs(bps) / 100) * periodsPerYear;
    fundingAprPct = (row?.is_funding_positive ? 1 : -1) * mag;
  }
  return { markPx, fundingAprPct };
}

/**
 * GET /api/protocols/yield-ai/delta-neutral-cycles?safeAddress=0x...&subaccount=0x...
 * Lists OPEN strategy_journal cycles for the safe (the post-migration DN positions), enriched
 * with a real-quote valuation per cycle. `subaccount` is optional but required for perp uPnL.
 * Read alongside the legacy /delta-neutral-state for dual-read during the transition.
 */
export async function GET(request: NextRequest) {
  try {
    const safeRaw = request.nextUrl.searchParams.get("safeAddress")?.trim();
    const subaccountRaw = request.nextUrl.searchParams.get("subaccount")?.trim() || "";
    // light=1 skips the per-cycle Hyperion/Decibel valuation (fast path for agent-badge detection).
    const light = request.nextUrl.searchParams.get("light") === "1";
    if (!safeRaw) {
      return NextResponse.json({ success: false, error: "safeAddress is required" }, { status: 400 });
    }
    const safe = toCanonicalAddress(safeRaw);
    if (!safe.startsWith("0x")) {
      return NextResponse.json({ success: false, error: "Invalid safeAddress" }, { status: 400 });
    }
    const subaccount = subaccountRaw ? toCanonicalAddress(subaccountRaw) : "";

    const journalInitialized = await isJournalInitialized(aptos);
    if (!journalInitialized) {
      const data: DeltaNeutralCyclesResponse = { journalInitialized: false, cycles: [] };
      return NextResponse.json({ success: true, data });
    }

    const cycles = await fetchOpenCycles(aptos, safe);
    if (cycles.length === 0) {
      return NextResponse.json({ success: true, data: { journalInitialized: true, cycles: [] } });
    }

    const [marketsRaw, positionsRaw] = await Promise.all([
      fetchDecibel("/api/v1/markets"),
      subaccount && !light
        ? fetchDecibel(`/api/v1/account_positions?account=${encodeURIComponent(subaccount)}`)
        : Promise.resolve(null),
    ]);
    const markets = normalizeListPayload<DecibelMarketRow>(marketsRaw);
    const marketByAddr = new Map<string, DecibelMarketRow>();
    for (const m of markets) {
      if (m.market_addr) marketByAddr.set(normalizeAddress(toCanonicalAddress(m.market_addr)), m);
    }
    const positions = normalizeListPayload<DecibelPositionRow>(positionsRaw);

    // LP-hedge cycles carry a Hyperion LP position (lp_position != 0x0). Fetch the safe's live LP
    // composition once, then attach/value the matching leg per cycle below.
    const lpByAddr = new Map<string, HyperionPositionView>();
    if (!light && cycles.some((c) => !isZeroAddress(c.lpPosition))) {
      try {
        for (const p of await readSafeHyperionPositions(safe)) {
          lpByAddr.set(normalizeAddress(toCanonicalAddress(p.position)), p);
        }
      } catch (err) {
        console.warn("[Yield AI] delta-neutral-cycles: readSafeHyperionPositions failed; LP legs omitted", err);
      }
    }

    // Pool APR feed (fee/farm + current tick) per referenced pool, for the range-adjusted APR. Once.
    const poolAprByKey = new Map<LpDnPoolKey, { feeApr: number; farmApr: number; currentTick: number }>();
    if (!light && cycles.some((c) => !isZeroAddress(c.lpPosition))) {
      const keys = new Set<LpDnPoolKey>();
      for (const lp of lpByAddr.values()) {
        const k = matchLpPoolKey(lp.tokenA, lp.tokenB);
        if (k) keys.add(k);
      }
      await Promise.all(
        [...keys].map(async (k) => {
          try {
            const poolId = YIELD_AI_HYPERION_POOLS[k].poolAddress;
            const raw = (await hyperionSdk.Pool.fetchPoolById({ poolId })) as unknown;
            const p = (Array.isArray(raw) ? raw[0] : raw) as
              | { feeAPR?: unknown; farmAPR?: unknown; currentTick?: unknown; pool?: { currentTick?: unknown } }
              | undefined;
            const currentTick = Number(p?.pool?.currentTick ?? p?.currentTick);
            if (Number.isFinite(currentTick)) {
              poolAprByKey.set(k, { feeApr: Number(p?.feeAPR) || 0, farmApr: Number(p?.farmAPR) || 0, currentTick });
            }
          } catch (err) {
            console.warn(`[Yield AI] delta-neutral-cycles: pool APR fetch failed for ${k}; LP APR omitted`, err);
          }
        })
      );
    }

    // Per-position fees + farm rewards (claimed + unclaimed, USD) from Hyperion's indexer. Once.
    // Hyperion already values each entry (amountUSD), so total earned = claimed + unclaimed — stable
    // across claims (unclaimed → claimed on claim, sum unchanged).
    type LpEarn = {
      feesClaimable: number;
      feesClaimed: number;
      rewardsClaimable: number;
      rewardsClaimed: number;
      rewardCount: number;
    };
    const lpEarnByPos = new Map<string, LpEarn>();
    if (!light && cycles.some((c) => !isZeroAddress(c.lpPosition))) {
      const sumUsd = (arr: unknown): number =>
        Array.isArray(arr)
          ? arr.reduce((s, x) => s + (Number((x as { amountUSD?: unknown })?.amountUSD) || 0), 0)
          : 0;
      try {
        const raw = (await hyperionSdk.Position.fetchAllPositionsByAddress({ address: safe })) as unknown;
        const list = (Array.isArray(raw) ? raw : []) as Array<{
          position?: { objectId?: string };
          fees?: { claimed?: unknown; unclaimed?: unknown };
          farm?: { claimed?: unknown; unclaimed?: unknown };
        }>;
        for (const it of list) {
          const oid = it?.position?.objectId;
          if (typeof oid !== "string") continue;
          lpEarnByPos.set(normalizeAddress(toCanonicalAddress(oid)), {
            feesClaimable: sumUsd(it.fees?.unclaimed),
            feesClaimed: sumUsd(it.fees?.claimed),
            rewardsClaimable: sumUsd(it.farm?.unclaimed),
            rewardsClaimed: sumUsd(it.farm?.claimed),
            rewardCount: Array.isArray(it.farm?.unclaimed)
              ? (it.farm!.unclaimed as Array<{ amount?: unknown }>).filter((x) => Number(x?.amount) > 0).length
              : 0,
          });
        }
      } catch (err) {
        console.warn("[Yield AI] delta-neutral-cycles: Hyperion position fees fetch failed; claimed/claimable omitted", err);
      }
    }

    const dtos: DeltaNeutralCycleDto[] = await Promise.all(
      cycles.map(async (c): Promise<DeltaNeutralCycleDto> => {
        const marketKey = normalizeAddress(toCanonicalAddress(c.perpMarket));
        const market = marketByAddr.get(marketKey);
        const szDecimals =
          typeof market?.sz_decimals === "number" && Number.isFinite(market.sz_decimals)
            ? market.sz_decimals
            : null;
        const shortHuman = szDecimals != null ? Number(c.perpShortSize) / 10 ** szDecimals : null;
        const shortSizeHuman = shortHuman != null && Number.isFinite(shortHuman) ? shortHuman : null;

        // The pinned Decibel subaccount is needed for both matching and valuation; always read it.
        const decibelSubaccount = await fetchCycleString(aptos, safe, c.cycleId, CYCLE_SUBACCOUNT_KEY);

        // Fast path: skip the per-cycle Hyperion/Decibel valuation entirely.
        if (light) {
          return {
            ...c,
            marketName: market?.market_name ?? null,
            szDecimals,
            shortSizeHuman,
            liveShortSizeHuman: null,
            markPx: null,
            spotValueUsd: null,
            perpEntryPx: null,
            perpUPnlUsd: null,
            estCloseUsd: null,
            perpMarginUsd: null,
            perpFundingUsd: null,
            fundingAprPct: null,
            decibelEquityUsd: null,
            totalValueUsd: null,
            pnlPriceUsd: null,
            deployedUsd: null,
            realizedAprPct: null,
            realizedAgeDays: null,
            decibelSubaccount,
          };
        }

        // Spot leg value: real Hyperion exact-in quote selling base_exposure -> USDC.
        let spotValueUsd: number | null = null;
        const baseExposure = (() => {
          try {
            return BigInt(c.baseExposure);
          } catch {
            return BigInt(0);
          }
        })();
        if (baseExposure > BigInt(0)) {
          try {
            const usdcOut = await getHyperionAmountOut({
              amountInBaseUnits: baseExposure,
              fromMetadata: toCanonicalAddress(c.spotMetadata),
              toMetadata: USDC_FA_METADATA_MAINNET,
            });
            spotValueUsd = Number(usdcOut) / 1e6;
          } catch {
            spotValueUsd = null;
          }
        }

        const [markAndFunding, spotUsdcExtra, marginOpenExtra] = await Promise.all([
          fetchMarkAndFunding(c.perpMarket),
          fetchCycleExtraU64(aptos, safe, c.cycleId, CYCLE_SPOT_USDC_KEY),
          fetchCycleExtraU64(aptos, safe, c.cycleId, CYCLE_MARGIN_OPEN_KEY),
        ]);
        const markPx = markAndFunding.markPx;
        const fundingAprPct = markAndFunding.fundingAprPct;

        // LP-hedge cycle: replace the base_exposure spot quote with the LIVE LP value (APT leg ×
        // markPx + USDC leg), so totalValue / pnl / estClose below reflect the real LP position.
        let lpLeg: DeltaNeutralLpLeg | null = null;
        if (!isZeroAddress(c.lpPosition)) {
          const lp = lpByAddr.get(normalizeAddress(toCanonicalAddress(c.lpPosition))) ?? null;
          if (lp) {
            const lpPoolKey = matchLpPoolKey(lp.tokenA, lp.tokenB);
            const poolCfg = YIELD_AI_HYPERION_POOLS[lpPoolKey ?? "apt_usdc"];
            const poolApr = lpPoolKey ? poolAprByKey.get(lpPoolKey) : undefined;
            const aptHuman = Number(lp.amountA) / 10 ** poolCfg.decimalsA; // token_a (8dp APT/WBTC)
            const usdcHuman = Number(lp.amountB) / 10 ** poolCfg.decimalsB; // token_b = USDC (6dp)
            const aptValueUsd = markPx != null ? aptHuman * markPx : spotValueUsd ?? 0;
            const lpValueUsd = aptValueUsd + usdcHuman;
            if (Number.isFinite(lpValueUsd)) spotValueUsd = lpValueUsd;
            const rangeApr = poolApr
              ? rangeAdjustedAprFromTicks({
                  feeAprPct: poolApr.feeApr,
                  farmAprPct: poolApr.farmApr,
                  currentTick: poolApr.currentTick,
                  lowerTick: lp.tickLower,
                  upperTick: lp.tickUpper,
                  referenceRangePct: poolCfg.ui.aprReferencePct,
                  tickSpacing: poolCfg.tickSpacing,
                })
              : null;
            const lpEarn = lpEarnByPos.get(normalizeAddress(toCanonicalAddress(lp.position)));
            lpLeg = {
              position: toCanonicalAddress(lp.position),
              tokenA: lp.tokenA,
              tokenB: lp.tokenB,
              feeTier: lp.feeTier,
              tickLower: lp.tickLower,
              tickUpper: lp.tickUpper,
              amountA: lp.amountA,
              amountB: lp.amountB,
              aptHuman,
              usdcHuman,
              inRange: lp.active,
              pendingFeeA: lp.pendingFeeA ?? null,
              pendingFeeB: lp.pendingFeeB ?? null,
              valueUsd: Number.isFinite(lpValueUsd) ? lpValueUsd : 0,
              rangeAprPct: rangeApr?.total ?? null,
              feeAprPct: rangeApr ? rangeApr.fee * rangeApr.ratio : null,
              farmAprPct: rangeApr?.farm ?? null,
              // Fees/rewards (claimable + already-claimed), USD-valued by Hyperion's indexer. Total
              // earned = claimable + claimed → PnL stays stable across claims. Periodic collection
              // runs via the DN-autoclaim cron (docs/dn-autoclaim-cron.md), claimed funds → USDC,
              // held in the safe (no reinvest).
              claimableFeesUsd: lpEarn?.feesClaimable ?? null,
              claimableRewardsUsd: lpEarn?.rewardsClaimable ?? null,
              claimedFeesUsd: lpEarn?.feesClaimed ?? null,
              claimedRewardsUsd: lpEarn?.rewardsClaimed ?? null,
              rewardCount: lpEarn?.rewardCount ?? lp.pendingRewards?.length ?? 0,
            };
          } else {
            lpLeg = {
              position: toCanonicalAddress(c.lpPosition),
              tokenA: "",
              tokenB: "",
              feeTier: 0,
              tickLower: 0,
              tickUpper: 0,
              amountA: "0",
              amountB: "0",
              aptHuman: 0,
              usdcHuman: 0,
              inRange: false,
              pendingFeeA: null,
              pendingFeeB: null,
              valueUsd: 0,
              unresolved: true,
            };
          }
        }

        // Perp uPnL from the live short (needs subaccount).
        const perpRow = positions.find((p) => {
          if (!p || p.is_deleted) return false;
          const m = String(p.market || "");
          if (!m) return false;
          if (normalizeAddress(toCanonicalAddress(m)) !== marketKey) return false;
          return Number.isFinite(Number(p.size)) && Number(p.size) < 0;
        });
        const perpEntryPx =
          perpRow && Number.isFinite(Number(perpRow.entry_price)) && Number(perpRow.entry_price) > 0
            ? Number(perpRow.entry_price)
            : null;
        const liveShortHuman = perpRow ? Math.abs(Number(perpRow.size)) : null;
        const perpUPnlUsd =
          perpEntryPx != null && markPx != null && liveShortHuman != null
            ? (perpEntryPx - markPx) * liveShortHuman
            : null;

        // Perp collateral + funding + Decibel-side equity.
        const leverage =
          perpRow && Number.isFinite(Number(perpRow.user_leverage)) && Number(perpRow.user_leverage) > 0
            ? Number(perpRow.user_leverage)
            : 1;
        const perpNotionalUsd =
          perpEntryPx != null && liveShortHuman != null ? liveShortHuman * perpEntryPx : null;
        const perpMarginUsd = perpNotionalUsd != null ? perpNotionalUsd / leverage : null;
        const perpFundingUsd =
          perpRow && Number.isFinite(Number(perpRow.unrealized_funding))
            ? -Number(perpRow.unrealized_funding)
            : null;
        const decibelEquityUsd = perpMarginUsd != null ? perpMarginUsd + (perpUPnlUsd ?? 0) : null;

        // Total position value = Decibel equity + spot value (real quote).
        const totalValueUsd =
          spotValueUsd != null || decibelEquityUsd != null
            ? (spotValueUsd ?? 0) + (decibelEquityUsd ?? 0)
            : null;

        // Cost basis = the actual USDC spent on the spot leg. The cumulative figure (open + adds)
        // is tracked in the spot_usdc extra; fall back to usdc_notional_open (exact for positions
        // that were never topped up).
        const spotCostBasisUsd =
          Number(spotUsdcExtra != null ? spotUsdcExtra : BigInt(c.usdcNotionalOpen)) / 1e6;
        // Margin cost basis: prefer the at-open anchor (decibel_margin_open extra) so "deposited" is
        // stable across rehedges (cash-neutral, usdc_delta=0); fall back to live margin for cycles
        // opened before this extra existed.
        const marginCostBasisUsd =
          marginOpenExtra != null ? Number(marginOpenExtra) / 1e6 : perpMarginUsd;
        // Total USDC deployed in the position (spot cost + perp margin anchor) — the "deposited" base.
        const deployedUsd =
          spotCostBasisUsd != null && marginCostBasisUsd != null
            ? spotCostBasisUsd + marginCostBasisUsd
            : marginCostBasisUsd;
        // Price PnL (spot + perp, excludes funding which is shown separately).
        const pnlPriceUsd =
          spotValueUsd != null && perpUPnlUsd != null && spotCostBasisUsd != null
            ? spotValueUsd - spotCostBasisUsd + perpUPnlUsd
            : null;

        // Realized APR on deployed USDC: total economic PnL (price + funding + claimable/claimed
        // fees + rewards — matches the card header PnL) over deployed, annualised by age. Noisy on
        // young positions, so we return realizedAgeDays alongside for the UI to gate/label.
        const feesRewardsUsd =
          (lpLeg?.claimableFeesUsd ?? 0) +
          (lpLeg?.claimedFeesUsd ?? 0) +
          (lpLeg?.claimableRewardsUsd ?? 0) +
          (lpLeg?.claimedRewardsUsd ?? 0);
        const totalPnlUsd =
          pnlPriceUsd != null ? pnlPriceUsd + (perpFundingUsd ?? 0) + feesRewardsUsd : null;
        const openedAtSec = Number(c.openedAt) || 0;
        const realizedAgeDays =
          openedAtSec > 0 ? Math.max(0, Date.now() / 1000 - openedAtSec) / 86400 : null;
        const realizedAprPct =
          totalPnlUsd != null && deployedUsd != null && deployedUsd > 0 && realizedAgeDays && realizedAgeDays > 0
            ? (totalPnlUsd / deployedUsd) * (365 / realizedAgeDays) * 100
            : null;

        // Estimated USDC realized closing now: spot quote (already net of slippage) + Decibel
        // equity (margin returned on close + uPnL) - taker fee.
        const closeShortHuman = liveShortHuman ?? shortHuman ?? 0;
        const decibelCloseFeeUsd =
          markPx != null ? closeShortHuman * markPx * (DECIBEL_TAKER_FEE_BPS / 10_000) : 0;
        const estCloseUsd =
          spotValueUsd != null
            ? spotValueUsd + (decibelEquityUsd ?? perpUPnlUsd ?? 0) - decibelCloseFeeUsd
            : null;

        return {
          ...c,
          marketName: market?.market_name ?? null,
          szDecimals,
          shortSizeHuman,
          liveShortSizeHuman: liveShortHuman,
          markPx,
          spotValueUsd,
          perpEntryPx,
          perpUPnlUsd,
          estCloseUsd,
          perpMarginUsd,
          perpFundingUsd,
          fundingAprPct,
          decibelEquityUsd,
          totalValueUsd,
          pnlPriceUsd,
          deployedUsd,
          realizedAprPct,
          realizedAgeDays,
          decibelSubaccount,
          lpLeg,
        };
      })
    );

    const data: DeltaNeutralCyclesResponse = { journalInitialized: true, cycles: dtos };
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[Yield AI] delta-neutral-cycles error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
