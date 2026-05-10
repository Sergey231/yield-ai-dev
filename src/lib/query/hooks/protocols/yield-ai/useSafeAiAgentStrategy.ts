'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';
import type {
  AiAgentStrategyId,
  StrategyRegistryResolvedStrategy,
} from '@/lib/protocols/yield-ai/strategyRegistry';

export type SafeAiAgentStrategy = StrategyRegistryResolvedStrategy & {
  safeAddress: string;
  activeStrategyId: AiAgentStrategyId;
};

type Response = {
  success: boolean;
  data?: SafeAiAgentStrategy;
  error?: string;
};

async function fetchSafeAiAgentStrategy(safeAddress: string): Promise<SafeAiAgentStrategy> {
  const res = await fetch(
    `/api/protocols/yield-ai/strategy/active?safeAddress=${encodeURIComponent(safeAddress)}`
  );
  if (!res.ok) throw new Error(`Failed to fetch safe strategy: ${res.status}`);
  const json = (await res.json()) as Response;
  if (json.error) throw new Error(json.error);
  if (!json.data) throw new Error('Missing response data');
  return json.data;
}

export function useSafeAiAgentStrategy(safeAddress: string | undefined, opts?: { enabled?: boolean }) {
  const enabled = (opts?.enabled ?? true) && Boolean(safeAddress && safeAddress.length >= 10);
  return useQuery({
    queryKey: queryKeys.protocols.yieldAi.safeActiveStrategy(safeAddress ?? ''),
    queryFn: () => fetchSafeAiAgentStrategy(safeAddress!),
    enabled,
    // Strategy tags gate automation and UI; keep them fresh.
    staleTime: STALE_TIME.BALANCE,
    refetchOnMount: 'always',
  });
}

