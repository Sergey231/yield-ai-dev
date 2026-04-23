import { NextRequest, NextResponse } from "next/server";
import { toCanonicalAddress, normalizeAddress } from "@/lib/utils/addressNormalization";
import { buildConfigureUserSettingsPayload } from "@/lib/protocols/decibel/configureUserSettings";
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
import {
  USDC_FA_METADATA_MAINNET,
  XBTC_FA_METADATA_MAINNET,
  YIELD_AI_PACKAGE_ADDRESS,
} from "@/lib/constants/yieldAiVault";
import { hedgeUsdcThreshold } from "@/lib/protocols/decibel/hedgePrefill";
import { submitSwapFaToFaWithFallbackLimits } from "@/lib/protocols/yield-ai/swapFaToFa";
import { HyperionSwapService } from "@/lib/services/protocols/hyperion/swap";
import {
  DELTA_NEUTRAL_IS_OPEN_VIEW,
} from "@/lib/protocols/yield-ai/deltaNeutralViews";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

type DelegationDto = {
  delegated_account?: string;
  permission_type?: string;
  expiration_time_s?: number | null;
};

const DECIBEL_API_KEY = process.env.DECIBEL_API_KEY;
const DECIBEL_API_BASE_URL =
  process.env.DECIBEL_API_BASE_URL || "https://api.testnet.aptoslabs.com/decibel";
const APTOS_API_KEY = process.env.APTOS_API_KEY;

const DEFAULT_SWAP_SLIPPAGE_BPS = 50;
const DEFAULT_SWAP_DEADLINE_SECS = 120;

const XBTC_USDC_FEE_TIER = 1; // 0.05%
const XBTC_DECIMALS = 8;

/**
 * Quote-driven hedge sizing parameters.
 * - INPUT_BUFFER_BPS: extra USDC on top of the exact-out quote to absorb fee + tick movement.
 * - OUT_MIN_SLIPPAGE_BPS: max acceptable shortfall below the target xBTC out (the filled short).
 * - FIXED_USDC_BUFFER_BASE: small absolute USDC padding (in 6-dec base units).
 */
const INPUT_BUFFER_BPS = BigInt(50); // 0.50%
const OUT_MIN_SLIPPAGE_BPS = BigInt(100); // 1.00%
const FIXED_USDC_BUFFER_BASE = BigInt(10_000); // 0.01 USDC

function parseAllowlist(): string[] {
  const raw = process.env.DECIBEL_EXECUTOR_ALLOWLIST || "";
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => normalizeAddress(toCanonicalAddress(v)));
}

function getAptosClientFromDecibelBaseUrl(): { aptos: Aptos; network: "mainnet" | "testnet"; isTestnet: boolean } {
  const isTestnet = DECIBEL_API_BASE_URL.includes("testnet");
  const network = isTestnet ? "testnet" : "mainnet";
  const aptosNetwork = isTestnet ? Network.TESTNET : Network.MAINNET;
  const config = new AptosConfig({
    network: aptosNetwork,
    ...(APTOS_API_KEY && { clientConfig: { HEADERS: { Authorization: `Bearer ${APTOS_API_KEY}` } } }),
  });
  return { aptos: new Aptos(config), network, isTestnet };
}

function hasPerpsDelegationOnChain(params: { subaccountResource: unknown; executorAddress: string }): boolean {
  const { subaccountResource, executorAddress } = params;
  const exec = normalizeAddress(executorAddress);
  if (!subaccountResource || typeof subaccountResource !== "object") return false;

  // Aptos TS SDK getAccountResource returns the resource data directly.
  // Some other callers may wrap it as { data }. Support both shapes.
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
    if (typeof v !== "string") return false;
    const s = v.toLowerCase();
    return s.includes("perp") && s.includes("trade");
  });
}

