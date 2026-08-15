import "server-only";

import Decimal from "decimal.js";
import {
  Account,
  AccountAddress,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  Network,
} from "@aptos-labs/ts-sdk";
import { GAS_STATION_ADDRESS } from "@/lib/admin/gasActivity";
import {
  YIELD_AI_PACKAGE_ADDRESS,
  YIELD_AI_VAULT_VIEWS,
} from "@/lib/constants/yieldAiVault";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";

const INDEXER_URL = "https://indexer.mainnet.aptoslabs.com/v1/graphql";
const FULLNODE_URL = "https://api.mainnet.aptoslabs.com/v1";
const DECIBEL_PACKAGE_ADDRESS =
  "0x50ead22afd6ffd9769e3b3d6e0e64a2a350d68e8b102c4e72e33d0b8cfdfdb06";

const PLACE_ORDER_FN = `${DECIBEL_PACKAGE_ADDRESS}::dex_accounts_entry::place_order_to_subaccount`;
const APPROVE_BUILDER_FEE_FN = `${DECIBEL_PACKAGE_ADDRESS}::dex_accounts_entry::approve_max_builder_fee_for_subaccount`;
const CONFIGURE_USER_SETTINGS_FN = `${DECIBEL_PACKAGE_ADDRESS}::dex_accounts_entry::configure_user_settings`;
const RECORD_OPEN_FN = `${YIELD_AI_PACKAGE_ADDRESS}::delta_neutral::record_open`;
const RECORD_CLOSE_FN = `${YIELD_AI_PACKAGE_ADDRESS}::delta_neutral::record_close`;

const PAGE_LIMIT = 100;
const VERSION_CURSOR_START = "999999999999999999";
const TRADE_HISTORY_LIMIT = 100;
const TRADE_HISTORY_MAX_PAGES = 100;
const ACCOUNT_ROWS_PER_DAY_CAP = 20_000;
const SAFES_PAGE_SIZE = 100;

const ACCOUNT_TX_QUERY = `
  query AccountTxs(
    $addr: String!,
    $fromTs: timestamp,
    $toTs: timestamp,
    $limit: Int!,
    $cursor: bigint!
  ) {
    account_transactions(
      where: {
        account_address: { _eq: $addr }
        transaction_version: { _lt: $cursor }
        user_transaction: { timestamp: { _gte: $fromTs, _lt: $toTs } }
      }
      order_by: { transaction_version: desc }
      limit: $limit
    ) {
      transaction_version
      user_transaction {
        sender
        entry_function_id_str
        timestamp
      }
    }
  }
`;

export interface DecibelOrderAggregate {
  placeOrderTxs: number;
  successfulPlaceOrderTxs: number;
  openLikeTxs: number;
  closeLikeTxs: number;
  actualFillCount: number;
  actualFillVolumeUsd: number;
  intentNotionalUsd: number;
  estimatedBuilderFeeUsd: number;
  uniqueWallets: number;
  uniqueSubaccounts: number;
  missedFillOrderTxs: number;
}

export interface DecibelMarketSummary {
  market: string;
  placeOrderTxs: number;
  actualFillCount: number;
  actualFillVolumeUsd: number;
  intentNotionalUsd: number;
  estimatedBuilderFeeUsd: number;
}

export interface DecibelDaySummary {
  date: string;
  placeOrderTxs: number;
  actualFillCount: number;
  actualFillVolumeUsd: number;
  intentNotionalUsd: number;
  estimatedBuilderFeeUsd: number;
}

export interface DecibelReportSection {
  label: "direct" | "agentDeltaNeutral" | "unclassifiedExecutorDecibelOrders";
  allOrders: DecibelOrderAggregate;
  builderFee: DecibelOrderAggregate;
  byMarket: DecibelMarketSummary[];
  byDay: DecibelDaySummary[];
  extra: Record<string, number>;
}

export interface DecibelOrderPreview {
  source: "direct" | "executor";
  txVersion: string;
  timestamp: string;
  wallet: string | null;
  subaccount: string;
  market: string;
  marketName: string;
  side: "buy" | "sell";
  reduceOnly: boolean;
  fillCount: number;
  actualFillVolumeUsd: number;
  intentNotionalUsd: number;
  estimatedBuilderFeeUsd: number;
  builderFeeBps: number | null;
  agentRecordType: "open" | "close" | null;
  recordTxVersion: string | null;
}

export interface DecibelBuilderFeeReport {
  generatedAt: string;
  range: {
    from: string;
    toExclusive: string;
  };
  addresses: {
    gasStation: string;
    executor: string;
    builder: string;
    configuredBuilderFeeBps: number | null;
    observedBuilderFeeBps: number[];
  };
  combinedBuilderFee: DecibelOrderAggregate;
  combinedBuilderFeeByMarket: DecibelMarketSummary[];
  combinedBuilderFeeByDay: DecibelDaySummary[];
  direct: DecibelReportSection;
  agentDeltaNeutral: DecibelReportSection;
  unclassifiedExecutorDecibelOrders: DecibelReportSection;
  recentBuilderOrders: DecibelOrderPreview[];
  diagnostics: {
    gasAccountRows: number;
    executorAccountRows: number;
    gasStationDecibelRows: number;
    executorDecibelRows: number;
    directPlaceOrderRows: number;
    executorPlaceOrderRows: number;
    recordOpenRows: number;
    recordCloseRows: number;
  };
}

