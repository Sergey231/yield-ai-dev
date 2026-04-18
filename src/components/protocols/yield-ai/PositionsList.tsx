"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import { ProtocolCard } from "@/shared/ProtocolCard";
import { formatCurrency } from "@/lib/utils/numberFormat";
import {
  useMoarPositions,
  useMoarRewards,
  useMoarPools,
} from "@/lib/query/hooks/protocols/moar";
import { mapMoarPositionsToProtocolPositionsAiAgent } from "./mapMoarToProtocolPositionsAiAgent";
import { queryKeys } from "@/lib/query/queryKeys";
import { useYieldAiSafes, useYieldAiSafeTokens } from "@/lib/query/hooks/protocols/yield-ai";
import { useEchelonProtocolCardModel } from "@/lib/query/hooks/protocols/echelon/useEchelonProtocolCardModel";
import { mapYieldAiSafeTokensToProtocolPositions } from "./mapYieldAiSafeTokensToProtocolPositions";
import { mapEchelonProtocolPositionsToAiAgent } from "./mapEchelonToProtocolPositionsAiAgent";

interface PositionsListProps {
  address?: string;
  onPositionsValueChange?: (value: number) => void;
  refreshKey?: number;
  onPositionsCheckComplete?: () => void;
  showManageButton?: boolean;
}

