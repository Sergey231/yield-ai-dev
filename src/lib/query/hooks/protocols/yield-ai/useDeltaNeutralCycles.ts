"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { STALE_TIME } from "@/lib/query/config";
import type { DeltaNeutralCyclesResponse } from "@/app/api/protocols/yield-ai/delta-neutral-cycles/route";

async function fetchDeltaNeutralCycles(
  safeAddress: string,
  subaccount?: string
): Promise<DeltaNeutralCyclesResponse> {
  const params = new URLSearchParams({ safeAddress });
  if (subaccount) params.set("subaccount", subaccount);
  const res = await fetch(`/api/protocols/yield-ai/delta-neutral-cycles?${params.toString()}`);
  const json = (await res.json()) as {
    success?: boolean;
    data?: DeltaNeutralCyclesResponse;
    error?: string;
  };
  if (!res.ok || !json?.success || !json.data) {
    throw new Error(json?.error || "Failed to load delta-neutral cycles");
  }
  return json.data;
}

interface UseDeltaNeutralCyclesOptions {
  refetchOnMount?: boolean | "always";
  /** Decibel subaccount — required for per-cycle perp uPnL valuation. */
  subaccount?: string;
}

/**
 * Open strategy_journal cycles for a safe (the post-migration DN positions). Read alongside
 * {@link useDeltaNeutralState} (legacy V2) for dual-read during the transition.
 */
export function useDeltaNeutralCycles(
  safeAddress: string | undefined,
  options?: UseDeltaNeutralCyclesOptions
) {
  return useQuery<DeltaNeutralCyclesResponse>({
    queryKey: [
      ...queryKeys.protocols.yieldAi.deltaNeutralCycles(safeAddress ?? ""),
      options?.subaccount ?? "",
    ],
    queryFn: () => fetchDeltaNeutralCycles(safeAddress!, options?.subaccount),
    enabled: Boolean(safeAddress),
    staleTime: STALE_TIME.POSITIONS,
    refetchOnMount: options?.refetchOnMount,
  });
}
