import { NextRequest, NextResponse } from "next/server";
import { toCanonicalAddress, normalizeAddress } from "@/lib/utils/addressNormalization";
import {
  buildOpenMarketOrderPayload,
  type DecibelMarketConfig,
  PACKAGE_MAINNET,
  PACKAGE_TESTNET,
  decibelOpenOrderSizeChainUnits,
  decibelHumanAbsBaseToOrderChainUnits,
  decibelChainUnitsToHumanBase,
} from "@/lib/protocols/decibel/closePosition";
import { getDecibelExecutorAccount, submitExecutorEntryFunction } from "@/lib/protocols/decibel/executorSubmit";
import { USDC_FA_METADATA_MAINNET } from "@/lib/constants/yieldAiVault";
import {
  DECIBEL_APT_SPOT_ASSET,
  getConfiguredDecibelBtcSpotAsset,
  type DecibelSpotAssetConfig,
} from "@/lib/protocols/decibel/deltaNeutralSpotAssets";
import { submitSwapFaToFaWithFallbackLimits } from "@/lib/protocols/yield-ai/swapFaToFa";
import { getHyperionAmountIn } from "@/lib/protocols/yield-ai/engine/hyperionQuote";
import { getApprovedBuilderFeeBps } from "@/lib/protocols/decibel/getApprovedBuilderFee";
import { fetchOnChainPrimaryFaBalance } from "@/lib/protocols/yield-ai/indexerFaBalance";
import {
  ACTION_KIND,
  CYCLE_SPOT_USDC_KEY,
  STRATEGY_JOURNAL_ENTRIES,
  STRATEGY_JOURNAL_VIEWS,
  fetchCycleExtraU64,
  isJournalInitialized,
  parseCycleView,
  strategyIdBytes,
} from "@/lib/protocols/yield-ai/strategyJournal";
import { ManageAuthError, assertOwnerManageAuth } from "@/lib/protocols/yield-ai/manageAuthServer";
import { addLpDeltaNeutral } from "@/lib/protocols/decibel/lpDeltaNeutralAdd";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

const DECIBEL_API_KEY = process.env.DECIBEL_API_KEY;
const DECIBEL_API_BASE_URL =
  process.env.DECIBEL_API_BASE_URL || "https://api.testnet.aptoslabs.com/decibel";
const APTOS_API_KEY = process.env.APTOS_API_KEY;

const DEFAULT_SWAP_SLIPPAGE_BPS = 50;
const DEFAULT_SWAP_DEADLINE_SECS = 120;
const INPUT_BUFFER_BPS = BigInt(20); // 0.20%
const OUT_MIN_SLIPPAGE_BPS = BigInt(100); // 1.00%
const MAX_SPOT_HEDGE_UNDERFUND_BPS = BigInt(100);
const MAX_SPOT_HEDGE_UNDERFUND_BASE_UNITS = BigInt(250_000);

function usdcBaseUnitsToHuman(baseUnits: bigint): number {
  return Number(baseUnits) / 1_000_000;
}
function maxSpotHedgeUnderfundBaseUnits(requiredUsdc: bigint): bigint {
  const pctCap = (requiredUsdc * MAX_SPOT_HEDGE_UNDERFUND_BPS) / BigInt(10_000);
  return pctCap < MAX_SPOT_HEDGE_UNDERFUND_BASE_UNITS ? pctCap : MAX_SPOT_HEDGE_UNDERFUND_BASE_UNITS;
}
function isSpotHedgeFundingAcceptable(availableUsdc: bigint, requiredUsdc: bigint): boolean {
  if (availableUsdc >= requiredUsdc) return true;
  return requiredUsdc - availableUsdc <= maxSpotHedgeUnderfundBaseUnits(requiredUsdc);
}
function spotHedgeSwapInput(availableUsdc: bigint, requiredUsdc: bigint): bigint {
  return availableUsdc >= requiredUsdc ? requiredUsdc : availableUsdc;
}

function parseAllowlist(): string[] {
  const raw = process.env.DECIBEL_EXECUTOR_ALLOWLIST || "";
  return raw.split(",").map((v) => v.trim()).filter(Boolean).map((v) => normalizeAddress(toCanonicalAddress(v)));
}

