'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export type KaminoRewardRow = {
  tokenMint: string;
  tokenSymbol?: string;
  tokenLogoUrl?: string;
  amount: string;
  usdValue?: number;
};

type KaminoRewardsResponse = {
  success: boolean;
  data?: KaminoRewardRow[];
  error?: string;
  message?: string;
  count?: number;
};

async function fetchKaminoRewards(address: string): Promise<KaminoRewardRow[]> {
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
  return json.data ?? [];
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
  });
}

