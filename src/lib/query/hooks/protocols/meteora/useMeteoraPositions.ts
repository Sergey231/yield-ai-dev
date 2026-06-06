'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export interface MeteoraTokenInfo {
  mint: string;
  symbol: string;
  decimals: number;
  logoUrl?: string;
  priceUsd?: number;
}

export interface MeteoraBin {
  binId: number;
  xAmount: number;
  yAmount: number;
  usd: number;
  price?: number;
}

export interface MeteoraPosition {
  positionAddress: string;
  owner: string;
  lowerBinId: number;
  upperBinId: number;
  inRange: boolean;
  amountX: number;
  amountY: number;
  feeX: number;
  feeY: number;
  valueUsd: number;
  feesUsd: number;
  totalUsd: number;
  bins: MeteoraBin[];
  lowerBinPrice?: number;
  upperBinPrice?: number;
  activeBinPrice?: number;
}

export interface MeteoraPoolDataApiMeta {
  apr24hPct: number;
  apyPct: number;
  farmAprPct: number;
  farmApyPct: number;
  totalApyPct: number;
  tvlUsd: number;
  volume24hUsd: number;
  fees24hUsd: number;
  currentPrice: number;
}

export interface MeteoraPool {
  poolAddress: string;
  binStep: number;
  baseFactor: number;
  /** Base fee in % (binStep × baseFactor / 1e8 × 100). */
  baseFeePct: number;
  activeBinId: number;
  /** Pool price expressed as tokenX per tokenY (derived from USD prices). */
  pricePerY?: number;
  tokenX: MeteoraTokenInfo;
  tokenY: MeteoraTokenInfo;
  positions: MeteoraPosition[];
  totalUsd: number;
  /** Meteora datapi metadata (APR / APY / TVL / volume). Null when datapi miss. */
  meta?: MeteoraPoolDataApiMeta | null;
}

interface MeteoraPositionsResponse {
  success: boolean;
  enriched?: MeteoraPool[];
  totalUsd?: number;
  error?: string;
}

async function fetchMeteoraPositions(address: string): Promise<MeteoraPool[]> {
  const response = await fetch(
    `/api/protocols/meteora/userPositions?address=${encodeURIComponent(address)}`,
    { cache: 'no-store' }
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch Meteora positions: ${response.status}`);
  }
  const json: MeteoraPositionsResponse = await response.json();
  if (!json.success) {
    throw new Error(json.error || 'Failed to fetch Meteora positions');
  }
  return Array.isArray(json.enriched) ? json.enriched : [];
}

export interface UseMeteoraPositionsOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

function isLikelySolanaAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

export function useMeteoraPositions(
  address: string | undefined,
  options?: UseMeteoraPositionsOptions
) {
  const trimmed = (address ?? '').trim();
  const enabled =
    (options?.enabled ?? true) && trimmed.length > 0 && isLikelySolanaAddress(trimmed);

  return useQuery({
    queryKey: queryKeys.protocols.meteora.userPositions(trimmed),
    queryFn: () => fetchMeteoraPositions(trimmed),
    staleTime: STALE_TIME.POSITIONS,
    enabled,
    refetchOnMount: options?.refetchOnMount,
    placeholderData: (prev) => prev ?? [],
  });
}
