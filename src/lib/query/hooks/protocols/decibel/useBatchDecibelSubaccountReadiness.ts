'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';
import type {
  DecibelDelegationItem,
  DecibelDelegationStatus,
} from './useDecibelDelegation';

type DelegationResp = {
  success?: boolean;
  subaccount?: string;
  executorAddress?: string;
  isDelegatedToExecutor?: boolean;
  data?: DecibelDelegationItem[];
  error?: string;
};

type BuilderConfig = { builderAddress: string; builderFeeBps: number } | null;
type ApprovalResp = { success?: boolean; approvedMaxFeeBps?: number | null };

/**
 * Fetch the same `DecibelDelegationStatus` shape that `useDecibelDelegation`
 * uses. Critical: both hooks share `queryKeys.protocols.decibel.delegation(s)`,
 * so writing a different shape from this batch hook would corrupt the cache
 * and break the per-row `<SubaccountDelegationRow>` rendering ("Not delegated"
 * when in fact delegated). Keep shapes identical here.
 */
async function fetchDelegationStatus(subaccount: string): Promise<DecibelDelegationStatus> {
  const res = await fetch(
    `/api/protocols/decibel/delegations?subaccount=${encodeURIComponent(subaccount)}`
  );
  if (!res.ok) {
    return {
      subaccount,
      executorAddress: '',
      isDelegatedToExecutor: false,
      data: [],
    };
  }
  const json = (await res.json()) as DelegationResp;
  return {
    subaccount: json.subaccount ?? subaccount,
    executorAddress: json.executorAddress ?? '',
    isDelegatedToExecutor: Boolean(json.success && json.isDelegatedToExecutor),
    data: json.data ?? [],
  };
}

async function fetchBuilderConfig(): Promise<BuilderConfig> {
  const res = await fetch('/api/protocols/decibel/builder-config');
  if (!res.ok) return null;
  const json = (await res.json()) as { success?: boolean; builderAddress?: string; builderFeeBps?: number };
  if (!json.success || !json.builderAddress || typeof json.builderFeeBps !== 'number') return null;
  return { builderAddress: json.builderAddress, builderFeeBps: json.builderFeeBps };
}

async function fetchApprovedBps(subaccount: string, builder: string): Promise<number | null> {
  const url =
    `/api/protocols/decibel/approved-max-fee?subaccount=${encodeURIComponent(subaccount)}` +
    `&builder=${encodeURIComponent(builder)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as ApprovalResp;
  return json.approvedMaxFeeBps ?? null;
}

export interface DecibelSubaccountReadiness {
  subaccount: string;
  isDelegated: boolean;
  feeApproved: boolean;
  /** isDelegated && feeApproved (== ready to receive executor orders that earn the builder fee). */
  isReady: boolean;
  isLoading: boolean;
}

/**
 * Batch readiness check across N Decibel subaccounts. Used to default-select
 * the most "useful" subaccount when no on-chain DN record exists.
 *
 * Cheap: builder config is fetched once globally, delegation + approval per
 * subaccount via TanStack `useQueries` so cache is shared with the per-row
 * `useDecibelDelegation` / `useDecibelBuilderFeeApproval` hooks.
 */
export function useBatchDecibelSubaccountReadiness(subaccounts: string[]) {
  const config = useQuery({
    queryKey: queryKeys.protocols.decibel.builderConfig(),
    queryFn: fetchBuilderConfig,
    staleTime: STALE_TIME.TOKEN_INFO,
  });
  const builderAddress = config.data?.builderAddress;
  const requiredBps = config.data?.builderFeeBps ?? null;

  const delegationResults = useQueries({
    queries: subaccounts.map((s) => ({
      queryKey: queryKeys.protocols.decibel.delegation(s),
      queryFn: () => fetchDelegationStatus(s),
      enabled: Boolean(s && s.length >= 10),
      staleTime: STALE_TIME.POSITIONS,
    })),
  });

  const approvalResults = useQueries({
    queries: subaccounts.map((s) => ({
      queryKey: queryKeys.protocols.decibel.approvedBuilderFee(s, builderAddress ?? ''),
      queryFn: () => fetchApprovedBps(s, builderAddress!),
      enabled: Boolean(s && s.length >= 10 && builderAddress),
      staleTime: STALE_TIME.POSITIONS,
    })),
  });

  const readiness: DecibelSubaccountReadiness[] = subaccounts.map((s, i) => {
    const isDelegated = Boolean(delegationResults[i]?.data?.isDelegatedToExecutor);
    const approvedBps = approvalResults[i]?.data ?? null;
    const feeApproved =
      requiredBps != null && approvedBps != null && approvedBps >= requiredBps;
    const isLoading =
      Boolean(delegationResults[i]?.isLoading) ||
      Boolean(approvalResults[i]?.isLoading) ||
      config.isLoading;
    return {
      subaccount: s,
      isDelegated,
      feeApproved,
      isReady: isDelegated && feeApproved,
      isLoading,
    };
  });

  return { readiness, isLoading: config.isLoading || readiness.some((r) => r.isLoading) };
}
