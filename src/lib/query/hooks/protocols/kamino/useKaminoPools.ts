'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';
import type { InvestmentData } from '@/types/investments';

type KaminoPoolsResponse = {
  success: boolean;
  data?: InvestmentData[];
  error?: string;
  message?: string;
  count?: number;
};

async function fetchKaminoPools(): Promise<InvestmentData[]> {
  const response = await fetch('/api/protocols/kamino/pools');
  if (!response.ok) {
    throw new Error(`Failed to fetch Kamino pools: ${response.status}`);
  }
  const json: KaminoPoolsResponse = await response.json();
  if (!json.success) {
    throw new Error(json.error || json.message || 'Failed to fetch Kamino pools');
  }
  return json.data ?? [];
}

export interface UseKaminoPoolsOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

export function useKaminoPools(options?: UseKaminoPoolsOptions) {
  const enabled = options?.enabled ?? true;
  return useQuery({
    queryKey: queryKeys.protocols.kamino.pools(),
    queryFn: fetchKaminoPools,
    staleTime: STALE_TIME.POOLS,
    enabled,
    refetchOnMount: options?.refetchOnMount,
  });
}

