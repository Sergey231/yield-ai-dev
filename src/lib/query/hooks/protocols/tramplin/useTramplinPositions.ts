'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export type TramplinPositionData = {
  hasPosition: boolean;
  stakeSol: number;
  stakeUsd: number | null;
  effectiveStakeSol: number;
  aprPct: number;
  multiplier: number;
  totalPoints: number;
  /** Lifetime winnings — claimed + unclaimed — denominated in SOL. */
  totalWonSol: number;
  totalWonUsd: number | null;
  solPriceUsd: number | null;
  drawEligibility: {
    regular: boolean;
    epoch: boolean;
    big: boolean;
  };
};

type TramplinPositionsResponse = {
  success: boolean;
  data?: TramplinPositionData;
  error?: string;
};

async function fetchTramplinPositions(address: string): Promise<TramplinPositionData | null> {
  const response = await fetch(
    `/api/protocols/tramplin/userPositions?address=${encodeURIComponent(address)}`,
    { cache: 'no-store' }
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch Tramplin positions: ${response.status}`);
  }
  const json: TramplinPositionsResponse = await response.json();
  if (!json.success) {
    throw new Error(json.error || 'Failed to fetch Tramplin positions');
  }
  return json.data ?? null;
}

export interface UseTramplinPositionsOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

export function useTramplinPositions(
  address: string | undefined,
  options?: UseTramplinPositionsOptions
) {
  const enabled = (options?.enabled ?? true) && Boolean(address && address.length >= 10);

  return useQuery({
    queryKey: queryKeys.protocols.tramplin.userPositions(address ?? ''),
    queryFn: () => fetchTramplinPositions(address!),
    staleTime: STALE_TIME.POSITIONS,
    enabled,
    refetchOnMount: options?.refetchOnMount,
    placeholderData: (prev) => prev ?? null,
  });
}
