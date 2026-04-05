'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export interface EchelonReward {
  token: string;
  tokenType: string;
  rewardName?: string;
  amount: number;
  rawAmount: string;
  farmingId: string;
  stakeAmount: number;
}

interface EchelonRewardsResponse {
  success: boolean;
  data: EchelonReward[];
}

async function fetchEchelonRewards(address: string): Promise<EchelonReward[]> {
  const response = await fetch(
    `/api/protocols/echelon/rewards?address=${encodeURIComponent(address)}`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch Echelon rewards: ${response.status}`);
  }
  const json: EchelonRewardsResponse = await response.json();
  if (!json.success) {
    throw new Error('Failed to fetch Echelon rewards');
  }
  return json.data ?? [];
}

interface UseEchelonRewardsOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

export function useEchelonRewards(
  address: string | undefined,
  options?: UseEchelonRewardsOptions
) {
  const enabled =
    (options?.enabled ?? true) && Boolean(address && address.length >= 10);

  return useQuery({
    queryKey: queryKeys.protocols.echelon.rewards(address ?? ''),
    queryFn: () => fetchEchelonRewards(address!),
    staleTime: STALE_TIME.POSITIONS,
    enabled,
    refetchOnMount: options?.refetchOnMount,
  });
}

