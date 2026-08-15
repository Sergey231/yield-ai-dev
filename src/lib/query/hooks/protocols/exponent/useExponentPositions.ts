'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';
import type { ExponentUserPositionRow } from '@/lib/services/exponent/types';

type ExponentPositionsResponse = {
  success: boolean;
  data?: ExponentUserPositionRow[];
  totalValueUsd?: number;
  error?: string;
  message?: string;
};

async function fetchExponentPositions(address: string): Promise<ExponentUserPositionRow[]> {
  const response = await fetch(
    `/api/protocols/exponent/userPositions?address=${encodeURIComponent(address)}`,
    { cache: 'no-store' }
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch Exponent positions: ${response.status}`);
  }
  const json: ExponentPositionsResponse = await response.json();
  if (!json.success) {
    throw new Error(json.error || json.message || 'Failed to fetch Exponent positions');
  }
  return json.data ?? [];
}

export interface UseExponentPositionsOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

export function useExponentPositions(
  address: string | undefined,
  options?: UseExponentPositionsOptions
) {
  const enabled = (options?.enabled ?? true) && Boolean(address && address.length >= 10);

  return useQuery({
    queryKey: queryKeys.protocols.exponent.userPositions(address ?? ''),
    queryFn: () => fetchExponentPositions(address!),
    staleTime: STALE_TIME.POSITIONS,
    enabled,
    refetchOnMount: options?.refetchOnMount,
    placeholderData: (prev) => prev ?? [],
  });
}

export type { ExponentUserPositionRow };
