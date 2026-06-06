"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import { ProtocolCard } from "@/shared/ProtocolCard";
import { formatNumber } from "@/lib/utils/numberFormat";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { useTramplinPositions } from "@/lib/query/hooks/protocols/tramplin/useTramplinPositions";
import { useTramplinRewards } from "@/lib/query/hooks/protocols/tramplin/useTramplinRewards";
import { Loader2 } from "lucide-react";
import {
  computeTramplinPositionsUsd,
  computeTramplinRewardsUsd,
  mapTramplinToProtocolPositions,
} from "@/components/protocols/tramplin/mapTramplinToProtocolPositions";
import { usePortfolioAmountsPrivacy } from "@/contexts/PortfolioAmountsPrivacyContext";

type TramplinPositionsListProps = {
  address?: string;
  onPositionsValueChange?: (value: number) => void;
  showManageButton?: boolean;
  onPositionsCheckComplete?: () => void;
};

export function PositionsList({
  address,
  onPositionsValueChange,
  showManageButton = true,
  onPositionsCheckComplete,
}: TramplinPositionsListProps) {
  const { maskUsd, maskBalance } = usePortfolioAmountsPrivacy();
  const protocol = getProtocolByName("Tramplin");
  const queryClient = useQueryClient();
  const onValueRef = useRef(onPositionsValueChange);
  onValueRef.current = onPositionsValueChange;
  const onCheckCompleteRef = useRef(onPositionsCheckComplete);
  onCheckCompleteRef.current = onPositionsCheckComplete;
  const hasCompletedCheckRef = useRef<string | null>(null);

  const effectiveAddress = (address ?? "").trim();

  const {
    data: positionData = null,
    isLoading: isPositionsLoading,
    isError: isPositionsError,
    isFetched: isPositionsFetched,
    isFetching: isPositionsFetching,
  } = useTramplinPositions(effectiveAddress);
  const {
    data: rewards = [],
    isLoading: isRewardsLoading,
    isError: isRewardsError,
    isFetched: isRewardsFetched,
    isFetching: isRewardsFetching,
  } = useTramplinRewards(effectiveAddress);

  const positionsNetUsd = useMemo(() => computeTramplinPositionsUsd(positionData), [positionData]);
  const calculateRewardsValue = useMemo(() => computeTramplinRewardsUsd(rewards), [rewards]);
  const positions = useMemo(() => mapTramplinToProtocolPositions(positionData), [positionData]);

  // Total assets for Tramplin = staked SOL + unclaimed prize winnings (also SOL).
  // The unclaimed winnings are real on-chain value the user can convert to liquid
  // SOL with a click — we include them in the protocol total and in the sidebar
  // "Assets" sum that derives from `onPositionsValueChange`.
  const headerTotalValue = positionsNetUsd + calculateRewardsValue;

  const totalRewardsUsdStr =
    calculateRewardsValue > 0 ? `$${formatNumber(calculateRewardsValue, 2)}` : undefined;

  const rewardsBreakdown =
    rewards.length > 0 ? (
      <>
        <div className="text-xs font-semibold mb-1">Unclaimed winnings:</div>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {rewards.map((reward, idx) => {
            const amountNum = Number(reward.amount);
            const value =
              typeof reward.usdValue === "number" && Number.isFinite(reward.usdValue)
                ? formatNumber(reward.usdValue, 2)
                : "N/A";
            return (
              <div key={idx} className="flex items-center gap-2">
                {reward.tokenLogoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={reward.tokenLogoUrl} alt={reward.tokenSymbol} className="w-3 h-3 rounded-full" />
                )}
                <span>{reward.tokenSymbol}</span>
                <span>
                  {Number.isFinite(amountNum)
                    ? maskBalance(formatNumber(amountNum, 6))
                    : maskBalance(String(reward.amount))}
                </span>
                <span className="text-gray-300">{value === "N/A" ? "N/A" : maskUsd(`$${value}`)}</span>
                {reward.winCount > 0 ? (
                  <span className="text-gray-400 text-[10px]">({reward.winCount} wins)</span>
                ) : null}
              </div>
            );
          })}
        </div>
      </>
    ) : undefined;

  useEffect(() => {
    if (!effectiveAddress) return;
    onValueRef.current?.(headerTotalValue);
  }, [effectiveAddress, headerTotalValue]);

  useEffect(() => {
    if (!effectiveAddress) return;
    const handleRefresh: EventListener = (evt) => {
      const event = evt as CustomEvent<{ protocol?: string }>;
      if (event?.detail?.protocol !== "tramplin") return;
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.tramplin.userPositions(effectiveAddress) });
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.tramplin.rewards(effectiveAddress) });
    };
    window.addEventListener("refreshPositions", handleRefresh);
    return () => window.removeEventListener("refreshPositions", handleRefresh);
  }, [effectiveAddress, queryClient]);

  useEffect(() => {
    if (!effectiveAddress) {
      onCheckCompleteRef.current?.();
      return;
    }
    const ready = (isPositionsFetched || isPositionsError) && (isRewardsFetched || isRewardsError);
    if (!ready) return;
    if (hasCompletedCheckRef.current === effectiveAddress) return;
    hasCompletedCheckRef.current = effectiveAddress;
    onCheckCompleteRef.current?.();
  }, [effectiveAddress, isPositionsFetched, isRewardsFetched, isPositionsError, isRewardsError]);

  useEffect(() => {
    if (!effectiveAddress) return;
    const isSettled = isPositionsFetched && isRewardsFetched && !isPositionsFetching && !isRewardsFetching;
    if (isSettled) return;
    const t = window.setTimeout(() => {
      onCheckCompleteRef.current?.();
    }, 30_000);
    return () => window.clearTimeout(t);
  }, [effectiveAddress, isPositionsFetched, isRewardsFetched, isPositionsFetching, isRewardsFetching]);

  const cacheKey = useMemo(() => `proto_has_positions:tramplin`, []);
  const [lastKnownHasPositions, setLastKnownHasPositions] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setLastKnownHasPositions(window.localStorage.getItem(cacheKey) === "1");
    } catch {
      // ignore
    }
  }, [cacheKey]);

  useEffect(() => {
    if (!effectiveAddress) return;
    if (!isPositionsFetched || !isRewardsFetched || isPositionsFetching || isRewardsFetching) return;
    const hasPositions = positions.length > 0 || calculateRewardsValue > 0;
    setLastKnownHasPositions(hasPositions);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(cacheKey, hasPositions ? "1" : "0");
    } catch {
      // ignore
    }
  }, [
    cacheKey,
    effectiveAddress,
    isPositionsFetched,
    isRewardsFetched,
    isPositionsFetching,
    isRewardsFetching,
    positions.length,
    calculateRewardsValue,
  ]);

  const isFetching = isPositionsFetching || isRewardsFetching;
  const isInitialLoading = isPositionsLoading || isRewardsLoading;
  const hasAnyData = positions.length > 0 || calculateRewardsValue > 0;
  const isLoading = isInitialLoading || (isFetching && !hasAnyData);
  const isError = isPositionsError || isRewardsError;

  if (!protocol || !effectiveAddress) return null;
  if (isLoading && !hasAnyData && !lastKnownHasPositions) return null;
  if (!isLoading && (isError || (positions.length === 0 && calculateRewardsValue <= 0))) return null;

  return (
    <ProtocolCard
      protocol={protocol}
      totalValue={headerTotalValue}
      totalRewardsUsd={totalRewardsUsdStr}
      rewardsBreakdown={rewardsBreakdown}
      rewardsEchelonStyle={Boolean(rewardsBreakdown)}
      positions={positions}
      isLoading={isLoading}
      showManageButton={showManageButton}
      belowRewardsContent={
        isFetching && hasAnyData ? (
          <div className="flex items-center gap-2 px-2 pt-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Updating Tramplin…</span>
          </div>
        ) : null
      }
    />
  );
}
