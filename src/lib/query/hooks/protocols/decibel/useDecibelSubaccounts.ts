'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export type DecibelSubaccount = {
  subaccount_address: string;
  primary_account_address: string;
  is_primary: boolean;
  is_active: boolean;
  custom_label: string | null;
};

type Response = {
  success: boolean;
  data?: DecibelSubaccount[];
  error?: string;
};

async function fetchDecibelSubaccounts(address: string): Promise<DecibelSubaccount[]> {
  const res = await fetch(`/api/protocols/decibel/subaccounts?address=${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(`Failed to fetch Decibel subaccounts: ${res.status}`);
  const json = (await res.json()) as Response;
  if (json.error) throw new Error(json.error);
  return json.data ?? [];
}

export function useDecibelSubaccounts(address: string | undefined, opts?: { enabled?: boolean }) {
  const enabled = (opts?.enabled ?? true) && Boolean(address && address.length >= 10);
  return useQuery({
    queryKey: queryKeys.protocols.decibel.subaccounts(address ?? ''),
    queryFn: () => fetchDecibelSubaccounts(address!),
    enabled,
    staleTime: STALE_TIME.POSITIONS,
  });
}