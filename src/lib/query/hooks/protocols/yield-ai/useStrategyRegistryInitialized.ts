'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

type InitializedResponse = {
  success: boolean;
  data?: { initialized: boolean };
  error?: string;
};

async function fetchStrategyRegistryInitialized(): Promise<boolean> {
  const res = await fetch('/api/protocols/yield-ai/strategy/initialized');
  if (!res.ok) throw new Error(`Failed to fetch strategy registry init: ${res.status}`);
  const json = (await res.json()) as InitializedResponse;
  if (json.error) throw new Error(json.error);
  return Boolean(json.data?.initialized);
}

export function useStrategyRegistryInitialized() {
  return useQuery({
    queryKey: queryKeys.protocols.yieldAi.strategyRegistryInitialized(),
    queryFn: fetchStrategyRegistryInitialized,
    staleTime: STALE_TIME.POSITIONS,
  });
}

