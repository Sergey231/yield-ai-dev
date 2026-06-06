import { PositionBadge, type ProtocolPosition } from "@/shared/ProtocolCard/types";
import type { MeteoraPool } from "@/lib/query/hooks/protocols/meteora/useMeteoraPositions";

export function computeMeteoraTotalUsd(pools: MeteoraPool[]): number {
  return pools.reduce((sum, p) => sum + (Number.isFinite(p.totalUsd) ? p.totalUsd : 0), 0);
}

export function computeMeteoraFeesUsd(pools: MeteoraPool[]): number {
  let s = 0;
  for (const pool of pools) {
    for (const pos of pool.positions) {
      if (Number.isFinite(pos.feesUsd)) s += pos.feesUsd;
    }
  }
  return s;
}

export function mapMeteoraToProtocolPositions(pools: MeteoraPool[]): ProtocolPosition[] {
  const out: ProtocolPosition[] = [];

  for (const pool of pools) {
    const { tokenX, tokenY, positions } = pool;
    const label = `${tokenX.symbol}/${tokenY.symbol}`;

    for (let i = 0; i < positions.length; i += 1) {
      const pos = positions[i];
      // Row value is just the deposit, like Hyperion. Fees are shown separately
      // via the "Total fees" row (totalRewardsUsd) so they aren't double-counted
      // visually in the sidebar — header total still includes both.
      const value = Number.isFinite(pos.valueUsd) ? pos.valueUsd : 0;

      // Pool-level APR from Meteora datapi (same number their UI shows).
      // Only attach when the position is in-range; out-of-range positions
      // don't earn, so an APR badge there would be misleading.
      const apr =
        pos.inRange && pool.meta && pool.meta.totalApyPct > 0
          ? pool.meta.totalApyPct.toFixed(2)
          : undefined;

      out.push({
        id: `meteora-${pool.poolAddress}-${pos.positionAddress || i}`,
        label,
        value,
        logoUrl: tokenX.logoUrl,
        logoUrl2: tokenY.logoUrl,
        badge: pos.inRange ? PositionBadge.Active : PositionBadge.Inactive,
        apr,
      });
    }
  }

  return out.sort((a, b) => b.value - a.value);
}
