'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';
import { VaultCalculator, type VaultData } from '@/lib/services/hyperion/vaultCalculator';

async function fetchHyperionVaultData(
  address: string,
  vaultTokenAddresses: string[]
): Promise<VaultData[]> {
  if (vaultTokenAddresses.length === 0) return [];
  const calculator = new VaultCalculator();
  return calculator.getAllVaultData(vaultTokenAddresses, address);
}

export function useHyperionVaultData(
  address: string | undefined,
  vaultTokenAddresses: string[],
  options?: { enabled?: boolean; refetchOnMount?: boolean | 'always' }
) {
  const enabled =
    (options?.enabled ?? true) &&
    Boolean(address && address.length >= 10) &&
    vaultTokenAddresses.length > 0;

  return useQuery({
    queryKey: [
      ...queryKeys.protocols.hyperion.vaultData(address ?? ''),
      vaultTokenAddresses.slice().sort().join(','),
    ] as const,
    queryFn: () => fetchHyperionVaultData(address!, vaultTokenAddresses),
    staleTime: STALE_TIME.POSITIONS,
    enabled,
    refetchOnMount: options?.refetchOnMount,
  });
}
