'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

export type DecibelAccountBalance = {
  perp_equity_balance: number;
  usdc_cross_withdrawable_balance: number;
  usdc_isolated_withdrawable_balance: number;
  total_margin: number;
  vault_equity: number;
  unrealized_pnl: number;
  realized_pnl: number;
};

type Response = {
  success: boolean;
  data?: DecibelAccountBalance;
  error?: string;
};

async function fetchDecibelAccountBalance(address: string): Promise<DecibelAccountBalance> {
  const res = await fetch(`/api/protocols/decibel/accountOverview?address=${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(`Failed to fetch Decibel account balance: ${res.status}`);
  const json = (await res.json()) as Response;
  if (json.error) throw new Error(json.error);
  return json.data ?? {
    perp_equity_balance: 0,
    usdc_cross_withdrawable_balance: 0,
    usdc_isolated_withdrawable_balance: 0,
    total_margin: 0,
    vault_equity: 0,
    unrealized_pnl: 0,
    realized_pnl: 0,
  };
}

export function useDecibelAccountBalance(address: string | undefined, opts?: { enabled?: boolean }) {
  const enabled = (opts?.enabled ?? true) && Boolean(address && address.length >= 10);
  return useQuery({
    queryKey: queryKeys.protocols.decibel.accountBalance(address ?? ''),
    queryFn: () => fetchDecibelAccountBalance(address!),
    enabled,
    staleTime: STALE_TIME.POSITIONS,
  });
}