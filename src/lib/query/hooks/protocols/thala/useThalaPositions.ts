'use client';

import { useQuery } from '@tanstack/react-query';
import { STALE_TIME } from '@/lib/query/config';
import { queryKeys } from '@/lib/query/queryKeys';

export interface ThalaTokenAmount {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string | null;
  amountRaw: string;
  amount: number;
  priceUSD: number;
  valueUSD: number;
}

export interface ThalaRewardItem {
  tokenAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl?: string | null;
  amountRaw: string;
  amount: number;
  priceUSD: number;
  valueUSD: number;
}

export interface ThalaPosition {
  positionId: string;
  positionAddress: string;
  staked: boolean;
  apr?: number;
  poolAddress: string;
  token0: ThalaTokenAmount;
  token1: ThalaTokenAmount;
  inRange: boolean;
  rewards: ThalaRewardItem[];
  positionValueUSD: number;
  rewardsValueUSD: number;
  totalValueUSD: number;
}

interface ThalaUserPositionsResponse {
  success: boolean;
  data: ThalaPosition[];
}

interface UseThalaQueryOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

async function fetchThalaPositions(address: string): Promise<ThalaPosition[]> {
  const response = await fetch(
    `/api/protocols/thala/userPositions?address=${encodeURIComponent(address)}`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch Thala positions: ${response.status}`);
  }
  const json: ThalaUserPositionsResponse = await response.json();
  if (!json.success) {
    throw new Error('Failed to fetch Thala positions');
  }
  return json.data ?? [];
}

export function useThalaPositions(
  address: string | undefined,
  options?: UseThalaQueryOptions
) {
  const enabled =
    (options?.enabled ?? true) && Boolean(address && address.length >= 10);

  return useQuery({
    queryKey: queryKeys.protocols.thala.userPositions(address ?? ''),
    queryFn: () => fetchThalaPositions(address!),
    staleTime: STALE_TIME.POSITIONS,
    enabled,
    refetchOnMount: options?.refetchOnMount,
  });
}
