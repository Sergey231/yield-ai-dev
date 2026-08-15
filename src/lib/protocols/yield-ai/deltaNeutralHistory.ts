import {
  YIELD_AI_PACKAGE_ADDRESS,
  USDC_FA_METADATA_MAINNET,
} from "@/lib/constants/yieldAiVault";
import {
  normalizeAddress,
  toCanonicalAddress,
} from "@/lib/utils/addressNormalization";
import {
  STRATEGY_JOURNAL_VIEWS,
  STRATEGY_JOURNAL_ENTRIES,
  parseCycleView,
} from "@/lib/protocols/yield-ai/strategyJournal";

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
  /**
   * USDC the safe received selling the spot leg back on close (base units), resolved
   * from indexer FA activities: the vault swap tx between this deal's open and its
   * record_close that withdraws the spot FA and deposits USDC. Null when the deal is
   * still open or the swap couldn't be resolved (e.g. swap skipped on close).
   * Spot round-trip only — Decibel funding / perp realized PnL settle on the shared
   * subaccount and are NOT part of this figure.
   */
  closeSwapUsdcOutBaseUnits: string | null;
  /** Tx version of the resolved close swap (explorer link target). */
  closeSwapTxVersion: string | null;
}

/**
 * A strategy_journal cycle (the post-V1 system: spot-DN and LP-DN alike) for the history
 * view. Unlike V1 deals, the close proceeds are EXACT — `close_cycle` writes
 * `usdc_received_on_close` on-chain, no indexer heuristics involved.
 */
