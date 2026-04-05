'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export interface HyperionPool {
  poolId?: string;
  feeAPR?: string;
  farmAPR?: string;
}

interface HyperionPoolsResponse {
  success: boolean;
  data?: HyperionPool[];
}

async function fetchHyperionPools(): Promise<HyperionPool[]> {
  const response = await fetch('/api/protocols/hyperion/pools');
  if (!response.ok) {
    throw new Error(`Failed to fetch Hyperion pools: ${response.status}`);
  }

  const json: HyperionPoolsResponse = await response.json();
  if (!json.success) {
    throw new Error('Failed to fetch Hyperion pools');
  }

  return Array.isArray(json.data) ? json.data : [];
}

export function useHyperionPools(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.protocols.hyperion.pools(),
    queryFn: fetchHyperionPools,
    staleTime: STALE_TIME.POOLS,
    enabled: options?.enabled ?? true,
  });
}
