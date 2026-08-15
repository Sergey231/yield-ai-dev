import type { KaminoRewardRow } from "@/lib/kamino/kaminoClaimTypes";
import { formatCurrency } from "@/lib/utils/numberFormat";

/** USD below this is treated as zero for Kamino rewards visibility / claim UI. */
export const KAMINO_MIN_VISIBLE_REWARD_USD = 0.0000001;

export function isMeaningfulKaminoRewardUsd(usd: number | undefined | null): boolean {
  return typeof usd === "number" && Number.isFinite(usd) && usd >= KAMINO_MIN_VISIBLE_REWARD_USD;
}

/** Display Kamino reward USD: "<$0.01" for dust, "$0.00" when truly zero, else 2-decimal currency. */
export function formatKaminoRewardUsd(usd: number | undefined | null): string {
  const v = typeof usd === "number" && Number.isFinite(usd) ? usd : 0;
  if (!isMeaningfulKaminoRewardUsd(v)) {
    return "$0.00";
  }
  if (v < 0.01) {
    return "<$0.01";
  }
  return formatCurrency(v, 2);
}

export function computeKaminoRewardsUsd(rewards: KaminoRewardRow[]): number {
  return rewards.reduce((sum, rw) => {
    const v = typeof rw.usdValue === "number" && Number.isFinite(rw.usdValue) ? rw.usdValue : 0;
    return sum + v;
  }, 0);
}

export function hasVisibleKaminoRewards(rewards: KaminoRewardRow[]): boolean {
  return isMeaningfulKaminoRewardUsd(computeKaminoRewardsUsd(rewards));
}

export function filterMeaningfulKaminoRewardRows(rewards: KaminoRewardRow[]): KaminoRewardRow[] {
  return rewards.filter((rw) => isMeaningfulKaminoRewardUsd(rw.usdValue));
}
