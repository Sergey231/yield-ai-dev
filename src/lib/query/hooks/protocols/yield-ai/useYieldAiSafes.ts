'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

interface YieldAiSafesResponse {
  data?: {
    safeAddresses?: string[];
  };
  error?: string;
}

async function fetchYieldAiSafes(owner: string): Promise<string[]> {
  const response = await fetch(
    `/api/protocols/yield-ai/safes?owner=${encodeURIComponent(owner)}`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch Yield AI safes: ${response.status}`);
  }
  const json: YieldAiSafesResponse = await response.json();
  if (json.error) throw new Error(json.error);
  const list = json?.data?.safeAddresses ?? [];
  return Array.isArray(list) ? list : [];
}

interface UseYieldAiSafesOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

export function useYieldAiSafes(owner: string | undefined, options?: UseYieldAiSafesOptions) {
  const enabled =
    (options?.enabled ?? true) && Boolean(owner && owner.length >= 10);

  return useQuery({
    queryKey: queryKeys.protocols.yieldAi.safes(owner ?? ''),
    queryFn: () => fetchYieldAiSafes(owner!),
    staleTime: STALE_TIME.POSITIONS,
    enabled,
    refetchOnMount: options?.refetchOnMount,
  });
}

