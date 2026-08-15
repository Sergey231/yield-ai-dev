/**
 * Hyperion LP position accounting from vault module events.
 *
 * The vault emits `used_a` / `used_b` on open/add and `got_a` / `got_b` on remove.
 * These are the LP-only cost basis (variant B) — unlike `principal_usdc`, which is
 * gross USDC notional for swap limits and is zeroed on full close.
 *
 * Aptos deprecated the global `/v1/events/{type}` stream and the indexer `events`
 * table. We reconstruct totals by scanning the SAFE's Hyperion entry calls via
 * `account_transactions`, then parsing `HyperionLp*` events from each fullnode tx.
 *
 * Scanning is keyed on the **safe address**, not the executor. Every Hyperion
 * action mutates the safe (legs/fees deposited, position objects), so the safe
 * is a participant in each of its own txs — and a single safe accrues only a
 * handful of Hyperion txs, so the scan window covers the position's full
 * lifetime. (Keying on the executor instead made the window global across all
 * safes: as the executor got busier, a position's early claim/open events aged
 * out of the last-N window, so "total earned" shrank and PnL basis went missing
 * over time even though nothing changed on-chain.)
 */
import { normalizeAddress, toCanonicalAddress } from "@/lib/utils/addressNormalization";
import {
  YIELD_AI_PACKAGE_ADDRESS,
  YIELD_AI_VAULT_ENTRYPOINTS,
} from "@/lib/constants/yieldAiVault";

const INDEXER_GRAPHQL = "https://indexer.mainnet.aptoslabs.com/v1/graphql";
const APTOS_FULLNODE = "https://api.mainnet.aptoslabs.com/v1";
const APTOS_API_KEY = process.env.APTOS_API_KEY;

const HYPERION_ENTRY_FNS = [
  YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionOpenZapUsdc,
  YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionAddZapUsdc,
  YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionOpenDual,
  YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionAddDual,
  YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionRemoveLiquidity,
  YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionRemoveAll,
  YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionClaimFees,
  YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionClaimRewards,
] as const;

const VAULT_EVENT = {
  opened: `${YIELD_AI_PACKAGE_ADDRESS}::vault::HyperionLpOpenedEvent`,
  added: `${YIELD_AI_PACKAGE_ADDRESS}::vault::HyperionLpAddedEvent`,
  removed: `${YIELD_AI_PACKAGE_ADDRESS}::vault::HyperionLpRemovedEvent`,
  feesClaimed: `${YIELD_AI_PACKAGE_ADDRESS}::vault::HyperionLpFeesClaimedEvent`,
  rewardClaimed: `${YIELD_AI_PACKAGE_ADDRESS}::vault::HyperionLpRewardClaimedEvent`,
} as const;

const DEFAULT_SCAN_LIMIT = 500;

export type HyperionLpPositionEventTotals = {
  depositedA: bigint;
  depositedB: bigint;
  removedA: bigint;
  removedB: bigint;
  feesClaimedA: bigint;
  feesClaimedB: bigint;
  rewardsClaimed: Map<string, bigint>;
};

interface IndexerActxRow {
  transaction_version: string | number;
}

interface FullnodeUserTx {
  type: string;
  version: string;
  events?: Array<{ type: string; data: Record<string, unknown> }>;
}

const INDEXER_QUERY = `
  query HyperionLpSafeTxs($safe: String!, $fns: [String!]!, $limit: Int!) {
    account_transactions(
      where: {
        account_address: { _eq: $safe },
        user_transaction: { entry_function_id_str: { _in: $fns } }
      }
      order_by: { transaction_version: desc }
      limit: $limit
    ) {
      transaction_version
    }
  }
`;

function parseU64(raw: unknown): bigint {
  if (raw == null) return 0n;
  try {
    const v = BigInt(String(raw));
    return v >= 0n ? v : 0n;
  } catch {
    return 0n;
  }
}

function positionKey(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    return toCanonicalAddress(raw.trim());
  } catch {
    return null;
  }
}

function emptyTotals(): HyperionLpPositionEventTotals {
  return {
    depositedA: 0n,
    depositedB: 0n,
    removedA: 0n,
    removedB: 0n,
    feesClaimedA: 0n,
    feesClaimedB: 0n,
    rewardsClaimed: new Map(),
  };
}

