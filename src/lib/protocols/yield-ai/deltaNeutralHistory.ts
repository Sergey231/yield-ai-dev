import {
  YIELD_AI_PACKAGE_ADDRESS,
} from "@/lib/constants/yieldAiVault";
import {
  normalizeAddress,
  toCanonicalAddress,
} from "@/lib/utils/addressNormalization";

const INDEXER_GRAPHQL = "https://indexer.mainnet.aptoslabs.com/v1/graphql";
const FULLNODE_URL = "https://api.mainnet.aptoslabs.com/v1";

export const DELTA_NEUTRAL_RECORD_OPEN_FN =
  `${YIELD_AI_PACKAGE_ADDRESS}::delta_neutral::record_open` as const;
export const DELTA_NEUTRAL_RECORD_CLOSE_FN =
  `${YIELD_AI_PACKAGE_ADDRESS}::delta_neutral::record_close` as const;

/**
 * One row of the executor-side history we care about: a `record_open` or
 * `record_close` transaction filtered to a specific safe.
 *
 * Open arguments order (matches `record_open` entry fn):
 *   [safe, subaccount, perpMarket, spotAssetMetadata, filledShortSize,
 *    usdcSwappedIn, decibelTxVersion, clientOrderIdBytes]
 *
 * Close arguments order (matches `record_close`):
 *   [safe, recordCloseAnchorTxVersion]
 */
export interface DeltaNeutralHistoryEvent {
  type: "open" | "close";
  /** Aptos transaction version of the record_* entry call. */
  txVersion: string;
  /** Aptos tx hash. */
  txHash: string;
  /** ISO-8601 timestamp from indexer (UTC). */
  timestamp: string;
  /** Sender of the record_* tx (the executor account). */
  sender: string;
  /** Open-only fields. */
  decibelSubaccount?: string;
  perpMarket?: string;
  spotAssetMetadata?: string;
  filledShortSize?: string;
  usdcSwappedIn?: string;
  /** Decibel tx version recorded in the open call. */
  decibelTxVersion?: string;
  /** Close-only field — anchor (Decibel close tx version, or fallback). */
  closeAnchorTxVersion?: string;
}

export interface DeltaNeutralDeal {
  /** Deal index (0-based, oldest first). Stable across pagination of the input list. */
  index: number;
  open: DeltaNeutralHistoryEvent;
  /** Optional — present once the deal has been closed. */
  close?: DeltaNeutralHistoryEvent;
  /** Convenience: market used for this deal (from open). */
  perpMarket: string;
  /** Convenience: spot asset metadata used for this deal (from open). */
  spotAssetMetadata: string;
}

export interface DeltaNeutralHistorySummary {
  /** Total executor-side `record_open` calls observed for this safe. */
  totalOpens: number;
  /** Total `record_close` calls observed for this safe. */
  totalCloses: number;
  /** Unique perp markets ever used by this safe (lowercased + normalized). */
  uniqueMarkets: string[];
  /** Latest deal (open or open+close pair). null when no opens observed. */
  lastDeal: DeltaNeutralDeal | null;
  /** All deals (open paired with closest later close), oldest → newest. */
  deals: DeltaNeutralDeal[];
  /** Raw events (newest → oldest), useful for debugging / detailed views. */
  events: DeltaNeutralHistoryEvent[];
  /**
   * True when the indexer scan was bounded (likely missed older history).
   * The page hint helps the UI offer "load more" later if needed.
   */
  truncated: boolean;
}

interface IndexerActxRow {
  transaction_version: string | number;
  user_transaction: {
    entry_function_id_str: string;
    timestamp: string;
    sender: string;
  } | null;
}

interface FullnodeUserTx {
  type: string;
  hash: string;
  version: string;
  timestamp: string;
  payload?: {
    function?: string;
    arguments?: unknown[];
    type?: string;
  };
}

const INDEXER_QUERY = `
  query DeltaNeutralRecordTxs($executor: String!, $opens: String!, $closes: String!, $limit: Int!) {
    account_transactions(
      where: {
        account_address: { _eq: $executor },
        user_transaction: { entry_function_id_str: { _in: [$opens, $closes] } }
      }
      order_by: { transaction_version: desc }
      limit: $limit
    ) {
      transaction_version
      user_transaction {
        entry_function_id_str
        timestamp
        sender
      }
    }
  }
`;

