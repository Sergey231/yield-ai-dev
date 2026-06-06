'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export interface RaydiumTokenInfo {
  mint: string;
  symbol: string;
  decimals: number;
  logoUrl?: string;
  priceUsd?: number;
  reserve?: number;
  amount?: number;
  valueUsd?: number;
}

export interface RaydiumPosition {
  id: string;
  protocol: 'raydium';
  type: 'clmm-nft' | 'lp-token';
  label: string;
  poolId: string;
  poolType: string;
  programId?: string;
  nftMint?: string;
  positionPda?: string;
  tickLower?: number;
  tickUpper?: number;
  lowerPrice?: number;
  upperPrice?: number;
  lpMint?: string;
  tokenAccount: string;
  valueUsd: number;
  principalUsd?: number;
  feesUsd?: number;
  rewardsUsd?: number;
  unclaimedUsd?: number;
  amountA?: number;
  amountB?: number;
  tokenA?: RaydiumTokenInfo;
  tokenB?: RaydiumTokenInfo;
  tokens?: RaydiumTokenInfo[];
  lpAmount?: number;
  lpPrice?: number;
  sharePct?: number;
  poolPrice?: number;
  tvl?: number;
  apr24h?: number;
  feeApr24h?: number;
  fee24h?: number;
  image?: string;
}

interface RaydiumPositionsResponse {
  success: boolean;
  data?: RaydiumPosition[];
  totalUsd?: number;
  error?: string;
}

async function fetchRaydiumPositions(address: string): Promise<RaydiumPosition[]> {
  const response = await fetch(
    `/api/protocols/raydium/userPositions?address=${encodeURIComponent(address)}`,
    { cache: 'no-store' }
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch Raydium positions: ${response.status}`);
  }
  const json: RaydiumPositionsResponse = await response.json();
  if (!json.success) {
    throw new Error(json.error || 'Failed to fetch Raydium positions');
  }
  return Array.isArray(json.data) ? json.data : [];
}

export interface UseRaydiumPositionsOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

function isLikelySolanaAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

export function useRaydiumPositions(
  address: string | undefined,
  options?: UseRaydiumPositionsOptions
) {
  const trimmed = (address ?? '').trim();
  const enabled =
    (options?.enabled ?? true) && trimmed.length > 0 && isLikelySolanaAddress(trimmed);

  return useQuery({
    queryKey: queryKeys.protocols.raydium.userPositions(trimmed),
    queryFn: () => fetchRaydiumPositions(trimmed),
    staleTime: STALE_TIME.POSITIONS,
    enabled,
    refetchOnMount: options?.refetchOnMount,
    placeholderData: (prev) => prev ?? [],
  });
}
