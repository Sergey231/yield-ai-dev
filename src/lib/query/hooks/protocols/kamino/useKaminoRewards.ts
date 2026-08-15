'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';
import type { KaminoClaimTarget, KaminoRewardRow } from '@/lib/kamino/kaminoClaimTypes';

export type { KaminoClaimTarget, KaminoRewardRow };

type KaminoRewardsResponse = {
  success: boolean;
  data?: KaminoRewardRow[];
  claimTargets?: KaminoClaimTarget[];
  totalUsdValue?: number;
  error?: string;
  message?: string;
  count?: number;
};

export type KaminoRewardsQueryData = {
  rewards: KaminoRewardRow[];
  claimTargets: KaminoClaimTarget[];
  totalUsdValue: number;
};

async function fetchKaminoRewards(address: string): Promise<KaminoRewardsQueryData> {
  const response = await fetch(
    `/api/protocols/kamino/rewards?address=${encodeURIComponent(address)}`,
    { cache: 'no-store' }
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch Kamino rewards: ${response.status}`);
  }
  const json: KaminoRewardsResponse = await response.json();
  if (!json.success) {
    throw new Error(json.error || json.message || 'Failed to fetch Kamino rewards');
  }
  return {
    rewards: json.data ?? [],
    claimTargets: json.claimTargets ?? [],
    totalUsdValue: typeof json.totalUsdValue === 'number' ? json.totalUsdValue : 0,
  };
}

export interface UseKaminoRewardsOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

export function useKaminoRewards(
  address: string | undefined,
  options?: UseKaminoRewardsOptions
) {
  const enabled = (options?.enabled ?? true) && Boolean(address && address.length >= 10);

  return useQuery({
    queryKey: queryKeys.protocols.kamino.rewards(address ?? ''),
    queryFn: () => fetchKaminoRewards(address!),
    staleTime: STALE_TIME.POSITIONS,
    enabled,
    refetchOnMount: options?.refetchOnMount,
    placeholderData: (prev) => prev ?? { rewards: [], claimTargets: [], totalUsdValue: 0 },
  });
}