function ensureHexAddress(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!/^0x[0-9a-fA-F]*$/.test(trimmed)) return null;
  return trimmed;
}

function toBigIntStringOrNull(v: unknown): string | null {
  if (typeof v === "string" && /^\d+$/.test(v)) return v;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return String(Math.trunc(v));
  return null;
}

/**
 * Bounded-concurrency mapper. Mirrors the helper used in deposit-history routes —
 * keeps fullnode RPS low while still letting us paginate quickly for ~30 txs.
 */
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

async function fetchTxByVersion(
  version: string,
  headers: Record<string, string>
): Promise<FullnodeUserTx | null> {
  try {
    const res = await fetch(`${FULLNODE_URL}/transactions/by_version/${version}`, {
      headers,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as FullnodeUserTx;
    if (!json || json.type !== "user_transaction") return null;
    return json;
  } catch {
    return null;
  }
}

interface FetchHistoryParams {
  /** Safe whose record_open / record_close calls we want. */
  safeAddress: string;
  /** Address of the executor account that signs vault txs. */
  executorAddress: string;
  /** Max number of `record_*` versions to scan from the indexer. Default 100. */
  scanLimit?: number;
  /** Aptos REST API key (optional). */
  aptosApiKey?: string | null;
}

/**
 * Pull a per-safe delta-neutral history from V1 contract activity.
 *
 * Strategy:
 *   1. Ask the indexer for all `record_open`/`record_close` versions ever signed
 *      by the executor (cheap — uses an indexed entry_function filter).
 *   2. Pull each tx payload from the fullnode by version (parallel, capped).
 *   3. Filter to those whose first argument equals `safeAddress` and parse out
 *      the per-deal fields we care about (market, spot meta, sizes).
 *
 * V1 doesn't store a multi-deal history on-chain, but this scan reconstructs
 * it from executor-signed entry calls — accurate as long as we are the only
 * sender for record_*, which is enforced today by the contract permission.
 */
export async function fetchDeltaNeutralHistory(
  params: FetchHistoryParams
): Promise<DeltaNeutralHistorySummary> {
  const { safeAddress, executorAddress, scanLimit = 100, aptosApiKey } = params;
  const safeNorm = normalizeAddress(toCanonicalAddress(safeAddress));
  const execNorm = toCanonicalAddress(executorAddress);

  const indexerHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const fullnodeHeaders: Record<string, string> = {};
  if (aptosApiKey) {
    indexerHeaders.Authorization = `Bearer ${aptosApiKey}`;
    fullnodeHeaders.Authorization = `Bearer ${aptosApiKey}`;
  }

  let rows: IndexerActxRow[] = [];
  try {
    const res = await fetch(INDEXER_GRAPHQL, {
      method: "POST",
      headers: indexerHeaders,
      body: JSON.stringify({
        query: INDEXER_QUERY,
        variables: {
          executor: execNorm,
          opens: DELTA_NEUTRAL_RECORD_OPEN_FN,
          closes: DELTA_NEUTRAL_RECORD_CLOSE_FN,
          limit: Math.max(10, Math.min(scanLimit, 500)),
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Indexer request failed: ${res.status}`);
    }
    const json = (await res.json()) as {
      data?: { account_transactions?: IndexerActxRow[] };
      errors?: { message?: string }[];
    };
    if (json.errors?.length) {
      throw new Error(`Indexer error: ${json.errors[0]?.message ?? "unknown"}`);
    }
    rows = json.data?.account_transactions ?? [];
  } catch (e) {
    throw new Error(
      `Indexer fetch failed: ${e instanceof Error ? e.message : "unknown"}`
    );
  }

  // Newest -> oldest from indexer. Map and parse each tx.
  const rawEvents = await mapWithConcurrency(rows, 6, async (row) => {
    const ut = row.user_transaction;
    if (!ut) return null;
    const version = String(row.transaction_version);
    const fn = ut.entry_function_id_str;
    const isOpen = fn === DELTA_NEUTRAL_RECORD_OPEN_FN;
    const isClose = fn === DELTA_NEUTRAL_RECORD_CLOSE_FN;
    if (!isOpen && !isClose) return null;

    const tx = await fetchTxByVersion(version, fullnodeHeaders);
    if (!tx) return null;
    const args = Array.isArray(tx.payload?.arguments) ? tx.payload!.arguments : null;
    if (!args || args.length === 0) return null;
    const argSafe = ensureHexAddress(args[0]);
    if (!argSafe) return null;
    if (normalizeAddress(toCanonicalAddress(argSafe)) !== safeNorm) return null;

    const base: DeltaNeutralHistoryEvent = {
      type: isOpen ? "open" : "close",
      txVersion: version,
      txHash: String(tx.hash ?? ""),
      timestamp: ut.timestamp,
      sender: toCanonicalAddress(ut.sender),
    };

    if (isOpen) {
      // record_open args: [safe, subaccount, market, spotMetadata, filledShortSize, usdcSwappedIn, decibelTxVersion, clientOrderIdBytes]
      const subaccount = ensureHexAddress(args[1]);
      const market = ensureHexAddress(args[2]);
      const spotMeta = ensureHexAddress(args[3]);
      base.decibelSubaccount = subaccount ? toCanonicalAddress(subaccount) : "0x0";
      base.perpMarket = market ? toCanonicalAddress(market) : "0x0";
      base.spotAssetMetadata = spotMeta ? toCanonicalAddress(spotMeta) : "0x0";
      base.filledShortSize = toBigIntStringOrNull(args[4]) ?? "0";
      base.usdcSwappedIn = toBigIntStringOrNull(args[5]) ?? "0";
      base.decibelTxVersion = toBigIntStringOrNull(args[6]) ?? "0";
    } else {
      // record_close args: [safe, anchorTxVersion]
      base.closeAnchorTxVersion = toBigIntStringOrNull(args[1]) ?? "0";
    }
    return base;
  });

  const events: DeltaNeutralHistoryEvent[] = rawEvents.filter(
    (e): e is DeltaNeutralHistoryEvent => e != null
  );

  // Aggregate: opens / closes / unique markets.
  const uniqueMarketsSet = new Set<string>();
  let totalOpens = 0;
  let totalCloses = 0;
  for (const ev of events) {
    if (ev.type === "open") {
      totalOpens += 1;
      if (ev.perpMarket && ev.perpMarket !== "0x0") {
        uniqueMarketsSet.add(normalizeAddress(toCanonicalAddress(ev.perpMarket)));
      }
    } else {
      totalCloses += 1;
    }
  }

  // Pair opens with the closest later close. Walk events oldest → newest.
  const chronological = [...events].sort(
    (a, b) => Number(BigInt(a.txVersion) - BigInt(b.txVersion))
  );
  const deals: DeltaNeutralDeal[] = [];
  let pendingOpen: DeltaNeutralHistoryEvent | null = null;
  for (const ev of chronological) {
    if (ev.type === "open") {
      // If we already had an open without a close, push it as an "open-only" deal.
      if (pendingOpen) {
        deals.push({
          index: deals.length,
          open: pendingOpen,
          perpMarket: pendingOpen.perpMarket ?? "0x0",
          spotAssetMetadata: pendingOpen.spotAssetMetadata ?? "0x0",
        });
      }
      pendingOpen = ev;
    } else if (ev.type === "close" && pendingOpen) {
      deals.push({
        index: deals.length,
        open: pendingOpen,
        close: ev,
        perpMarket: pendingOpen.perpMarket ?? "0x0",
        spotAssetMetadata: pendingOpen.spotAssetMetadata ?? "0x0",
      });
      pendingOpen = null;
    }
    // close without an open in window: ignore (older open lost beyond scan limit).
  }
  if (pendingOpen) {
    deals.push({
      index: deals.length,
      open: pendingOpen,
      perpMarket: pendingOpen.perpMarket ?? "0x0",
      spotAssetMetadata: pendingOpen.spotAssetMetadata ?? "0x0",
    });
  }

  const lastDeal = deals.length > 0 ? deals[deals.length - 1] : null;

  return {
    totalOpens,
    totalCloses,
    uniqueMarkets: Array.from(uniqueMarketsSet),
    lastDeal,
    deals,
    events,
    truncated: rows.length >= scanLimit,
  };
}
