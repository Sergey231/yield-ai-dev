'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export interface EchelonPool {
  token: string;
  supplyAPY?: number;
  borrowAPY?: number;
  supplyRewardsApr?: number;
  borrowRewardsApr?: number;
  marketAddress?: string;
  asset?: string;
}

interface EchelonPoolsResponse {
  success: boolean;
  data: EchelonPool[];
}

async function fetchEchelonPools(): Promise<EchelonPoolsResponse> {
  const response = await fetch('/api/protocols/echelon/v2/pools');
  if (!response.ok) {
    throw new Error(`Failed to fetch Echelon pools: ${response.status}`);
  }
  const json: EchelonPoolsResponse = await response.json();
  if (!json.success) {
    throw new Error('Failed to fetch Echelon pools');
  }
  return json;
}

export function useEchelonPools(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.protocols.echelon.pools(),
    queryFn: fetchEchelonPools,
    staleTime: STALE_TIME.POOLS,
    enabled: options?.enabled ?? true,
  });
}

