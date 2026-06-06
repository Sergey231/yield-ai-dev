'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export type DecibelBuilderConfig = {
  builderAddress: string;
  builderFeeBps: number;
};

async function fetchBuilderConfig(): Promise<DecibelBuilderConfig | null> {
  const res = await fetch('/api/protocols/decibel/builder-config');
  if (!res.ok) return null;
  const json = (await res.json()) as {
    success?: boolean;
    builderAddress?: string;
    builderFeeBps?: number;
  };
  if (!json.success || !json.builderAddress || typeof json.builderFeeBps !== 'number') {
    return null;
  }
  return { builderAddress: json.builderAddress, builderFeeBps: json.builderFeeBps };
}

async function fetchApprovedBuilderFee(params: {
  subaccount: string;
  builder: string;
}): Promise<number | null> {
  const url =
    `/api/protocols/decibel/approved-max-fee?subaccount=${encodeURIComponent(params.subaccount)}` +
    `&builder=${encodeURIComponent(params.builder)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`approved-max-fee HTTP ${res.status}`);
  const json = (await res.json()) as { success?: boolean; approvedMaxFeeBps?: number | null };
  return json.approvedMaxFeeBps ?? null;
}

export function useDecibelBuilderConfig(opts?: { enabled?: boolean }) {
  const enabled = opts?.enabled ?? true;
  return useQuery({
    queryKey: queryKeys.protocols.decibel.builderConfig(),
    queryFn: fetchBuilderConfig,
    enabled,
    staleTime: STALE_TIME.TOKEN_INFO,
  });
}

/**
 * Reads `builder_code_registry::get_approved_max_fee(subaccount, builder)` via our API route.
 * Returns:
 *  - approvedMaxFeeBps: null when no approval, number when approved.
 *  - meetsRequiredFee: true if approval >= the env-configured DECIBEL_BUILDER_FEE_BPS.
 */
export function useDecibelBuilderFeeApproval(params: {
  subaccount: string | undefined;
  enabled?: boolean;
}) {
  const config = useDecibelBuilderConfig({ enabled: params.enabled });
  const builder = config.data?.builderAddress;
  const subaccount = params.subaccount;
  const enabled =
    (params.enabled ?? true) && Boolean(subaccount) && Boolean(builder);
  const approval = useQuery({
    queryKey: queryKeys.protocols.decibel.approvedBuilderFee(subaccount ?? '', builder ?? ''),
    queryFn: () => fetchApprovedBuilderFee({ subaccount: subaccount!, builder: builder! }),
    enabled,
    staleTime: STALE_TIME.POSITIONS,
  });
  const requiredBps = config.data?.builderFeeBps ?? null;
  const approvedBps = approval.data ?? null;
  const meetsRequiredFee =
    requiredBps != null && approvedBps != null && approvedBps >= requiredBps;
  return {
    isLoading: config.isLoading || approval.isLoading,
    error: config.error ?? approval.error,
    builderAddress: builder ?? null,
    requiredBps,
    approvedBps,
    meetsRequiredFee,
    refetch: approval.refetch,
  };
}
