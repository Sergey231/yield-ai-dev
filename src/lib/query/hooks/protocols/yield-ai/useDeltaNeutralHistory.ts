"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { STALE_TIME } from "@/lib/query/config";
import type { DeltaNeutralHistorySummary } from "@/lib/protocols/yield-ai/deltaNeutralHistory";

interface FetchOpts {
  safeAddress: string;
  limit?: number;
}

async function fetchDeltaNeutralHistory(
  opts: FetchOpts
): Promise<DeltaNeutralHistorySummary> {
  const params = new URLSearchParams();
  params.set("safeAddress", opts.safeAddress);
  if (opts.limit) params.set("limit", String(opts.limit));
  const res = await fetch(
    `/api/protocols/yield-ai/delta-neutral-history?${params.toString()}`
  );
  const json = (await res.json()) as {
    success?: boolean;
    data?: DeltaNeutralHistorySummary;
    error?: string;
  };
  if (!res.ok || !json?.success || !json.data) {
    throw new Error(json?.error || "Failed to load delta-neutral history");
  }
  return json.data;
}

/**
 * V1 contract stores only the last on-chain snapshot. This hook reconstructs
 * the per-safe history by scanning executor-signed `record_open` /
 * `record_close` transactions from the indexer + fullnode (one network call
 * per matched version). Cached aggressively because it's an expensive call.
 */
export function useDeltaNeutralHistory(
  safeAddress: string | undefined,
  options?: { enabled?: boolean; limit?: number }
) {
  const enabled = (options?.enabled ?? true) && Boolean(safeAddress);
  return useQuery<DeltaNeutralHistorySummary>({
    queryKey: queryKeys.protocols.yieldAi.deltaNeutralHistory(
      safeAddress ?? "",
      options?.limit
    ),
    queryFn: () =>
      fetchDeltaNeutralHistory({
        safeAddress: safeAddress!,
        limit: options?.limit,
      }),
    enabled,
    staleTime: STALE_TIME.POSITIONS,
    refetchOnMount: false,
  });
}
