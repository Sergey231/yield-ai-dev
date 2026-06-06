'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';
import type { HyperionPositionView } from '@/lib/protocols/yield-ai/hyperionLp';

/** Position view enriched by the positions route with USD value + fees/rewards. */
export type HyperionLpPositionView = HyperionPositionView & {
  valueUsd?: number;
  feesUsd?: number;
  rewardsUsd?: number;
  feesBreakdown?: Array<{ symbol: string; amount: number }>;
  rewardsBreakdown?: Array<{ symbol: string; amount: number }>;
  /** Realized annualized APR estimate (uncollected fees+rewards since open). */
  aprPct?: number | null;
};

interface PositionsResponse {
  data?: { positions?: HyperionLpPositionView[] };
  error?: { message?: string } | string;
}

async function fetchHyperionLpPositions(safeAddress: string): Promise<HyperionLpPositionView[]> {
  const res = await fetch(
    `/api/protocols/yield-ai/hyperion-lp/positions?safe=${encodeURIComponent(safeAddress)}`
  );
  const json: PositionsResponse = await res.json();
  if (!res.ok) {
    const msg = typeof json.error === 'string' ? json.error : json.error?.message;
    throw new Error(msg || `Failed to fetch Hyperion LP positions: ${res.status}`);
  }
  return json.data?.positions ?? [];
}

interface UseHyperionLpPositionsOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

/**
 * Read the Hyperion CLMM LP positions tracked on a safe (open + closed), with
 * live composition and active/inactive flag. Read-only (no executor / secret).
 */
export function useHyperionLpPositions(
  safeAddress: string | undefined,
  options?: UseHyperionLpPositionsOptions
) {
  const enabled =
    (options?.enabled ?? true) && Boolean(safeAddress && safeAddress.length >= 10);

  return useQuery({
    queryKey: queryKeys.protocols.yieldAi.hyperionLpPositions(safeAddress ?? ''),
    enabled,
    staleTime: STALE_TIME.POSITIONS,
    refetchOnMount: options?.refetchOnMount,
    queryFn: () => fetchHyperionLpPositions(safeAddress!),
  });
}