export function PositionsList({
  address,
  onPositionsValueChange,
  refreshKey,
  onPositionsCheckComplete,
  showManageButton = true,
}: PositionsListProps) {
  const MIN_VISIBLE_USD = 0.0001;
  const { account } = useWallet();
  const queryClient = useQueryClient();
  const walletAddress = address || account?.address?.toString();
  const onValueRef = useRef(onPositionsValueChange);
  const onCompleteRef = useRef(onPositionsCheckComplete);
  onValueRef.current = onPositionsValueChange;
  onCompleteRef.current = onPositionsCheckComplete;

  const { data: safeAddresses = [], isLoading: safesLoading, isFetching: safesFetching } =
    useYieldAiSafes(walletAddress);

  const safeAddress = safeAddresses[0];

  const {
    data: safeTokens = [],
    isLoading: safeTokensLoading,
    isFetching: safeTokensFetching,
  } = useYieldAiSafeTokens(safeAddress, {
    refetchOnMount: refreshKey != null ? "always" : undefined,
    enabled: Boolean(safeAddress),
  });

  const {
    data: moarPositions = [],
    isLoading: moarPositionsLoading,
    isFetching: moarPositionsFetching,
    error: moarPositionsError,
  } = useMoarPositions(safeAddress, {
    refetchOnMount: refreshKey != null ? "always" : undefined,
    enabled: Boolean(safeAddress),
  });
  const {
    data: rewardsResponse,
    isLoading: moarRewardsLoading,
    isFetching: moarRewardsFetching,
  } = useMoarRewards(safeAddress, {
    enabled: Boolean(safeAddress),
  });
  const { data: poolsResponse } = useMoarPools();

  const {
    protocolPositions: echelonProtocolPositions,
    totalValue: echelonTotalValue,
    rewardsValueUsd: echelonRewardsValueUsd,
    isLoading: echelonLoading,
    isFetching: echelonFetching,
  } = useEchelonProtocolCardModel(safeAddress, {
    enabled: Boolean(safeAddress),
    refetchOnMount: refreshKey != null ? "always" : undefined,
  });

  const rewardsTotalUsd = rewardsResponse?.totalUsd ?? 0;

  const aprByPoolId = useMemo(() => {
    if (!poolsResponse?.data) return {} as Record<number, number>;
    const map: Record<number, number> = {};
    (poolsResponse.data as { poolId?: number; totalAPY?: number }[]).forEach((pool) => {
      if (pool.poolId !== undefined) {
        map[pool.poolId] = pool.totalAPY ?? 0;
      }
    });
    return map;
  }, [poolsResponse?.data]);

  const moarProtocolPositions = useMemo(
    () => mapMoarPositionsToProtocolPositionsAiAgent(moarPositions, aprByPoolId),
    [moarPositions, aprByPoolId]
  );

  const tokenProtocolPositions = useMemo(
    () => mapYieldAiSafeTokensToProtocolPositions(safeTokens),
    [safeTokens]
  );

  const echelonAiPositions = useMemo(
    () => mapEchelonProtocolPositionsToAiAgent(echelonProtocolPositions),
    [echelonProtocolPositions]
  );

  const mergedProtocolPositions = useMemo(
    () =>
      [...moarProtocolPositions, ...echelonAiPositions, ...tokenProtocolPositions].sort(
        (a, b) => b.value - a.value
      ),
    [moarProtocolPositions, echelonAiPositions, tokenProtocolPositions]
  );

  const visibleProtocolPositions = useMemo(
    () => mergedProtocolPositions.filter((p) => Number.isFinite(p.value) && p.value >= MIN_VISIBLE_USD),
    [mergedProtocolPositions]
  );

  const positionsValue = useMemo(
    () => moarPositions.reduce((sum, p) => sum + parseFloat(p.value || "0"), 0),
    [moarPositions]
  );
  const tokensValue = useMemo(
    () => safeTokens.reduce((sum, t) => sum + (t.value ? parseFloat(t.value) : 0), 0),
    [safeTokens]
  );

  const combinedRewardsUsd = rewardsTotalUsd + echelonRewardsValueUsd;
  const totalValue = positionsValue + tokensValue + rewardsTotalUsd + echelonTotalValue;

  const totalRewardsUsd =
    combinedRewardsUsd > 0
      ? combinedRewardsUsd < 1
        ? "<$1"
        : formatCurrency(combinedRewardsUsd, 2)
      : undefined;

  const isLoading =
    safesLoading ||
    safeTokensLoading ||
    moarPositionsLoading ||
    moarRewardsLoading ||
    echelonLoading;
  const isFetching =
    safesFetching ||
    safeTokensFetching ||
    moarPositionsFetching ||
    moarRewardsFetching ||
    echelonFetching;
  const hasError = Boolean(moarPositionsError);

  useEffect(() => {
    if (refreshKey != null && walletAddress) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.yieldAi.safes(walletAddress),
      });
    }
  }, [refreshKey, walletAddress, queryClient]);

  useEffect(() => {
    if (refreshKey != null && safeAddress) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.yieldAi.safeTokens(safeAddress),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.moar.userPositions(safeAddress),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.moar.rewards(safeAddress),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.echelon.userPositions(safeAddress),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.echelon.rewards(safeAddress),
      });
    }
  }, [refreshKey, safeAddress, queryClient]);

  useEffect(() => {
    const handleRefresh: EventListener = (evt) => {
      const event = evt as CustomEvent<{ protocol?: string }>;
      if (event?.detail?.protocol === "echelon" && safeAddress) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.protocols.echelon.userPositions(safeAddress),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.protocols.echelon.rewards(safeAddress),
        });
      }
    };
    window.addEventListener("refreshPositions", handleRefresh);
    return () => window.removeEventListener("refreshPositions", handleRefresh);
  }, [safeAddress, queryClient]);

  useEffect(() => {
    if (!isFetching) {
      onCompleteRef.current?.();
    }
  }, [isFetching]);

  useEffect(() => {
    onValueRef.current?.(totalValue);
  }, [totalValue]);

  const protocol = getProtocolByName("AI agent");
  if (!protocol) return null;
  if (hasError) return null;

  // Do not show card when user has no safe
  if (!safeAddress) return null;

  const echelonHasActivity =
    echelonProtocolPositions.length > 0 || echelonRewardsValueUsd > 0;

  // No positions at all
  if (
    !isLoading &&
    moarPositions.length === 0 &&
    safeTokens.length === 0 &&
    rewardsTotalUsd === 0 &&
    !echelonHasActivity
  ) {
    return null;
  }

  // Hide card when everything is dust-level (but allow rewards badge to still show a card).
  if (!isLoading && visibleProtocolPositions.length === 0 && combinedRewardsUsd === 0) {
    return null;
  }

  const showInitialSkeleton =
    isLoading &&
    moarPositions.length === 0 &&
    safeTokens.length === 0 &&
    rewardsTotalUsd === 0 &&
    !echelonHasActivity;

  return (
    <ProtocolCard
      protocol={protocol}
      totalValue={totalValue}
      totalRewardsUsd={totalRewardsUsd}
      positions={visibleProtocolPositions}
      isLoading={showInitialSkeleton}
      showManageButton={showManageButton}
    />
  );
}
