import { NextRequest, NextResponse } from 'next/server';
import { toCanonicalAddress, normalizeAddress } from '@/lib/utils/addressNormalization';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/http';

const APTOS_API_KEY = process.env.APTOS_API_KEY;
const FULLNODE_URL = 'https://fullnode.mainnet.aptoslabs.com/v1';
const INDEXER_URL = 'https://indexer.mainnet.aptoslabs.com/v1/graphql';

// Panora token list confirms this FA is Tether USD (USDt), 6 decimals.
const USDT_FA_MAINNET =
  '0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b';
const USDT_DECIMALS = 6;

// APTree bridge entry functions (examples observed on-chain).
const APTREE_MODULE =
  '0x951a31b39db54a4e32af927dce9fae7aa1ad14a1bb73318405ccf6cd5d66b3be';
const APTREE_BRIDGE_DEPOSIT_FN = `${APTREE_MODULE}::bridge::deposit`;
const APTREE_BRIDGE_WITHDRAW_FN = `${APTREE_MODULE}::bridge::withdraw`;

type Direction = 'deposit' | 'withdraw';

type AptosUserTransaction = {
  type: string;
  success: boolean;
  version: string;
  hash: string;
  sender?: string;
  timestamp?: string;
  payload?: {
    type: string;
    function?: string;
  };
  events?: Array<{
    type: string;
    data?: any;
  }>;
};

export interface AptreeCashflowEntry {
  timestamp: string;
  direction: Direction;
  amountRaw: string;
  amount: string;
  assetId: string;
  txVersion: string;
  txHash: string;
}

export interface AptreeDepositHistoryResponseData {
  assetId: string;
  totalDeposited: string;
  totalWithdrawn: string;
  netDeposits: string;
  pnlStats: {
    pnl: string | null;
    apr: string | null;
    holdingDays: number;
  };
  entries: AptreeCashflowEntry[];
}

function formatDecimal(baseUnits: bigint, decimals: number) {
  const sign = baseUnits < 0n ? '-' : '';
  const abs = baseUnits < 0n ? -baseUnits : baseUnits;
  const denom = 10n ** BigInt(decimals);
  const whole = abs / denom;
  const frac = abs % denom;
  return `${sign}${whole}.${String(frac).padStart(decimals, '0')}`;
}

