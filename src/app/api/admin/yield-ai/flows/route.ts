import { NextRequest, NextResponse } from 'next/server';
import { Aptos, AptosConfig, Network } from '@aptos-labs/ts-sdk';
import { toCanonicalAddress } from '@/lib/utils/addressNormalization';
import {
  YIELD_AI_VAULT_MODULE,
  YIELD_AI_VAULT_VIEWS,
  USDC_FA_METADATA_MAINNET,
} from '@/lib/constants/yieldAiVault';
import {
  STRATEGY_REGISTRY_VIEWS,
  resolveActiveAiAgentStrategy,
  type AiAgentStrategyId,
} from '@/lib/protocols/yield-ai/strategyRegistry';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/http';

const APTOS_API_KEY = process.env.APTOS_API_KEY;
const INDEXER_URL = 'https://indexer.mainnet.aptoslabs.com/v1/graphql';
const USDC_DECIMALS = 6;

const VAULT_DEPOSIT_FN = `${YIELD_AI_VAULT_MODULE}::deposit`;
const VAULT_WITHDRAW_FN = `${YIELD_AI_VAULT_MODULE}::withdraw`;

const SAFES_PAGE_SIZE = 100;
const STRATEGY_VIEW_CONCURRENCY = 8;
/** Aptos indexer caps fungible_asset_activities at 100 rows per query. */
const ACTIVITIES_PAGE_LIMIT = 100;
const ACTIVITIES_MAX_TOTAL = 50000;
const DEFAULT_RANGE_MS = 7 * 24 * 3600 * 1000;
const OWNER_CHUNK_SIZE = 10;
const OWNER_QUERY_CONCURRENCY = 3;
/** Cursor sentinel above any real transaction_version (first page). */
const VERSION_CURSOR_START = '999999999999999999';

const config = new AptosConfig({
  network: Network.MAINNET,
  ...(APTOS_API_KEY && {
    clientConfig: { HEADERS: { Authorization: `Bearer ${APTOS_API_KEY}` } },
  }),
});
const aptos = new Aptos(config);

type Direction = 'deposit' | 'withdraw';

interface SafeInfo {
  safeAddress: string;
  owner: string;
  paused: boolean;
  exists: boolean;
}

interface FlowEntry {
  timestamp: string;
  txVersion: string;
  safeAddress: string;
  owner: string | null;
  strategy: AiAgentStrategyId | 'unknown';
  direction: Direction;
  amount: string;
  amountRaw: string;
}

interface DayBucket {
  /** YYYY-MM-DD (UTC) */
  date: string;
  stablecoinDeposit: string;
  stablecoinWithdraw: string;
  deltaNeutralDeposit: string;
  deltaNeutralWithdraw: string;
  unknownDeposit: string;
  unknownWithdraw: string;
}

interface WalletSummary {
  owner: string;
  safeAddresses: string[];
  strategies: AiAgentStrategyId[];
  totalDeposited: string;
  totalWithdrawn: string;
  netDeposits: string;
  lastActivity: string | null;
}

interface FlowsResponse {
  generatedAt: string;
  rangeFrom: string | null;
  rangeTo: string | null;
  totals: {
    safes: number;
    activeOwners: number;
    totalDeposited: string;
    totalWithdrawn: string;
    netDeposits: string;
  };
  byDay: DayBucket[];
  byWallet: WalletSummary[];
  entries: FlowEntry[];
  /** True if we hit the activities page cap (means data is truncated). */
  truncated: boolean;
}

