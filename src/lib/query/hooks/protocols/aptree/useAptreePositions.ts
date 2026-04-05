'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export interface AptreePosition {
  poolId: number;
  assetName: string;
  balance: string;
  value: string;
  displayPrice?: number;
  displayAmount?: string;
  type: 'deposit';
  assetInfo?: {
    symbol?: string;
    logoUrl?: string;
    decimals?: number;
    name?: string;
  };
}

interface AptreePositionsResponse {
  success: boolean;
  data: AptreePosition[];
  error?: string;
}

async function fetchAptreePositions(address: string): Promise<AptreePosition[]> {
  const response = await fetch(
    `/api/protocols/aptree/userPositions?address=${encodeURIComponent(address)}`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch APTree positions: ${response.status}`);
  }
  const json: AptreePositionsResponse = await response.json();
  if (!json.success) {
    throw new Error(json.error || 'Failed to fetch APTree positions');
  }
  return Array.isArray(json.data) ? json.data : [];
}

interface UseAptreePositionsOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

export function useAptreePositions(address: string | undefined, options?: UseAptreePositionsOptions) {
  const enabled =
    (options?.enabled ?? true) && Boolean(address && address.length >= 10);

  return useQuery({
    queryKey: queryKeys.protocols.aptree.userPositions(address ?? ''),
    queryFn: () => fetchAptreePositions(address!),
    staleTime: STALE_TIME.POSITIONS,
    enabled,
    refetchOnMount: options?.refetchOnMount,
  });
}