function getOrCreate(map: Map<string, HyperionLpPositionEventTotals>, position: string) {
  let row = map.get(position);
  if (!row) {
    row = emptyTotals();
    map.set(position, row);
  }
  return row;
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

async function fetchTxByVersion(
  version: string,
  headers: Record<string, string>
): Promise<FullnodeUserTx | null> {
  try {
    const res = await fetch(`${APTOS_FULLNODE}/transactions/by_version/${version}`, {
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

function applyVaultEvent(
  row: HyperionLpPositionEventTotals,
  eventType: string,
  data: Record<string, unknown>
): void {
  if (eventType === VAULT_EVENT.opened || eventType === VAULT_EVENT.added) {
    row.depositedA += parseU64(data.used_a);
    row.depositedB += parseU64(data.used_b);
    return;
  }
  if (eventType === VAULT_EVENT.removed) {
    row.removedA += parseU64(data.got_a);
    row.removedB += parseU64(data.got_b);
    return;
  }
  if (eventType === VAULT_EVENT.feesClaimed) {
    row.feesClaimedA += parseU64(data.fee_a);
    row.feesClaimedB += parseU64(data.fee_b);
    return;
  }
  if (eventType === VAULT_EVENT.rewardClaimed) {
    const meta = typeof data.reward_metadata === "string" ? normalizeAddress(data.reward_metadata) : null;
    if (!meta) return;
    const prev = row.rewardsClaimed.get(meta) ?? 0n;
    row.rewardsClaimed.set(meta, prev + parseU64(data.amount));
  }
}

function ingestTxEvents(
  tx: FullnodeUserTx,
  safeCanon: string,
  map: Map<string, HyperionLpPositionEventTotals>
): void {
  for (const ev of tx.events ?? []) {
    const eventType = ev.type;
    const data = ev.data;
    if (!eventType || !data || typeof data !== "object") continue;
    if (
      eventType !== VAULT_EVENT.opened &&
      eventType !== VAULT_EVENT.added &&
      eventType !== VAULT_EVENT.removed &&
      eventType !== VAULT_EVENT.feesClaimed &&
      eventType !== VAULT_EVENT.rewardClaimed
    ) {
      continue;
    }
    const evSafe = typeof data.safe_address === "string" ? toCanonicalAddress(data.safe_address) : null;
    if (!evSafe || evSafe !== safeCanon) continue;
    const pos = positionKey(data.position);
    if (!pos) continue;
    applyVaultEvent(getOrCreate(map, pos), eventType, data);
  }
}

async function fetchHyperionTxVersions(
  safeAddress: string,
  scanLimit: number,
  headers: Record<string, string>
): Promise<string[]> {
  const res = await fetch(INDEXER_GRAPHQL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: INDEXER_QUERY,
      variables: {
        safe: safeAddress,
        fns: HYPERION_ENTRY_FNS,
        limit: scanLimit,
      },
    }),
    next: { revalidate: 0 },
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
  return (json.data?.account_transactions ?? []).map((row) => String(row.transaction_version));
}

/**
 * Load per-position LP lifecycle totals for one safe from vault module events.
 * Scans the safe's own Hyperion vault entry calls (indexer + fullnode tx events),
 * so the window covers the position's full lifetime regardless of executor load.
 */
export async function loadHyperionLpEventTotalsBySafe(
  safeAddress: string,
  options?: { scanLimit?: number }
): Promise<Map<string, HyperionLpPositionEventTotals>> {
  const safeCanon = toCanonicalAddress(safeAddress);
  const map = new Map<string, HyperionLpPositionEventTotals>();
  const scanLimit = Math.max(10, Math.min(options?.scanLimit ?? DEFAULT_SCAN_LIMIT, 500));

  const indexerHeaders: Record<string, string> = { "Content-Type": "application/json" };
  const fullnodeHeaders: Record<string, string> = {};
  if (APTOS_API_KEY) fullnodeHeaders.Authorization = `Bearer ${APTOS_API_KEY}`;

  const versions = await fetchHyperionTxVersions(safeCanon, scanLimit, indexerHeaders);
  const txs = await mapWithConcurrency(versions, 8, (version) =>
    fetchTxByVersion(version, fullnodeHeaders)
  );

  for (const tx of txs) {
    if (!tx) continue;
    ingestTxEvents(tx, safeCanon, map);
  }

  return map;
}

/** Net LP legs still at risk (deposited minus withdrawn on partial/full remove). */
export function netLpLegTotals(totals: HyperionLpPositionEventTotals): { netA: bigint; netB: bigint } {
  const netA = totals.depositedA > totals.removedA ? totals.depositedA - totals.removedA : 0n;
  const netB = totals.depositedB > totals.removedB ? totals.depositedB - totals.removedB : 0n;
  return { netA, netB };
}
