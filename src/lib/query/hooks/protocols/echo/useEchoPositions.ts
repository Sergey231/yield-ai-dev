'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export interface EchoPosition {
  positionId: string;
  aTokenAddress: string;
  aTokenSymbol: string;
  underlyingAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string | null;
  amountRaw: string;
  amount: number;
  priceUSD: number;
  valueUSD: number;
  type?: 'supply' | 'borrow';
  apy?: number;
  apyFormatted?: string;
}

interface EchoPositionsResponse {
  success: boolean;
  data?: EchoPosition[];
}

async function fetchEchoPositions(address: string): Promise<EchoPosition[]> {
  const response = await fetch(
    `/api/protocols/echo/userPositions?address=${encodeURIComponent(address)}`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch Echo positions: ${response.status}`);
  }

  const json: EchoPositionsResponse = await response.json();
  if (!json.success) {
    throw new Error('Failed to fetch Echo positions');
  }

  return json.data ?? [];
}

interface UseEchoPositionsOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

export function useEchoPositions(
  address: string | undefined,
  options?: UseEchoPositionsOptions
) {
  const enabled =
    (options?.enabled ?? true) && Boolean(address && address.length >= 10);

  return useQuery({
    queryKey: queryKeys.protocols.echo.userPositions(address ?? ''),
    queryFn: () => fetchEchoPositions(address!),
    staleTime: STALE_TIME.POSITIONS,
    enabled,
    refetchOnMount: options?.refetchOnMount,
  });
}

