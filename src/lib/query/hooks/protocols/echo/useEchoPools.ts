'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export interface EchoPool {
  underlyingAddress: string;
  token: string;
  symbol: string;
  supplyApy: number;
  borrowApy: number;
  supplyApyFormatted: string;
  borrowApyFormatted: string;
}

interface EchoPoolsResponse {
  success: boolean;
  data?: EchoPool[];
}

async function fetchEchoPools(): Promise<EchoPool[]> {
  const response = await fetch('/api/protocols/echo/reserves');
  if (!response.ok) {
    throw new Error(`Failed to fetch Echo pools: ${response.status}`);
  }

  const json: EchoPoolsResponse = await response.json();
  if (!json.success) {
    throw new Error('Failed to fetch Echo pools');
  }

  return json.data ?? [];
}

export function useEchoPools() {
  return useQuery({
    queryKey: queryKeys.protocols.echo.pools(),
    queryFn: fetchEchoPools,
    staleTime: STALE_TIME.POOLS,
  });
}