function isAptreeBridgeTx(tx: AptosUserTransaction) {
  const fn = tx.payload?.function ?? '';
  // Matches examples: 0x951a...::bridge::deposit / withdraw
  return fn.includes('::bridge::deposit') || fn.includes('::bridge::withdraw');
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
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

async function fetchTxByVersion(version: string, headers: Record<string, string>) {
  const res = await fetch(`${FULLNODE_URL}/transactions/by_version/${version}`, {
    headers,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Fullnode tx by_version failed: ${res.status}`);
  const json = (await res.json().catch(() => null)) as AptosUserTransaction | null;
  if (!json) throw new Error('Fullnode tx by_version returned empty body');
  return json;
}

function parseAptreeCashflowsFromTx(tx: AptosUserTransaction, assetId: string) {
  const entries: AptreeCashflowEntry[] = [];
  const txTsMs = tx.timestamp ? Number(tx.timestamp) / 1000 : NaN; // fullnode timestamp is microseconds
  const timestampIso = Number.isFinite(txTsMs)
    ? new Date(txTsMs).toISOString()
    : new Date().toISOString();

  const normalizedAsset = normalizeAddress(assetId).toLowerCase();
  const events = Array.isArray(tx.events) ? tx.events : [];

  for (const e of events) {
    const t = String(e.type ?? '');
    const data = e.data ?? {};

    // Prefer protocol-native vault events.
    if (t.endsWith('::vault::DepositedEvent')) {
      const evAsset = data?.asset?.inner ? String(data.asset.inner) : '';
      if (normalizeAddress(evAsset).toLowerCase() !== normalizedAsset) continue;
      const raw = BigInt(String(data.amount ?? '0'));
      entries.push({
        timestamp: data?.timestamp
          ? new Date(Number(data.timestamp) * 1000).toISOString()
          : timestampIso,
        direction: 'deposit',
        amountRaw: String(raw),
        amount: formatDecimal(raw, USDT_DECIMALS),
        assetId,
        txVersion: tx.version,
        txHash: tx.hash,
      });
    }

    if (t.endsWith('::vault::WithdrawnEvent')) {
      const evAsset = data?.asset?.inner ? String(data.asset.inner) : '';
      if (normalizeAddress(evAsset).toLowerCase() !== normalizedAsset) continue;
      const raw = BigInt(String(data.amount ?? '0'));
      entries.push({
        timestamp: data?.timestamp
          ? new Date(Number(data.timestamp) * 1000).toISOString()
          : timestampIso,
        direction: 'withdraw',
        amountRaw: String(raw),
        amount: formatDecimal(raw, USDT_DECIMALS),
        assetId,
        txVersion: tx.version,
        txHash: tx.hash,
      });
    }
  }

  return entries;
}

function computePnlStats(entries: AptreeCashflowEntry[], currentValue: number | null) {
  if (entries.length === 0) {
    return { pnl: null, apr: null, holdingDays: 0 };
  }

  const chronological = [...entries].reverse();
  const firstTs = new Date(chronological[0].timestamp).getTime();
  const now = Date.now();
  const totalMs = now - firstTs;
  const totalDays = totalMs / (1000 * 60 * 60 * 24);
  const holdingDays = Math.max(0, Math.floor(totalDays));

  if (currentValue == null || !Number.isFinite(currentValue)) {
    return { pnl: null, apr: null, holdingDays };
  }

  // netDeposits from entries (in decimal strings)
  let netDeposits = 0;
  for (const e of chronological) {
    const amt = parseFloat(e.amount);
    netDeposits += e.direction === 'deposit' ? amt : -amt;
  }

  const pnl = currentValue - netDeposits;
  if (totalDays < 1) {
    return { pnl: pnl.toFixed(6), apr: null, holdingDays };
  }

  let dollarDays = 0;
  let balance = 0;
  let prevTs = firstTs;

  for (const entry of chronological) {
    const ts = new Date(entry.timestamp).getTime();
    const daysDelta = (ts - prevTs) / (1000 * 60 * 60 * 24);
    dollarDays += balance * daysDelta;
    prevTs = ts;

    const amount = parseFloat(entry.amount);
    balance += entry.direction === 'deposit' ? amount : -amount;
  }

  const remainingDays = (now - prevTs) / (1000 * 60 * 60 * 24);
  dollarDays += balance * remainingDays;

  const avgCapital = dollarDays / totalDays;
  let apr: string | null = null;
  if (avgCapital > 0.01) {
    const annualizedReturn = (pnl / avgCapital) * (365 / totalDays) * 100;
    apr = annualizedReturn.toFixed(2);
  }

  return { pnl: pnl.toFixed(6), apr, holdingDays };
}

/**
 * GET /api/protocols/aptree/deposit-history?address=0x...&assetId=0x...&maxActivities=2000
 *
 * Builds full APTree cashflow history by:
 * 1) fetching matching activity rows from Indexer GraphQL (paginated)
 * 2) extracting unique transaction versions
 * 3) fetching fullnode txs by version and parsing protocol-native vault events
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const addressParam = searchParams.get('address');
    if (!addressParam?.trim()) {
      return NextResponse.json(
        createErrorResponse(new Error('address parameter is required')),
        { status: 400 }
      );
    }

    const assetId = searchParams.get('assetId')?.trim() || USDT_FA_MAINNET;
    const currentValueParam = searchParams.get('currentValue');
    const currentValue = currentValueParam != null ? parseFloat(currentValueParam) : null;
    const maxActivities = Math.max(
      1,
      Math.min(10_000, Number(searchParams.get('maxActivities') ?? '2000') || 2000)
    );
    const pageSize = Math.max(
      50,
      Math.min(500, Number(searchParams.get('pageSize') ?? '200') || 200)
    );
    const concurrency = Math.max(
      1,
      Math.min(20, Number(searchParams.get('concurrency') ?? '6') || 6)
    );

    const addressRaw = addressParam.trim();
    // Fullnode endpoints are tolerant, but we keep canonical for consistency.
    const address = toCanonicalAddress(addressRaw);
    // Indexer owner_address may be stored either as canonical (64-hex) or normalized (trimmed) form.
    const ownerCanonical = toCanonicalAddress(addressRaw);
    const ownerNormalized = normalizeAddress(addressRaw);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (APTOS_API_KEY) headers['Authorization'] = `Bearer ${APTOS_API_KEY}`;

    // 1) Indexer: get all matching activity rows for this owner+asset and bridge functions.
    const versions: string[] = [];
    const seen = new Set<string>();

    const query = `
      query GetFaActivities($owners: [String!]!, $asset: String!, $entryFns: [String!]!, $limit: Int!, $offset: Int!) {
        fungible_asset_activities(
          where: {
            owner_address: { _in: $owners }
            asset_type: { _eq: $asset }
            is_transaction_success: { _eq: true }
            entry_function_id_str: { _in: $entryFns }
          }
          order_by: { transaction_timestamp: desc }
          limit: $limit
          offset: $offset
        ) {
          transaction_version
          transaction_timestamp
          entry_function_id_str
          amount
          type
        }
      }
    `;

    for (let offset = 0; offset < maxActivities; offset += pageSize) {
      const res = await fetch(INDEXER_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          variables: {
            owners: [ownerCanonical, ownerNormalized],
            asset: assetId,
            entryFns: [APTREE_BRIDGE_DEPOSIT_FN, APTREE_BRIDGE_WITHDRAW_FN],
            limit: pageSize,
            offset,
          },
        }),
        cache: 'no-store',
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Indexer GraphQL failed: ${res.status} ${text.slice(0, 200)}`);
      }

      const json = await res.json().catch(() => null);
      const rows = (json?.data?.fungible_asset_activities ?? []) as Array<{
        transaction_version?: string;
      }>;

      if (!Array.isArray(rows) || rows.length === 0) break;

      for (const r of rows) {
        const v = r?.transaction_version;
        if (!v) continue;
        if (seen.has(v)) continue;
        seen.add(v);
        versions.push(String(v));
      }

      if (rows.length < pageSize) break;
    }

    // 2) Fullnode: fetch txs by version and parse protocol-native vault events.
    const txs = await mapWithConcurrency(versions, concurrency, async (v) =>
      fetchTxByVersion(v, headers)
    );

    const entries: AptreeCashflowEntry[] = [];
    for (const tx of txs) {
      if (!tx || tx.type !== 'user_transaction' || tx.success !== true) continue;
      // Indexer already filtered by bridge entry function, but keep an extra guard.
      if (!isAptreeBridgeTx(tx)) continue;
      entries.push(...parseAptreeCashflowsFromTx(tx, assetId));
    }

    // Sort desc by timestamp (UI-friendly).
    entries.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));

    let depositedRaw = 0n;
    let withdrawnRaw = 0n;
    for (const e of entries) {
      const raw = BigInt(e.amountRaw);
      if (e.direction === 'deposit') depositedRaw += raw;
      else withdrawnRaw += raw;
    }

    const pnlStats = computePnlStats(entries, currentValue);

    const data: AptreeDepositHistoryResponseData = {
      assetId,
      totalDeposited: formatDecimal(depositedRaw, USDT_DECIMALS),
      totalWithdrawn: formatDecimal(withdrawnRaw, USDT_DECIMALS),
      netDeposits: formatDecimal(depositedRaw - withdrawnRaw, USDT_DECIMALS),
      pnlStats,
      entries,
    };

    return NextResponse.json(createSuccessResponse(data));
  } catch (error) {
    console.error('[APTree] deposit-history error:', error);
    return NextResponse.json(
      createErrorResponse(error instanceof Error ? error : new Error('Unknown error')),
      { status: 500 }
    );
  }
}

