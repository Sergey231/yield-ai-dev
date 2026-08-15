'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';

interface EchelonAccountEmodeResponse {
  success: boolean;
  data: { emodeId: number };
}

async function fetchEchelonAccountEmode(address: string): Promise<number> {
  const response = await fetch(`/api/protocols/echelon/account-emode?address=${encodeURIComponent(address)}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch Echelon account emode: ${response.status}`);
  }
  const json: EchelonAccountEmodeResponse = await response.json();
  if (!json.success) {
    throw new Error('Failed to fetch Echelon account emode');
  }
  return json.data.emodeId;
}

/** Active Echelon efficiency mode id for an account (0 = normal, 2 = stable, ...). */
export function useEchelonAccountEmode(address: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.protocols.echelon.accountEmode(address ?? ''),
    queryFn: () => fetchEchelonAccountEmode(address!),
    staleTime: STALE_TIME.POOLS,
    enabled: (options?.enabled ?? true) && Boolean(address && address.length >= 10),
  });
}