const ACTIVITIES_QUERY = `
  query GetVaultFlows(
    $usdcAsset: String!,
    $entryFunctions: [String!]!,
    $owners: [String!]!,
    $fromTs: timestamp,
    $toTs: timestamp,
    $limit: Int!,
    $cursor: bigint!
  ) {
    fungible_asset_activities(
      where: {
        owner_address: { _in: $owners }
        asset_type: { _eq: $usdcAsset }
        is_transaction_success: { _eq: true }
        entry_function_id_str: { _in: $entryFunctions }
        transaction_timestamp: { _gte: $fromTs, _lte: $toTs }
        transaction_version: { _lt: $cursor }
      }
      order_by: { transaction_version: desc }
      limit: $limit
    ) {
      transaction_version
      transaction_timestamp
      owner_address
      amount
      entry_function_id_str
    }
  }
`;

/**
 * GET /api/admin/yield-ai/flows?from=2025-01-01&to=2025-12-31
 *
 * Aggregates Yield AI vault deposits/withdrawals across ALL safes,
 * grouped by day and active strategy (stablecoin vs delta-neutral).
 *
 * Strategy is resolved from current strategy_registry tag (not historical).
 */
export async function GET(request: NextRequest) {
  try {
    const fromParam = request.nextUrl.searchParams.get('from');
    const toParam = request.nextUrl.searchParams.get('to');

    const defaultToTs = formatIndexerTimestamp(new Date());
    const defaultFromTs = formatIndexerTimestamp(new Date(Date.now() - DEFAULT_RANGE_MS));
    const fromTs = parseDateParam(fromParam) ?? defaultFromTs;
    const toTs = parseDateParam(toParam, /*endOfDay*/ true) ?? defaultToTs;

    const safes = await fetchAllSafes();
    const activeSafes = safes.filter((s) => s.exists);

    const safesByAddress = new Map<string, SafeInfo>();
    for (const s of activeSafes) {
      safesByAddress.set(toCanonicalAddress(s.safeAddress), s);
    }

    const strategyMap = await fetchStrategiesBatched(activeSafes.map((s) => s.safeAddress));

    const owners = activeSafes.map((s) => toCanonicalAddress(s.safeAddress));

    const { entries: rawEntries, truncated } = await fetchActivities({
      owners,
      fromTs,
      toTs,
    });

    const entries: FlowEntry[] = [];
    let totalDepRaw = 0n;
    let totalWdrRaw = 0n;
    const dayMap = new Map<string, DayBucket>();
    const walletMap = new Map<
      string,
      {
        owner: string;
        safeAddresses: Set<string>;
        strategies: Set<AiAgentStrategyId>;
        totalDepositedRaw: bigint;
        totalWithdrawnRaw: bigint;
        lastActivity: string | null;
      }
    >();

    for (const a of rawEntries) {
      const fn = a.entry_function_id_str;
      let direction: Direction;
      if (fn.endsWith('::deposit')) direction = 'deposit';
      else if (fn.endsWith('::withdraw')) direction = 'withdraw';
      else continue;

      const safeAddr = toCanonicalAddress(a.owner_address);
      const safe = safesByAddress.get(safeAddr);
      const owner = safe ? toCanonicalAddress(safe.owner) : null;
      const strategy = strategyMap.get(safeAddr) ?? 'unknown';
      const raw = BigInt(a.amount);

      if (direction === 'deposit') totalDepRaw += raw;
      else totalWdrRaw += raw;

      entries.push({
        timestamp: a.transaction_timestamp,
        txVersion: String(a.transaction_version),
        safeAddress: safeAddr,
        owner,
        strategy,
        direction,
        amount: formatUsdc(raw),
        amountRaw: String(raw),
      });

      const day = a.transaction_timestamp.slice(0, 10);
      let bucket = dayMap.get(day);
      if (!bucket) {
        bucket = makeEmptyBucket(day);
        dayMap.set(day, bucket);
      }
      addToBucket(bucket, strategy, direction, raw);

      if (owner) {
        let w = walletMap.get(owner);
        if (!w) {
          w = {
            owner,
            safeAddresses: new Set(),
            strategies: new Set(),
            totalDepositedRaw: 0n,
            totalWithdrawnRaw: 0n,
            lastActivity: null,
          };
          walletMap.set(owner, w);
        }
        w.safeAddresses.add(safeAddr);
        if (strategy !== 'unknown') w.strategies.add(strategy);
        if (direction === 'deposit') w.totalDepositedRaw += raw;
        else w.totalWithdrawnRaw += raw;
        if (!w.lastActivity || a.transaction_timestamp > w.lastActivity) {
          w.lastActivity = a.transaction_timestamp;
        }
      }
    }

    const byDay = [...dayMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    const byWallet: WalletSummary[] = [...walletMap.values()]
      .map((w) => ({
        owner: w.owner,
        safeAddresses: [...w.safeAddresses],
        strategies: [...w.strategies],
        totalDeposited: formatUsdc(w.totalDepositedRaw),
        totalWithdrawn: formatUsdc(w.totalWithdrawnRaw),
        netDeposits: formatUsdc(w.totalDepositedRaw - w.totalWithdrawnRaw),
        lastActivity: w.lastActivity,
      }))
      .sort((a, b) => parseFloat(b.netDeposits) - parseFloat(a.netDeposits));

    const result: FlowsResponse = {
      generatedAt: new Date().toISOString(),
      rangeFrom: fromTs,
      rangeTo: toTs,
      totals: {
        safes: activeSafes.length,
        activeOwners: walletMap.size,
        totalDeposited: formatUsdc(totalDepRaw),
        totalWithdrawn: formatUsdc(totalWdrRaw),
        netDeposits: formatUsdc(totalDepRaw - totalWdrRaw),
      },
      byDay,
      byWallet,
      entries,
      truncated,
    };

    return NextResponse.json(createSuccessResponse(result));
  } catch (error) {
    console.error('[Admin Yield AI flows] error:', error);
    return NextResponse.json(
      createErrorResponse(error instanceof Error ? error : new Error('Unknown error')),
      { status: 500 },
    );
  }
}

async function fetchAllSafes(): Promise<SafeInfo[]> {
  const totalRes = await aptos.view({
    payload: {
      function: YIELD_AI_VAULT_VIEWS.getTotalSafes,
      typeArguments: [],
      functionArguments: [],
    },
  });
  const totalRaw = Array.isArray(totalRes) ? totalRes[0] : totalRes;
  const total = Number(typeof totalRaw === 'bigint' ? totalRaw : String(totalRaw ?? 0)) || 0;
  if (total <= 0) return [];

  const safes: SafeInfo[] = [];
  for (let start = 0; start < total; start += SAFES_PAGE_SIZE) {
    const limit = Math.min(SAFES_PAGE_SIZE, total - start);
    const pageRes = await aptos.view({
      payload: {
        function: YIELD_AI_VAULT_VIEWS.getSafesRangeInfo,
        typeArguments: [],
        functionArguments: [String(start), String(limit)],
      },
    });
    // View returns [vector<SafeStruct>]. Items may be objects or tuples.
    const list = (Array.isArray(pageRes) && Array.isArray(pageRes[0])
      ? pageRes[0]
      : Array.isArray(pageRes)
        ? pageRes
        : []) as unknown[];
    for (const item of list) {
      const parsed = parseSafeRow(item);
      if (parsed) safes.push(parsed);
    }
  }
  return safes;
}

function parseSafeRow(raw: unknown): SafeInfo | null {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    const addr = (r.safe_address ?? r.safeAddress ?? r.safe_addr ?? r.safe) as string | undefined;
    const owner = (r.owner ?? r.owner_address ?? r.ownerAddress) as string | undefined;
    if (typeof addr !== 'string' || typeof owner !== 'string') return null;
    return {
      safeAddress: addr,
      owner,
      paused: Boolean(r.paused ?? r.isPaused ?? false),
      exists: Boolean(r.exists ?? r.isExists ?? true),
    };
  }
  if (Array.isArray(raw)) {
    const [addr, owner, paused, exists] = raw as unknown[];
    if (typeof addr !== 'string' || typeof owner !== 'string') return null;
    return {
      safeAddress: addr,
      owner,
      paused: Boolean(paused),
      exists: exists === undefined ? true : Boolean(exists),
    };
  }
  return null;
}

