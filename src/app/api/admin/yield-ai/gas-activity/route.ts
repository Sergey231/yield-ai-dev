import { NextRequest, NextResponse } from 'next/server';
import { toCanonicalAddress } from '@/lib/utils/addressNormalization';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/http';
import {
  GAS_STATION_ADDRESS,
  categorizeEntryFunction,
  type ActivityCategory,
} from '@/lib/admin/gasActivity';

const APTOS_API_KEY = process.env.APTOS_API_KEY;
const INDEXER_URL = 'https://indexer.mainnet.aptoslabs.com/v1/graphql';

/** Aptos indexer caps account_transactions at 100 rows per query. */
const PAGE_LIMIT = 100;
const MAX_TOTAL = 50000;
const DEFAULT_RANGE_MS = 7 * 24 * 3600 * 1000;
/** Cursor sentinel above any real transaction_version (first page). */
const VERSION_CURSOR_START = '999999999999999999';

interface ActivityEntry {
  txVersion: string;
  timestamp: string;
  sender: string;
  entryFunction: string;
  category: ActivityCategory;
  action: string;
}

interface DayBucket {
  date: string;
  counts: Record<ActivityCategory, number>;
}

interface FunctionStat {
  entryFunction: string;
  category: ActivityCategory;
  action: string;
  count: number;
  uniqueWallets: number;
}

interface WalletStat {
  wallet: string;
  actions: number;
  categories: ActivityCategory[];
  isNew: boolean;
  firstSeen: string;
  lastSeen: string;
}

interface GasActivityResponse {
  generatedAt: string;
  gasStation: string;
  rangeFrom: string | null;
  rangeTo: string | null;
  totals: {
    actions: number;
    uniqueWallets: number;
    newSafes: number;
    byCategory: Record<ActivityCategory, number>;
  };
  byDay: DayBucket[];
  byFunction: FunctionStat[];
  byWallet: WalletStat[];
  entries: ActivityEntry[];
  truncated: boolean;
}

