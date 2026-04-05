import type { ProtocolPosition } from '@/shared/ProtocolCard/types';
import { PositionBadge } from '@/shared/ProtocolCard/types';
import { formatNumber } from '@/lib/utils/numberFormat';
import type { EchoPosition } from '@/lib/query/hooks/protocols/echo';

function trimTrailingZeros(value: string): string {
  if (!value.includes('.')) return value;
  const trimmed = value.replace(/\.?0+$/, '');
  return trimmed === '' ? '0' : trimmed;
}

function formatApr(apr?: number): string | undefined {
  if (typeof apr !== 'number' || apr <= 0) return undefined;
  return apr.toFixed(2);
}

export function mapEchoPositionsToProtocolPositions(
  positions: EchoPosition[]
): ProtocolPosition[] {
  return positions
    .map((position) => ({
      id: `echo-${position.type ?? 'supply'}-${position.positionId}`,
      label: position.symbol || '—',
      value: Number(position.valueUSD || 0),
      logoUrl: position.logoUrl ?? undefined,
      badge:
        position.type === 'borrow' ? PositionBadge.Borrow : PositionBadge.Supply,
      subLabel: trimTrailingZeros(formatNumber(Number(position.amount || 0), 4)),
      price:
        Number(position.priceUSD || 0) > 0 ? Number(position.priceUSD) : undefined,
      apr: formatApr(position.apy),
    }))
    .sort((a, b) => b.value - a.value);
}

