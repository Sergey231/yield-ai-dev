"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { STALE_TIME } from "@/lib/query/config";
import { normalizeAddress } from "@/lib/utils/addressNormalization";

/**
 * Single trade item returned by Decibel `trade_history` API.
 * Shape confirmed via manual probe (subaccount 0x2be8…).
 */
type DecibelTradeHistoryItem = {
  account?: string;
  market?: string;
  action?: string; // "OpenShort" | "CloseShort" | "OpenLong" | "CloseLong" | …
  source?: string; // "OrderFill" | …
  trade_id?: string;
  size?: number;
  price?: number;
  is_profit?: boolean;
  realized_pnl_amount?: number; // USD (price leg)
  realized_funding_amount?: number; // USD (funding settled at this trade)
  is_rebate?: boolean;
  fee_amount?: number; // USD (positive = paid)
  order_id?: string;
  transaction_unix_ms?: number;
  transaction_version?: number;
};

type DecibelTradeHistoryPage = {
  items?: DecibelTradeHistoryItem[];
  total_count?: number;
};

export type DecibelPositionLedger = {
  /** Sum of realized price PnL across trades in window (USD). Positive = profit. */
  realizedPnlUsd: number;
  /**
   * Sum of funding settled at trades in window (USD) as reported by Decibel.
   * NOTE: Decibel's sign convention is "user debt" — subtract to represent
   * funding EARNED by the user.
   */
  realizedFundingEarnedUsd: number;
  /** Total fees paid on trades in window (USD). Always non-negative here. */
  feesUsd: number;
  /** Count of matching trades aggregated. */
  tradeCount: number;
  /** Items used for the aggregate (for debugging / deeper UI if needed). */
  items: DecibelTradeHistoryItem[];
};

const PAGE_LIMIT = 100;
const MAX_PAGES = 10; // hard safety cap — 1000 trades per aggregate

async function fetchOnePage(
  subaccount: string,
  offset: number,
  market?: string
): Promise<DecibelTradeHistoryPage> {
  const params = new URLSearchParams({
    address: subaccount,
    limit: String(PAGE_LIMIT),
    offset: String(offset),
  });
  if (market) params.set("market", market);
  const res = await fetch(
    `/api/protocols/decibel/tradeHistory?${params.toString()}`
  );
  const json = (await res.json()) as { success?: boolean; data?: DecibelTradeHistoryPage; error?: string };
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || "Failed to load Decibel trade history");
  }
  return json.data ?? { items: [] };
}

async function fetchDecibelPositionLedger(
  subaccount: string,
  market: string,
  fromUnixMs: number,
  toUnixMs: number | null
): Promise<DecibelPositionLedger> {
  const marketNorm = normalizeAddress(market);
  const collected: DecibelTradeHistoryItem[] = [];
  let offset = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    // Upstream honors ?market= filter but we re-check locally to be safe.
    const data = await fetchOnePage(subaccount, offset, market);
    const items = Array.isArray(data.items) ? data.items : [];
    if (items.length === 0) break;

    // Items are newest-first; stop paginating once we've passed fromUnixMs.
    let passedFrom = false;
    for (const it of items) {
      const ts = typeof it.transaction_unix_ms === "number" ? it.transaction_unix_ms : 0;
      if (ts === 0) continue;
      if (ts < fromUnixMs) {
        passedFrom = true;
        break;
      }
      if (toUnixMs != null && ts > toUnixMs) continue; // newer than window, skip
      if (normalizeAddress(String(it.market || "")) !== marketNorm) continue;
      collected.push(it);
    }

    if (passedFrom) break;
    if (items.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }

  let realizedPnlUsd = 0;
  let fundingDebtUsd = 0;
  let feesUsd = 0;

  for (const it of collected) {
    if (typeof it.realized_pnl_amount === "number") realizedPnlUsd += it.realized_pnl_amount;
    if (typeof it.realized_funding_amount === "number") fundingDebtUsd += it.realized_funding_amount;
    if (typeof it.fee_amount === "number") feesUsd += it.fee_amount;
  }

  return {
    realizedPnlUsd,
    // Decibel reports funding as the user's debt; short earning → display-positive.
    realizedFundingEarnedUsd: -fundingDebtUsd,
    feesUsd,
    tradeCount: collected.length,
    items: collected,
  };
}

/**
 * Aggregate Decibel realized PnL, funding and fees for a subaccount/market
 * between `fromUnixMs` (inclusive) and `toUnixMs` (inclusive, or "now" if null).
 * Pulls paginated trade_history newest-first and stops when past the window.
 */
export function useDecibelPositionLedger(params: {
  subaccount: string | undefined;
  market: string | undefined;
  fromUnixMs: number | undefined;
  toUnixMs: number | null;
  enabled?: boolean;
}) {
  const { subaccount, market, fromUnixMs, toUnixMs, enabled = true } = params;
  const canRun = Boolean(subaccount && market && Number.isFinite(fromUnixMs) && (fromUnixMs ?? 0) > 0);
  return useQuery<DecibelPositionLedger>({
    queryKey: queryKeys.protocols.decibel.positionLedger(
      subaccount ?? "",
      market ?? "",
      fromUnixMs ?? 0,
      toUnixMs
    ),
    queryFn: () =>
      fetchDecibelPositionLedger(subaccount!, market!, fromUnixMs!, toUnixMs),
    enabled: enabled && canRun,
    staleTime: STALE_TIME.POSITIONS,
  });
}
