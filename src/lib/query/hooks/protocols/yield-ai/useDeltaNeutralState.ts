"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { STALE_TIME } from "@/lib/query/config";
import type { DeltaNeutralStateResponse } from "@/lib/protocols/yield-ai/deltaNeutralViews";

async function fetchDeltaNeutralState(safeAddress: string): Promise<DeltaNeutralStateResponse> {
  const res = await fetch(
    `/api/protocols/yield-ai/delta-neutral-state?safeAddress=${encodeURIComponent(safeAddress)}`
  );
  const json = (await res.json()) as { success?: boolean; data?: DeltaNeutralStateResponse; error?: string };
  if (!res.ok || !json?.success || !json.data) {
    throw new Error(json?.error || "Failed to load delta-neutral state");
  }
  return json.data;
}

export function useDeltaNeutralState(safeAddress: string | undefined) {
  return useQuery<DeltaNeutralStateResponse>({
    queryKey: queryKeys.protocols.yieldAi.deltaNeutralState(safeAddress ?? ""),
    queryFn: () => fetchDeltaNeutralState(safeAddress!),
    enabled: Boolean(safeAddress),
    staleTime: STALE_TIME.POSITIONS,
  });
}