const QUERY = `
  query GasStationActivity(
    $gasStation: String!,
    $fromTs: timestamp,
    $toTs: timestamp,
    $limit: Int!,
    $cursor: bigint!
  ) {
    account_transactions(
      where: {
        account_address: { _eq: $gasStation }
        transaction_version: { _lt: $cursor }
        user_transaction: { timestamp: { _gte: $fromTs, _lte: $toTs } }
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

const ALL_CATEGORIES: ActivityCategory[] = [
  'vault',
  'strategy',
  'decibel',
  'swap',
  'lending',
  'bridge',
  'other',
];

function emptyCategoryCounts(): Record<ActivityCategory, number> {
  return {
    vault: 0,
    strategy: 0,
    decibel: 0,
    swap: 0,
    lending: 0,
    bridge: 0,
    other: 0,
  };
}

/**
 * GET /api/admin/yield-ai/gas-activity?from=2025-01-01&to=2025-12-31
 *
 * Aggregates every transaction sponsored by the Yield AI gas station wallet,
 * grouped by day, entry function, and sender wallet. Counts only (no amounts).
 */
export async function GET(request: NextRequest) {
  try {
    const defaultToTs = formatIndexerTimestamp(new Date());
    const defaultFromTs = formatIndexerTimestamp(new Date(Date.now() - DEFAULT_RANGE_MS));
    const fromTs = parseDateParam(request.nextUrl.searchParams.get('from')) ?? defaultFromTs;
    const toTs = parseDateParam(request.nextUrl.searchParams.get('to'), true) ?? defaultToTs;

    const { rows, truncated } = await fetchSponsoredTxns(fromTs, toTs);

    const entries: ActivityEntry[] = [];
    const dayMap = new Map<string, DayBucket>();
    const fnMap = new Map<string, { stat: FunctionStat; wallets: Set<string> }>();
    const walletMap = new Map<
      string,
      {
        wallet: string;
        actions: number;
        categories: Set<ActivityCategory>;
        isNew: boolean;
        firstSeen: string;
        lastSeen: string;
      }
    >();
    const byCategory = emptyCategoryCounts();
    const uniqueWallets = new Set<string>();
    let newSafes = 0;

    for (const row of rows) {
      const ut = row.user_transaction;
      if (!ut) continue;
      const fn = ut.entry_function_id_str;
      if (!fn) continue;

      const sender = toCanonicalAddress(ut.sender);
      const { category, action } = categorizeEntryFunction(fn);
      const isInitVault = fn.endsWith('::vault::init_vault_v2');

      entries.push({
        txVersion: String(row.transaction_version),
        timestamp: ut.timestamp,
        sender,
        entryFunction: fn,
        category,
        action,
      });

      byCategory[category] += 1;
      uniqueWallets.add(sender);
      if (isInitVault) newSafes += 1;

      const day = ut.timestamp.slice(0, 10);
      let bucket = dayMap.get(day);
      if (!bucket) {
        bucket = { date: day, counts: emptyCategoryCounts() };
        dayMap.set(day, bucket);
      }
      bucket.counts[category] += 1;

      let fnEntry = fnMap.get(fn);
      if (!fnEntry) {
        fnEntry = {
          stat: { entryFunction: fn, category, action, count: 0, uniqueWallets: 0 },
          wallets: new Set(),
        };
        fnMap.set(fn, fnEntry);
      }
      fnEntry.stat.count += 1;
      fnEntry.wallets.add(sender);

      let w = walletMap.get(sender);
      if (!w) {
        w = {
          wallet: sender,
          actions: 0,
          categories: new Set(),
          isNew: false,
          firstSeen: ut.timestamp,
          lastSeen: ut.timestamp,
        };
        walletMap.set(sender, w);
      }
      w.actions += 1;
      w.categories.add(category);
      if (isInitVault) w.isNew = true;
      if (ut.timestamp < w.firstSeen) w.firstSeen = ut.timestamp;
      if (ut.timestamp > w.lastSeen) w.lastSeen = ut.timestamp;
    }

    const byDay = [...dayMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

    const byFunction: FunctionStat[] = [...fnMap.values()]
      .map((f) => ({ ...f.stat, uniqueWallets: f.wallets.size }))
      .sort((a, b) => b.count - a.count);

    const byWallet: WalletStat[] = [...walletMap.values()]
      .map((w) => ({
        wallet: w.wallet,
        actions: w.actions,
        categories: ALL_CATEGORIES.filter((c) => w.categories.has(c)),
        isNew: w.isNew,
        firstSeen: w.firstSeen,
        lastSeen: w.lastSeen,
      }))
      .sort((a, b) => b.actions - a.actions);

    const result: GasActivityResponse = {
      generatedAt: new Date().toISOString(),
      gasStation: GAS_STATION_ADDRESS,
      rangeFrom: fromTs,
      rangeTo: toTs,
      totals: {
        actions: entries.length,
        uniqueWallets: uniqueWallets.size,
        newSafes,
        byCategory,
      },
      byDay,
      byFunction,
      byWallet,
      entries,
      truncated,
    };

    return NextResponse.json(createSuccessResponse(result));
  } catch (error) {
    console.error('[Admin gas-activity] error:', error);
    return NextResponse.json(
      createErrorResponse(error instanceof Error ? error : new Error('Unknown error')),
      { status: 500 },
    );
  }
}

interface RawRow {
  transaction_version: string | number;
  user_transaction: {
    sender: string;
    entry_function_id_str: string | null;
    timestamp: string;
  } | null;
}

async function fetchSponsoredTxns(
  fromTs: string | null,
  toTs: string | null,
): Promise<{ rows: RawRow[]; truncated: boolean }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (APTOS_API_KEY) headers['Authorization'] = `Bearer ${APTOS_API_KEY}`;

  const rows: RawRow[] = [];
  let cursor = VERSION_CURSOR_START;
  let truncated = false;

  while (rows.length < MAX_TOTAL) {
    const res = await fetch(INDEXER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: QUERY,
        variables: {
          gasStation: GAS_STATION_ADDRESS,
          fromTs,
          toTs,
          limit: PAGE_LIMIT,
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
    const page: RawRow[] = json.data?.account_transactions ?? [];
    rows.push(...page);

    if (page.length < PAGE_LIMIT) break;
    // Rows are version-desc → last row holds the smallest version on this page.
    cursor = String(page[page.length - 1].transaction_version);
    if (rows.length >= MAX_TOTAL) {
      truncated = true;
      break;
    }
  }

  return { rows, truncated };
}

function parseDateParam(s: string | null, endOfDay = false): string | null {
  if (!s) return null;
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