export async function buildDecibelBuilderFeeReport(params: {
  from: Date;
  toExclusive: Date;
}): Promise<DecibelBuilderFeeReport> {
  if (!Number.isFinite(params.from.getTime()) || !Number.isFinite(params.toExclusive.getTime())) {
    throw new Error("Invalid Decibel report date range");
  }
  if (params.from >= params.toExclusive) {
    throw new Error("Decibel report `from` must be before `to`");
  }

  const context = makeReportContext(params.from, params.toExclusive);

  const [markets, safeOwnerMap, gasRows, executorRows] = await Promise.all([
    fetchMarkets(context),
    fetchSafeOwnerMap(context),
    fetchAccountTransactionsByDay(context, GAS_STATION_ADDRESS, "gas"),
    fetchAccountTransactionsByDay(context, context.executorAddress, "executor"),
  ]);

  const gasDecibelRows = gasRows.filter((row) =>
    [PLACE_ORDER_FN, APPROVE_BUILDER_FEE_FN, CONFIGURE_USER_SETTINGS_FN].includes(
      row.user_transaction?.entry_function_id_str ?? "",
    ),
  );
  const executorDecibelRows = executorRows.filter((row) =>
    [PLACE_ORDER_FN, CONFIGURE_USER_SETTINGS_FN, RECORD_OPEN_FN, RECORD_CLOSE_FN].includes(
      row.user_transaction?.entry_function_id_str ?? "",
    ),
  );

  const directOrderRows = gasDecibelRows.filter(
    (row) => row.user_transaction?.entry_function_id_str === PLACE_ORDER_FN,
  );
  const directApproveRows = gasDecibelRows.filter(
    (row) => row.user_transaction?.entry_function_id_str === APPROVE_BUILDER_FEE_FN,
  );
  const executorOrderRows = executorDecibelRows.filter(
    (row) => row.user_transaction?.entry_function_id_str === PLACE_ORDER_FN,
  );
  const recordOpenRows = executorDecibelRows.filter(
    (row) => row.user_transaction?.entry_function_id_str === RECORD_OPEN_FN,
  );
  const recordCloseRows = executorDecibelRows.filter(
    (row) => row.user_transaction?.entry_function_id_str === RECORD_CLOSE_FN,
  );

  const [directOrders, executorOrders, recordOpens, recordCloses] = await Promise.all([
    parseOrderRows(context, directOrderRows, markets, "direct"),
    parseOrderRows(context, executorOrderRows, markets, "executor"),
    parseRecordOpenRows(context, recordOpenRows, safeOwnerMap),
    parseRecordCloseRows(context, recordCloseRows, safeOwnerMap),
  ]);

  const agentOrderVersions = new Map<string, AgentOrderLink>();
  for (const record of recordOpens) {
    if (record.decibelTxVersion && record.decibelTxVersion !== "0") {
      agentOrderVersions.set(record.decibelTxVersion, {
        recordType: "open",
        safe: record.safe,
        owner: record.owner,
        recordTxVersion: record.txVersion,
      });
    }
  }
  for (const record of recordCloses) {
    if (record.closeAnchorTxVersion && record.closeAnchorTxVersion !== "0") {
      agentOrderVersions.set(record.closeAnchorTxVersion, {
        recordType: "close",
        safe: record.safe,
        owner: record.owner,
        recordTxVersion: record.txVersion,
      });
    }
  }

  const agentOrders = executorOrders
    .filter((order) => agentOrderVersions.has(order.txVersion))
    .map((order) => ({
      ...order,
      agent: agentOrderVersions.get(order.txVersion) ?? null,
    }));
  const unclassifiedExecutorOrders = executorOrders.filter(
    (order) => !agentOrderVersions.has(order.txVersion),
  );

  const [directWithFills, agentWithFills, unclassifiedWithFills] = await Promise.all([
    attachFills(context, directOrders),
    attachFills(context, agentOrders),
    attachFills(context, unclassifiedExecutorOrders),
  ]);

  const directBuilderOrders = directWithFills.filter((order) => isBuilderFeeOrder(context, order));
  const agentBuilderOrders = agentWithFills.filter((order) => isBuilderFeeOrder(context, order));
  const unclassifiedBuilderOrders = unclassifiedWithFills.filter((order) =>
    isBuilderFeeOrder(context, order),
  );
  const combinedBuilderOrders = [
    ...directBuilderOrders,
    ...agentBuilderOrders,
    ...unclassifiedBuilderOrders,
  ];

  const direct = summarizeOrders({
    label: "direct",
    orders: directWithFills,
    builderOrders: directBuilderOrders,
    allWallets: directWithFills.map((order) => order.sender),
    builderWallets: directBuilderOrders.map((order) => order.sender),
    extra: {
      approveBuilderFeeTxs: directApproveRows.length,
      gasStationDecibelRows: gasDecibelRows.length,
    },
  });
  const agentDeltaNeutral = summarizeOrders({
    label: "agentDeltaNeutral",
    orders: agentWithFills,
    builderOrders: agentBuilderOrders,
    allWallets: agentWithFills.map((order) => order.agent?.owner ?? order.agent?.safe ?? null),
    builderWallets: agentBuilderOrders.map(
      (order) => order.agent?.owner ?? order.agent?.safe ?? null,
    ),
    extra: {
      recordOpenTxs: recordOpens.length,
      recordCloseTxs: recordCloses.length,
      executorPlaceOrderTxsInRange: executorOrders.length,
      tiedPlaceOrderTxs: agentOrders.length,
      unclassifiedExecutorPlaceOrderTxs: unclassifiedExecutorOrders.length,
    },
  });
  const unclassifiedExecutorDecibelOrders = summarizeOrders({
    label: "unclassifiedExecutorDecibelOrders",
    orders: unclassifiedWithFills,
    builderOrders: unclassifiedBuilderOrders,
    allWallets: unclassifiedWithFills.map((order) => order.sender),
    builderWallets: unclassifiedBuilderOrders.map((order) => order.sender),
    extra: {},
  });

  const combinedWallets = new Set(
    [
      ...directBuilderOrders.map((order) => order.sender),
      ...agentBuilderOrders.map((order) => order.agent?.owner ?? order.agent?.safe ?? null),
      ...unclassifiedBuilderOrders.map((order) => order.sender),
    ]
      .filter(isNonEmptyString)
      .map(canonicalAddress),
  );
  const combinedBuilderFee = combineAggregates(
    [
      direct.builderFee,
      agentDeltaNeutral.builderFee,
      unclassifiedExecutorDecibelOrders.builderFee,
    ],
    combinedWallets.size,
    new Set(combinedBuilderOrders.map((order) => order.subaccount)).size,
  );

  const observedBuilderFeeBps = [...directBuilderOrders, ...agentBuilderOrders, ...unclassifiedBuilderOrders]
    .map((order) => order.builderFeeBps)
    .filter((bps): bps is number => typeof bps === "number" && Number.isFinite(bps))
    .filter((bps, idx, all) => all.indexOf(bps) === idx)
    .sort((a, b) => a - b);

  return {
    generatedAt: new Date().toISOString(),
    range: {
      from: context.from.toISOString(),
      toExclusive: context.toExclusive.toISOString(),
    },
    addresses: {
      gasStation: GAS_STATION_ADDRESS,
      executor: context.executorAddress,
      builder: context.builderAddress,
      configuredBuilderFeeBps: context.configuredBuilderFeeBps,
      observedBuilderFeeBps,
    },
    combinedBuilderFee,
    combinedBuilderFeeByMarket: summarizeByMarket(combinedBuilderOrders),
    combinedBuilderFeeByDay: summarizeByDay(combinedBuilderOrders),
    direct,
    agentDeltaNeutral,
    unclassifiedExecutorDecibelOrders,
    recentBuilderOrders: combinedBuilderOrders
      .slice()
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 300)
      .map(toOrderPreview),
    diagnostics: {
      gasAccountRows: gasRows.length,
      executorAccountRows: executorRows.length,
      gasStationDecibelRows: gasDecibelRows.length,
      executorDecibelRows: executorDecibelRows.length,
      directPlaceOrderRows: directOrderRows.length,
      executorPlaceOrderRows: executorOrderRows.length,
      recordOpenRows: recordOpenRows.length,
      recordCloseRows: recordCloseRows.length,
    },
  };
}

