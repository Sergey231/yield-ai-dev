'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export type TramplinRewardRow = {
  tokenMint: string;
  tokenSymbol: string;
  tokenLogoUrl?: string;
  amount: string;
  usdValue?: number;
  winCount: number;
};

type TramplinRewardsResponse = {
  success: boolean;
  data?: TramplinRewardRow[];
  error?: string;
};

async function fetchTramplinRewards(address: string): Promise<TramplinRewardRow[]> {
  const response = await fetch(
    `/api/protocols/tramplin/rewards?address=${encodeURIComponent(address)}`,
    { cache: 'no-store' }
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch Tramplin rewards: ${response.status}`);
  }
  const json: TramplinRewardsResponse = await response.json();
  if (!json.success) {
    throw new Error(json.error || 'Failed to fetch Tramplin rewards');
  }
  return json.data ?? [];
}

export interface UseTramplinRewardsOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

export function useTramplinRewards(
  address: string | undefined,
  options?: UseTramplinRewardsOptions
) {
  const enabled = (options?.enabled ?? true) && Boolean(address && address.length >= 10);

  return useQuery({
    queryKey: queryKeys.protocols.tramplin.rewards(address ?? ''),
    queryFn: () => fetchTramplinRewards(address!),
    staleTime: STALE_TIME.POSITIONS,
    enabled,
    refetchOnMount: options?.refetchOnMount,
    placeholderData: (prev) => prev ?? [],
  });
}
