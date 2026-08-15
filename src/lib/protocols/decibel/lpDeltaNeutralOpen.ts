/**
 * LP-hedge delta-neutral OPEN (Hyperion APT/USDC LP long + Decibel APT-USD short).
 *
 * Variant of the spot-hold DN: the long leg is a Hyperion CLMM LP position (earning fees),
 * not a plain spot balance. The CLMM delta to hedge is the LP's *current APT amount*
 * (`amountA` of the apt_usdc pool, APT is token_a). Flow — deliberately LP-first so the short
 * is sized from the real post-open LP composition:
 *
 *   1. open LP from USDC via vault::execute_hyperion_open_zap_usdc (reuses runHyperionOpen)
 *   2. read the freshly-opened position's live APT amount  → base_exposure
 *   3. open the Decibel APT-USD short sized to that APT amount (1x)
 *   4. strategy_journal::open_cycle(deposit_mode=usdc_zap, lp_position=<pos>, base_exposure, ...)
 *
 * Mainnet-only (the apt_usdc pool + journal live on mainnet). The Decibel plumbing here mirrors
 * `executor-open-delta-neutral` (spot path) intentionally — a later refactor can extract the shared
 * helpers; duplicating keeps the proven spot route untouched.
 */
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { normalizeAddress, toCanonicalAddress } from "@/lib/utils/addressNormalization";
import { buildConfigureUserSettingsPayload } from "@/lib/protocols/decibel/configureUserSettings";
import {
  buildOpenMarketOrderPayload,
  type DecibelMarketConfig,
  PACKAGE_MAINNET,
  decibelOpenOrderSizeChainUnits,
  decibelHumanAbsBaseToOrderChainUnits,
  decibelChainUnitsToHumanBase,
} from "@/lib/protocols/decibel/closePosition";
import { getDecibelExecutorAccount, submitExecutorEntryFunction } from "@/lib/protocols/decibel/executorSubmit";
import { getApprovedBuilderFeeBps } from "@/lib/protocols/decibel/getApprovedBuilderFee";
import {
  CYCLE_MARGIN_OPEN_KEY,
  CYCLE_SPOT_USDC_KEY,
  CYCLE_SUBACCOUNT_KEY,
  DEPOSIT_MODE,
  STRATEGY_JOURNAL_ENTRIES,
  STRATEGY_JOURNAL_VIEWS,
  fetchOpenCycles,
  isJournalInitialized,
  strategyIdBytes,
} from "@/lib/protocols/yield-ai/strategyJournal";
import { runHyperionOpenViaDualSwap } from "@/lib/protocols/yield-ai/hyperionLpActions";
import { readSafeHyperionPositions } from "@/lib/protocols/yield-ai/hyperionLp";
import { assertOwnerManageAuth } from "@/lib/protocols/yield-ai/manageAuthServer";
import { YIELD_AI_HYPERION_POOLS } from "@/lib/constants/yieldAiVault";

/**
 * LP pools wired for the Decibel hedge. token_a = the non-USDC asset (8dp for both), token_b = USDC.
 * `decibelAsset` = the Decibel perp market base symbol; `strategyId` = the journal strategy tag.
 */
const LP_DN_CONFIG = {
  apt_usdc: { decibelAsset: "APT", strategyId: "dn-decibel-apt-lp" },
  wbtc_usdc: { decibelAsset: "BTC", strategyId: "dn-decibel-wbtc-lp" },
} as const;
export type LpDnPoolKey = keyof typeof LP_DN_CONFIG;

const DECIBEL_API_KEY = process.env.DECIBEL_API_KEY;
const DECIBEL_API_BASE_URL =
  process.env.DECIBEL_API_BASE_URL || "https://api.testnet.aptoslabs.com/decibel";
const APTOS_API_KEY = process.env.APTOS_API_KEY;

export function aptosClient(): Aptos {
  return new Aptos(
    new AptosConfig({
      network: Network.MAINNET,
      ...(APTOS_API_KEY && { clientConfig: { HEADERS: { Authorization: `Bearer ${APTOS_API_KEY}` } } }),
    })
  );
}

