import type { ProtocolPosition } from '@/shared/ProtocolCard/types';
import { PositionBadge } from '@/shared/ProtocolCard/types';
import type { ThalaPosition } from '@/lib/query/hooks/protocols/thala';

function formatApr(apr?: number): string | undefined {
  if (typeof apr !== 'number' || apr <= 0) return undefined;
  return apr.toFixed(2);
}

export function mapThalaPositionToProtocolPosition(
  position: ThalaPosition
): ProtocolPosition {
  return {
    id: `thala-${position.positionId}`,
    label: `${position.token0.symbol}/${position.token1.symbol}`,
    value: position.positionValueUSD || 0,
    logoUrl: position.token0.logoUrl ?? undefined,
    logoUrl2: position.token1.logoUrl ?? undefined,
    badge: position.inRange ? PositionBadge.Active : PositionBadge.Inactive,
    apr: formatApr(position.apr),
  };
}

export function mapThalaPositionsToProtocolPositions(
  positions: ThalaPosition[]
): ProtocolPosition[] {
  return positions
    .map(mapThalaPositionToProtocolPosition)
    .sort((a, b) => b.value - a.value);
}