interface ReportContext {
  from: Date;
  toExclusive: Date;
  aptosApiKey: string | null;
  decibelApiKey: string;
  decibelApiBaseUrl: string;
  executorAddress: string;
  builderAddress: string;
  configuredBuilderFeeBps: number | null;
  aptos: Aptos;
  fullTxCache: Map<string, Promise<FullTransaction>>;
  tradeHistoryCache: Map<string, Promise<TradeHistoryItem[]>>;
}

interface MarketConfig {
  marketAddr: string;
  marketName: string;
  pxDecimals: number;
  szDecimals: number;
}

interface RawAccountTransaction {
  transaction_version: string | number;
  user_transaction: {
    sender: string;
    entry_function_id_str: string | null;
    timestamp: string;
  } | null;
}

interface FullTransaction {
  type?: string;
  hash?: string;
  sender?: string;
  timestamp?: string | number;
  success?: boolean;
  payload?: {
    function?: string;
    arguments?: unknown[];
  };
  events?: Array<{
    type?: string;
    data?: Record<string, unknown>;
  }>;
}

interface ParsedOrder {
  source: "direct" | "executor";
  txVersion: string;
  txHash: string;
  timestamp: string;
  sender: string;
  success: boolean;
  subaccount: string;
  market: string;
  marketName: string;
  orderId: string | null;
  isBuy: boolean;
  reduceOnly: boolean;
  builderAddress: string | null;
  builderFeeBps: number | null;
  priceChain: string | null;
  sizeChain: string | null;
  intentNotionalUsd: number;
  fillCount: number;
  actualFillVolumeUsd: number;
  fills: TradeFillPreview[];
  agent?: AgentOrderLink | null;
}

interface AgentOrderLink {
  recordType: "open" | "close";
  safe: string;
  owner: string | null;
  recordTxVersion: string;
}

interface RecordOpen {
  txVersion: string;
  safe: string;
  owner: string | null;
  decibelTxVersion: string;
}

