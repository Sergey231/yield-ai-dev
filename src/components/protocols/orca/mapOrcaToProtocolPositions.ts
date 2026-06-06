import { PositionBadge, type ProtocolPosition } from "@/shared/ProtocolCard/types";
import type { OrcaPosition } from "@/lib/query/hooks/protocols/orca/useOrcaPositions";

function finite(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function computeOrcaTotalUsd(positions: OrcaPosition[]): number {
  return positions.reduce((sum, position) => sum + finite(position.valueUsd), 0);
}

export function computeOrcaFeesUsd(positions: OrcaPosition[]): number {
  return positions.reduce((sum, position) => {
    if (Number.isFinite(position.unclaimedUsd)) return sum + finite(position.unclaimedUsd);
    return sum + finite(position.feesUsd);
  }, 0);
}

export function computeOrcaPrincipalUsd(position: OrcaPosition): number {
  if (Number.isFinite(position.principalUsd)) return finite(position.principalUsd);
  const fees = Number.isFinite(position.unclaimedUsd) ? finite(position.unclaimedUsd) : finite(position.feesUsd);
  return Math.max(0, finite(position.valueUsd) - fees);
}

export function mapOrcaToProtocolPositions(positions: OrcaPosition[]): ProtocolPosition[] {
  return positions
    .map((position): ProtocolPosition => {
      const fees = Number.isFinite(position.unclaimedUsd)
        ? finite(position.unclaimedUsd)
        : finite(position.feesUsd);
      const feeRatePct = finite(position.feeRate) * 100;

      return {
        id: position.id,
        label: position.label,
        value: computeOrcaPrincipalUsd(position),
        logoUrl: position.tokenA?.logoUrl,
        logoUrl2: position.tokenB?.logoUrl,
        badge: position.inRange ? PositionBadge.Active : PositionBadge.Inactive,
        subLabel: fees > 0 ? `Yield $${fees.toFixed(2)}` : undefined,
        apr: feeRatePct > 0 ? `${feeRatePct.toFixed(2)}% fee` : undefined,
      };
    })
    .sort((a, b) => b.value - a.value);
}
