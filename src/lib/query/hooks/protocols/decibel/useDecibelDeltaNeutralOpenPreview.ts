"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { CACHE_TIME, RETRY_CONFIG } from "@/lib/query/config";

export type DecibelDeltaNeutralOpenPreviewSeverity = "ok" | "warning" | "block";

export type DecibelDeltaNeutralOpenPreview = {
  asset: "BTC" | "APT";
  requestedSizeUsd: number;
  marketAddr: string;
  marketName: string;
  spotAsset: string;
  spotAssetLabel: string;
  spotMetadata: string;
  decibelMark: number;
  shortSizeBaseUnits: string;
  shortSizeHumanBase: number;
  shortNotionalUsd: number;
  targetSpotOutBaseUnits: string;
  targetSpotHuman: number;
  quoteUsdcInBaseUnits: string;
  quoteUsdcInUsd: number;
  bufferedUsdcInBaseUnits: string;
  bufferedUsdcInUsd: number;
  hyperionEffectivePrice: number | null;
  bufferedEffectivePrice: number | null;
  spreadBps: number;
  spreadPct: number;
  estimatedEntryCostUsd: number;
  inputBufferBps: number;
  thresholds: {
    okBps: number;
    blockBps: number;
  };
  severity: DecibelDeltaNeutralOpenPreviewSeverity;
};

type UseDecibelDeltaNeutralOpenPreviewParams = {
  asset?: "BTC" | "APT";
  sizeUsd?: number;
  enabled?: boolean;
};

async function fetchDecibelDeltaNeutralOpenPreview(
  asset: "BTC" | "APT",
  sizeUsd: number
): Promise<DecibelDeltaNeutralOpenPreview> {
  const params = new URLSearchParams({
    asset,
    sizeUsd: String(sizeUsd),
  });
  const res = await fetch(`/api/protocols/decibel/delta-neutral-open-preview?${params.toString()}`);
  const json = (await res.json()) as {
    success?: boolean;
    data?: DecibelDeltaNeutralOpenPreview;
    error?: string;
  };
  if (!res.ok || !json?.success || !json.data) {
    throw new Error(json?.error || "Failed to load Decibel entry preview");
  }
  return json.data;
}

export function useDecibelDeltaNeutralOpenPreview({
  asset,
  sizeUsd,
  enabled = true,
}: UseDecibelDeltaNeutralOpenPreviewParams) {
  const normalizedSizeUsd =
    typeof sizeUsd === "number" && Number.isFinite(sizeUsd) && sizeUsd > 0
      ? Math.round(sizeUsd * 100) / 100
      : 0;

  return useQuery<DecibelDeltaNeutralOpenPreview>({
    queryKey: queryKeys.protocols.decibel.deltaNeutralOpenPreview(asset ?? "", normalizedSizeUsd),
    queryFn: () => fetchDecibelDeltaNeutralOpenPreview(asset!, normalizedSizeUsd),
    enabled: Boolean(enabled && asset && normalizedSizeUsd > 0),
    staleTime: 15_000,
    gcTime: CACHE_TIME.SHORT,
    retry: RETRY_CONFIG.NETWORK_ERROR,
    refetchOnWindowFocus: false,
  });
}
