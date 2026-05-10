"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";

type HasTxResponse =
  | { success: true; address: string; hasTransactions: boolean }
  | { success: false; error: string; address?: string; hasTransactions?: boolean };

export function useAptosHasTransactions(address?: string, opts?: { enabled?: boolean }) {
  const enabled = Boolean(opts?.enabled ?? true) && Boolean(address);

  return useQuery({
    queryKey: queryKeys.aptos.hasTransactions(address ?? ""),
    enabled,
    queryFn: async () => {
      const addr = (address ?? "").trim();
      if (!addr) return { hasTransactions: false };
      const res = await fetch(`/api/aptos/has-transactions?address=${encodeURIComponent(addr)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const json = (await res.json().catch(() => null)) as HasTxResponse | null;
      if (!res.ok || !json || json.success !== true) return { hasTransactions: false };
      return { hasTransactions: Boolean(json.hasTransactions) };
    },
    staleTime: 60 * 60 * 1000,
    gcTime: 6 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

