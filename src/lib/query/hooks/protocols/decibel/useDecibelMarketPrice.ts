"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { STALE_TIME } from "@/lib/query/config";

export type DecibelMarketPrice = {
  market: string;
  markPx: number | null;
  midPx: number | null;
  fundingRateBps: number | null;
  isFundingPositive: boolean | null;
};

type DecibelPriceRow = {
  market?: string;
  mark_px?: number;
  mid_px?: number;
  funding_rate_bps?: number;
  is_funding_positive?: boolean;
};

async function fetchDecibelMarketPrice(market: string): Promise<DecibelMarketPrice | null> {
  const url = `/api/protocols/decibel/prices?market=${encodeURIComponent(market)}`;
  const res = await fetch(url);
  const json = (await res.json()) as { success?: boolean; data?: DecibelPriceRow[]; error?: string };
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || "Failed to load Decibel market price");
  }
  const row = Array.isArray(json.data) ? json.data[0] : null;
  if (!row) return null;
  return {
    market,
    markPx: typeof row.mark_px === "number" ? row.mark_px : null,
    midPx: typeof row.mid_px === "number" ? row.mid_px : null,
    fundingRateBps: typeof row.funding_rate_bps === "number" ? row.funding_rate_bps : null,
    isFundingPositive: typeof row.is_funding_positive === "boolean" ? row.is_funding_positive : null,
  };
}

/** Live market price (mark/mid) + current funding rate for a Decibel perp market. */
export function useDecibelMarketPrice(market: string | undefined) {
  return useQuery<DecibelMarketPrice | null>({
    queryKey: queryKeys.protocols.decibel.marketPrice(market ?? ""),
    queryFn: () => fetchDecibelMarketPrice(market!),
    enabled: Boolean(market),
    staleTime: STALE_TIME.PRICES,
    refetchInterval: STALE_TIME.PRICES,
  });
}
