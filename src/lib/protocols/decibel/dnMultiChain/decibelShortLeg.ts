import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { buildConfigureUserSettingsPayload } from "@/lib/protocols/decibel/configureUserSettings";
import {
  buildCloseAtMarketPayload,
  buildOpenMarketOrderPayload,
  decibelChainUnitsToHumanBase,
  decibelHumanAbsBaseToOrderChainUnits,
  decibelOpenOrderSizeChainUnits,
  PACKAGE_MAINNET,
  PACKAGE_TESTNET,
  type DecibelMarketConfig,
} from "@/lib/protocols/decibel/closePosition";
import {
  fetchDecibel,
  fetchDecibelMarkPx,
  normalizeDecibelMarketsPayload,
  resolveDecibelMarketByName,
} from "@/lib/protocols/decibel/decibelApi";
import { getDecibelExecutorAccount, submitExecutorEntryFunction } from "@/lib/protocols/decibel/executorSubmit";
import { getApprovedBuilderFeeBps } from "@/lib/protocols/decibel/getApprovedBuilderFee";
import { normalizeAddress, toCanonicalAddress } from "@/lib/utils/addressNormalization";

const DECIBEL_API_BASE_URL =
  process.env.DECIBEL_API_BASE_URL || "https://api.testnet.aptoslabs.com/decibel";
const APTOS_API_KEY = process.env.APTOS_API_KEY;
const DEFAULT_SLIPPAGE_BPS = 50;

type DelegationDto = {
  delegated_account?: string;
  permission_type?: string;
  expiration_time_s?: number | null;
};

type DecibelAccountPosition = {
  market?: string;
  size?: number;
  is_deleted?: boolean;
};

