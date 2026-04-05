'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

type Direction = 'deposit' | 'withdraw';

export interface AptreeDepositHistoryEntry {
  timestamp: string;
  direction: Direction;
  amountRaw: string;
  amount: string;
  assetId: string;
  txVersion: string;
  txHash: string;
}

export interface AptreeDepositHistory {
  assetId: string;
  totalDeposited: string;
  totalWithdrawn: string;
  netDeposits: string;
  pnlStats: {
    pnl: string | null;
    apr: string | null;
    holdingDays: number;
  };
  entries: AptreeDepositHistoryEntry[];
}

interface AptreeDepositHistoryApiResponse {
  data?: {
    assetId?: string;
    totalDeposited?: string;
    totalWithdrawn?: string;
    netDeposits?: string;
    pnlStats?: {
      pnl?: string | null;
      apr?: string | null;
      holdingDays?: number;
    };
    entries?: AptreeDepositHistoryEntry[];
  };
  error?: string;
}

async function fetchAptreeDepositHistory(params: {
  address: string;
  assetId?: string;
  currentValue?: number | null;
}): Promise<AptreeDepositHistory> {
  const url = new URL('/api/protocols/aptree/deposit-history', window.location.origin);
  url.searchParams.set('address', params.address);
  if (params.assetId) url.searchParams.set('assetId', params.assetId);
  if (params.currentValue != null && Number.isFinite(params.currentValue)) {
    url.searchParams.set('currentValue', String(params.currentValue));
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch APTree deposit history: ${response.status}`);
  }
  const json: AptreeDepositHistoryApiResponse = await response.json();
  if (json.error) throw new Error(json.error);

  return {
    assetId: json.data?.assetId ?? params.assetId ?? '',
    totalDeposited: json.data?.totalDeposited ?? '0.000000',
    totalWithdrawn: json.data?.totalWithdrawn ?? '0.000000',
    netDeposits: json.data?.netDeposits ?? '0.000000',
    pnlStats: {
      pnl: json.data?.pnlStats?.pnl ?? null,
      apr: json.data?.pnlStats?.apr ?? null,
      holdingDays: Number(json.data?.pnlStats?.holdingDays ?? 0),
    },
    entries: Array.isArray(json.data?.entries) ? json.data!.entries! : [],
  };
}

interface UseAptreeDepositHistoryOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

export function useAptreeDepositHistory(
  address: string | undefined,
  params: { assetId?: string; currentValue?: number | null },
  options?: UseAptreeDepositHistoryOptions
) {
  const enabled =
    (options?.enabled ?? true) && Boolean(address && address.length >= 10);

  return useQuery({
    queryKey: queryKeys.protocols.aptree.depositHistory(
      address ?? '',
      params.assetId,
      params.currentValue ?? null
    ),
    enabled,
    staleTime: STALE_TIME.POSITIONS,
    refetchOnMount: options?.refetchOnMount,
    queryFn: () =>
      fetchAptreeDepositHistory({
        address: address!,
        assetId: params.assetId,
        currentValue: params.currentValue,
      }),
  });
}

