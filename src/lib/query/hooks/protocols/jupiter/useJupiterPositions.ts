'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export type JupiterPosition = {
  token?: {
    totalRate?: string;
    asset?: {
      address?: string;
      symbol?: string;
      uiSymbol?: string;
      decimals?: number;
      price?: string;
      logoUrl?: string;
    };
  };
  shares?: string;
  underlyingAssets?: string;
};

type JupiterPositionsResponse = {
  success: boolean;
  data?: JupiterPosition[];
  error?: string;
  message?: string;
};

async function fetchJupiterPositions(address: string): Promise<JupiterPosition[]> {
  const response = await fetch(
    `/api/protocols/jupiter/userPositions?address=${encodeURIComponent(address)}`,
    { cache: 'no-store' }
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch Jupiter positions: ${response.status}`);
  }
  const json: JupiterPositionsResponse = await response.json();
  if (!json.success) {
    throw new Error(json.error || json.message || 'Failed to fetch Jupiter positions');
  }
  return json.data ?? [];
}

export interface UseJupiterPositionsOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

export function useJupiterPositions(
  address: string | undefined,
  options?: UseJupiterPositionsOptions
) {
  const enabled = (options?.enabled ?? true) && Boolean(address && address.length >= 10);

  return useQuery({
    queryKey: queryKeys.protocols.jupiter.userPositions(address ?? ''),
    queryFn: () => fetchJupiterPositions(address!),
    staleTime: STALE_TIME.POSITIONS,
    enabled,
    refetchOnMount: options?.refetchOnMount,
  });
}

