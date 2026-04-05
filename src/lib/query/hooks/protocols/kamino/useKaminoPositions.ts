'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export type KaminoUserPositionsRow = {
  source?: 'kamino-lend' | 'kamino-earn' | 'kamino-farm' | string;
  marketName?: string;
  marketPubkey?: string;
  obligation?: unknown;
  position?: unknown;
  farmPubkey?: string;
  tokenMint?: string;
  tokenSymbol?: string;
  tokenLogoUrl?: string;
  netTokenAmount?: string;
  netUsdAmount?: string;
  lastActivity?: string;
  vaultAddress?: string;
  vaultName?: string;
};

type KaminoPositionsResponse = {
  success: boolean;
  data?: KaminoUserPositionsRow[];
  error?: string;
  message?: string;
};

async function fetchKaminoPositions(address: string): Promise<KaminoUserPositionsRow[]> {
  const response = await fetch(
    `/api/protocols/kamino/userPositions?address=${encodeURIComponent(address)}`,
    { cache: 'no-store' }
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch Kamino positions: ${response.status}`);
  }
  const json: KaminoPositionsResponse = await response.json();
  if (!json.success) {
    throw new Error(json.error || json.message || 'Failed to fetch Kamino positions');
  }
  return json.data ?? [];
}

export interface UseKaminoPositionsOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

export function useKaminoPositions(
  address: string | undefined,
  options?: UseKaminoPositionsOptions
) {
  const enabled = (options?.enabled ?? true) && Boolean(address && address.length >= 10);

  return useQuery({
    queryKey: queryKeys.protocols.kamino.userPositions(address ?? ''),
    queryFn: () => fetchKaminoPositions(address!),
    staleTime: STALE_TIME.POSITIONS,
    enabled,
    refetchOnMount: options?.refetchOnMount,
  });
}