async function fetchStrategiesBatched(
  safeAddresses: string[],
): Promise<Map<string, AiAgentStrategyId>> {
  const out = new Map<string, AiAgentStrategyId>();
  let idx = 0;

  async function worker() {
    while (idx < safeAddresses.length) {
      const i = idx++;
      const raw = safeAddresses[i];
      const safe = toCanonicalAddress(raw);
      try {
        const res = await aptos.view({
          payload: {
            function: STRATEGY_REGISTRY_VIEWS.getSafeActiveStrategies,
            typeArguments: [],
            functionArguments: [safe],
          },
        });
        const vec = Array.isArray(res) ? res[0] : res;
        const resolved = resolveActiveAiAgentStrategy({ activeStrategyIdBytesVec: vec });
        out.set(safe, resolved.activeStrategyId);
      } catch {
        out.set(safe, 'stablecoin_compound');
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(STRATEGY_VIEW_CONCURRENCY, safeAddresses.length) }, () => worker()),
  );
  return out;
}

interface RawActivity {
  transaction_version: string;
  transaction_timestamp: string;
  owner_address: string;
  amount: string | number;
  entry_function_id_str: string;
}

async function fetchActivities(params: {
  owners: string[];
  fromTs: string | null;
  toTs: string | null;
}): Promise<{ entries: RawActivity[]; truncated: boolean }> {
  if (params.owners.length === 0) return { entries: [], truncated: false };

  const ownerChunks = chunk(params.owners.map((owner) => toCanonicalAddress(owner)), OWNER_CHUNK_SIZE);
  const results = await mapWithConcurrency(ownerChunks, OWNER_QUERY_CONCURRENCY, (owners) =>
    fetchActivitiesForOwnerChunk(params, owners),
  );

  const entries = results
    .flatMap((result) => result.entries)
    .sort((a, b) => {
      const av = BigInt(a.transaction_version);
      const bv = BigInt(b.transaction_version);
      if (av === bv) return 0;
      return av < bv ? 1 : -1;
    });
  const truncated = results.some((result) => result.truncated) || entries.length > ACTIVITIES_MAX_TOTAL;

  return {
    entries: entries.slice(0, ACTIVITIES_MAX_TOTAL),
    truncated,
  };
}

