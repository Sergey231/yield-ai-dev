'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export interface EchelonPosition {
  market: string;
  coin: string;
  supply: number;
  borrow?: number;
  amount?: number;
  type?: 'supply' | 'borrow';
}

interface EchelonPositionsResponse {
  success: boolean;
  data: EchelonPosition[];
}

async function fetchEchelonPositions(address: string): Promise<EchelonPosition[]> {
  const response = await fetch(
    `/api/protocols/echelon/userPositions?address=${encodeURIComponent(address)}`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch Echelon positions: ${response.status}`);
  }
  const json: EchelonPositionsResponse = await response.json();
  if (!json.success) {
    throw new Error('Failed to fetch Echelon positions');
  }
  return json.data ?? [];
}

interface UseEchelonPositionsOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

export function useEchelonPositions(
  address: string | undefined,
  options?: UseEchelonPositionsOptions
) {
  const enabled =
    (options?.enabled ?? true) && Boolean(address && address.length >= 10);

  return useQuery({
    queryKey: queryKeys.protocols.echelon.userPositions(address ?? ''),
    queryFn: () => fetchEchelonPositions(address!),
    staleTime: STALE_TIME.POSITIONS,
    enabled,
    refetchOnMount: options?.refetchOnMount,
  });
}

