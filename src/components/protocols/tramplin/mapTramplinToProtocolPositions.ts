import { PositionBadge, type ProtocolPosition } from "@/shared/ProtocolCard/types";
import { formatNumber } from "@/lib/utils/numberFormat";
import type { TramplinPositionData } from "@/lib/query/hooks/protocols/tramplin/useTramplinPositions";
import type { TramplinRewardRow } from "@/lib/query/hooks/protocols/tramplin/useTramplinRewards";

export function computeTramplinPositionsUsd(data: TramplinPositionData | null | undefined): number {
  if (!data || !data.hasPosition) return 0;
  return typeof data.stakeUsd === "number" && Number.isFinite(data.stakeUsd) ? data.stakeUsd : 0;
}

export function computeTramplinRewardsUsd(rewards: TramplinRewardRow[]): number {
  return rewards.reduce((sum, rw) => {
    const v = typeof rw.usdValue === "number" && Number.isFinite(rw.usdValue) ? rw.usdValue : 0;
    return sum + v;
  }, 0);
}

export function mapTramplinToProtocolPositions(
  data: TramplinPositionData | null | undefined
): ProtocolPosition[] {
  if (!data || !data.hasPosition || !(data.stakeSol > 0)) return [];

  const value =
    typeof data.stakeUsd === "number" && Number.isFinite(data.stakeUsd) ? data.stakeUsd : 0;
  const price =
    typeof data.solPriceUsd === "number" && Number.isFinite(data.solPriceUsd) && data.solPriceUsd > 0
      ? data.solPriceUsd
      : undefined;

  return [
    {
      id: "tramplin-stake-sol",
      label: "SOL",
      value,
      logoUrl: "/token_ico/sol.png",
      badge: PositionBadge.Supply,
      price,
      subLabel: formatNumber(data.stakeSol, 4),
      apr: data.aprPct > 0 ? data.aprPct.toFixed(2) : undefined,
    },
  ];
}
