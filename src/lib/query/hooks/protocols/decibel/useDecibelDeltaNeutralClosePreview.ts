"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { CACHE_TIME, RETRY_CONFIG } from "@/lib/query/config";

export type DecibelDeltaNeutralClosePreviewSeverity = "ok" | "warning" | "block";

export type DecibelDeltaNeutralClosePreview = {
  safeAddress: string;
  marketAddr: string;
  marketName: string;
  decibelSubaccount: string;
  spotAssetLabel: string;
  spotMetadata: string;
  spotBalanceBaseUnits: string;
  spotBalanceHuman: number;
  spotBalanceSource: "indexer" | "onchain" | "both";
  decibelMark: number;
  recordedShortHumanBase: number;
  liveShortHumanBase: number | null;
  hasSpotBalance: boolean;
  quoteUsdcOutBaseUnits: string | null;
  quoteUsdcOutUsd: number | null;
  hyperionEffectivePrice: number | null;
  spreadBps: number | null;
  spreadPct: number | null;
  exitCostBps: number | null;
  estimatedSpotExitCostUsd: number | null;
  estimatedDecibelCloseFeeUsd: number | null;
  severity: DecibelDeltaNeutralClosePreviewSeverity;
  thresholds: {
    okBps: number;
    blockBps: number;
  };
};

type UseDecibelDeltaNeutralClosePreviewParams = {
  safeAddress?: string;
  enabled?: boolean;
};

async function fetchDecibelDeltaNeutralClosePreview(
  safeAddress: string
): Promise<DecibelDeltaNeutralClosePreview> {
  const params = new URLSearchParams({ safeAddress });
  const res = await fetch(`/api/protocols/decibel/delta-neutral-close-preview?${params.toString()}`);
  const json = (await res.json()) as {
    success?: boolean;
    data?: DecibelDeltaNeutralClosePreview;
    error?: string;
  };
  if (!res.ok || !json?.success || !json.data) {
    throw new Error(json?.error || "Failed to load Decibel close preview");
  }
  return json.data;
}

export function useDecibelDeltaNeutralClosePreview({
  safeAddress,
  enabled = true,
}: UseDecibelDeltaNeutralClosePreviewParams) {
  return useQuery<DecibelDeltaNeutralClosePreview>({
    queryKey: queryKeys.protocols.decibel.deltaNeutralClosePreview(safeAddress ?? ""),
    queryFn: () => fetchDecibelDeltaNeutralClosePreview(safeAddress!),
    enabled: Boolean(enabled && safeAddress),
    staleTime: 15_000,
    gcTime: CACHE_TIME.SHORT,
    retry: RETRY_CONFIG.NETWORK_ERROR,
    refetchOnWindowFocus: false,
  });
}
