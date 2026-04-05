"use client";

import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import { ProtocolCard } from "@/shared/ProtocolCard";
import { formatNumber } from "@/lib/utils/numberFormat";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { useKaminoPositions } from "@/lib/query/hooks/protocols/kamino/useKaminoPositions";
import { useKaminoRewards } from "@/lib/query/hooks/protocols/kamino/useKaminoRewards";
import { getPreferredJupiterTokenIcon } from "@/lib/services/solana/jupiterTokenIcons";
import { isLikelySolanaAddress } from "@/lib/kamino/kvaultVaultAddress";
import {
  computeKaminoPositionsUsd,
  computeKaminoRewardsUsd,
  mapKaminoToProtocolPositions,
} from "@/components/protocols/kamino/mapKaminoToProtocolPositions";
import { usePortfolioAmountsPrivacy } from "@/contexts/PortfolioAmountsPrivacyContext";

type KaminoPositionsListProps = {
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
}: KaminoPositionsListProps) {
  const { maskUsd, maskBalance } = usePortfolioAmountsPrivacy();
  const protocol = getProtocolByName("Kamino");
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const onValueRef = useRef(onPositionsValueChange);
  onValueRef.current = onPositionsValueChange;
  const onCheckCompleteRef = useRef(onPositionsCheckComplete);
  onCheckCompleteRef.current = onPositionsCheckComplete;

  const rewardsMockEnabled =
    process.env.NEXT_PUBLIC_KAMINO_REWARDS_MOCK === "1" ||
    process.env.NEXT_PUBLIC_KAMINO_REWARDS_MOCK === "true";

  const effectiveAddress = useMemo(() => {
    const base = (address ?? "").trim();
    if (!rewardsMockEnabled) return base;
    const raw =
      (searchParams?.get("kaminoAddress") || searchParams?.get("address") || "").trim();
    if (raw && isLikelySolanaAddress(raw)) return raw;
    return base;
  }, [address, rewardsMockEnabled, searchParams]);

  const {
    data: rows = [],
    isLoading: isPositionsLoading,
    isError: isPositionsError,
    isFetched: isPositionsFetched,
    isFetching: isPositionsFetching,
  } = useKaminoPositions(effectiveAddress);
  const {
    data: rewards = [],
    isLoading: isRewardsLoading,
    isError: isRewardsError,
    isFetched: isRewardsFetched,
    isFetching: isRewardsFetching,
  } = useKaminoRewards(effectiveAddress);

  const positionsNetUsd = useMemo(() => computeKaminoPositionsUsd(rows), [rows]);
  const calculateRewardsValue = useMemo(() => computeKaminoRewardsUsd(rewards), [rewards]);
  const positions = useMemo(() => mapKaminoToProtocolPositions(rows), [rows]);

  /** Header + sort: net positions only (same as "Total assets in Kamino" in manage positions). Rewards stay in the expanded row. */
  const headerTotalValue = positionsNetUsd;

  const totalRewardsUsdStr =
    calculateRewardsValue > 0 ? `$${formatNumber(calculateRewardsValue, 2)}` : undefined;

  const rewardsBreakdown =
    calculateRewardsValue > 0 ? (
      <>
        <div className="text-xs font-semibold mb-1">Rewards breakdown:</div>
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {rewards.map((reward, idx) => {
            const tokenInfo = (() => {
              const mint = (reward.tokenMint || "").trim();
              if (!mint) return null;
              const symbol =
                (reward.tokenSymbol || "").trim() || `${mint.slice(0, 4)}...${mint.slice(-4)}`;
              const icon_uri =
                (reward.tokenLogoUrl || "").trim() ||
                getPreferredJupiterTokenIcon(reward.tokenSymbol, reward.tokenLogoUrl) ||
                "";
              return { symbol, icon_uri };
            })();
            if (!tokenInfo) return null;
            const amountNum = Number(reward.amount);
            const rewardAmount = Number.isFinite(amountNum) ? amountNum : 0;
            const price =
              typeof reward.usdValue === "number" &&
              Number.isFinite(reward.usdValue) &&
              reward.usdValue > 0 &&
              rewardAmount > 0
                ? String(reward.usdValue / rewardAmount)
                : "0";
            const value =
              price && price !== "0" ? formatNumber(rewardAmount * parseFloat(price), 2) : "N/A";
            return (
              <div key={idx} className="flex items-center gap-2">
                {tokenInfo.icon_uri && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tokenInfo.icon_uri} alt={tokenInfo.symbol} className="w-3 h-3 rounded-full" />
                )}
                <span>{tokenInfo.symbol}</span>
                <span>
                  {Number.isFinite(amountNum)
                    ? maskBalance(formatNumber(amountNum, 6))
                    : maskBalance(String(reward.amount))}
                </span>
                <span className="text-gray-300">
                  {value === "N/A" ? "N/A" : maskUsd(`$${value}`)}
                </span>
              </div>
            );
          })}
        </div>
      </>
    ) : undefined;

  useEffect(() => {
    onValueRef.current?.(effectiveAddress ? headerTotalValue : 0);
  }, [effectiveAddress, headerTotalValue]);

  useEffect(() => {
    if (!effectiveAddress) return;
    const handleRefresh: EventListener = (evt) => {
      const event = evt as CustomEvent<{ protocol?: string }>;
      if (event?.detail?.protocol !== "kamino") return;
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.kamino.userPositions(effectiveAddress) });
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.kamino.rewards(effectiveAddress) });
    };
    window.addEventListener("refreshPositions", handleRefresh);
    return () => window.removeEventListener("refreshPositions", handleRefresh);
  }, [effectiveAddress, queryClient, rewardsMockEnabled]);

  useEffect(() => {
    if (!effectiveAddress) {
      // No fetch runs; clear sidebar "checking" so Kamino does not spin forever on race / gated address.
      onCheckCompleteRef.current?.();
      return;
    }
    // "Fetched" can be true from cache while a refetch is still in progress.
    // We only want to mark the protocol as checked once queries are settled.
    if (isPositionsFetched && isRewardsFetched && !isPositionsFetching && !isRewardsFetching) {
      onCheckCompleteRef.current?.();
    }
  }, [effectiveAddress, isPositionsFetched, isRewardsFetched, isPositionsFetching, isRewardsFetching]);

  // Avoid showing an "empty" card when cached data is empty but a refetch is still in progress.
  const isFetching = isPositionsFetching || isRewardsFetching;
  const isInitialLoading = isPositionsLoading || isRewardsLoading;
  const hasAnyData = positions.length > 0 || calculateRewardsValue > 0;
  const isLoading = isInitialLoading || (isFetching && !hasAnyData);
  const isError = isPositionsError || isRewardsError;

  if (!protocol || !effectiveAddress) return null;
  if (!isLoading && (isError || (positions.length === 0 && calculateRewardsValue <= 0))) return null;

  return (
    <ProtocolCard
      protocol={protocol}
      totalValue={headerTotalValue}
      totalRewardsUsd={totalRewardsUsdStr}
      rewardsBreakdown={rewardsBreakdown}
      rewardsEchelonStyle={Boolean(totalRewardsUsdStr)}
      positions={positions}
      isLoading={isLoading}
      showManageButton={showManageButton}
    />
  );
}