async function fetchDecibel(path: string) {
  if (!DECIBEL_API_KEY) throw new Error("Decibel API key not configured");
  const baseUrl = DECIBEL_API_BASE_URL.replace(/\/$/, "");
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${DECIBEL_API_KEY}`,
      "Content-Type": "application/json",
    },
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

function resolveMarketForAsset(
  asset: "BTC",
  markets: Array<DecibelMarketConfig & { market_addr?: string; market_name?: string }>
): (DecibelMarketConfig & { market_addr: string; market_name: string }) | null {
  const extractBaseSymbol = (name: string): string => {
    const upper = name.toUpperCase();
    return upper.split(/[-/_\s]/)[0] || upper;
  };
  const candidates = markets.filter((m) => {
    const name = (m.market_name || "").toUpperCase();
    if (!name) return false;
    if (name.startsWith(`${asset}-`) || name.startsWith(`${asset}/`) || name.startsWith(`${asset}_`)) {
      return true;
    }
    return extractBaseSymbol(name) === asset;
  });
  const selected = candidates[0];
  if (!selected?.market_addr || !selected?.market_name) return null;
  return {
    ...selected,
    market_addr: selected.market_addr,
    market_name: selected.market_name,
  };
}

function normalizeMarketsPayload(data: unknown): Array<DecibelMarketConfig & { market_addr?: string; market_name?: string }> {
  if (Array.isArray(data)) return data as Array<DecibelMarketConfig & { market_addr?: string; market_name?: string }>;
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  const candidates: unknown[] = [];
  if (Array.isArray(obj.items)) candidates.push(...obj.items);
  if (Array.isArray(obj.markets)) candidates.push(...obj.markets);
  if (Array.isArray(obj.data)) candidates.push(...obj.data);
  return candidates as Array<DecibelMarketConfig & { market_addr?: string; market_name?: string }>;
}

function spotMetadataForAsset(asset: "BTC"): string {
  return asset === "BTC" ? XBTC_FA_METADATA_MAINNET : XBTC_FA_METADATA_MAINNET;
}

function utf8BytesArray(s: string): number[] {
  if (!s) return [];
  const bytes = new TextEncoder().encode(s);
  return Array.from(bytes);
}

function defaultFeeTier(asset: "BTC"): number {
  // Based on existing mainnet examples for BTC pools.
  return asset === "BTC" ? XBTC_USDC_FEE_TIER : XBTC_USDC_FEE_TIER;
}

function usdcAmountInFromSizeUsd(sizeUsd: number): bigint {
  // Use the same buffer policy as the UI hedge prefill.
  const human = hedgeUsdcThreshold(sizeUsd);
  // Convert to base units (6 decimals) safely.
  const base = Math.round(human * 1_000_000);
  return BigInt(Math.max(0, base));
}

async function getTxVersionByHash(params: { aptos: Aptos; hash: string }): Promise<bigint | null> {
  try {
    const tx = (await params.aptos.getTransactionByHash({
      transactionHash: params.hash,
    })) as unknown;
    const v =
      tx && typeof tx === "object" && "version" in tx ? (tx as { version?: unknown }).version : undefined;
    if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
    if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
    return null;
  } catch {
    return null;
  }
}

type DecibelAccountPosition = {
  market?: string;
  size?: number;
  is_deleted?: boolean;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollDecibelFilledShortSizeChainUnits(params: {
  subaccount: string;
  marketAddr: string;
  marketConfig: DecibelMarketConfig;
  orderSizeUsd: number;
  markPx: number;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<bigint> {
  const {
    subaccount,
    marketAddr,
    marketConfig,
    orderSizeUsd,
    markPx,
    timeoutMs = 20_000,
    intervalMs = 2_000,
  } = params;
  const started = Date.now();
  const want = normalizeAddress(toCanonicalAddress(marketAddr));
  const placedFallback = BigInt(decibelOpenOrderSizeChainUnits(orderSizeUsd, markPx, marketConfig));

  while (Date.now() - started <= timeoutMs) {
    const positionsRaw = (await fetchDecibel(
      `/api/v1/account_positions?account=${encodeURIComponent(subaccount)}`
    )) as unknown;
    const list = Array.isArray(positionsRaw) ? (positionsRaw as DecibelAccountPosition[]) : [];
    const row = list.find((p) => {
      if (!p || p.is_deleted) return false;
      const m = String(p.market || "");
      if (!m) return false;
      if (normalizeAddress(toCanonicalAddress(m)) !== want) return false;
      const sz = Number(p.size);
      return Number.isFinite(sz) && sz < 0;
    });
    const absHuman = row ? Math.abs(Number(row.size)) : 0;
    if (Number.isFinite(absHuman) && absHuman > 0) {
      const chainNum = decibelHumanAbsBaseToOrderChainUnits(absHuman, marketConfig);
      if (chainNum > 0) return BigInt(chainNum);
    }
    await sleep(intervalMs);
  }

  if (placedFallback > BigInt(0)) {
    console.warn(
      "[Decibel] executor-open-delta-neutral: account_positions timeout; using placed order chain size (same formula as place_order)"
    );
    return placedFallback;
  }
  throw new Error("Decibel position size not available yet (account_positions lag). Try again in a few seconds.");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    const subaccountRaw = typeof body.subaccount === "string" ? body.subaccount.trim() : "";
    const ownerRaw = typeof body.owner === "string" ? body.owner.trim() : "";
    const safeRaw = typeof body.safeAddress === "string" ? body.safeAddress.trim() : "";
    const assetRaw = typeof body.asset === "string" ? body.asset.trim().toUpperCase() : "";
    const sizeUsd = Number(body.sizeUsd);

    if (!subaccountRaw || !ownerRaw || !safeRaw) {
      return NextResponse.json(
        { success: false, error: "subaccount, owner, and safeAddress are required" },
        { status: 400 }
      );
    }

    const canonicalSubaccount = toCanonicalAddress(subaccountRaw);
    const canonicalOwner = toCanonicalAddress(ownerRaw);
    const canonicalSafe = toCanonicalAddress(safeRaw);
    if (!canonicalSubaccount.startsWith("0x") || !canonicalOwner.startsWith("0x") || !canonicalSafe.startsWith("0x")) {
      return NextResponse.json({ success: false, error: "Invalid address" }, { status: 400 });
    }

    if (assetRaw !== "BTC") {
      return NextResponse.json({ success: false, error: "asset must be BTC" }, { status: 400 });
    }

    if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) {
      return NextResponse.json({ success: false, error: "sizeUsd must be a positive number" }, { status: 400 });
    }

    const allowlist = parseAllowlist();
    if (allowlist.length > 0 && !allowlist.includes(normalizeAddress(canonicalOwner))) {
      return NextResponse.json(
        { success: false, error: "Owner is not allowlisted for executor trading" },
        { status: 403 }
      );
    }

    const executorAddress = toCanonicalAddress(getDecibelExecutorAccount().accountAddress.toString());
    if (!executorAddress) {
      return NextResponse.json({ success: false, error: "Executor address is not configured" }, { status: 503 });
    }

    // 1) Ensure delegation exists (Decibel API first; fall back to on-chain state if API lags indexing).
    const delegations = (await fetchDecibel(
      `/api/v1/delegations?subaccount=${encodeURIComponent(canonicalSubaccount)}`
    )) as DelegationDto[];
    const hasPerpsDelegation = (Array.isArray(delegations) ? delegations : []).some((item) => {
      const delegated = item.delegated_account ? toCanonicalAddress(item.delegated_account) : "";
      const notExpired =
        typeof item.expiration_time_s === "number" ? item.expiration_time_s > Math.floor(Date.now() / 1000) : true;
      const permission = (item.permission_type || "").toLowerCase();
      return (
        delegated &&
        normalizeAddress(delegated) === normalizeAddress(executorAddress) &&
        notExpired &&
        permission.includes("trade") &&
        permission.includes("perp")
      );
    });

    let hasDelegation = hasPerpsDelegation;
    let chainHasPerpsDelegation: boolean | null = null;

    if (!hasDelegation) {
      const { aptos: chainAptos, isTestnet } = getAptosClientFromDecibelBaseUrl();
      const pkg = isTestnet ? PACKAGE_TESTNET : PACKAGE_MAINNET;
      try {
        const subRes = await chainAptos.getAccountResource({
          accountAddress: canonicalSubaccount,
          resourceType: `${pkg}::dex_accounts::Subaccount`,
        });
        chainHasPerpsDelegation = hasPerpsDelegationOnChain({
          subaccountResource: subRes,
          executorAddress,
        });
        hasDelegation = chainHasPerpsDelegation;
      } catch {
        chainHasPerpsDelegation = null;
      }
    }

    if (!hasDelegation) {
      return NextResponse.json(
        {
          success: false,
          error: "No active delegation to executor for this subaccount",
          debug: {
            executorAddress,
            apiHasPerpsDelegation: hasPerpsDelegation,
            chainHasPerpsDelegation,
            apiDelegations: (Array.isArray(delegations) ? delegations : []).map((d) => ({
              delegated_account: d.delegated_account ?? null,
              permission_type: d.permission_type ?? null,
              expiration_time_s: d.expiration_time_s ?? null,
            })),
          },
        },
        { status: 403 }
      );
    }

    // 2) Resolve market + mark price.
    const marketsRaw = await fetchDecibel("/api/v1/markets");
    const markets = normalizeMarketsPayload(marketsRaw);
    const selectedMarket = resolveMarketForAsset("BTC", markets);
    if (!selectedMarket) {
      return NextResponse.json({ success: false, error: `Market not found for asset ${assetRaw}` }, { status: 404 });
    }

    const prices = (await fetchDecibel(
      `/api/v1/prices?market=${encodeURIComponent(selectedMarket.market_addr)}`
    )) as Array<{ mark_px?: number; mid_px?: number }>;
    const firstPrice = Array.isArray(prices) ? prices[0] : null;
    const markPx = Number(firstPrice?.mark_px ?? firstPrice?.mid_px ?? NaN);
    if (!Number.isFinite(markPx) || markPx <= 0) {
      return NextResponse.json({ success: false, error: "Failed to resolve mark price" }, { status: 502 });
    }

    const { aptos, network, isTestnet } = getAptosClientFromDecibelBaseUrl();

    // 2a) Pre-flight: refuse if this safe already has a delta-neutral record open on-chain.
    // Prevents creating a duplicate record (which would abort later in `record_open`).
    try {
      const isOpenView = (await aptos.view({
        payload: {
          function: DELTA_NEUTRAL_IS_OPEN_VIEW,
          typeArguments: [],
          functionArguments: [canonicalSafe],
        },
      })) as unknown;
      const isOpen =
        Array.isArray(isOpenView) && isOpenView.length > 0
          ? isOpenView[0] === true || isOpenView[0] === "true"
          : false;
      if (isOpen) {
        return NextResponse.json(
          {
            success: false,
            error:
              "This safe already has an open delta-neutral position. Close it before opening a new one.",
            code: "DELTA_NEUTRAL_ALREADY_OPEN",
          },
          { status: 409 }
        );
      }
    } catch (err) {
      // Non-fatal: if the view call itself fails we proceed and let `record_open` fail explicitly.
      console.warn(
        "[Decibel] executor-open-delta-neutral: delta_neutral::is_delta_neutral_open view failed; continuing",
        err
      );
    }

    // 2b) Pre-flight: refuse if the subaccount already holds an open position on the SAME market.
    // Guards against layering a second short on top of an existing one (asymmetric to the DN record).
    try {
      const positionsRaw = (await fetchDecibel(
        `/api/v1/account_positions?account=${encodeURIComponent(canonicalSubaccount)}`
      )) as unknown;
      const list = Array.isArray(positionsRaw) ? (positionsRaw as DecibelAccountPosition[]) : [];
      const wantedMarket = normalizeAddress(toCanonicalAddress(selectedMarket.market_addr));
      const existing = list.find((p) => {
        if (!p || p.is_deleted) return false;
        const m = String(p.market || "");
        if (!m) return false;
        if (normalizeAddress(toCanonicalAddress(m)) !== wantedMarket) return false;
        const sz = Number(p.size);
        return Number.isFinite(sz) && sz !== 0;
      });
      if (existing) {
        return NextResponse.json(
          {
            success: false,
            error: `Decibel subaccount already has an open position on market ${selectedMarket.market_name}. Close it before opening a delta-neutral on the same market.`,
            code: "DECIBEL_POSITION_ON_MARKET",
            debug: {
              marketAddr: selectedMarket.market_addr,
              marketName: selectedMarket.market_name,
              size: existing.size ?? null,
            },
          },
          { status: 409 }
        );
      }
    } catch (err) {
      console.warn(
        "[Decibel] executor-open-delta-neutral: account_positions pre-flight failed; continuing",
        err
      );
    }

    // 3) Configure leverage/margin mode and open Decibel short (tx1+tx1b).
    const configurePayload = buildConfigureUserSettingsPayload({
      subaccountAddr: canonicalSubaccount,
      marketAddr: selectedMarket.market_addr,
      isCross: true,
      userLeverage: 1,
      isTestnet,
    });
    const configureTxHash = await submitExecutorEntryFunction({
      network,
      fn: configurePayload.function,
      functionArguments: configurePayload.functionArguments as (string | number | boolean | bigint | null)[],
      maxGasAmount: 20_000,
    });

    const openPayload = buildOpenMarketOrderPayload({
      subaccountAddr: canonicalSubaccount,
      marketAddr: selectedMarket.market_addr,
      orderSizeUsd: sizeUsd,
      markPx,
      marketConfig: selectedMarket,
      isLong: false,
      slippageBps: DEFAULT_SWAP_SLIPPAGE_BPS,
      isTestnet,
    });
    const openTxHash = await submitExecutorEntryFunction({
      network,
      fn: openPayload.function,
      functionArguments: openPayload.functionArguments as (string | number | boolean | bigint | null)[],
      maxGasAmount: 30_000,
    });

    const decibelTxVersion = await getTxVersionByHash({ aptos, hash: openTxHash });

    const placedOrderChainSize = BigInt(decibelOpenOrderSizeChainUnits(sizeUsd, markPx, selectedMarket));

    const filledShortSize = await pollDecibelFilledShortSizeChainUnits({
      subaccount: canonicalSubaccount,
      marketAddr: selectedMarket.market_addr,
      marketConfig: selectedMarket,
      orderSizeUsd: sizeUsd,
      markPx,
    });

    const szDecimals = selectedMarket.sz_decimals ?? 9;
    const filledShortHumanBase = decibelChainUnitsToHumanBase(filledShortSize, szDecimals);
    const shortNotionalUsd = filledShortHumanBase * markPx;
    const spotMetadata = toCanonicalAddress(spotMetadataForAsset("BTC"));
    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_SWAP_DEADLINE_SECS);

    // Target xBTC out in FA base units (decimals = 8). Snap-up to avoid losing dust.
    const desiredXbtcOutBaseUnits =
      Number.isFinite(filledShortHumanBase) && filledShortHumanBase > 0
        ? BigInt(Math.max(1, Math.ceil(filledShortHumanBase * 10 ** XBTC_DECIMALS)))
        : BigInt(0);

    // (B) Ask Hyperion for an exact-out quote: how much USDC we need for the filled short xBTC.
    let quoteUsdcInBaseUnits: bigint | null = null;
    if (desiredXbtcOutBaseUnits > BigInt(0)) {
      try {
        const hyperion = HyperionSwapService.getInstance();
        const est = await hyperion.estFromAmount({
          amount: Number(desiredXbtcOutBaseUnits),
          from: USDC_FA_METADATA_MAINNET,
          to: XBTC_FA_METADATA_MAINNET,
          safeMode: true,
        });
        const raw =
          (est as any)?.amountIn ??
          (est as any)?.amount_in ??
          (est as any)?.amount ??
          null;
        if (typeof raw === "string" && /^\d+$/.test(raw)) {
          quoteUsdcInBaseUnits = BigInt(raw);
        } else if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
          quoteUsdcInBaseUnits = BigInt(Math.ceil(raw));
        }
      } catch (err) {
        console.warn(
          "[Decibel] executor-open-delta-neutral: Hyperion estFromAmount failed; falling back to mark-px sizing",
          err
        );
      }
    }

    let usdcAmountIn: bigint;
    let amountOutMin: bigint;
    if (quoteUsdcInBaseUnits != null && quoteUsdcInBaseUnits > BigInt(0)) {
      // Input = exact-out quote + 0.5% + $0.01 as safety margin for fee/tick drift.
      usdcAmountIn =
        (quoteUsdcInBaseUnits * (BigInt(10_000) + INPUT_BUFFER_BPS)) / BigInt(10_000) +
        FIXED_USDC_BUFFER_BASE;
      // Require at least (filledShort * (1 - 1%)) xBTC on output — blocks undersized hedges.
      amountOutMin =
        (desiredXbtcOutBaseUnits * (BigInt(10_000) - OUT_MIN_SLIPPAGE_BPS)) / BigInt(10_000);
    } else {
      // Fallback: previous mark-px-driven sizing with `hedgeUsdcThreshold` (50bps + $0.01).
      usdcAmountIn = usdcAmountInFromSizeUsd(
        Number.isFinite(shortNotionalUsd) && shortNotionalUsd > 0 ? shortNotionalUsd : sizeUsd
      );
      amountOutMin = BigInt(0);
    }

    // (A) Submit the USDC -> xBTC swap through the shared helper with oneForZero direction.
    const { swapTxHash, usedSqrtPriceLimit } = await submitSwapFaToFaWithFallbackLimits({
      network,
      safe: canonicalSafe,
      feeTier: defaultFeeTier("BTC"),
      amountIn: usdcAmountIn,
      amountOutMin,
      fromMetadata: USDC_FA_METADATA_MAINNET,
      toMetadata: spotMetadata,
      deadline,
      direction: "oneForZero",
      maxGasAmount: 80_000,
    });

    // 5) Record open (tx3). Uses best-effort snapshots.
    const pkg = isTestnet ? PACKAGE_TESTNET : PACKAGE_MAINNET;
    const recordOpenFn = `${YIELD_AI_PACKAGE_ADDRESS}::delta_neutral::record_open`;
    const recordOpenTxHash = await submitExecutorEntryFunction({
      network,
      fn: recordOpenFn,
      functionArguments: [
        canonicalSafe,
        canonicalSubaccount,
        selectedMarket.market_addr,
        spotMetadata,
        filledShortSize,
        usdcAmountIn, // usdc_swapped_in
        decibelTxVersion ?? BigInt(0),
        utf8BytesArray(""), // client_order_id_bytes
      ],
      maxGasAmount: 60_000,
    });

    return NextResponse.json({
      success: true,
      data: {
        owner: canonicalOwner,
        safeAddress: canonicalSafe,
        subaccount: canonicalSubaccount,
        asset: assetRaw,
        sizeUsd,
        marketAddr: selectedMarket.market_addr,
        marketName: selectedMarket.market_name,
        executorAddress,
        configureTxHash,
        openTxHash,
        swapTxHash,
        recordOpenTxHash,
        spotMetadata,
        usdcAmountIn: usdcAmountIn.toString(),
        amountOutMin: amountOutMin.toString(),
        desiredXbtcOutBaseUnits: desiredXbtcOutBaseUnits.toString(),
        quoteUsdcInBaseUnits: quoteUsdcInBaseUnits?.toString() ?? null,
        usedSqrtPriceLimit: usedSqrtPriceLimit.toString(),
        filledShortSize: filledShortSize.toString(),
        placedOrderChainSize: placedOrderChainSize.toString(),
        filledShortHumanBase,
        shortNotionalUsd,
        decibelTxVersion: decibelTxVersion?.toString() ?? null,
        decibelPackage: pkg,
      },
    });
  } catch (error) {
    console.error("[Decibel] executor-open-delta-neutral error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