interface RecordClose {
  txVersion: string;
  safe: string;
  owner: string | null;
  closeAnchorTxVersion: string;
}

interface SafeInfo {
  safeAddress: string;
  owner: string;
  paused: boolean;
  exists: boolean;
}

interface TradeHistoryItem {
  order_id?: string | number | null;
  trade_id?: string | number | null;
  action?: string | null;
  source?: string | null;
  size?: string | number | null;
  price?: string | number | null;
  fee_amount?: string | number | null;
  transaction_unix_ms?: string | number | null;
  transaction_version?: string | number | null;
}

interface TradeFillPreview {
  tradeId: string | null;
  action: string | null;
  source: string | null;
  size: string | number | null;
  price: string | number | null;
  feeAmount: string | number | null;
  transactionUnixMs: string | number | null;
  transactionVersion: string | number | null;
}

function makeReportContext(from: Date, toExclusive: Date): ReportContext {
  const aptosApiKey = process.env.APTOS_API_KEY?.trim() || null;
  const decibelApiKey = process.env.DECIBEL_API_KEY?.trim();
  const builderAddressEnv = process.env.DECIBEL_BUILDER_ADDRESS?.trim();
  const privateKeyEnv = process.env.YIELD_AI_EXECUTOR_PRIVATE_KEY?.trim();
  const executorAddressEnv = process.env.YIELD_AI_EXECUTOR_ADDRESS?.trim();

  if (!decibelApiKey) {
    throw new Error("DECIBEL_API_KEY is required for Decibel fill-volume reporting");
  }
  if (!builderAddressEnv) {
    throw new Error("DECIBEL_BUILDER_ADDRESS is required for Decibel builder-fee reporting");
  }
  if (!executorAddressEnv && !privateKeyEnv) {
    throw new Error(
      "YIELD_AI_EXECUTOR_PRIVATE_KEY or YIELD_AI_EXECUTOR_ADDRESS is required for agent Decibel reporting",
    );
  }

  const executorAddress = executorAddressEnv
    ? canonicalAddress(executorAddressEnv)
    : canonicalAddress(
        Account.fromPrivateKey({
          privateKey: new Ed25519PrivateKey(privateKeyEnv!.replace(/^0x/, "")),
        }).accountAddress.toString(),
      );

  return {
    from,
    toExclusive,
    aptosApiKey,
    decibelApiKey,
    decibelApiBaseUrl: (
      process.env.DECIBEL_API_BASE_URL || "https://api.mainnet.aptoslabs.com/decibel"
    ).replace(/\/$/, ""),
    executorAddress,
    builderAddress: canonicalAddress(builderAddressEnv),
    configuredBuilderFeeBps: parseOptionalBps(process.env.DECIBEL_BUILDER_FEE_BPS),
    aptos: new Aptos(
      new AptosConfig({
        network: Network.MAINNET,
        ...(aptosApiKey && {
          clientConfig: { HEADERS: { Authorization: `Bearer ${aptosApiKey}` } },
        }),
      }),
    ),
    fullTxCache: new Map(),
    tradeHistoryCache: new Map(),
  };
}

async function fetchMarkets(context: ReportContext): Promise<Map<string, MarketConfig>> {
  const data = await fetchDecibel(context, "/api/v1/markets");
  const markets = new Map<string, MarketConfig>();
  for (const market of normalizeItems(data)) {
    if (!market || typeof market !== "object") continue;
    const row = market as Record<string, unknown>;
    const rawAddr = row.market_addr;
    if (typeof rawAddr !== "string" || !rawAddr) continue;
    const marketAddr = canonicalAddress(rawAddr);
    markets.set(marketAddr, {
      marketAddr,
      marketName: String(row.market_name ?? ""),
      pxDecimals: toFiniteNumber(row.px_decimals, 9),
      szDecimals: toFiniteNumber(row.sz_decimals, 9),
    });
  }
  return markets;
}

async function fetchSafeOwnerMap(context: ReportContext): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const totalRes = await context.aptos.view({
    payload: {
      function: YIELD_AI_VAULT_VIEWS.getTotalSafes,
      typeArguments: [],
      functionArguments: [],
    },
  });
  const totalRaw = Array.isArray(totalRes) ? totalRes[0] : totalRes;
  const total = Number(totalRaw ?? 0);
  if (!Number.isFinite(total) || total <= 0) return out;

  for (let start = 0; start < total; start += SAFES_PAGE_SIZE) {
    const limit = Math.min(SAFES_PAGE_SIZE, total - start);
    const pageRes = await context.aptos.view({
      payload: {
        function: YIELD_AI_VAULT_VIEWS.getSafesRangeInfo,
        typeArguments: [],
        functionArguments: [String(start), String(limit)],
      },
    });
    const list = Array.isArray(pageRes?.[0])
      ? pageRes[0]
      : Array.isArray(pageRes)
        ? pageRes
        : [];
    for (const item of list) {
      const parsed = parseSafeRow(item);
      if (parsed?.exists) out.set(parsed.safeAddress, parsed.owner);
    }
  }
  return out;
}

