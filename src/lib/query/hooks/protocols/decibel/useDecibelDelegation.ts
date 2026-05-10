'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export type DecibelDelegationItem = {
  delegatedAccount: string;
  permissionType: string;
  expirationTimeS: number | null;
  isExpired: boolean;
};

export type DecibelDelegationStatus = {
  subaccount: string;
  executorAddress: string;
  isDelegatedToExecutor: boolean;
  data: DecibelDelegationItem[];
};

type Response = {
  success: boolean;
  subaccount?: string;
  executorAddress?: string;
  isDelegatedToExecutor?: boolean;
  data?: DecibelDelegationItem[];
  error?: string;
};

async function fetchDecibelDelegation(subaccount: string): Promise<DecibelDelegationStatus> {
  const res = await fetch(`/api/protocols/decibel/delegations?subaccount=${encodeURIComponent(subaccount)}`);
  if (!res.ok) throw new Error(`Failed to fetch Decibel delegation: ${res.status}`);
  const json = (await res.json()) as Response;
  if (json.error) throw new Error(json.error);
  return {
    subaccount: json.subaccount ?? subaccount,
    executorAddress: json.executorAddress ?? '',
    isDelegatedToExecutor: json.isDelegatedToExecutor ?? false,
    data: json.data ?? [],
  };
}

export function useDecibelDelegation(subaccount: string | undefined, opts?: { enabled?: boolean }) {
  const enabled = (opts?.enabled ?? true) && Boolean(subaccount && subaccount.length >= 10);
  return useQuery({
    queryKey: queryKeys.protocols.decibel.delegation(subaccount ?? ''),
    queryFn: () => fetchDecibelDelegation(subaccount!),
    enabled,
    staleTime: STALE_TIME.POSITIONS,
  });
}