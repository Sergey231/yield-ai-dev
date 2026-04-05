import type { ProtocolPosition } from '@/shared/ProtocolCard/types';
import { PositionBadge } from '@/shared/ProtocolCard/types';
import type { HyperionPosition } from '@/lib/query/hooks/protocols/hyperion';
import type { VaultData } from '@/lib/services/hyperion/vaultCalculator';
import { getVaultTokenMapping } from '@/lib/services/hyperion/vaultTokens';

export function mapHyperionToProtocolPositions(
  positions: HyperionPosition[],
  aprByPoolId: Record<string, number>,
  vaultData: VaultData[]
): ProtocolPosition[] {
  const poolPositions: ProtocolPosition[] = positions.map((position, index) => {
    const poolId = position.position?.pool?.poolId ?? '';
    const token1 = position.position?.pool?.token1Info;
    const token2 = position.position?.pool?.token2Info;

    return {
      id: position.position?.objectId ?? `hyperion-${poolId}-${index}`,
      label: `${token1?.symbol ?? 'Unknown'}/${token2?.symbol ?? 'Unknown'}`,
      value: parseFloat(position.value || '0'),
      logoUrl: token1?.logoUrl,
      logoUrl2: token2?.logoUrl,
      badge: position.isActive ? PositionBadge.Active : PositionBadge.Inactive,
      apr: aprByPoolId[poolId] != null ? aprByPoolId[poolId].toFixed(2) : undefined,
    };
  });

  const vaultPositions: ProtocolPosition[] = vaultData.map((vaultInfo, index) => {
    const mapping = getVaultTokenMapping(vaultInfo.vaultTokenAddress);
    const token1 = mapping?.tokens?.[0];
    const token2 = mapping?.tokens?.[1];
    return {
      id: `hyperion-vault-${vaultInfo.vaultTokenAddress}-${index}`,
      label: `${token1?.symbol ?? 'Vault'}/${token2?.symbol ?? 'Vault'}`,
      value: vaultInfo.totalValueUSD || 0,
      logoUrl: token1?.logoUrl,
      logoUrl2: token2?.logoUrl,
      badge: PositionBadge.Supply,
    };
  });

  return [...poolPositions, ...vaultPositions].sort((a, b) => b.value - a.value);
}
