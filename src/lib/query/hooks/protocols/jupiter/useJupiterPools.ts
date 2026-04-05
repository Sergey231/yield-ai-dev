'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';
import type { InvestmentData } from '@/types/investments';

type JupiterPoolsResponse = {
  success: boolean;
  data?: InvestmentData[];
  error?: string;
  message?: string;
};

async function fetchJupiterPools(): Promise<InvestmentData[]> {
  const response = await fetch('/api/protocols/jupiter/pools');
  if (!response.ok) {
    throw new Error(`Failed to fetch Jupiter pools: ${response.status}`);
  }
  const json: JupiterPoolsResponse = await response.json();
  if (!json.success) {
    throw new Error(json.error || json.message || 'Failed to fetch Jupiter pools');
  }
  return json.data ?? [];
}

export interface UseJupiterPoolsOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

export function useJupiterPools(options?: UseJupiterPoolsOptions) {
  const enabled = options?.enabled ?? true;
  return useQuery({
    queryKey: queryKeys.protocols.jupiter.pools(),
    queryFn: fetchJupiterPools,
    staleTime: STALE_TIME.POOLS,
    enabled,
    refetchOnMount: options?.refetchOnMount,
  });
}