function parseSafeRow(raw: unknown): SafeInfo | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const [safe, owner, paused, exists] = raw;
    if (typeof safe !== "string" || typeof owner !== "string") return null;
    return {
      safeAddress: canonicalAddress(safe),
      owner: canonicalAddress(owner),
      paused: Boolean(paused),
      exists: exists === undefined ? true : Boolean(exists),
    };
  }
  if (typeof raw === "object") {
    const row = raw as Record<string, unknown>;
    const safe = row.safe_address ?? row.safeAddress ?? row.safe_addr ?? row.safe;
    const owner = row.owner ?? row.owner_address ?? row.ownerAddress;
    if (typeof safe !== "string" || typeof owner !== "string") return null;
    return {
      safeAddress: canonicalAddress(safe),
      owner: canonicalAddress(owner),
      paused: Boolean(row.paused ?? row.isPaused ?? false),
      exists: Boolean(row.exists ?? row.isExists ?? true),
    };
  }
  return null;
}

async function fetchAccountTransactionsByDay(
  context: ReportContext,
  accountAddress: string,
  label: string,
): Promise<RawAccountTransaction[]> {
  const all: RawAccountTransaction[] = [];
  let start = new Date(context.from);

  while (start < context.toExclusive) {
    const end = new Date(
      Math.min(nextUtcDay(start).getTime(), context.toExclusive.getTime()),
    );
    let cursor = VERSION_CURSOR_START;
    const dayRows: RawAccountTransaction[] = [];

    while (true) {
      const page = await graphqlWithRetry(context, {
        query: ACCOUNT_TX_QUERY,
        variables: {
          addr: accountAddress,
          fromTs: formatIndexerTimestamp(start),
          toTs: formatIndexerTimestamp(end),
          limit: PAGE_LIMIT,
          cursor,
        },
      });
      const rows = (page.data?.account_transactions ?? []) as RawAccountTransaction[];
      dayRows.push(...rows);

      if (rows.length < PAGE_LIMIT) break;
      cursor = String(rows[rows.length - 1].transaction_version);
      if (dayRows.length > ACCOUNT_ROWS_PER_DAY_CAP) {
        throw new Error(`${label}: too many account_transactions on ${start.toISOString()}`);
      }
    }

    all.push(...dayRows);
    start = end;
  }

  return all;
}

async function parseOrderRows(
  context: ReportContext,
  rows: RawAccountTransaction[],
  markets: Map<string, MarketConfig>,
  source: "direct" | "executor",
): Promise<ParsedOrder[]> {
  const parsed = await mapWithConcurrency(rows, 8, async (row) => {
    const txVersion = String(row.transaction_version);
    const tx = await fetchFullTx(context, txVersion);
    if (!tx || tx.type !== "user_transaction") return null;

    const args = Array.isArray(tx.payload?.arguments) ? tx.payload.arguments : [];
    if (tx.payload?.function !== PLACE_ORDER_FN || args.length < 15) return null;

    const subaccount = canonicalAddress(args[0]);
    const market = canonicalAddress(args[1]);
    const marketConfig = markets.get(market);
    const orderEvent = (tx.events ?? []).find((event) =>
      String(event.type ?? "").endsWith("::market_types::OrderEvent"),
    );
    const orderId =
      orderEvent?.data?.order_id != null ? String(orderEvent.data.order_id) : null;
    const priceChain = toBigIntString(args[2]);
    const sizeChain = toBigIntString(args[3]);
    const intentNotionalUsd =
      priceChain && sizeChain && marketConfig
        ? decimalToNumber(
            new Decimal(priceChain)
              .div(new Decimal(10).pow(marketConfig.pxDecimals))
              .mul(new Decimal(sizeChain).div(new Decimal(10).pow(marketConfig.szDecimals))),
          )
        : 0;

    return {
      source,
      txVersion,
      txHash: String(tx.hash ?? ""),
      timestamp: row.user_transaction?.timestamp ?? microsecondsToIso(tx.timestamp),
      sender: canonicalAddress(row.user_transaction?.sender ?? tx.sender ?? ""),
      success: tx.success === true,
      subaccount,
      market,
      marketName: marketConfig?.marketName ?? "",
      orderId,
      isBuy: args[4] === true || args[4] === "true",
      reduceOnly: args[6] === true || args[6] === "true",
      builderAddress: optionalAddress(args[13]),
      builderFeeBps: optionalU64(args[14]),
      priceChain,
      sizeChain,
      intentNotionalUsd,
      fillCount: 0,
      actualFillVolumeUsd: 0,
      fills: [],
    } satisfies ParsedOrder;
  });
  return parsed.filter(isNonNull);
}

async function parseRecordOpenRows(
  context: ReportContext,
  rows: RawAccountTransaction[],
  safeOwnerMap: Map<string, string>,
): Promise<RecordOpen[]> {
  const parsed = await mapWithConcurrency(rows, 8, async (row) => {
    const txVersion = String(row.transaction_version);
    const tx = await fetchFullTx(context, txVersion);
    const args = Array.isArray(tx.payload?.arguments) ? tx.payload.arguments : [];
    if (tx.payload?.function !== RECORD_OPEN_FN || args.length < 7) return null;
    const safe = canonicalAddress(args[0]);
    return {
      txVersion,
      safe,
      owner: safeOwnerMap.get(safe) ?? null,
      decibelTxVersion: toBigIntString(args[6]) ?? "0",
    } satisfies RecordOpen;
  });
  return parsed.filter(isNonNull);
}

