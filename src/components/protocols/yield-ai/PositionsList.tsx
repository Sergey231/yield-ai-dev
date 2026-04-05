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
import { mapYieldAiSafeTokensToProtocolPositions } from "./mapYieldAiSafeTokensToProtocolPositions";

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

  const positionsValue = useMemo(
    () => moarPositions.reduce((sum, p) => sum + parseFloat(p.value || "0"), 0),
    [moarPositions]
  );
  const tokensValue = useMemo(
    () => safeTokens.reduce((sum, t) => sum + (t.value ? parseFloat(t.value) : 0), 0),
    [safeTokens]
  );

  const totalValue = positionsValue + tokensValue + rewardsTotalUsd;

  const totalRewardsUsd =
    rewardsTotalUsd > 0
      ? rewardsTotalUsd < 1
        ? "<$1"
        : formatCurrency(rewardsTotalUsd, 2)
      : undefined;

  const isLoading = safesLoading || safeTokensLoading || moarPositionsLoading || moarRewardsLoading;
  const isFetching = safesFetching || safeTokensFetching || moarPositionsFetching || moarRewardsFetching;
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
    }
  }, [refreshKey, safeAddress, queryClient]);

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

  // No positions at all
  if (!isLoading && moarPositions.length === 0 && safeTokens.length === 0 && rewardsTotalUsd === 0) {
    return null;
  }

  return (
    <ProtocolCard
      protocol={protocol}
      totalValue={totalValue}
      totalRewardsUsd={totalRewardsUsd}
      positions={[...moarProtocolPositions, ...tokenProtocolPositions]}
      isLoading={isLoading && moarPositions.length === 0 && safeTokens.length === 0 && rewardsTotalUsd === 0}
      showManageButton={showManageButton}
    />
  );
}
