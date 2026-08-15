"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { STALE_TIME } from "@/lib/query/config";

export type YieldAiStablecoinCompoundHistory = {
  operations: {
    txVersion: string;
    timestamp: string;
    label: string;
    actor: "user" | "agent";
    legs: Array<{ direction: "in" | "out"; assetLabel: string; amountHuman: string }>;
  }[];
};

async function fetchYieldAiStablecoinCompoundHistory(params: {
  safeAddress: string;
  limit?: number;
}): Promise<YieldAiStablecoinCompoundHistory> {
  const qs = new URLSearchParams();
  qs.set("safeAddress", params.safeAddress);
  if (params.limit) qs.set("limit", String(params.limit));
  const res = await fetch(`/api/protocols/yield-ai/stablecoin-compound-history?${qs.toString()}`);
  const json = (await res.json()) as {
    success?: boolean;
    data?: YieldAiStablecoinCompoundHistory;
    error?: string;
  };
  if (!res.ok || !json?.success || !json.data) {
    throw new Error(json?.error || "Failed to load stablecoin compound history");
  }
  return json.data;
}

export function useYieldAiStablecoinCompoundHistory(
  safeAddress: string | undefined,
  options?: { enabled?: boolean; limit?: number }
) {
  const enabled = (options?.enabled ?? true) && Boolean(safeAddress);
  return useQuery<YieldAiStablecoinCompoundHistory>({
    queryKey: [
      ...queryKeys.protocols.yieldAi.depositHistory(safeAddress ?? ""),
      "stablecoinCompoundOps",
      options?.limit ?? 200,
    ],
    queryFn: () =>
      fetchYieldAiStablecoinCompoundHistory({
        safeAddress: safeAddress!,
        limit: options?.limit,
      }),
    enabled,
    staleTime: STALE_TIME.POSITIONS,
    refetchOnMount: false,
  });
}