async function parseRecordCloseRows(
  context: ReportContext,
  rows: RawAccountTransaction[],
  safeOwnerMap: Map<string, string>,
): Promise<RecordClose[]> {
  const parsed = await mapWithConcurrency(rows, 8, async (row) => {
    const txVersion = String(row.transaction_version);
    const tx = await fetchFullTx(context, txVersion);
    const args = Array.isArray(tx.payload?.arguments) ? tx.payload.arguments : [];
    if (tx.payload?.function !== RECORD_CLOSE_FN || args.length < 2) return null;
    const safe = canonicalAddress(args[0]);
    return {
      txVersion,
      safe,
      owner: safeOwnerMap.get(safe) ?? null,
      closeAnchorTxVersion: toBigIntString(args[1]) ?? "0",
    } satisfies RecordClose;
  });
  return parsed.filter(isNonNull);
}

async function attachFills<T extends ParsedOrder>(
  context: ReportContext,
  orders: T[],
): Promise<T[]> {
  const accounts = [...new Set(orders.map((order) => order.subaccount))];
  const histories = await mapWithConcurrency(accounts, 3, async (account) => [
    account,
    await fetchTradeHistoryForWindow(context, account),
  ] as const);
  const byOrder = new Map<string, TradeHistoryItem[]>();

  for (const [, items] of histories) {
    for (const item of items) {
      if (item.order_id == null) continue;
      const key = String(item.order_id);
      const list = byOrder.get(key) ?? [];
      list.push(item);
      byOrder.set(key, list);
    }
  }

  return orders.map((order) => {
    const fills = order.orderId ? byOrder.get(order.orderId) ?? [] : [];
    const actualFillVolumeUsd = fills.reduce((sum, fill) => {
      const size = Number(fill.size);
      const price = Number(fill.price);
      if (!Number.isFinite(size) || !Number.isFinite(price)) return sum;
      return sum + Math.abs(size * price);
    }, 0);

    return {
      ...order,
      fillCount: fills.length,
      actualFillVolumeUsd,
      fills: fills.map((fill) => ({
        tradeId: fill.trade_id != null ? String(fill.trade_id) : null,
        action: fill.action ?? null,
        source: fill.source ?? null,
        size: fill.size ?? null,
        price: fill.price ?? null,
        feeAmount: fill.fee_amount ?? null,
        transactionUnixMs: fill.transaction_unix_ms ?? null,
        transactionVersion: fill.transaction_version ?? null,
      })),
    };
  });
}

async function fetchTradeHistoryForWindow(
  context: ReportContext,
  account: string,
): Promise<TradeHistoryItem[]> {
  if (context.tradeHistoryCache.has(account)) {
    return context.tradeHistoryCache.get(account)!;
  }

  const promise = (async () => {
    const items: TradeHistoryItem[] = [];
    for (let page = 0; page < TRADE_HISTORY_MAX_PAGES; page++) {
      const offset = page * TRADE_HISTORY_LIMIT;
      const data = await fetchDecibel(
        context,
        `/api/v1/trade_history?account=${encodeURIComponent(account)}&limit=${TRADE_HISTORY_LIMIT}&offset=${offset}`,
      );
      const pageItems = normalizeItems(data) as TradeHistoryItem[];
      if (pageItems.length === 0) break;

      let passedFrom = false;
      for (const item of pageItems) {
        const ts = Number(item.transaction_unix_ms ?? 0);
        if (!Number.isFinite(ts) || ts <= 0) continue;
        if (ts < context.from.getTime()) {
          passedFrom = true;
          break;
        }
        if (ts < context.toExclusive.getTime()) items.push(item);
      }
      if (passedFrom || pageItems.length < TRADE_HISTORY_LIMIT) break;
    }
    return items;
  })();

  context.tradeHistoryCache.set(account, promise);
  return promise;
}

async function fetchFullTx(context: ReportContext, version: string): Promise<FullTransaction> {
  const key = String(version);
  if (context.fullTxCache.has(key)) return context.fullTxCache.get(key)!;

  const headers: Record<string, string> = {};
  if (context.aptosApiKey) headers.Authorization = `Bearer ${context.aptosApiKey}`;

  const promise = retry(async () => {
    const res = await fetch(`${FULLNODE_URL}/transactions/by_version/${key}`, {
      headers,
      cache: "no-store",
    });
    if (!res.ok) {
      const err = new Error(`Fullnode ${key} HTTP ${res.status}`) as Error & {
        status?: number;
      };
      err.status = res.status;
      throw err;
    }
    return (await res.json()) as FullTransaction;
  });

  context.fullTxCache.set(key, promise);
  return promise;
}