export type DecibelNetworkContext = {
  aptos: Aptos;
  network: "mainnet" | "testnet";
  isTestnet: boolean;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function getDecibelNetworkContext(): DecibelNetworkContext {
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

  const root =
    "delegated_permissions" in (subaccountResource as object)
      ? (subaccountResource as Record<string, unknown>)
      : (subaccountResource as { data?: unknown })?.data;
  if (!root || typeof root !== "object") return false;

  const delegatedPermissions = (root as { delegated_permissions?: unknown }).delegated_permissions as {
    root?: { children?: { entries?: unknown[] } };
  };
  const entries = delegatedPermissions?.root?.children?.entries;
  if (!Array.isArray(entries)) return false;

  const normalizeKey = (k: unknown) => (typeof k === "string" ? normalizeAddress(toCanonicalAddress(k)) : "");
  const leaf = (entries as Array<{ key?: unknown; value?: { value?: { perms?: { entries?: unknown[] } } } }>).find(
    (e) => normalizeKey(e?.key) === exec
  )?.value;
  const permsEntries = leaf?.value?.perms?.entries;
  if (!Array.isArray(permsEntries)) return false;

  return permsEntries.some((pe: unknown) => {
    const v = (pe as { key?: { __variant__?: string } })?.key?.__variant__;
    if (typeof v !== "string") return false;
    const s = v.toLowerCase();
    return s.includes("perp") && s.includes("trade");
  });
}

export async function assertExecutorDelegation(subaccount: string): Promise<{
  executorAddress: string;
  apiHasPerpsDelegation: boolean;
  chainHasPerpsDelegation: boolean | null;
}> {
  const canonicalSubaccount = toCanonicalAddress(subaccount);
  const executorAddress = toCanonicalAddress(getDecibelExecutorAccount().accountAddress.toString());

  const delegations = (await fetchDecibel(
    `/api/v1/delegations?subaccount=${encodeURIComponent(canonicalSubaccount)}`
  )) as DelegationDto[];

  const apiHasPerpsDelegation = (Array.isArray(delegations) ? delegations : []).some((item) => {
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

  let chainHasPerpsDelegation: boolean | null = null;
  let hasDelegation = apiHasPerpsDelegation;

  if (!hasDelegation) {
    const { aptos, isTestnet } = getDecibelNetworkContext();
    const pkg = isTestnet ? PACKAGE_TESTNET : PACKAGE_MAINNET;
    try {
      const subRes = await aptos.getAccountResource({
        accountAddress: canonicalSubaccount,
        resourceType: `${pkg}::dex_accounts::Subaccount`,
      });
      chainHasPerpsDelegation = hasPerpsDelegationOnChain({ subaccountResource: subRes, executorAddress });
      hasDelegation = chainHasPerpsDelegation;
    } catch {
      chainHasPerpsDelegation = null;
    }
  }

  if (!hasDelegation) {
    throw new Error(
      `No active perp-trade delegation from subaccount ${canonicalSubaccount} to executor ${executorAddress}`
    );
  }

  return { executorAddress, apiHasPerpsDelegation, chainHasPerpsDelegation };
}

export async function resolvePilotMarket(marketName: string): Promise<
  DecibelMarketConfig & { market_addr: string; market_name: string }
> {
  const marketsRaw = await fetchDecibel("/api/v1/markets");
  const markets = normalizeDecibelMarketsPayload(marketsRaw);
  const selected = resolveDecibelMarketByName(marketName, markets);
  if (!selected) {
    throw new Error(`Decibel market not found: ${marketName}`);
  }
  return selected;
}

async function getTxVersionByHash(params: { aptos: Aptos; hash: string }): Promise<bigint | null> {
  try {
    const tx = (await params.aptos.getTransactionByHash({ transactionHash: params.hash })) as {
      version?: string | number;
    };
    const v = tx?.version;
    if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
    if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
    return null;
  } catch {
    return null;
  }
}

export async function assertNoOpenPositionOnMarket(params: {
  subaccount: string;
  marketAddr: string;
}): Promise<void> {
  const positionsRaw = (await fetchDecibel(
    `/api/v1/account_positions?account=${encodeURIComponent(toCanonicalAddress(params.subaccount))}`
  )) as unknown;
  const list = Array.isArray(positionsRaw) ? (positionsRaw as DecibelAccountPosition[]) : [];
  const wantedMarket = normalizeAddress(toCanonicalAddress(params.marketAddr));
  const existing = list.find((p) => {
    if (!p || p.is_deleted) return false;
    const m = String(p.market || "");
    if (!m) return false;
    if (normalizeAddress(toCanonicalAddress(m)) !== wantedMarket) return false;
    const sz = Number(p.size);
    return Number.isFinite(sz) && sz !== 0;
  });
  if (existing) {
    throw new Error(
      `Subaccount already has an open position on this market (size=${existing.size ?? "unknown"}). Close it first.`
    );
  }
}

export async function pollDecibelFilledShortSizeChainUnits(params: {
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
      `/api/v1/account_positions?account=${encodeURIComponent(toCanonicalAddress(subaccount))}`
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

  if (placedFallback > BigInt(0)) return placedFallback;
  throw new Error("Decibel short fill not visible yet (account_positions timeout)");
}

export async function pollShortClosed(params: {
  subaccount: string;
  marketAddr: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<void> {
  const { subaccount, marketAddr, timeoutMs = 25_000, intervalMs = 2_000 } = params;
  const started = Date.now();
  const want = normalizeAddress(toCanonicalAddress(marketAddr));
  while (Date.now() - started <= timeoutMs) {
    const positionsRaw = (await fetchDecibel(
      `/api/v1/account_positions?account=${encodeURIComponent(toCanonicalAddress(subaccount))}`
    )) as unknown;
    const list = Array.isArray(positionsRaw) ? (positionsRaw as DecibelAccountPosition[]) : [];
    const row = list.find((p) => {
      if (!p || p.is_deleted) return false;
      const m = String(p.market || "");
      if (!m) return false;
      return normalizeAddress(toCanonicalAddress(m)) === want;
    });
    if (!row) return;
    const sz = Number(row.size);
    if (!Number.isFinite(sz) || sz >= 0) return;
    await sleep(intervalMs);
  }
  throw new Error("Decibel short still open after close (account_positions timeout)");
}

async function resolveBuilderFee(params: {
  aptos: Aptos;
  subaccount: string;
  isTestnet: boolean;
}): Promise<{ builderAddr: string | null; builderFeeBps: number | null }> {
  const builderAddrEnv = process.env.DECIBEL_BUILDER_ADDRESS?.trim() || null;
  const builderFeeEnvRaw = process.env.DECIBEL_BUILDER_FEE_BPS?.trim();
  const builderFeeEnv =
    builderFeeEnvRaw != null && builderFeeEnvRaw !== "" ? Number(builderFeeEnvRaw) : 10;

  if (
    !builderAddrEnv ||
    !Number.isFinite(builderFeeEnv) ||
    builderFeeEnv <= 0 ||
    builderFeeEnv > 10_000
  ) {
    return { builderAddr: null, builderFeeBps: null };
  }

  const approvedBps = await getApprovedBuilderFeeBps({
    aptos: params.aptos,
    subaccount: toCanonicalAddress(params.subaccount),
    builder: builderAddrEnv,
    isTestnet: params.isTestnet,
  });

  if (approvedBps != null && approvedBps >= builderFeeEnv) {
    return {
      builderAddr: toCanonicalAddress(builderAddrEnv),
      builderFeeBps: builderFeeEnv,
    };
  }

  return { builderAddr: null, builderFeeBps: null };
}

export type OpenShortResult = {
  market: DecibelMarketConfig & { market_addr: string; market_name: string };
  markPx: number;
  configureTxHash: string;
  openTxHash: string;
  openTxVersion: bigint | null;
  filledShortSizeChainUnits: bigint;
  filledShortHumanBase: number;
  shortNotionalUsd: number;
};

export async function openDecibelShort(params: {
  subaccount: string;
  marketName: string;
  orderSizeUsd: number;
  dryRun?: boolean;
}): Promise<OpenShortResult> {
  const canonicalSubaccount = toCanonicalAddress(params.subaccount);
  await assertExecutorDelegation(canonicalSubaccount);
  const market = await resolvePilotMarket(params.marketName);
  const markPx = await fetchDecibelMarkPx(market.market_addr);
  if (markPx == null || markPx <= 0) {
    throw new Error(`Failed to resolve mark price for ${params.marketName}`);
  }

  await assertNoOpenPositionOnMarket({
    subaccount: canonicalSubaccount,
    marketAddr: market.market_addr,
  });

  const { aptos, network, isTestnet } = getDecibelNetworkContext();

  if (params.dryRun) {
    const filledShortSizeChainUnits = BigInt(
      decibelOpenOrderSizeChainUnits(params.orderSizeUsd, markPx, market)
    );
    const filledShortHumanBase = decibelChainUnitsToHumanBase(
      filledShortSizeChainUnits,
      market.sz_decimals ?? 9
    );
    return {
      market,
      markPx,
      configureTxHash: "dry-run",
      openTxHash: "dry-run",
      openTxVersion: null,
      filledShortSizeChainUnits,
      filledShortHumanBase,
      shortNotionalUsd: filledShortHumanBase * markPx,
    };
  }

  const configurePayload = buildConfigureUserSettingsPayload({
    subaccountAddr: canonicalSubaccount,
    marketAddr: market.market_addr,
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

  const { builderAddr, builderFeeBps } = await resolveBuilderFee({
    aptos,
    subaccount: canonicalSubaccount,
    isTestnet,
  });

  const openPayload = buildOpenMarketOrderPayload({
    subaccountAddr: canonicalSubaccount,
    marketAddr: market.market_addr,
    orderSizeUsd: params.orderSizeUsd,
    markPx,
    marketConfig: market,
    isLong: false,
    slippageBps: DEFAULT_SLIPPAGE_BPS,
    isTestnet,
    builderAddr,
    builderFeeBps,
  });
  const openTxHash = await submitExecutorEntryFunction({
    network,
    fn: openPayload.function,
    functionArguments: openPayload.functionArguments as (string | number | boolean | bigint | null)[],
    maxGasAmount: 30_000,
  });
  const openTxVersion = await getTxVersionByHash({ aptos, hash: openTxHash });

  const filledShortSizeChainUnits = await pollDecibelFilledShortSizeChainUnits({
    subaccount: canonicalSubaccount,
    marketAddr: market.market_addr,
    marketConfig: market,
    orderSizeUsd: params.orderSizeUsd,
    markPx,
  });
  const filledShortHumanBase = decibelChainUnitsToHumanBase(
    filledShortSizeChainUnits,
    market.sz_decimals ?? 9
  );
  const shortNotionalUsd = filledShortHumanBase * markPx;

  return {
    market,
    markPx,
    configureTxHash,
    openTxHash,
    openTxVersion,
    filledShortSizeChainUnits,
    filledShortHumanBase,
    shortNotionalUsd,
  };
}

export async function getActiveShortSize(params: {
  subaccount: string;
  marketAddr: string;
}): Promise<number> {
  const positionsRaw = (await fetchDecibel(
    `/api/v1/account_positions?account=${encodeURIComponent(toCanonicalAddress(params.subaccount))}`
  )) as unknown;
  const list = Array.isArray(positionsRaw) ? (positionsRaw as DecibelAccountPosition[]) : [];
  const want = normalizeAddress(toCanonicalAddress(params.marketAddr));
  const row = list.find((p) => {
    if (!p || p.is_deleted) return false;
    const m = String(p.market || "");
    if (!m) return false;
    if (normalizeAddress(toCanonicalAddress(m)) !== want) return false;
    const sz = Number(p.size);
    return Number.isFinite(sz) && sz < 0;
  });
  return row ? Math.abs(Number(row.size)) : 0;
}

export async function closeDecibelShort(params: {
  subaccount: string;
  marketName: string;
  dryRun?: boolean;
}): Promise<{ closeTxHash: string | null; shortSize: number; markPx: number }> {
  const canonicalSubaccount = toCanonicalAddress(params.subaccount);
  await assertExecutorDelegation(canonicalSubaccount);
  const market = await resolvePilotMarket(params.marketName);
  const markPx = await fetchDecibelMarkPx(market.market_addr);
  if (markPx == null || markPx <= 0) {
    throw new Error(`Failed to resolve mark price for ${params.marketName}`);
  }

  const shortSize = await getActiveShortSize({
    subaccount: canonicalSubaccount,
    marketAddr: market.market_addr,
  });
  if (shortSize <= 0) {
    return { closeTxHash: null, shortSize: 0, markPx };
  }

  if (params.dryRun) {
    return { closeTxHash: "dry-run", shortSize, markPx };
  }

  const { aptos, network, isTestnet } = getDecibelNetworkContext();
  const { builderAddr, builderFeeBps } = await resolveBuilderFee({
    aptos,
    subaccount: canonicalSubaccount,
    isTestnet,
  });

  const closePayload = buildCloseAtMarketPayload({
    subaccountAddr: canonicalSubaccount,
    marketAddr: market.market_addr,
    size: shortSize,
    isLong: false,
    markPx,
    marketConfig: market,
    slippageBps: DEFAULT_SLIPPAGE_BPS,
    isTestnet,
    builderAddr,
    builderFeeBps,
  });
  const closeTxHash = await submitExecutorEntryFunction({
    network,
    fn: closePayload.function,
    functionArguments: closePayload.functionArguments as (string | number | boolean | bigint | null)[],
    maxGasAmount: 35_000,
  });

  await pollShortClosed({
    subaccount: canonicalSubaccount,
    marketAddr: market.market_addr,
  });

  return { closeTxHash, shortSize, markPx };
}

export async function fetchSubaccountUsdcBalanceUsd(subaccount: string): Promise<number | null> {
  try {
    const data = (await fetchDecibel(
      `/api/v1/account_overviews?account=${encodeURIComponent(toCanonicalAddress(subaccount))}`
    )) as unknown;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== "object") return null;
    const obj = row as {
      balance?: number;
      account_balance?: number;
      equity?: number;
      cross_available_to_trade?: number;
      usdc_cross_withdrawable_balance?: number;
    };
    const balance =
      obj.cross_available_to_trade ??
      obj.usdc_cross_withdrawable_balance ??
      obj.balance ??
      obj.account_balance ??
      obj.equity;
    return typeof balance === "number" && Number.isFinite(balance) ? balance : null;
  } catch {
    return null;
  }
}