async function fetchActivitiesForOwnerChunk(
  params: {
    fromTs: string | null;
    toTs: string | null;
  },
  owners: string[],
): Promise<{ entries: RawActivity[]; truncated: boolean }> {
  try {
    return await fetchActivitiesForOwners(params, owners);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (owners.length <= 1 || !isIndexerTimeout(message)) throw error;

    const midpoint = Math.ceil(owners.length / 2);
    const [left, right] = await Promise.all([
      fetchActivitiesForOwnerChunk(params, owners.slice(0, midpoint)),
      fetchActivitiesForOwnerChunk(params, owners.slice(midpoint)),
    ]);

    return {
      entries: [...left.entries, ...right.entries],
      truncated: left.truncated || right.truncated,
    };
  }
}

async function fetchActivitiesForOwners(
  params: {
    fromTs: string | null;
    toTs: string | null;
  },
  owners: string[],
): Promise<{ entries: RawActivity[]; truncated: boolean }> {
  if (owners.length === 0) return { entries: [], truncated: false };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (APTOS_API_KEY) headers['Authorization'] = `Bearer ${APTOS_API_KEY}`;

  const all: RawActivity[] = [];
  let cursor = VERSION_CURSOR_START;
  let truncated = false;

  while (all.length < ACTIVITIES_MAX_TOTAL) {
    const res = await fetch(INDEXER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: ACTIVITIES_QUERY,
        variables: {
          usdcAsset: USDC_FA_METADATA_MAINNET,
          entryFunctions: [VAULT_DEPOSIT_FN, VAULT_WITHDRAW_FN],
          owners,
          fromTs: params.fromTs,
          toTs: params.toTs,
          limit: ACTIVITIES_PAGE_LIMIT,
          cursor,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Indexer request failed: ${res.status} ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    if (json.errors) {
      throw new Error(`Indexer GraphQL error: ${JSON.stringify(json.errors).slice(0, 300)}`);
    }
    const page: RawActivity[] = json.data?.fungible_asset_activities ?? [];
    all.push(...page);

    if (page.length < ACTIVITIES_PAGE_LIMIT) break;
    // Rows are version-desc → last row holds the smallest version on this page.
    cursor = String(page[page.length - 1].transaction_version);
    if (all.length >= ACTIVITIES_MAX_TOTAL) {
      truncated = true;
      break;
    }
  }

  return { entries: all, truncated };
}

function isIndexerTimeout(message: string): boolean {
  return message.includes('408') || message.toLowerCase().includes('timed out');
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let idx = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const current = idx++;
      if (current >= items.length) return;
      results[current] = await mapper(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

function parseDateParam(s: string | null, endOfDay = false): string | null {
  if (!s) return null;
  // Accept YYYY-MM-DD or ISO. Output ISO without TZ for Hasura `timestamp`.
  const trimmed = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return endOfDay ? `${trimmed}T23:59:59` : `${trimmed}T00:00:00`;
  }
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return null;
  return formatIndexerTimestamp(d);
}

function formatIndexerTimestamp(d: Date): string {
  return d.toISOString().replace('Z', '').replace(/\.\d+$/, '');
}

function makeEmptyBucket(date: string): DayBucket {
  return {
    date,
    stablecoinDeposit: '0',
    stablecoinWithdraw: '0',
    deltaNeutralDeposit: '0',
    deltaNeutralWithdraw: '0',
    unknownDeposit: '0',
    unknownWithdraw: '0',
  };
}

function addToBucket(
  bucket: DayBucket,
  strategy: AiAgentStrategyId | 'unknown',
  direction: Direction,
  raw: bigint,
) {
  const key = bucketKey(strategy, direction);
  const prev = parseUsdc(bucket[key]);
  bucket[key] = formatUsdc(prev + raw);
}

function bucketKey(
  strategy: AiAgentStrategyId | 'unknown',
  direction: Direction,
): keyof Omit<DayBucket, 'date'> {
  if (strategy === 'stablecoin_compound') {
    return direction === 'deposit' ? 'stablecoinDeposit' : 'stablecoinWithdraw';
  }
  if (strategy === 'decibel_delta_neutral') {
    return direction === 'deposit' ? 'deltaNeutralDeposit' : 'deltaNeutralWithdraw';
  }
  return direction === 'deposit' ? 'unknownDeposit' : 'unknownWithdraw';
}

function parseUsdc(s: string): bigint {
  const [whole, frac = ''] = s.split('.');
  const fracPadded = (frac + '0'.repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  const sign = whole.startsWith('-') ? -1n : 1n;
  const wholeAbs = whole.replace('-', '');
  return sign * (BigInt(wholeAbs || '0') * 10n ** BigInt(USDC_DECIMALS) + BigInt(fracPadded || '0'));
}

function formatUsdc(baseUnits: bigint): string {
  const sign = baseUnits < 0n ? '-' : '';
  const abs = baseUnits < 0n ? -baseUnits : baseUnits;
  const whole = abs / 10n ** BigInt(USDC_DECIMALS);
  const frac = abs % 10n ** BigInt(USDC_DECIMALS);
  return `${sign}${whole}.${String(frac).padStart(USDC_DECIMALS, '0')}`;
}