async function fetchDecibel(context: ReportContext, pathname: string): Promise<unknown> {
  return retry(async () => {
    const res = await fetch(`${context.decibelApiBaseUrl}${pathname}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${context.decibelApiKey}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Decibel invalid JSON ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      const message =
        json && typeof json === "object" && "message" in json
          ? String((json as { message?: unknown }).message)
          : text.slice(0, 200);
      const err = new Error(`Decibel HTTP ${res.status}: ${message}`) as Error & {
        status?: number;
      };
      err.status = res.status;
      throw err;
    }
    return json;
  });
}

async function graphqlWithRetry(
  context: ReportContext,
  body: Record<string, unknown>,
): Promise<{ data?: Record<string, unknown> }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (context.aptosApiKey) headers.Authorization = `Bearer ${context.aptosApiKey}`;

  return retry(async () => {
    const res = await fetch(INDEXER_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`Indexer HTTP ${res.status}: ${text.slice(0, 300)}`) as Error & {
        status?: number;
      };
      err.status = res.status;
      throw err;
    }
    const json = (text ? JSON.parse(text) : {}) as {
      data?: Record<string, unknown>;
      errors?: unknown;
    };
    if (json.errors) {
      const message = JSON.stringify(json.errors);
      const err = new Error(`Indexer GraphQL error: ${message.slice(0, 500)}`) as Error & {
        status?: number;
      };
      if (/Timed Out|rate|429|408/i.test(message)) err.status = 408;
      throw err;
    }
    return json;
  });
}

function summarizeOrders(params: {
  label: DecibelReportSection["label"];
  orders: ParsedOrder[];
  builderOrders: ParsedOrder[];
  allWallets: Array<string | null>;
  builderWallets: Array<string | null>;
  extra: Record<string, number>;
}): DecibelReportSection {
  const allWallets = new Set(params.allWallets.filter(isNonEmptyString).map(canonicalAddress));
  const builderWallets = new Set(
    params.builderWallets.filter(isNonEmptyString).map(canonicalAddress),
  );
  const allOrders = aggregateOrders(params.orders, allWallets.size);
  const builderFee = aggregateOrders(params.builderOrders, builderWallets.size);

  return {
    label: params.label,
    allOrders,
    builderFee,
    byMarket: summarizeByMarket(params.builderOrders),
    byDay: summarizeByDay(params.builderOrders),
    extra: params.extra,
  };
}

function aggregateOrders(orders: ParsedOrder[], uniqueWallets: number): DecibelOrderAggregate {
  const successful = orders.filter((order) => order.success);
  return {
    placeOrderTxs: orders.length,
    successfulPlaceOrderTxs: successful.length,
    openLikeTxs: successful.filter((order) => !order.reduceOnly).length,
    closeLikeTxs: successful.filter((order) => order.reduceOnly).length,
    actualFillCount: successful.reduce((sum, order) => sum + order.fillCount, 0),
    actualFillVolumeUsd: roundUsd(
      successful.reduce((sum, order) => sum + order.actualFillVolumeUsd, 0),
    ),
    intentNotionalUsd: roundUsd(
      successful.reduce((sum, order) => sum + order.intentNotionalUsd, 0),
    ),
    estimatedBuilderFeeUsd: roundUsd(
      successful.reduce((sum, order) => sum + estimatedBuilderFeeUsd(order), 0),
    ),
    uniqueWallets,
    uniqueSubaccounts: new Set(orders.map((order) => order.subaccount)).size,
    missedFillOrderTxs: orders.filter((order) => order.success && order.fillCount === 0).length,
  };
}

function combineAggregates(
  parts: DecibelOrderAggregate[],
  uniqueWallets: number,
  uniqueSubaccounts: number,
): DecibelOrderAggregate {
  return {
    placeOrderTxs: parts.reduce((sum, part) => sum + part.placeOrderTxs, 0),
    successfulPlaceOrderTxs: parts.reduce((sum, part) => sum + part.successfulPlaceOrderTxs, 0),
    openLikeTxs: parts.reduce((sum, part) => sum + part.openLikeTxs, 0),
    closeLikeTxs: parts.reduce((sum, part) => sum + part.closeLikeTxs, 0),
    actualFillCount: parts.reduce((sum, part) => sum + part.actualFillCount, 0),
    actualFillVolumeUsd: roundUsd(
      parts.reduce((sum, part) => sum + part.actualFillVolumeUsd, 0),
    ),
    intentNotionalUsd: roundUsd(parts.reduce((sum, part) => sum + part.intentNotionalUsd, 0)),
    estimatedBuilderFeeUsd: roundUsd(
      parts.reduce((sum, part) => sum + part.estimatedBuilderFeeUsd, 0),
    ),
    uniqueWallets,
    uniqueSubaccounts,
    missedFillOrderTxs: parts.reduce((sum, part) => sum + part.missedFillOrderTxs, 0),
  };
}

function summarizeByMarket(orders: ParsedOrder[]): DecibelMarketSummary[] {
  const map = new Map<string, DecibelMarketSummary>();
  for (const order of orders.filter((candidate) => candidate.success)) {
    const key = order.marketName || order.market;
    const item = map.get(key) ?? {
      market: key,
      placeOrderTxs: 0,
      actualFillCount: 0,
      actualFillVolumeUsd: 0,
      intentNotionalUsd: 0,
      estimatedBuilderFeeUsd: 0,
    };
    item.placeOrderTxs += 1;
    item.actualFillCount += order.fillCount;
    item.actualFillVolumeUsd += order.actualFillVolumeUsd;
    item.intentNotionalUsd += order.intentNotionalUsd;
    item.estimatedBuilderFeeUsd += estimatedBuilderFeeUsd(order);
    map.set(key, item);
  }
  return [...map.values()]
    .map((item) => ({
      ...item,
      actualFillVolumeUsd: roundUsd(item.actualFillVolumeUsd),
      intentNotionalUsd: roundUsd(item.intentNotionalUsd),
      estimatedBuilderFeeUsd: roundUsd(item.estimatedBuilderFeeUsd),
    }))
    .sort((a, b) => b.actualFillVolumeUsd - a.actualFillVolumeUsd);
}

function summarizeByDay(orders: ParsedOrder[]): DecibelDaySummary[] {
  const map = new Map<string, DecibelDaySummary>();
  for (const order of orders.filter((candidate) => candidate.success)) {
    const day = order.timestamp.slice(0, 10);
    const item = map.get(day) ?? {
      date: day,
      placeOrderTxs: 0,
      actualFillCount: 0,
      actualFillVolumeUsd: 0,
      intentNotionalUsd: 0,
      estimatedBuilderFeeUsd: 0,
    };
    item.placeOrderTxs += 1;
    item.actualFillCount += order.fillCount;
    item.actualFillVolumeUsd += order.actualFillVolumeUsd;
    item.intentNotionalUsd += order.intentNotionalUsd;
    item.estimatedBuilderFeeUsd += estimatedBuilderFeeUsd(order);
    map.set(day, item);
  }
  return [...map.values()]
    .map((item) => ({
      ...item,
      actualFillVolumeUsd: roundUsd(item.actualFillVolumeUsd),
      intentNotionalUsd: roundUsd(item.intentNotionalUsd),
      estimatedBuilderFeeUsd: roundUsd(item.estimatedBuilderFeeUsd),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function toOrderPreview(order: ParsedOrder): DecibelOrderPreview {
  const wallet = order.agent?.owner ?? order.agent?.safe ?? order.sender ?? null;
  return {
    source: order.source,
    txVersion: order.txVersion,
    timestamp: order.timestamp,
    wallet,
    subaccount: order.subaccount,
    market: order.market,
    marketName: order.marketName,
    side: order.isBuy ? "buy" : "sell",
    reduceOnly: order.reduceOnly,
    fillCount: order.fillCount,
    actualFillVolumeUsd: roundUsd(order.actualFillVolumeUsd),
    intentNotionalUsd: roundUsd(order.intentNotionalUsd),
    estimatedBuilderFeeUsd: roundUsd(estimatedBuilderFeeUsd(order)),
    builderFeeBps: order.builderFeeBps,
    agentRecordType: order.agent?.recordType ?? null,
    recordTxVersion: order.agent?.recordTxVersion ?? null,
  };
}

function isBuilderFeeOrder(context: ReportContext, order: ParsedOrder): boolean {
  return (
    order.success &&
    order.builderAddress === context.builderAddress &&
    typeof order.builderFeeBps === "number" &&
    order.builderFeeBps > 0
  );
}

function estimatedBuilderFeeUsd(order: ParsedOrder): number {
  if (!order.builderFeeBps || order.builderFeeBps <= 0) return 0;
  return order.actualFillVolumeUsd * (order.builderFeeBps / 10_000);
}

function canonicalAddress(value: unknown): string {
  if (value && typeof value === "object" && "inner" in value) {
    return canonicalAddress((value as { inner: unknown }).inner);
  }
  return toCanonicalAddress(AccountAddress.fromString(String(value).trim()).toString());
}

function optionalAddress(value: unknown): string | null {
  const inner = optionalVecValue(value);
  return inner == null ? null : canonicalAddress(inner);
}

function optionalU64(value: unknown): number | null {
  const inner = optionalVecValue(value);
  if (inner == null) return null;
  const n = Number(inner);
  return Number.isFinite(n) ? n : null;
}

function optionalVecValue(value: unknown): unknown | null {
  if (value && typeof value === "object" && Array.isArray((value as { vec?: unknown[] }).vec)) {
    const vec = (value as { vec: unknown[] }).vec;
    return vec.length > 0 ? vec[0] : null;
  }
  if (Array.isArray(value)) return value.length > 0 ? value[0] : null;
  return null;
}

function toBigIntString(value: unknown): string | null {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  return null;
}

function parseOptionalBps(raw: string | undefined): number | null {
  if (!raw || raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 10_000 ? parsed : null;
}

function normalizeItems(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.items)) return obj.items;
  if (Array.isArray(obj.markets)) return obj.markets;
  if (Array.isArray(obj.data)) return obj.data;
  return [];
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function decimalToNumber(value: Decimal): number {
  const n = Number(value.toFixed(12));
  return Number.isFinite(n) ? n : 0;
}

function roundUsd(value: number): number {
  return Number(value.toFixed(2));
}

function nextUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1),
  );
}

function formatIndexerTimestamp(date: Date): string {
  return date.toISOString().replace("Z", "").replace(/\.\d+$/, "");
}

function microsecondsToIso(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return new Date(Math.trunc(n / 1000)).toISOString();
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (idx < items.length) {
      const current = idx++;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

async function retry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number } | null)?.status;
      if (attempt < 4 && (status === 408 || status === 429 || (status ?? 500) >= 500)) {
        await sleep(750 * attempt);
        continue;
      }
      break;
    }
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNonNull<T>(value: T | null): value is T {
  return value !== null;
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
