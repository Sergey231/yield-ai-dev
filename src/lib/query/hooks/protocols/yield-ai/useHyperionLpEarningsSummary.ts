'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export type HyperionLpEarningsSummary = {
  profitYesterdayUsd: number;
  claimsYesterdayCount: number;
  window: { start: string; end: string };
  pricing?: { mode: string; note?: string };
};

interface EarningsSummaryResponse {
  data?: HyperionLpEarningsSummary;
  error?: { message?: string } | string;
}

async function fetchHyperionLpEarningsSummary(safeAddress: string): Promise<HyperionLpEarningsSummary> {
  const res = await fetch(
    `/api/protocols/yield-ai/hyperion-lp/earnings-summary?safe=${encodeURIComponent(safeAddress)}`
  );
  const json: EarningsSummaryResponse = await res.json();
  if (!res.ok) {
    const msg = typeof json.error === 'string' ? json.error : json.error?.message;
    throw new Error(msg || `Failed to fetch Hyperion LP earnings summary: ${res.status}`);
  }
  if (!json.data) {
    throw new Error('Missing earnings summary payload');
  }
  return json.data;
}

interface UseHyperionLpEarningsSummaryOptions {
  enabled?: boolean;
}

export function useHyperionLpEarningsSummary(
  safeAddress: string | undefined,
  options?: UseHyperionLpEarningsSummaryOptions
) {
  const enabled =
    (options?.enabled ?? true) && Boolean(safeAddress && safeAddress.length >= 10);

  return useQuery({
    queryKey: queryKeys.protocols.yieldAi.hyperionLpEarningsSummary(safeAddress ?? ''),
    enabled,
    staleTime: STALE_TIME.POSITIONS,
    queryFn: () => fetchHyperionLpEarningsSummary(safeAddress!),
  });
}
