"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { STALE_TIME } from "@/lib/query/config";

/** Row shape from GET /api/protocols/decibel/userPositions (Decibel REST). */
export type DecibelUserPositionRow = {
  market: string;
  size: number;
  entry_price: number;
  estimated_liquidation_price?: number;
  unrealized_funding?: number;
  user: string;
  user_leverage?: number;
  is_isolated?: boolean;
  is_deleted?: boolean;
};

async function fetchDecibelUserPositions(address: string): Promise<DecibelUserPositionRow[]> {
  const res = await fetch(`/api/protocols/decibel/userPositions?address=${encodeURIComponent(address)}`);
  const json = (await res.json()) as { success?: boolean; data?: DecibelUserPositionRow[]; error?: string };
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || "Failed to load Decibel positions");
  }
  return Array.isArray(json.data) ? json.data : [];
}

export function useDecibelUserPositions(walletAddress: string | undefined) {
  return useQuery<DecibelUserPositionRow[]>({
    queryKey: queryKeys.protocols.decibel.userPositions(walletAddress ?? ""),
    queryFn: () => fetchDecibelUserPositions(walletAddress!),
    enabled: Boolean(walletAddress),
    staleTime: STALE_TIME.POSITIONS,
  });
}