export interface JournalCycleHistoryRow {
  cycleId: string;
  strategyId: string;
  /** True when the cycle carries a Hyperion LP long leg (lp_position set / "lp" strategy id). */
  isLp: boolean;
  spotMetadata: string;
  isOpen: boolean;
  /** Unix seconds. */
  openedAt: string;
  /** Unix seconds; "0" while open. */
  closedAt: string;
  /** Base units (6dp). Spot/LP leg only — Decibel margin is not part of this figure. */
  usdcNotionalOpen: string;
  /**
   * Best-known TOTAL USDC put into the spot/LP leg (base units): the cumulative `spot_usdc`
   * extra (open + every top-up) when the cycle recorded it, else usdcNotionalOpen. Use this
   * as the PnL cost basis — topped-up cycles look like fake profit against notional-open.
   */
  usdcInTotal: string;
  /** Base units (6dp), exact from close_cycle. "0" while open. */
  usdcReceivedOnClose: string;
  /** Executor open_cycle tx (matched by timestamp), for explorer links. */
  openTxVersion: string | null;
  /** Executor close_cycle tx (matched by cycle_id argument). */
  closeTxVersion: string | null;
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
  /** strategy_journal cycles (spot-DN + LP-DN), oldest → newest. Empty when journal unused. */
  journalCycles: JournalCycleHistoryRow[];
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
  query DeltaNeutralRecordTxs($executor: String!, $fns: [String!]!, $limit: Int!) {
    account_transactions(
      where: {
        account_address: { _eq: $executor },
        user_transaction: { entry_function_id_str: { _in: $fns } }
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

const VAULT_SWAP_FN_ID = `${YIELD_AI_PACKAGE_ADDRESS}::vault::execute_swap_fa_to_fa`;

interface SwapActivityRow {
  transaction_version: string | number;
  asset_type: string;
  type: string;
  amount: string | number;
}

/** Per-version rollup of the safe's vault-swap FA activities. */
interface SwapBucket {
  /** Normalized asset metadata addresses withdrawn from the safe in this tx. */
  withdrawn: Set<string>;
  /** Sum of USDC deposited to the safe in this tx (base units). */
  usdcInBaseUnits: bigint;
}

/**
 * Every successful `vault::execute_swap_fa_to_fa` FA activity on this safe within
 * (minVersion, maxVersion], bucketed by tx version. A deal's close swap is then the
 * version inside (open, record_close) that withdraws the deal's spot FA and deposits
 * USDC — same pair-matching rule as `closeSwapResolver`, but resolved for all deals
 * at once.
 *
 * Cursor-paginated: the public indexer silently caps a page at 100 rows regardless of
 * the requested `limit`, so a single bounded query would truncate before the deal
 * window and every deal would resolve to null. Pages advance on `_gt` cursor; a full
 * page drops its trailing (possibly split) version and re-reads it on the next page so
 * buckets are never assembled from half a transaction.
 */
async function fetchVaultSwapBuckets(
  safeAddress: string,
  headers: Record<string, string>,
  minVersion: bigint,
  maxVersion: bigint
): Promise<Map<string, SwapBucket>> {
  const query = `
    query SafeVaultSwapActivities($safeAddress: String!, $entryFn: String!, $gt: bigint!, $lte: bigint!, $limit: Int!) {
      fungible_asset_activities(
        where: {
          owner_address: { _eq: $safeAddress }
          entry_function_id_str: { _eq: $entryFn }
          is_transaction_success: { _eq: true }
          transaction_version: { _gt: $gt, _lte: $lte }
        }
        order_by: { transaction_version: asc }
        limit: $limit
      ) {
        transaction_version
        asset_type
        type
        amount
      }
    }
  `;

  const isDeposit = (t: string) => t.endsWith("Deposit") || t.endsWith("DepositEvent");
  const isWithdraw = (t: string) => t.endsWith("Withdraw") || t.endsWith("WithdrawEvent");
  const usdcNorm = normalizeAddress(toCanonicalAddress(USDC_FA_METADATA_MAINNET));

  const PAGE = 100;
  const MAX_PAGES = 40;
  const buckets = new Map<string, SwapBucket>();
  let cursor = minVersion;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetch(INDEXER_GRAPHQL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query,
        variables: {
          safeAddress,
          entryFn: VAULT_SWAP_FN_ID,
          gt: cursor.toString(),
          lte: maxVersion.toString(),
          limit: PAGE,
        },
      }),
    });
    if (!res.ok) throw new Error(`Indexer swap-activity request failed: ${res.status}`);
    const json = (await res.json()) as {
      data?: { fungible_asset_activities?: SwapActivityRow[] };
      errors?: { message?: string }[];
    };
    if (json.errors?.length) {
      throw new Error(`Indexer swap-activity error: ${json.errors[0]?.message ?? "unknown"}`);
    }
    const rows = json.data?.fungible_asset_activities ?? [];
    if (rows.length === 0) break;

    let usable = rows;
    const lastVersion = String(rows[rows.length - 1].transaction_version);
    if (rows.length >= PAGE) {
      // Full page: the last version's rows may continue on the next page. Drop them here
      // and restart just before that version so it is read whole next round.
      const trimmed = rows.filter((r) => String(r.transaction_version) !== lastVersion);
      if (trimmed.length > 0) {
        usable = trimmed;
        cursor = BigInt(lastVersion) - BigInt(1);
      } else {
        // Pathological: 100 rows of one version — take as-is to avoid looping.
        cursor = BigInt(lastVersion);
      }
    } else {
      cursor = BigInt(lastVersion);
    }

    for (const row of usable) {
      const version = String(row.transaction_version);
      const assetNorm = normalizeAddress(toCanonicalAddress(row.asset_type ?? ""));
      if (!assetNorm) continue;
      const bucket = buckets.get(version) ?? {
        withdrawn: new Set<string>(),
        usdcInBaseUnits: BigInt(0),
      };
      if (isWithdraw(row.type)) {
        bucket.withdrawn.add(assetNorm);
      } else if (assetNorm === usdcNorm && isDeposit(row.type)) {
        const amt = row.amount;
        if (typeof amt === "string" && /^\d+$/.test(amt)) {
          bucket.usdcInBaseUnits += BigInt(amt);
        } else if (typeof amt === "number" && Number.isFinite(amt) && amt >= 0) {
          bucket.usdcInBaseUnits += BigInt(Math.trunc(amt));
        }
      }
      buckets.set(version, bucket);
    }

    if (rows.length < PAGE) break;
  }
  return buckets;
}