export async function fetchDecibel(path: string): Promise<unknown> {
  if (!DECIBEL_API_KEY) throw new Error("Decibel API key not configured");
  const res = await fetch(`${DECIBEL_API_BASE_URL.replace(/\/$/, "")}${path}`, {
    headers: { Authorization: `Bearer ${DECIBEL_API_KEY}`, "Content-Type": "application/json" },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg =
      data && typeof data === "object" && "message" in data ? String((data as { message?: string }).message) : `Decibel API error: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export type ResolvedDecibelMarket = DecibelMarketConfig & { market_addr: string; market_name: string };

export function normalizeMarkets(
  raw: unknown
): Array<DecibelMarketConfig & { market_addr?: string; market_name?: string }> {
  if (Array.isArray(raw)) return raw as Array<DecibelMarketConfig & { market_addr?: string; market_name?: string }>;
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const k of ["items", "markets", "data"] as const) {
      if (Array.isArray(o[k])) return o[k] as Array<DecibelMarketConfig & { market_addr?: string; market_name?: string }>;
    }
  }
  return [];
}

function resolveMarketBySymbol(
  markets: Array<DecibelMarketConfig & { market_addr?: string; market_name?: string }>,
  symbol: string
): (DecibelMarketConfig & { market_addr: string; market_name: string }) | null {
  const S = symbol.toUpperCase();
  const m = markets.find((row) => {
    const n = (row.market_name || "").toUpperCase();
    return n.startsWith(`${S}-`) || n.startsWith(`${S}/`) || n.startsWith(`${S}_`) || n.split(/[-/_\s]/)[0] === S;
  });
  if (!m?.market_addr || !m.market_name) return null;
  return { ...m, market_addr: m.market_addr, market_name: m.market_name };
}

type DecibelPosition = { market?: string; size?: number; is_deleted?: boolean };

function hasPerpsDelegationOnChain(subaccountResource: unknown, executorAddress: string): boolean {
  const exec = normalizeAddress(executorAddress);
  const root =
    subaccountResource && typeof subaccountResource === "object" && "delegated_permissions" in subaccountResource
      ? (subaccountResource as Record<string, unknown>)
      : (subaccountResource as { data?: unknown })?.data;
  if (!root || typeof root !== "object") return false;
  const entries = (root as any).delegated_permissions?.root?.children?.entries;
  if (!Array.isArray(entries)) return false;
  const leaf = entries.find(
    (e: any) => (typeof e?.key === "string" ? normalizeAddress(toCanonicalAddress(e.key)) : "") === exec
  )?.value;
  const perms = leaf?.value?.perms?.entries;
  if (!Array.isArray(perms)) return false;
  return perms.some((pe: any) => {
    const v = pe?.key?.__variant__;
    return typeof v === "string" && v.toLowerCase().includes("perp") && v.toLowerCase().includes("trade");
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pollFilledShortChainUnits(params: {
  subaccount: string;
  marketAddr: string;
  marketConfig: DecibelMarketConfig;
  fallbackOrderSizeUsd: number;
  markPx: number;
  timeoutMs?: number;
}): Promise<bigint> {
  const { subaccount, marketAddr, marketConfig, fallbackOrderSizeUsd, markPx, timeoutMs = 20_000 } = params;
  const want = normalizeAddress(toCanonicalAddress(marketAddr));
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const raw = (await fetchDecibel(
      `/api/v1/account_positions?account=${encodeURIComponent(subaccount)}`
    )) as unknown;
    const list = Array.isArray(raw) ? (raw as DecibelPosition[]) : [];
    const row = list.find(
      (p) =>
        p &&
        !p.is_deleted &&
        normalizeAddress(toCanonicalAddress(String(p.market || ""))) === want &&
        Number(p.size) < 0
    );
    const absHuman = row ? Math.abs(Number(row.size)) : 0;
    if (Number.isFinite(absHuman) && absHuman > 0) {
      const chain = decibelHumanAbsBaseToOrderChainUnits(absHuman, marketConfig);
      if (chain > 0) return BigInt(chain);
    }
    await sleep(2_000);
  }
  const fallback = BigInt(decibelOpenOrderSizeChainUnits(fallbackOrderSizeUsd, markPx, marketConfig));
  if (fallback > 0n) return fallback;
  throw new Error("Decibel position size not available yet (account_positions lag). Try again shortly.");
}

/** Half-width in ticks for a ±rangePct band (tick = 1.0001^i; ln(1+p)/ln(1.0001)). */
function halfWidthTicksForPct(rangePct: number): number {
  const p = Math.max(0.5, Math.min(95, rangePct)) / 100;
  return Math.max(10, Math.round(Math.log(1 + p) / Math.log(1.0001)));
}

export type LpDeltaNeutralOpenParams = {
  owner: string;
  safeAddress: string;
  subaccount: string;
  /** LP notional in USDC base units (6 dp) — total USDC zapped into the LP. */
  usdcAmountInBaseUnits: bigint;
  /** Symmetric range half-width, percent (e.g. 30 → ±30%). Default 30. */
  rangePct?: number;
  /**
   * Balancing-swap slippage for the zap, bps. Default 300 (3%). The zap fill quality does NOT
   * affect delta-neutrality (the short is sized to the ACTUAL APT received), so a generous buffer
   * is safe — its only job is to survive APT price drift between the off-chain quote and the
   * on-chain executor submit. 1% was too tight and tripped E_HYPERION_SLIPPAGE (0x25) on APT.
   */
  slippageBps?: number;
  /** Which LP pool to hedge: "apt_usdc" (default) or "wbtc_usdc". */
  poolKey?: LpDnPoolKey;
  /** Signed manage-auth payload (mirrors fields below). */
  auth: unknown;
  /** Plan only — open the LP in dry-run, skip the short + journal. */
  dryRun?: boolean;
};

/**
 * Open an LP-hedge delta-neutral cycle. Returns the LP open, the Decibel short fill, and the
 * journal cycle id. On a short failure AFTER the LP is open, the response flags `unhedgedLpPosition`
 * so the caller can retry the short or close the LP — the LP is NOT auto-closed here.
 */
export async function openLpDeltaNeutral(params: LpDeltaNeutralOpenParams) {
  const owner = toCanonicalAddress(params.owner);
  const safe = toCanonicalAddress(params.safeAddress);
  const subaccount = toCanonicalAddress(params.subaccount);
  const rangePct = Number.isFinite(params.rangePct) ? Number(params.rangePct) : 30;
  const slippageBps = Number.isFinite(params.slippageBps) ? Number(params.slippageBps) : 300;
  const dryRun = Boolean(params.dryRun);
  const poolKey: LpDnPoolKey = params.poolKey && params.poolKey in LP_DN_CONFIG ? params.poolKey : "apt_usdc";
  const cfg = LP_DN_CONFIG[poolKey];
  const pool = YIELD_AI_HYPERION_POOLS[poolKey];

  if (DECIBEL_API_BASE_URL.includes("testnet")) {
    throw new Error("LP-hedge delta-neutral is mainnet-only (the pools + journal are on mainnet).");
  }
  if (params.usdcAmountInBaseUnits <= 0n) throw new Error("usdcAmountInBaseUnits must be > 0");

  // Manage-auth: the client must sign exactly these fields, same order.
  const sizeUsd = Number(params.usdcAmountInBaseUnits) / 1e6;
  const { ownerAddress: verifiedOwner } = await assertOwnerManageAuth({
    action: "decibel_dn_lp_open",
    fields: { safeAddress: params.safeAddress, subaccount: params.subaccount, poolKey, sizeUsd, rangePct },
    auth: params.auth,
    safeAddress: safe,
  });
  if (normalizeAddress(verifiedOwner) !== normalizeAddress(owner)) {
    throw new Error("owner does not match the signed authorization");
  }

  const aptos = aptosClient();
  const executorAddress = toCanonicalAddress(getDecibelExecutorAccount().accountAddress.toString());

  // 1) Delegation (Decibel API, fall back to on-chain Subaccount resource).
  const delegations = (await fetchDecibel(
    `/api/v1/delegations?subaccount=${encodeURIComponent(subaccount)}`
  )) as Array<{ delegated_account?: string; permission_type?: string; expiration_time_s?: number | null }>;
  let hasDelegation = (Array.isArray(delegations) ? delegations : []).some((d) => {
    const del = d.delegated_account ? normalizeAddress(toCanonicalAddress(d.delegated_account)) : "";
    const notExpired = typeof d.expiration_time_s === "number" ? d.expiration_time_s > Math.floor(Date.now() / 1000) : true;
    const perm = (d.permission_type || "").toLowerCase();
    return del === normalizeAddress(executorAddress) && notExpired && perm.includes("trade") && perm.includes("perp");
  });
  if (!hasDelegation) {
    try {
      const sub = await aptos.getAccountResource({
        accountAddress: subaccount,
        resourceType: `${PACKAGE_MAINNET}::dex_accounts::Subaccount`,
      });
      hasDelegation = hasPerpsDelegationOnChain(sub, executorAddress);
    } catch {
      /* leave false */
    }
  }
  if (!hasDelegation) throw new Error("No active perps delegation to the executor for this subaccount");

  // 2) Resolve the perp market (APT-USD / BTC-USD) + mark price.
  const markets = normalizeMarkets(await fetchDecibel("/api/v1/markets"));
  const market = resolveMarketBySymbol(markets, cfg.decibelAsset);
  if (!market) throw new Error(`${cfg.decibelAsset}-USD market not found on Decibel`);
  const prices = (await fetchDecibel(
    `/api/v1/prices?market=${encodeURIComponent(market.market_addr)}`
  )) as Array<{ mark_px?: number; mid_px?: number }>;
  const markPx = Number(prices?.[0]?.mark_px ?? prices?.[0]?.mid_px ?? NaN);
  if (!Number.isFinite(markPx) || markPx <= 0) throw new Error(`Failed to resolve ${cfg.decibelAsset} mark price`);

  // 3) Pre-flight: journal ready; no duplicate cycle / Decibel position on the APT market.
  if (!(await isJournalInitialized(aptos))) throw new Error("strategy_journal is not initialized on-chain");
  const wantMarket = normalizeAddress(toCanonicalAddress(market.market_addr));
  // Fail CLOSED: this duplicate-cycle check prevents stacking a second DN short on the same market.
  // If the on-chain view can't be read, REFUSE rather than open blind (the previous fail-open
  // `.catch(() => [])` let a transient error bypass the guard — how a spot-DN got stacked on an LP-DN).
  let openCycles: Awaited<ReturnType<typeof fetchOpenCycles>>;
  try {
    openCycles = await fetchOpenCycles(aptos, safe);
  } catch (err) {
    throw new Error(
      `Could not verify existing DN cycles on this safe (${err instanceof Error ? err.message : "view failed"}); refusing to open.`
    );
  }
  if (openCycles.some((c) => c.isOpen && normalizeAddress(toCanonicalAddress(c.perpMarket)) === wantMarket)) {
    throw new Error(`Safe already has an open DN cycle on ${market.market_name}. Close it first.`);
  }
  const existingPositions = (await fetchDecibel(
    `/api/v1/account_positions?account=${encodeURIComponent(subaccount)}`
  ).catch(() => null)) as unknown;
  if (
    Array.isArray(existingPositions) &&
    (existingPositions as DecibelPosition[]).some(
      (p) => p && !p.is_deleted && normalizeAddress(toCanonicalAddress(String(p.market || ""))) === wantMarket && Number(p.size) !== 0
    )
  ) {
    throw new Error(`Decibel subaccount already has a position on ${market.market_name}. Close it first.`);
  }

  // 4) LONG LEG — open the LP (zap from USDC). Snapshot positions to identify the new one.
  const beforeAddrs = new Set(
    (await readSafeHyperionPositions(safe)).map((p) => toCanonicalAddress(p.position))
  );
  // NOTE: uses the dual-swap path (router swap + open_dual), NOT the adapter zap — the adapter's
  // internal pool_v3::swap mis-routes USDC→APT to a 0-fill on apt_usdc (E_HYPERION_SLIPPAGE).
  const lpOpen = await runHyperionOpenViaDualSwap({
    safeAddress: safe,
    usdcAmountInBaseUnits: params.usdcAmountInBaseUnits,
    poolKey,
    halfWidthTicks: halfWidthTicksForPct(rangePct),
    slippageBps,
    dryRun,
  });

  if (dryRun) {
    return {
      dryRun: true,
      mode: "lp" as const,
      owner,
      safeAddress: safe,
      subaccount,
      marketName: market.market_name,
      markPx,
      rangePct,
      lpOpenPlan: lpOpen,
    };
  }

  // Identify the freshly-opened position and read its live composition.
  const after = await readSafeHyperionPositions(safe);
  const opened = after.find((p) => !p.closed && !beforeAddrs.has(toCanonicalAddress(p.position)));
  if (!opened) {
    return {
      success: false as const,
      error: "LP opened but the new position could not be identified; short NOT placed.",
      code: "LP_POSITION_UNRESOLVED",
      lpOpen,
    };
  }
  const lpPosition = toCanonicalAddress(opened.position);
  // token_a (APT 0xa / WBTC) is the non-USDC leg → amountA is the base asset = the delta to hedge.
  const baseExposureApt = (() => {
    try {
      return BigInt(opened.amountA);
    } catch {
      return 0n;
    }
  })();
  const aptHuman = Number(baseExposureApt) / 10 ** pool.decimalsA; // token_a decimals (8 for APT/WBTC)
  const shortNotionalUsd = aptHuman * markPx;
  const spotMetadata = toCanonicalAddress(pool.tokenA); // non-USDC leg (0xa for APT, WBTC FA for BTC)

  if (!(aptHuman > 0)) {
    return {
      success: false as const,
      error: "LP opened with zero APT leg (range fully above current tick?); short NOT placed.",
      code: "LP_NO_APT_LEG",
      lpPosition,
      lpOpen,
      unhedgedLpPosition: lpPosition,
    };
  }

  // 5) SHORT LEG — configure 1x, resolve builder fee, place market short sized to the LP APT.
  try {
    const configure = buildConfigureUserSettingsPayload({
      subaccountAddr: subaccount,
      marketAddr: market.market_addr,
      isCross: true,
      userLeverage: 1,
      isTestnet: false,
    });
    await submitExecutorEntryFunction({
      network: "mainnet",
      fn: configure.function,
      functionArguments: configure.functionArguments as (string | number | boolean | bigint | null)[],
      maxGasAmount: 20_000,
    });

    const builderAddrEnv = process.env.DECIBEL_BUILDER_ADDRESS?.trim() || null;
    const builderFeeEnvRaw = process.env.DECIBEL_BUILDER_FEE_BPS?.trim();
    const builderFeeEnv = builderFeeEnvRaw ? Number(builderFeeEnvRaw) : 10;
    let builderAddr: string | null = null;
    let builderFeeBps: number | null = null;
    if (builderAddrEnv && Number.isFinite(builderFeeEnv) && builderFeeEnv > 0 && builderFeeEnv <= 10_000) {
      const approved = await getApprovedBuilderFeeBps({ aptos, subaccount, builder: builderAddrEnv, isTestnet: false });
      if (approved != null && approved >= builderFeeEnv) {
        builderAddr = toCanonicalAddress(builderAddrEnv);
        builderFeeBps = builderFeeEnv;
      }
    }

    const openPayload = buildOpenMarketOrderPayload({
      subaccountAddr: subaccount,
      marketAddr: market.market_addr,
      orderSizeUsd: shortNotionalUsd,
      markPx,
      marketConfig: market,
      isLong: false,
      slippageBps: 50,
      isTestnet: false,
      builderAddr,
      builderFeeBps,
    });
    const openTxHash = await submitExecutorEntryFunction({
      network: "mainnet",
      fn: openPayload.function,
      functionArguments: openPayload.functionArguments as (string | number | boolean | bigint | null)[],
      maxGasAmount: 30_000,
    });

    const filledShortSize = await pollFilledShortChainUnits({
      subaccount,
      marketAddr: market.market_addr,
      marketConfig: market,
      fallbackOrderSizeUsd: shortNotionalUsd,
      markPx,
    });
    const szDecimals = market.sz_decimals ?? 5;
    const filledShortHuman = decibelChainUnitsToHumanBase(filledShortSize, szDecimals);

    // Record the ACTUAL USDC value deployed into the LP (APT leg @ mark + USDC leg), NOT the
    // intended zap amount: open_dual returns surplus USDC to the safe, so the intended amount
    // overstates the position and shows a phantom loss at open. usdc_notional_open drives PnL.
    const usdcLegBaseUnits = Number(opened.amountB) || 0;
    const lpDeployedUsdcBaseUnits = BigInt(
      Math.max(0, Math.round(aptHuman * markPx * 1e6) + usdcLegBaseUnits)
    );

    // Perp margin committed at open = short notional @ 1x (the DN sizing). Recorded as a stable
    // "deposited" anchor: rehedge is cash-neutral (usdc_delta=0) so it never moves this. The cycles
    // route falls back to live margin for cycles opened before this extra existed.
    const marginOpenUsdcBaseUnits = BigInt(
      Math.max(0, Math.round(filledShortHuman * markPx * 1e6))
    );

    // 6) Record the cycle: deposit_mode = usdc_zap, lp_position set, base_exposure = LP APT amount.
    const openCycleTxHash = await submitExecutorEntryFunction({
      network: "mainnet",
      fn: STRATEGY_JOURNAL_ENTRIES.openCycle,
      functionArguments: [
        safe,
        strategyIdBytes(cfg.strategyId),
        DEPOSIT_MODE.usdcZap,
        lpPosition, // lp_position: address (the Hyperion CLMM position)
        market.market_addr,
        spotMetadata, // 0xa — APT identifier for off-chain valuation
        baseExposureApt, // base_exposure: live APT in the LP (8dp)
        filledShortSize, // perp_short_size (Decibel sz units)
        lpDeployedUsdcBaseUnits, // usdc_notional_open: ACTUAL LP value (APT@mark + USDC leg)
      ],
      maxGasAmount: 60_000,
    });

    let cycleId: string | null = null;
    try {
      const countRaw = await aptos.view({
        payload: { function: STRATEGY_JOURNAL_VIEWS.getCycleCount, typeArguments: [], functionArguments: [safe] },
      });
      const c = Array.isArray(countRaw) ? countRaw[0] : countRaw;
      if (typeof c === "string" && /^\d+$/.test(c)) cycleId = c;
      else if (typeof c === "number" && Number.isFinite(c)) cycleId = String(Math.trunc(c));
    } catch {
      /* cycleId stays null */
    }

    if (cycleId) {
      // Pin subaccount + record USDC deployed into the LP (reuse spot keys; same semantics).
      try {
        await submitExecutorEntryFunction({
          network: "mainnet",
          fn: STRATEGY_JOURNAL_ENTRIES.setCycleString,
          functionArguments: [safe, cycleId, strategyIdBytes(CYCLE_SUBACCOUNT_KEY), strategyIdBytes(subaccount)],
          maxGasAmount: 30_000,
        });
        await submitExecutorEntryFunction({
          network: "mainnet",
          fn: STRATEGY_JOURNAL_ENTRIES.setCycleExtraU64,
          // ACTUAL deployed value (matches usdc_notional_open). The cycles route reads THIS extra
          // first as the cost basis, so recording the intended $X here reintroduced the phantom PnL.
          functionArguments: [safe, cycleId, strategyIdBytes(CYCLE_SPOT_USDC_KEY), lpDeployedUsdcBaseUnits],
          maxGasAmount: 30_000,
        });
        await submitExecutorEntryFunction({
          network: "mainnet",
          fn: STRATEGY_JOURNAL_ENTRIES.setCycleExtraU64,
          // Perp margin at open (short notional @ 1x) — the stable "deposited" anchor.
          functionArguments: [safe, cycleId, strategyIdBytes(CYCLE_MARGIN_OPEN_KEY), marginOpenUsdcBaseUnits],
          maxGasAmount: 30_000,
        });
      } catch {
        /* non-fatal */
      }
    }

    return {
      success: true as const,
      mode: "lp" as const,
      owner,
      safeAddress: safe,
      subaccount,
      marketAddr: market.market_addr,
      marketName: market.market_name,
      markPx,
      rangePct,
      strategyId: cfg.strategyId,
      depositMode: DEPOSIT_MODE.usdcZap,
      lpPosition,
      lpOpen,
      baseExposureApt: baseExposureApt.toString(),
      aptHuman,
      shortNotionalUsd,
      filledShortSize: filledShortSize.toString(),
      filledShortHuman,
      openTxHash,
      openCycleTxHash,
      cycleId,
      usdcNotionalOpen: params.usdcAmountInBaseUnits.toString(),
    };
  } catch (err) {
    // LP is open but the short/journal failed → leave the LP for retry/close; surface the partial state.
    return {
      success: false as const,
      error: err instanceof Error ? err.message : String(err),
      code: "SHORT_OR_JOURNAL_FAILED",
      unhedgedLpPosition: lpPosition,
      lpPosition,
      lpOpen,
      baseExposureApt: baseExposureApt.toString(),
      aptHuman,
    };
  }
}
