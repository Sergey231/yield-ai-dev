import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";

export type JupiterBorrowApiPosition = {
  source: "vault";
  vaultId: number | null;
  nftId: number | null;
  supplyMint: string | null;
  borrowMint: string | null;
  supplyAmount: string;
  borrowAmount: string;
  supplyUsd?: number;
  borrowUsd?: number;
  supplyAprPct?: number;
  borrowAprPct?: number;
  healthFactor?: number;
  liquidationPct?: number;
  supplyToken?: { mint: string; symbol?: string; name?: string; logoUrl?: string; priceUsd?: number };
  borrowToken?: { mint: string; symbol?: string; name?: string; logoUrl?: string; priceUsd?: number };
};

export type JupiterBorrowApiResponse = {
  success: boolean;
  address: string;
  data?: {
    positions?: JupiterBorrowApiPosition[];
  };
};

export function useJupiterBorrow(address?: string, opts?: { enabled?: boolean }) {
  const addr = (address ?? "").trim();
  const enabled = Boolean(opts?.enabled ?? true) && Boolean(addr);

  return useQuery({
    // IMPORTANT: use trimmed address in the key to avoid transient "" keys on reconnect.
    queryKey: queryKeys.protocols.jupiter.borrow(addr),
    enabled,
    queryFn: async (): Promise<JupiterBorrowApiPosition[]> => {
      if (!addr) return [];
      const res = await fetch(`/api/protocols/jupiter/borrow?address=${encodeURIComponent(addr)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const json = (await res.json().catch(() => null)) as JupiterBorrowApiResponse | null;
      if (!res.ok || !json?.success) return [];
      const positions = json?.data?.positions;
      return Array.isArray(positions) ? positions : [];
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    // Prevent UI flicker when reconnect/refresh causes a brief key/enabled change.
    placeholderData: (prev) => prev ?? [],
  });
}

