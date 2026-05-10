'use client';

import { useQuery } from '@tanstack/react-query';
import type { Aptos } from '@aptos-labs/ts-sdk';
import { useAptosClient } from '@/contexts/AptosClientContext';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';
import { YIELD_AI_VAULT_VIEWS } from '@/lib/constants/yieldAiVault';

async function fetchIsSafePaused(aptos: Aptos, safeAddress: string): Promise<boolean> {
  const result = await aptos.view({
    payload: {
      function: YIELD_AI_VAULT_VIEWS.isSafePaused,
      typeArguments: [],
      functionArguments: [safeAddress],
    },
  });
  return result[0] === true || result[0] === "true";
}

export function useYieldAiSafePaused(safeAddress: string | undefined) {
  const aptos = useAptosClient();

  return useQuery({
    queryKey: queryKeys.protocols.yieldAi.safePaused(safeAddress ?? ''),
    queryFn: () => fetchIsSafePaused(aptos, safeAddress!),
    enabled: Boolean(safeAddress),
    staleTime: STALE_TIME.BALANCE,
    refetchOnMount: 'always',
  });
}
