import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

type Direction = 'deposit' | 'withdraw';

export interface YieldAiDepositHistoryEntry {
  timestamp: string;
  amount: string;
  amountRaw: string;
  direction: Direction;
  txVersion: string;
}

export interface YieldAiDepositHistoryResponse {
  data?: {
    totalDeposited?: string;
    totalWithdrawn?: string;
    netDeposits?: string;
    pnlStats?: {
      pnl?: string | null;
      apr?: string | null;
      holdingDays?: number;
    };
    entries?: YieldAiDepositHistoryEntry[];
  };
  error?: string;
}

export interface YieldAiDepositHistory {
  totalDeposited: string;
  totalWithdrawn: string;
  netDeposits: string;
  pnlStats: {
    pnl: string | null;
    apr: string | null;
    holdingDays: number;
  };
  entries: YieldAiDepositHistoryEntry[];
}

async function fetchYieldAiDepositHistory(params: {
  safeAddress: string;
  currentValue?: number | null;
}): Promise<YieldAiDepositHistory> {
  const url = new URL('/api/protocols/yield-ai/deposit-history', window.location.origin);
  url.searchParams.set('safeAddress', params.safeAddress);
  if (params.currentValue != null && Number.isFinite(params.currentValue)) {
    url.searchParams.set('currentValue', String(params.currentValue));
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to fetch Yield AI deposit history: ${response.status}`);
  }
  const json: YieldAiDepositHistoryResponse = await response.json();
  if (json.error) throw new Error(json.error);

  return {
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

interface UseYieldAiDepositHistoryOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

export function useYieldAiDepositHistory(
  safeAddress: string | undefined,
  currentValue: number | null,
  options?: UseYieldAiDepositHistoryOptions
) {
  const enabled =
    (options?.enabled ?? true) && Boolean(safeAddress && safeAddress.length >= 10);

  return useQuery({
    queryKey: queryKeys.protocols.yieldAi.depositHistory(safeAddress ?? '', currentValue),
    enabled,
    staleTime: STALE_TIME.POSITIONS,
    refetchOnMount: options?.refetchOnMount,
    queryFn: () =>
      fetchYieldAiDepositHistory({ safeAddress: safeAddress!, currentValue }),
  });
}

