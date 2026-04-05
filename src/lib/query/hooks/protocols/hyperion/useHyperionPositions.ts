'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export interface HyperionPosition {
  isActive: boolean;
  value: string;
  farm?: {
    unclaimed?: Array<{ amountUSD?: string }>;
  };
  fees?: {
    unclaimed?: Array<{ amountUSD?: string }>;
  };
  position?: {
    objectId?: string;
    pool?: {
      poolId?: string;
      token1Info?: { symbol?: string; logoUrl?: string };
      token2Info?: { symbol?: string; logoUrl?: string };
    };
  };
}

interface HyperionPositionsResponse {
  success: boolean;
  data?: HyperionPosition[];
}

async function fetchHyperionPositions(address: string): Promise<HyperionPosition[]> {
  const response = await fetch(
    `/api/protocols/hyperion/userPositions?address=${encodeURIComponent(address)}`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch Hyperion positions: ${response.status}`);
  }

  const json: HyperionPositionsResponse = await response.json();
  if (!json.success) {
    throw new Error('Failed to fetch Hyperion positions');
  }

  return Array.isArray(json.data) ? json.data : [];
}

interface UseHyperionPositionsOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

export function useHyperionPositions(
  address: string | undefined,
  options?: UseHyperionPositionsOptions
) {
  const enabled =
    (options?.enabled ?? true) && Boolean(address && address.length >= 10);

  return useQuery({
    queryKey: queryKeys.protocols.hyperion.userPositions(address ?? ''),
    queryFn: () => fetchHyperionPositions(address!),
    staleTime: STALE_TIME.POSITIONS,
    enabled,
    refetchOnMount: options?.refetchOnMount,
  });
}
