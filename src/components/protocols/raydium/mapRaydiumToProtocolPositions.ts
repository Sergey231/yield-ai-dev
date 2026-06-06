import { PositionBadge, type ProtocolPosition } from "@/shared/ProtocolCard/types";
import type { RaydiumPosition, RaydiumTokenInfo } from "@/lib/query/hooks/protocols/raydium/useRaydiumPositions";

function finite(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positionTokens(position: RaydiumPosition): [RaydiumTokenInfo | undefined, RaydiumTokenInfo | undefined] {
  if (position.tokenA || position.tokenB) return [position.tokenA, position.tokenB];
  return [position.tokens?.[0], position.tokens?.[1]];
}

export function computeRaydiumTotalUsd(positions: RaydiumPosition[]): number {
  return positions.reduce((sum, p) => sum + finite(p.valueUsd), 0);
}

export function computeRaydiumUnclaimedUsd(positions: RaydiumPosition[]): number {
  return positions.reduce((sum, p) => {
    const explicit = p.unclaimedUsd;
    if (Number.isFinite(explicit)) return sum + finite(explicit);
    return sum + finite(p.feesUsd) + finite(p.rewardsUsd);
  }, 0);
}

export function computeRaydiumPrincipalUsd(position: RaydiumPosition): number {
  if (Number.isFinite(position.principalUsd)) return finite(position.principalUsd);
  const unclaimed = Number.isFinite(position.unclaimedUsd)
    ? finite(position.unclaimedUsd)
    : finite(position.feesUsd) + finite(position.rewardsUsd);
  return Math.max(0, finite(position.valueUsd) - unclaimed);
}

export function isRaydiumPositionActive(position: RaydiumPosition): boolean {
  if (position.type !== "clmm-nft") return true;
  return finite(position.amountA) > 0 && finite(position.amountB) > 0;
}

export function mapRaydiumToProtocolPositions(positions: RaydiumPosition[]): ProtocolPosition[] {
  return positions
    .map((position): ProtocolPosition => {
      const [tokenA, tokenB] = positionTokens(position);
      const principal = computeRaydiumPrincipalUsd(position);
      const unclaimed = Number.isFinite(position.unclaimedUsd)
        ? finite(position.unclaimedUsd)
        : finite(position.feesUsd) + finite(position.rewardsUsd);
      const apr = Number.isFinite(position.apr24h) ? finite(position.apr24h).toFixed(2) : undefined;

      return {
        id: position.id,
        label: position.label,
        value: principal,
        logoUrl: tokenA?.logoUrl,
        logoUrl2: tokenB?.logoUrl,
        badge: position.type === "lp-token"
          ? PositionBadge.Supply
          : isRaydiumPositionActive(position)
            ? PositionBadge.Active
            : PositionBadge.Inactive,
        subLabel: unclaimed > 0 ? `Unclaimed $${unclaimed.toFixed(2)}` : undefined,
        apr,
      };
    })
    .sort((a, b) => b.value - a.value);
}
