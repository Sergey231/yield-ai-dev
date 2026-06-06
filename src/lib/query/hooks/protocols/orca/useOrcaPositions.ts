'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export interface OrcaTokenInfo {
  mint: string;
  symbol: string;
  decimals: number;
  logoUrl?: string;
  priceUsd?: number;
  amount?: number;
  valueUsd?: number;
}

export interface OrcaPosition {
  id: string;
  protocol: 'orca';
  type: 'whirlpool-nft';
  label: string;
  poolId: string;
  poolType: string;
  programId?: string;
  nftMint: string;
  tokenAccount: string;
  positionPda: string;
  tickLower: number;
  tickUpper: number;
  tickCurrent?: number;
  tickSpacing?: number;
  lowerPrice?: number;
  upperPrice?: number;
  poolPrice?: number;
  inRange: boolean;
  rangeStatus?: 'priceInRange' | 'priceBelowRange' | 'priceAboveRange' | 'invalid';
  liquidity?: string;
  poolLiquidity?: string;
  feeRate?: number;
  valueUsd: number;
  principalUsd?: number;
  feesUsd?: number;
  rewardsUsd?: number;
  unclaimedUsd?: number;
  amountA?: number;
  amountB?: number;
  feeA?: number;
  feeB?: number;
  tokenA?: OrcaTokenInfo;
  tokenB?: OrcaTokenInfo;
  rewardMints?: string[];
  rewardOwedRaw?: string[];
  rewardTokens?: OrcaTokenInfo[];
  actions?: {
    harvestSupportedBySdk?: boolean;
    closeSupportedBySdk?: boolean;
    uiEnabled?: boolean;
  };
}

interface OrcaPositionsResponse {
  success: boolean;
  data?: OrcaPosition[];
  totalUsd?: number;
  error?: string;
}

async function fetchOrcaPositions(address: string): Promise<OrcaPosition[]> {
  const response = await fetch(
    `/api/protocols/orca/userPositions?address=${encodeURIComponent(address)}`,
    { cache: 'no-store' }
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch Orca positions: ${response.status}`);
  }
  const json: OrcaPositionsResponse = await response.json();
  if (!json.success) {
    throw new Error(json.error || 'Failed to fetch Orca positions');
  }
  return Array.isArray(json.data) ? json.data : [];
}

export interface UseOrcaPositionsOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

function isLikelySolanaAddress(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

export function useOrcaPositions(
  address: string | undefined,
  options?: UseOrcaPositionsOptions
) {
  const trimmed = (address ?? '').trim();
  const enabled =
    (options?.enabled ?? true) && trimmed.length > 0 && isLikelySolanaAddress(trimmed);

  return useQuery({
    queryKey: queryKeys.protocols.orca.userPositions(trimmed),
    queryFn: () => fetchOrcaPositions(trimmed),
    staleTime: STALE_TIME.POSITIONS,
    enabled,
    refetchOnMount: options?.refetchOnMount,
    placeholderData: (prev) => prev ?? [],
  });
}
