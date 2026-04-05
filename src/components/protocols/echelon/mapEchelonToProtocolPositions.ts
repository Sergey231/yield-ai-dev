import type { ProtocolPosition } from '@/shared/ProtocolCard/types';
import { PositionBadge } from '@/shared/ProtocolCard/types';

export interface EchelonMappedInput {
  id: string;
  label: string;
  value: number;
  logoUrl?: string;
  amountLabel: string;
  price?: number;
  apr?: string;
  type: 'supply' | 'borrow';
}

export function mapEchelonToProtocolPositions(
  positions: EchelonMappedInput[]
): ProtocolPosition[] {
  return positions
    .map((position) => ({
      id: position.id,
      label: position.label,
      value: position.value,
      logoUrl: position.logoUrl,
      badge:
        position.type === 'borrow' ? PositionBadge.Borrow : PositionBadge.Supply,
      subLabel: position.amountLabel,
      price: position.price,
      apr: position.apr,
    }))
    .sort((a, b) => b.value - a.value);
}