/** LP-DN private beta: FAIL CLOSED (empty/unset = nobody). Mirrors executor-open-delta-neutral. */
function parseLpDnAllowlist(): string[] {
  const raw = process.env.NEXT_PUBLIC_LP_DN_ALLOWLIST || "";
  return raw.split(",").map((v) => v.trim()).filter(Boolean).map((v) => normalizeAddress(toCanonicalAddress(v)));
}

function getAptosClientFromDecibelBaseUrl(): { aptos: Aptos; network: "mainnet" | "testnet"; isTestnet: boolean } {
  const isTestnet = DECIBEL_API_BASE_URL.includes("testnet");
  const network = isTestnet ? "testnet" : "mainnet";
  const config = new AptosConfig({
    network: isTestnet ? Network.TESTNET : Network.MAINNET,
    ...(APTOS_API_KEY && { clientConfig: { HEADERS: { Authorization: `Bearer ${APTOS_API_KEY}` } } }),
  });
  return { aptos: new Aptos(config), network, isTestnet };
}

function hasPerpsDelegationOnChain(params: { subaccountResource: unknown; executorAddress: string }): boolean {
  const { subaccountResource, executorAddress } = params;
  const exec = normalizeAddress(executorAddress);
  if (!subaccountResource || typeof subaccountResource !== "object") return false;
  const root =
    "delegated_permissions" in (subaccountResource as object)
      ? (subaccountResource as Record<string, unknown>)
      : (subaccountResource as { data?: unknown })?.data;
  if (!root || typeof root !== "object") return false;
  const delegatedPermissions = (root as { delegated_permissions?: unknown }).delegated_permissions as any;
  const entries = delegatedPermissions?.root?.children?.entries;
  if (!Array.isArray(entries)) return false;
  const normalizeKey = (k: unknown) => (typeof k === "string" ? normalizeAddress(toCanonicalAddress(k)) : "");
  const leaf = entries.find((e: any) => normalizeKey(e?.key) === exec)?.value;
  const permsEntries = leaf?.value?.perms?.entries;
  if (!Array.isArray(permsEntries)) return false;
  return permsEntries.some((pe: any) => {
    const v = pe?.key?.__variant__;
    return typeof v === "string" && v.toLowerCase().includes("perp") && v.toLowerCase().includes("trade");
  });
}

