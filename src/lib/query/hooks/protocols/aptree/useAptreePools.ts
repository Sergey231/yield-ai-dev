'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export interface AptreePool {
  pool_id: string;
  token: string;
  symbol: string;
  name: string;
  tvl: number;
  /** Decimal, e.g. 0.12 = 12% */
  apr: number;
}

interface AptreePoolsResponse {
  success: boolean;
  data: AptreePool[];
  error?: string;
}

async function fetchAptreePools(): Promise<AptreePool[]> {
  const response = await fetch('/api/protocols/aptree/pools');
  if (!response.ok) {
    throw new Error(`Failed to fetch APTree pools: ${response.status}`);
  }
  const json: AptreePoolsResponse = await response.json();
  if (!json.success) {
    throw new Error(json.error || 'Failed to fetch APTree pools');
  }
  return Array.isArray(json.data) ? json.data : [];
}

interface UseAptreePoolsOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

export function useAptreePools(options?: UseAptreePoolsOptions) {
  const enabled = options?.enabled ?? true;
  return useQuery({
    queryKey: queryKeys.protocols.aptree.pools(),
    queryFn: fetchAptreePools,
    staleTime: STALE_TIME.POOLS,
    enabled,
    refetchOnMount: options?.refetchOnMount,
  });
}

