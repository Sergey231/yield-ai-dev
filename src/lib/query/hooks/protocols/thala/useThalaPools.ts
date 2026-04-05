'use client';

import { useQuery } from '@tanstack/react-query';
import { STALE_TIME } from '@/lib/query/config';
import { queryKeys } from '@/lib/query/queryKeys';

interface ThalaPoolsResponse {
  success: boolean;
  data: Array<Record<string, unknown>>;
}

async function fetchThalaPools(): Promise<ThalaPoolsResponse> {
  const response = await fetch('/api/protocols/thala/pools');
  if (!response.ok) {
    throw new Error(`Failed to fetch Thala pools: ${response.status}`);
  }
  const json: ThalaPoolsResponse = await response.json();
  if (!json.success) {
    throw new Error('Failed to fetch Thala pools');
  }
  return json;
}

export function useThalaPools(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.protocols.thala.pools(),
    queryFn: fetchThalaPools,
    staleTime: STALE_TIME.POOLS,
    enabled: options?.enabled ?? true,
  });
}
