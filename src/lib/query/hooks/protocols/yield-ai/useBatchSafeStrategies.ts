'use client';

import { useQueries } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';
import type { SafeAiAgentStrategy } from './useSafeAiAgentStrategy';

type Response = {
  success: boolean;
  data?: SafeAiAgentStrategy;
  error?: string;
};

async function fetchSafeAiAgentStrategy(safeAddress: string): Promise<SafeAiAgentStrategy | null> {
  try {
    const res = await fetch(
      `/api/protocols/yield-ai/strategy/active?safeAddress=${encodeURIComponent(safeAddress)}`
    );
    if (!res.ok) return null;
    const json = (await res.json()) as Response;
    if (json.error || !json.data) return null;
    return json.data;
  } catch {
    return null;
  }
}

export function useBatchSafeStrategies(safeAddresses: string[]) {
  const results = useQueries({
    queries: safeAddresses.map((safeAddress) => ({
      queryKey: queryKeys.protocols.yieldAi.safeActiveStrategy(safeAddress),
      queryFn: () => fetchSafeAiAgentStrategy(safeAddress),
      enabled: Boolean(safeAddress && safeAddress.length >= 10),
      staleTime: STALE_TIME.POSITIONS,
    })),
  });

  const strategiesMap = new Map<string, SafeAiAgentStrategy | null>();

  safeAddresses.forEach((address, index) => {
    const result = results[index];
    strategiesMap.set(address, result.data ?? null);
  });

  const isLoading = results.some(r => r.isLoading);
  const hasError = results.some(r => r.error);

  return {
    strategiesMap,
    isLoading,
    hasError,
  };
}