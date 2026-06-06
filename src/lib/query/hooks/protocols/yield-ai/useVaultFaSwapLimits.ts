"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { STALE_TIME } from "@/lib/query/config";

/**
 * Client-shaped view of the on-chain `vault::VaultFaSwapConfig` for an AI
 * agent safe. All USDC values are strings of u64 base units so the JSON
 * payload survives transport without bigint hassle; the consumer converts
 * to `bigint` (or to USD via dividing by 1e6) where it needs to.
 */
export interface VaultFaSwapLimitsDTO {
  exists: boolean;
  day: string;
  currentDayEpoch: string;
  maxDailyUsdc: string;
  maxPerTxUsdc: string;
  spentTodayUsdcRaw: string;
  spentTodayUsdc: string;
  remainingUsdc: string;
  secondsUntilRollover: number;
}

interface Response {
  success: boolean;
  data?: VaultFaSwapLimitsDTO;
  error?: string;
}

async function fetchVaultFaSwapLimits(safeAddress: string): Promise<VaultFaSwapLimitsDTO> {
  const res = await fetch(
    `/api/protocols/yield-ai/vault-fa-swap-limits?safeAddress=${encodeURIComponent(safeAddress)}`
  );
  if (!res.ok) throw new Error(`Failed to fetch vault swap limits: ${res.status}`);
  const json = (await res.json()) as Response;
  if (!json.success || !json.data) {
    throw new Error(json.error || "Unknown error reading vault swap limits");
  }
  return json.data;
}

export function useVaultFaSwapLimits(safeAddress: string | undefined, opts?: { enabled?: boolean }) {
  const enabled = (opts?.enabled ?? true) && Boolean(safeAddress && safeAddress.length >= 10);
  return useQuery({
    queryKey: queryKeys.protocols.yieldAi.vaultFaSwapLimits(safeAddress ?? ""),
    queryFn: () => fetchVaultFaSwapLimits(safeAddress!),
    enabled,
    // Short stale — the daily counter changes whenever the AI agent rebalances.
    staleTime: STALE_TIME.BALANCE,
    refetchOnMount: "always",
  });
}