async function fetchDecibel(path: string) {
  if (!DECIBEL_API_KEY) throw new Error("Decibel API key not configured");
  const baseUrl = DECIBEL_API_BASE_URL.replace(/\/$/, "");
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${DECIBEL_API_KEY}`, "Content-Type": "application/json" },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("Invalid response from Decibel API");
  }
  if (!res.ok) {
    const msg =
      typeof data === "object" && data !== null && "message" in (data as object)
        ? String((data as { message?: string }).message)
        : `Decibel API error: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function normalizeMarketsPayload(data: unknown): Array<DecibelMarketConfig & { market_addr?: string; market_name?: string }> {
  if (Array.isArray(data)) return data as Array<DecibelMarketConfig & { market_addr?: string; market_name?: string }>;
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  const out: unknown[] = [];
  if (Array.isArray(obj.items)) out.push(...obj.items);
  if (Array.isArray(obj.markets)) out.push(...obj.markets);
  if (Array.isArray(obj.data)) out.push(...obj.data);
  return out as Array<DecibelMarketConfig & { market_addr?: string; market_name?: string }>;
}

function resolveMarketForAsset(
  asset: "BTC" | "APT",
  markets: Array<DecibelMarketConfig & { market_addr?: string; market_name?: string }>
): (DecibelMarketConfig & { market_addr: string; market_name: string }) | null {
  const base = (name: string) => name.toUpperCase().split(/[-/_\s]/)[0] || name.toUpperCase();
  const m = markets.find((x) => {
    const name = (x.market_name || "").toUpperCase();
    return !!name && (name.startsWith(`${asset}-`) || name.startsWith(`${asset}/`) || name.startsWith(`${asset}_`) || base(name) === asset);
  });
  if (!m?.market_addr || !m?.market_name) return null;
  return { ...m, market_addr: m.market_addr, market_name: m.market_name };
}

function spotAssetConfigForAsset(asset: "BTC" | "APT"): DecibelSpotAssetConfig {
  return asset === "BTC" ? getConfiguredDecibelBtcSpotAsset() : DECIBEL_APT_SPOT_ASSET;
}

type DecibelAccountPosition = { market?: string; size?: number; is_deleted?: boolean };

async function getTxVersionByHash(params: { aptos: Aptos; hash: string }): Promise<bigint | null> {
  try {
    const tx = (await params.aptos.getTransactionByHash({ transactionHash: params.hash })) as unknown;
    const v = tx && typeof tx === "object" && "version" in tx ? (tx as { version?: unknown }).version : undefined;
    if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
    if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
    return null;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function readLiveShortHuman(subaccount: string, marketAddr: string): Promise<number> {
  try {
    const raw = (await fetchDecibel(`/api/v1/account_positions?account=${encodeURIComponent(subaccount)}`)) as unknown;
    const list = Array.isArray(raw) ? (raw as DecibelAccountPosition[]) : [];
    const want = normalizeAddress(toCanonicalAddress(marketAddr));
    const row = list.find((p) => {
      if (!p || p.is_deleted) return false;
      const m = String(p.market || "");
      return !!m && normalizeAddress(toCanonicalAddress(m)) === want && Number.isFinite(Number(p.size)) && Number(p.size) < 0;
    });
    return row ? Math.abs(Number(row.size)) : 0;
  } catch {
    return 0;
  }
}

/** Poll until the live short grows beyond `beforeHuman`; returns the new total (human base). */
async function pollShortIncreased(params: {
  subaccount: string;
  marketAddr: string;
  beforeHuman: number;
  expectedAddHuman: number;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<number> {
  const { subaccount, marketAddr, beforeHuman, expectedAddHuman, timeoutMs = 20_000, intervalMs = 2_000 } = params;
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const total = await readLiveShortHuman(subaccount, marketAddr);
    if (total > beforeHuman + expectedAddHuman * 0.5) return total;
    await sleep(intervalMs);
  }
  // Fallback: assume the placed order filled fully.
  return beforeHuman + expectedAddHuman;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    // LP-hedge top-up (mode:"lp"): add USDC into the cycle's Hyperion LP + grow the short.
    // Self-contained; the spot-hold path below is unchanged. Body: { mode:"lp", owner,
    // safeAddress, subaccount, cycleId, usdcAmountInBaseUnits (u64 string), slippageBps?,
    // auth, dryRun? }. Private beta — same fail-closed allowlist as LP open.
    if (typeof body.mode === "string" && body.mode.trim().toLowerCase() === "lp") {
      const ownerRawLp = typeof body.owner === "string" ? body.owner.trim() : "";
      const safeRawLp = typeof body.safeAddress === "string" ? body.safeAddress.trim() : "";
      const subaccountRawLp = typeof body.subaccount === "string" ? body.subaccount.trim() : "";
      const cycleIdLp =
        typeof body.cycleId === "string" && /^\d+$/.test(body.cycleId.trim())
          ? body.cycleId.trim()
          : typeof body.cycleId === "number" && Number.isFinite(body.cycleId) && body.cycleId > 0
            ? String(Math.trunc(body.cycleId))
            : null;
      if (!ownerRawLp || !safeRawLp || !subaccountRawLp || !cycleIdLp) {
        return NextResponse.json(
          { success: false, error: "owner, safeAddress, subaccount, and cycleId are required" },
          { status: 400 }
        );
      }
      let usdcAmountInBaseUnits: bigint;
      try {
        usdcAmountInBaseUnits = BigInt(String(body.usdcAmountInBaseUnits ?? "").trim());
      } catch {
        return NextResponse.json(
          { success: false, error: "usdcAmountInBaseUnits must be a u64 string (USDC, 6 dp)" },
          { status: 400 }
        );
      }
      if (usdcAmountInBaseUnits <= 0n) {
        return NextResponse.json({ success: false, error: "usdcAmountInBaseUnits must be > 0" }, { status: 400 });
      }
      const lpDnAllowlist = parseLpDnAllowlist();
      if (!lpDnAllowlist.includes(normalizeAddress(toCanonicalAddress(ownerRawLp)))) {
        return NextResponse.json(
          {
            success: false,
            error: "LP delta-neutral is in private beta. Contact the team for access.",
            code: "LP_DN_BETA_RESTRICTED",
          },
          { status: 403 }
        );
      }

      const lpResult = await addLpDeltaNeutral({
        owner: ownerRawLp,
        safeAddress: safeRawLp,
        subaccount: subaccountRawLp,
        cycleId: cycleIdLp,
        usdcAmountInBaseUnits,
        slippageBps: Number.isFinite(Number(body.slippageBps)) ? Number(body.slippageBps) : undefined,
        auth: body.auth,
        dryRun: Boolean(body.dryRun),
      });
      return NextResponse.json({ success: true, data: lpResult });
    }

    const subaccountRaw = typeof body.subaccount === "string" ? body.subaccount.trim() : "";
    const ownerRaw = typeof body.owner === "string" ? body.owner.trim() : "";
    const safeRaw = typeof body.safeAddress === "string" ? body.safeAddress.trim() : "";
    const assetRaw = typeof body.asset === "string" ? body.asset.trim().toUpperCase() : "";
    const sizeUsd = Number(body.sizeUsd);
    const cycleIdRaw = body.cycleId;
    const cycleId =
      typeof cycleIdRaw === "string" && /^\d+$/.test(cycleIdRaw.trim())
        ? cycleIdRaw.trim()
        : typeof cycleIdRaw === "number" && Number.isFinite(cycleIdRaw) && cycleIdRaw > 0
          ? String(Math.trunc(cycleIdRaw))
          : null;

    if (!subaccountRaw || !ownerRaw || !safeRaw) {
      return NextResponse.json({ success: false, error: "subaccount, owner, and safeAddress are required" }, { status: 400 });
    }
    if (!cycleId) {
      return NextResponse.json({ success: false, error: "cycleId is required to add to a position" }, { status: 400 });
    }
    const canonicalSubaccount = toCanonicalAddress(subaccountRaw);
    const canonicalOwner = toCanonicalAddress(ownerRaw);
    const canonicalSafe = toCanonicalAddress(safeRaw);
    if (!canonicalSubaccount.startsWith("0x") || !canonicalOwner.startsWith("0x") || !canonicalSafe.startsWith("0x")) {
      return NextResponse.json({ success: false, error: "Invalid address" }, { status: 400 });
    }
    if (assetRaw !== "BTC" && assetRaw !== "APT") {
      return NextResponse.json({ success: false, error: "asset must be BTC or APT" }, { status: 400 });
    }
    if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) {
      return NextResponse.json({ success: false, error: "sizeUsd must be a positive number" }, { status: 400 });
    }

    const allowlist = parseAllowlist();
    if (allowlist.length > 0 && !allowlist.includes(normalizeAddress(canonicalOwner))) {
      return NextResponse.json({ success: false, error: "Owner is not allowlisted for executor trading" }, { status: 403 });
    }

    const { ownerAddress: verifiedOwner } = await assertOwnerManageAuth({
      action: "decibel_dn_add",
      fields: { safeAddress: safeRaw, subaccount: subaccountRaw, asset: assetRaw, sizeUsd, cycleId },
      auth: body.auth,
      safeAddress: canonicalSafe,
    });
    if (normalizeAddress(verifiedOwner) !== normalizeAddress(canonicalOwner)) {
      return NextResponse.json({ success: false, error: "owner does not match the signed authorization" }, { status: 403 });
    }

    const executorAddress = toCanonicalAddress(getDecibelExecutorAccount().accountAddress.toString());
    const asset = assetRaw as "BTC" | "APT";
    const { aptos, network, isTestnet } = getAptosClientFromDecibelBaseUrl();

    // Journal must be live; cycle must exist, be open, and match the asset's market.
    if (!(await isJournalInitialized(aptos))) {
      return NextResponse.json({ success: false, error: "Strategy journal is not initialized on-chain", code: "JOURNAL_NOT_INITIALIZED" }, { status: 503 });
    }

    // Delegation check (Decibel API, then on-chain fallback).
    const delegations = (await fetchDecibel(`/api/v1/delegations?subaccount=${encodeURIComponent(canonicalSubaccount)}`)) as Array<{
      delegated_account?: string;
      permission_type?: string;
      expiration_time_s?: number | null;
    }>;
    let hasDelegation = (Array.isArray(delegations) ? delegations : []).some((item) => {
      const delegated = item.delegated_account ? toCanonicalAddress(item.delegated_account) : "";
      const notExpired = typeof item.expiration_time_s === "number" ? item.expiration_time_s > Math.floor(Date.now() / 1000) : true;
      const perm = (item.permission_type || "").toLowerCase();
      return delegated && normalizeAddress(delegated) === normalizeAddress(executorAddress) && notExpired && perm.includes("trade") && perm.includes("perp");
    });
    if (!hasDelegation) {
      try {
        const subRes = await aptos.getAccountResource({
          accountAddress: canonicalSubaccount,
          resourceType: `${isTestnet ? PACKAGE_TESTNET : PACKAGE_MAINNET}::dex_accounts::Subaccount`,
        });
        hasDelegation = hasPerpsDelegationOnChain({ subaccountResource: subRes, executorAddress });
      } catch {
        // ignore — handled below
      }
    }
    if (!hasDelegation) {
      return NextResponse.json({ success: false, error: "No active delegation to executor for this subaccount" }, { status: 403 });
    }

    // Resolve market + mark price.
    const markets = normalizeMarketsPayload(await fetchDecibel("/api/v1/markets"));
    const selectedMarket = resolveMarketForAsset(asset, markets);
    if (!selectedMarket) {
      return NextResponse.json({ success: false, error: `Market not found for asset ${assetRaw}` }, { status: 404 });
    }

    // Validate the cycle and that it belongs to this market.
    const cycleRaw = await aptos.view({
      payload: { function: STRATEGY_JOURNAL_VIEWS.getCycle, typeArguments: [], functionArguments: [canonicalSafe, cycleId] },
    });
    const cycle = parseCycleView(cycleRaw);
    if (!cycle || !cycle.recordExists) {
      return NextResponse.json({ success: false, error: `No journal cycle #${cycleId} for this safe` }, { status: 404 });
    }
    if (!cycle.isOpen) {
      return NextResponse.json({ success: false, error: `Journal cycle #${cycleId} is already closed` }, { status: 400 });
    }
    if (normalizeAddress(toCanonicalAddress(cycle.perpMarket)) !== normalizeAddress(toCanonicalAddress(selectedMarket.market_addr))) {
      return NextResponse.json({ success: false, error: "Selected asset does not match the cycle's market" }, { status: 400 });
    }

    const prices = (await fetchDecibel(`/api/v1/prices?market=${encodeURIComponent(selectedMarket.market_addr)}`)) as Array<{ mark_px?: number; mid_px?: number }>;
    const markPx = Number((Array.isArray(prices) ? prices[0] : null)?.mark_px ?? (Array.isArray(prices) ? prices[0] : null)?.mid_px ?? NaN);
    if (!Number.isFinite(markPx) || markPx <= 0) {
      return NextResponse.json({ success: false, error: "Failed to resolve mark price" }, { status: 502 });
    }

    const spotAsset = spotAssetConfigForAsset(asset);
    const spotMetadata = toCanonicalAddress(spotAsset.metadata);

    // Pre-flight: the safe must hold enough USDC for the ADDED spot leg.
    const addShortChain = BigInt(decibelOpenOrderSizeChainUnits(sizeUsd, markPx, selectedMarket));
    const addShortHuman = decibelChainUnitsToHumanBase(addShortChain, selectedMarket.sz_decimals ?? 9);
    const targetSpotOutBaseUnits =
      Number.isFinite(addShortHuman) && addShortHuman > 0
        ? BigInt(Math.max(1, Math.ceil(addShortHuman * 10 ** spotAsset.decimals)))
        : BigInt(0);
    if (targetSpotOutBaseUnits <= BigInt(0)) {
      return NextResponse.json({ success: false, error: "Failed to size the added spot leg" }, { status: 502 });
    }
    let preflightQuoteUsdcIn: bigint;
    try {
      preflightQuoteUsdcIn = await getHyperionAmountIn({ amountOutBaseUnits: targetSpotOutBaseUnits, fromMetadata: USDC_FA_METADATA_MAINNET, toMetadata: spotMetadata });
    } catch {
      return NextResponse.json({ success: false, error: "Unable to quote the added spot hedge. Try again shortly.", code: "SPOT_HEDGE_PREFLIGHT_QUOTE_FAILED" }, { status: 502 });
    }
    const requiredUsdc = (preflightQuoteUsdcIn * (BigInt(10_000) + INPUT_BUFFER_BPS)) / BigInt(10_000);
    const safeUsdcBalance = await fetchOnChainPrimaryFaBalance(aptos, canonicalSafe, USDC_FA_METADATA_MAINNET);
    if (!isSpotHedgeFundingAcceptable(safeUsdcBalance, requiredUsdc)) {
      return NextResponse.json(
        {
          success: false,
          code: "SAFE_USDC_INSUFFICIENT_FOR_SPOT_HEDGE",
          error: `Safe USDC too low for the added spot. Need ${usdcBaseUnitsToHuman(requiredUsdc).toFixed(6)}, have ${usdcBaseUnitsToHuman(safeUsdcBalance).toFixed(6)}.`,
          data: { requiredUsdc: usdcBaseUnitsToHuman(requiredUsdc), availableUsdc: usdcBaseUnitsToHuman(safeUsdcBalance) },
        },
        { status: 422 }
      );
    }

    // Builder fee (same gating as open).
    const builderAddrEnv = process.env.DECIBEL_BUILDER_ADDRESS?.trim() || null;
    const builderFeeEnvRaw = process.env.DECIBEL_BUILDER_FEE_BPS?.trim();
    const builderFeeEnv = builderFeeEnvRaw != null && builderFeeEnvRaw !== "" ? Number(builderFeeEnvRaw) : 10;
    let orderBuilderAddr: string | null = null;
    let orderBuilderFeeBps: number | null = null;
    if (builderAddrEnv && Number.isFinite(builderFeeEnv) && builderFeeEnv > 0 && builderFeeEnv <= 10_000) {
      const approvedBps = await getApprovedBuilderFeeBps({ aptos, subaccount: canonicalSubaccount, builder: builderAddrEnv, isTestnet });
      if (approvedBps != null && approvedBps >= builderFeeEnv) {
        orderBuilderAddr = toCanonicalAddress(builderAddrEnv);
        orderBuilderFeeBps = builderFeeEnv;
      }
    }

    // 1) Increase the short (margin drawn from the subaccount's free USDC). No configure_user_settings
    //    here — Decibel aborts settings changes while a position is open; leverage was set at open.
    const shortBeforeHuman = await readLiveShortHuman(canonicalSubaccount, selectedMarket.market_addr);
    const openPayload = buildOpenMarketOrderPayload({
      subaccountAddr: canonicalSubaccount,
      marketAddr: selectedMarket.market_addr,
      orderSizeUsd: sizeUsd,
      markPx,
      marketConfig: selectedMarket,
      isLong: false,
      slippageBps: DEFAULT_SWAP_SLIPPAGE_BPS,
      isTestnet,
      builderAddr: orderBuilderAddr,
      builderFeeBps: orderBuilderFeeBps,
    });
    const openTxHash = await submitExecutorEntryFunction({
      network,
      fn: openPayload.function,
      functionArguments: openPayload.functionArguments as (string | number | boolean | bigint | null)[],
      maxGasAmount: 30_000,
    });
    const decibelTxVersion = await getTxVersionByHash({ aptos, hash: openTxHash });

    // 2) Read the new total short, derive the actually-added size, and buy the matching spot.
    const shortTotalHuman = await pollShortIncreased({
      subaccount: canonicalSubaccount,
      marketAddr: selectedMarket.market_addr,
      beforeHuman: shortBeforeHuman,
      expectedAddHuman: addShortHuman,
    });
    const addedHuman = Math.max(0, shortTotalHuman - shortBeforeHuman);
    const totalShortChain = BigInt(decibelHumanAbsBaseToOrderChainUnits(shortTotalHuman, selectedMarket));
    const addedSpotOutBaseUnits =
      addedHuman > 0
        ? BigInt(Math.max(1, Math.ceil(addedHuman * 10 ** spotAsset.decimals)))
        : targetSpotOutBaseUnits;

    let quoteUsdcInBaseUnits: bigint | null = null;
    try {
      quoteUsdcInBaseUnits = await getHyperionAmountIn({ amountOutBaseUnits: addedSpotOutBaseUnits, fromMetadata: USDC_FA_METADATA_MAINNET, toMetadata: spotMetadata });
    } catch {
      quoteUsdcInBaseUnits = null;
    }
    const bufferedUsdcIn =
      quoteUsdcInBaseUnits != null && quoteUsdcInBaseUnits > BigInt(0)
        ? (quoteUsdcInBaseUnits * (BigInt(10_000) + INPUT_BUFFER_BPS)) / BigInt(10_000)
        : requiredUsdc;
    const usdcAmountIn = spotHedgeSwapInput(safeUsdcBalance, bufferedUsdcIn);
    const amountOutMin = (addedSpotOutBaseUnits * (BigInt(10_000) - OUT_MIN_SLIPPAGE_BPS)) / BigInt(10_000);

    const { swapTxHash } = await submitSwapFaToFaWithFallbackLimits({
      network,
      safe: canonicalSafe,
      feeTier: spotAsset.feeTier,
      amountIn: usdcAmountIn,
      amountOutMin,
      fromMetadata: USDC_FA_METADATA_MAINNET,
      toMetadata: spotMetadata,
      deadline: BigInt(Math.floor(Date.now() / 1000) + DEFAULT_SWAP_DEADLINE_SECS),
      direction: "oneForZero",
      maxGasAmount: 80_000,
    });

    // 3) Record the add: new CURRENT totals for both legs.
    const baseExposureAfter = (() => {
      try {
        return BigInt(cycle.baseExposure) + addedSpotOutBaseUnits;
      } catch {
        return addedSpotOutBaseUnits;
      }
    })();
    const recordActionTxHash = await submitExecutorEntryFunction({
      network,
      fn: STRATEGY_JOURNAL_ENTRIES.recordAction,
      functionArguments: [
        canonicalSafe,
        cycleId,
        ACTION_KIND.liquidityAdd, // 3 — top-up of both legs
        baseExposureAfter, // base_exposure_after
        totalShortChain, // perp_short_size_after
        usdcAmountIn, // usdc_delta (USDC spent on the added spot)
        decibelTxVersion ?? BigInt(0), // related_tx_version (the Decibel increase tx)
      ],
      maxGasAmount: 60_000,
    });

    // Increment cumulative spot USDC (= prior + this add) for add-aware PnL. Best-effort.
    try {
      const prev =
        (await fetchCycleExtraU64(aptos, canonicalSafe, cycleId, CYCLE_SPOT_USDC_KEY)) ??
        (() => {
          try {
            return BigInt(cycle.usdcNotionalOpen);
          } catch {
            return BigInt(0);
          }
        })();
      await submitExecutorEntryFunction({
        network,
        fn: STRATEGY_JOURNAL_ENTRIES.setCycleExtraU64,
        functionArguments: [canonicalSafe, cycleId, strategyIdBytes(CYCLE_SPOT_USDC_KEY), prev + usdcAmountIn],
        maxGasAmount: 30_000,
      });
    } catch (err) {
      console.warn("[Decibel] executor-add-delta-neutral: set_cycle_extra_u64(spot_usdc) failed; non-fatal", err);
    }

    return NextResponse.json({
      success: true,
      data: {
        owner: canonicalOwner,
        safeAddress: canonicalSafe,
        subaccount: canonicalSubaccount,
        cycleId,
        asset: assetRaw,
        sizeUsd,
        marketAddr: selectedMarket.market_addr,
        marketName: selectedMarket.market_name,
        openTxHash,
        swapTxHash,
        recordActionTxHash,
        addedShortHuman: addedHuman,
        shortTotalHuman,
        baseExposureAfter: baseExposureAfter.toString(),
        usdcAmountIn: usdcAmountIn.toString(),
        decibelTxVersion: decibelTxVersion?.toString() ?? null,
      },
    });
  } catch (error) {
    console.error("[Decibel] executor-add-delta-neutral error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: error instanceof ManageAuthError ? error.status : 500 }
    );
  }
}