/** POST fullnode /view. Returns the raw JSON array or null on any failure. */
async function fullnodeView(
  fn: string,
  args: unknown[],
  headers: Record<string, string>
): Promise<unknown[] | null> {
  try {
    const res = await fetch(`${FULLNODE_URL}/view`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ function: fn, type_arguments: [], arguments: args }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    return Array.isArray(json) ? json : null;
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
          fns: [
            DELTA_NEUTRAL_RECORD_OPEN_FN,
            DELTA_NEUTRAL_RECORD_CLOSE_FN,
            STRATEGY_JOURNAL_ENTRIES.openCycle,
            STRATEGY_JOURNAL_ENTRIES.closeCycle,
          ],
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

  // Newest -> oldest from indexer. Map and parse each tx. V1 record_* rows become history
  // events; strategy_journal open_cycle/close_cycle rows become tx refs used to attach
  // explorer links to journal cycles (whose data itself comes from on-chain views below).
  type MappedRow =
    | { kind: "v1"; event: DeltaNeutralHistoryEvent }
    | { kind: "journalOpen"; txVersion: string; timestampSec: number }
    | { kind: "journalClose"; txVersion: string; cycleId: string }
    | null;
  // Indexer timestamps come without a timezone marker but are UTC — anchor them
  // explicitly so second-level matching against on-chain opened_at is TZ-independent.
  const parseUtcSeconds = (ts: string): number => {
    const anchored = /([+-]\d\d:?\d\d|Z)$/i.test(ts) ? ts : `${ts}Z`;
    const ms = Date.parse(anchored);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
  };
  const rawEvents = await mapWithConcurrency(rows, 6, async (row): Promise<MappedRow> => {
    const ut = row.user_transaction;
    if (!ut) return null;
    const version = String(row.transaction_version);
    const fn = ut.entry_function_id_str;
    const isOpen = fn === DELTA_NEUTRAL_RECORD_OPEN_FN;
    const isClose = fn === DELTA_NEUTRAL_RECORD_CLOSE_FN;
    const isJournalOpen = fn === STRATEGY_JOURNAL_ENTRIES.openCycle;
    const isJournalClose = fn === STRATEGY_JOURNAL_ENTRIES.closeCycle;
    if (!isOpen && !isClose && !isJournalOpen && !isJournalClose) return null;

    const tx = await fetchTxByVersion(version, fullnodeHeaders);
    if (!tx) return null;
    const args = Array.isArray(tx.payload?.arguments) ? tx.payload!.arguments : null;
    if (!args || args.length === 0) return null;
    const argSafe = ensureHexAddress(args[0]);
    if (!argSafe) return null;
    if (normalizeAddress(toCanonicalAddress(argSafe)) !== safeNorm) return null;

    if (isJournalOpen) {
      return { kind: "journalOpen", txVersion: version, timestampSec: parseUtcSeconds(ut.timestamp) };
    }
    if (isJournalClose) {
      // close_cycle args: [safe, cycle_id, usdc_received_on_close, ...]
      return { kind: "journalClose", txVersion: version, cycleId: toBigIntStringOrNull(args[1]) ?? "0" };
    }

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
    return { kind: "v1", event: base };
  });

  const events: DeltaNeutralHistoryEvent[] = rawEvents
    .filter((e): e is Exclude<MappedRow, null> => e != null)
    .filter((e): e is { kind: "v1"; event: DeltaNeutralHistoryEvent } => e.kind === "v1")
    .map((e) => e.event);
  const journalOpenRefs = rawEvents.filter(
    (e): e is { kind: "journalOpen"; txVersion: string; timestampSec: number } =>
      e != null && e.kind === "journalOpen"
  );
  const journalCloseRefs = rawEvents.filter(
    (e): e is { kind: "journalClose"; txVersion: string; cycleId: string } =>
      e != null && e.kind === "journalClose"
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
          closeSwapUsdcOutBaseUnits: null,
          closeSwapTxVersion: null,
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
        closeSwapUsdcOutBaseUnits: null,
        closeSwapTxVersion: null,
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
      closeSwapUsdcOutBaseUnits: null,
      closeSwapTxVersion: null,
    });
  }

  // Resolve "USDC received on close" per closed deal from one bulk swap-activity
  // scan. The close swap sits strictly between the deal's open and its record_close
  // (close flow: Decibel close → spot→USDC swap → record_close), so the version
  // window plus the Withdraw(spot)+Deposit(USDC) pair identifies it uniquely.
  // Best-effort: a failed indexer call leaves the fields null rather than failing
  // the whole history response.
  const closedDeals = deals.filter((d) => d.close != null);
  if (closedDeals.length > 0) {
    try {
      // Bound the activity scan to the deals' overall version range — the safe can have
      // hundreds of unrelated swaps (wizard, autoclaim sweeps) outside it.
      const minV = closedDeals.reduce(
        (m, d) => (BigInt(d.open.txVersion) < m ? BigInt(d.open.txVersion) : m),
        BigInt(closedDeals[0].open.txVersion)
      );
      const maxV = closedDeals.reduce(
        (m, d) => (BigInt(d.close!.txVersion) > m ? BigInt(d.close!.txVersion) : m),
        BigInt(closedDeals[0].close!.txVersion)
      );
      const buckets = await fetchVaultSwapBuckets(
        toCanonicalAddress(safeAddress),
        indexerHeaders,
        minV,
        maxV
      );
      const versionsAsc = Array.from(buckets.keys()).sort((a, b) =>
        Number(BigInt(a) - BigInt(b))
      );
      for (let i = 0; i < deals.length; i++) {
        const deal = deals[i];
        if (!deal.close) continue;
        const spotNorm = normalizeAddress(toCanonicalAddress(deal.spotAssetMetadata));
        if (!spotNorm || spotNorm === normalizeAddress("0x0")) continue;
        const lo = BigInt(deal.open.txVersion);
        // Upper bound: the NEXT deal's open, not this deal's record_close. Retried/duplicate
        // record_close txs (observed on-chain: 17 closes for 16 opens) can land BEFORE the
        // close swap and would clip it out of a record_close-bounded window. Nothing of the
        // next deal can precede its open, so this bound is always safe.
        const next = deals[i + 1];
        const hi = next ? BigInt(next.open.txVersion) : BigInt(deal.close.txVersion) + BigInt(1);
        // Take the LARGEST matching swap in the window, not the first: mid-deal manual
        // conversions and post-close residual sweeps also produce Withdraw(spot)+Deposit(USDC)
        // pairs, but the close swap unwinds the whole position and dominates them.
        let best: { version: string; out: bigint } | null = null;
        for (const v of versionsAsc) {
          const vBig = BigInt(v);
          if (vBig <= lo) continue;
          if (vBig >= hi) break;
          const bucket = buckets.get(v)!;
          if (bucket.withdrawn.has(spotNorm) && bucket.usdcInBaseUnits > BigInt(0)) {
            if (!best || bucket.usdcInBaseUnits > best.out) {
              best = { version: v, out: bucket.usdcInBaseUnits };
            }
          }
        }
        if (best) {
          deal.closeSwapUsdcOutBaseUnits = best.out.toString();
          deal.closeSwapTxVersion = best.version;
        }
      }
    } catch (e) {
      console.warn(
        "[Yield AI] delta-neutral-history: close-swap resolution failed, PnL omitted:",
        e instanceof Error ? e.message : e
      );
    }
  }

  const lastDeal = deals.length > 0 ? deals[deals.length - 1] : null;

  // strategy_journal cycles (the current system, spot-DN + LP-DN): exact on-chain records
  // via get_cycle_count / get_cycle views. Explorer links come from the executor tx scan
  // above — close_cycle matches by its cycle_id argument, open_cycle by tx timestamp vs
  // the cycle's opened_at (open_cycle has no cycle_id argument; the id is auto-assigned).
  // Best-effort: any failure leaves journalCycles empty without failing the response.
  let journalCycles: JournalCycleHistoryRow[] = [];
  try {
    const safeCanonical = toCanonicalAddress(safeAddress);
    const countRaw = await fullnodeView(
      STRATEGY_JOURNAL_VIEWS.getCycleCount,
      [safeCanonical],
      fullnodeHeaders
    );
    const count = Math.min(200, Number(toBigIntStringOrNull(countRaw?.[0]) ?? "0"));
    if (count > 0) {
      const ids = Array.from({ length: count }, (_, i) => String(i + 1));
      // Cost basis: prefer the cumulative `spot_usdc` extra (open + every top-up) over
      // usdc_notional_open, otherwise topped-up cycles show phantom profit in the history.
      const spotUsdcKeyHex =
        "0x" +
        Array.from(new TextEncoder().encode("spot_usdc"))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
      const parsed = await mapWithConcurrency(ids, 4, async (id) => {
        const raw = await fullnodeView(
          STRATEGY_JOURNAL_VIEWS.getCycle,
          [safeCanonical, id],
          fullnodeHeaders
        );
        const cycle = raw ? parseCycleView(raw) : null;
        if (!cycle || !cycle.recordExists) return null;
        let spotUsdcTotal: string | null = null;
        const extraRaw = await fullnodeView(
          STRATEGY_JOURNAL_VIEWS.getCycleExtraU64,
          [safeCanonical, id, spotUsdcKeyHex],
          fullnodeHeaders
        );
        const extraObj = extraRaw?.[0] as { found?: unknown; value?: unknown } | undefined;
        if (extraObj && (extraObj.found === true || extraObj.found === "true")) {
          spotUsdcTotal = toBigIntStringOrNull(extraObj.value);
        }
        return { cycle, spotUsdcTotal };
      });
      const closeTxByCycleId = new Map(journalCloseRefs.map((r) => [r.cycleId, r.txVersion]));
      const usedOpenRefs = new Set<string>();
      journalCycles = parsed
        .filter((p): p is NonNullable<typeof p> => p != null)
        .map(({ cycle: c, spotUsdcTotal }) => {
          const openedAtSec = Number(c.openedAt) || 0;
          const openRef = journalOpenRefs.find(
            (r) => !usedOpenRefs.has(r.txVersion) && Math.abs(r.timestampSec - openedAtSec) <= 5
          );
          if (openRef) usedOpenRefs.add(openRef.txVersion);
          return {
            cycleId: c.cycleId,
            strategyId: c.strategyId,
            isLp:
              Boolean(c.lpPosition && !/^0x0+$/.test(normalizeAddress(c.lpPosition))) ||
              c.strategyId.toLowerCase().includes("lp"),
            spotMetadata: c.spotMetadata,
            isOpen: c.isOpen,
            openedAt: c.openedAt,
            closedAt: c.closedAt,
            usdcNotionalOpen: c.usdcNotionalOpen,
            usdcInTotal:
              spotUsdcTotal && BigInt(spotUsdcTotal) > BigInt(0)
                ? spotUsdcTotal
                : c.usdcNotionalOpen,
            usdcReceivedOnClose: c.usdcReceivedOnClose,
            openTxVersion: openRef?.txVersion ?? null,
            closeTxVersion: closeTxByCycleId.get(c.cycleId) ?? null,
          };
        });
    }
  } catch (e) {
    console.warn(
      "[Yield AI] delta-neutral-history: journal cycle read failed, list omitted:",
      e instanceof Error ? e.message : e
    );
  }

  return {
    totalOpens,
    totalCloses,
    uniqueMarkets: Array.from(uniqueMarketsSet),
    lastDeal,
    deals,
    events,
    truncated: rows.length >= scanLimit,
    journalCycles,
  };
}
