"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import { ProtocolCard } from "@/shared/ProtocolCard";
import { formatNumber } from "@/lib/utils/numberFormat";
import { queryKeys } from "@/lib/query/queryKeys";
import { useRaydiumPositions } from "@/lib/query/hooks/protocols/raydium/useRaydiumPositions";
import {
  computeRaydiumTotalUsd,
  computeRaydiumUnclaimedUsd,
  mapRaydiumToProtocolPositions,
} from "@/components/protocols/raydium/mapRaydiumToProtocolPositions";

type RaydiumPositionsListProps = {
  address?: string;
  onPositionsValueChange?: (value: number) => void;
  onPositionsCheckComplete?: () => void;
  showManageButton?: boolean;
};

export function PositionsList({
  address,
  onPositionsValueChange,
  onPositionsCheckComplete,
  showManageButton = true,
}: RaydiumPositionsListProps) {
  const protocol = getProtocolByName("Raydium");
  const queryClient = useQueryClient();
  const onValueRef = useRef(onPositionsValueChange);
  onValueRef.current = onPositionsValueChange;
  const onCheckCompleteRef = useRef(onPositionsCheckComplete);
  onCheckCompleteRef.current = onPositionsCheckComplete;
  const hasCompletedCheckRef = useRef<string | null>(null);

  const effectiveAddress = (address ?? "").trim();

  const {
    data: raydiumPositions = [],
    isLoading,
    isFetched,
    isError,
  } = useRaydiumPositions(effectiveAddress, { refetchOnMount: "always" });

  const totalValue = useMemo(() => computeRaydiumTotalUsd(raydiumPositions), [raydiumPositions]);
  const totalUnclaimed = useMemo(() => computeRaydiumUnclaimedUsd(raydiumPositions), [raydiumPositions]);
  const positions = useMemo(() => mapRaydiumToProtocolPositions(raydiumPositions), [raydiumPositions]);

  const totalUnclaimedUsdStr = totalUnclaimed > 0 ? `$${formatNumber(totalUnclaimed, 2)}` : undefined;

  useEffect(() => {
    if (!effectiveAddress) return;
    onValueRef.current?.(totalValue);
  }, [effectiveAddress, totalValue]);

  useEffect(() => {
    if (!effectiveAddress) {
      onCheckCompleteRef.current?.();
      return;
    }
    const ready = isFetched || isError;
    if (!ready) return;
    if (hasCompletedCheckRef.current === effectiveAddress) return;
    hasCompletedCheckRef.current = effectiveAddress;
    onCheckCompleteRef.current?.();
  }, [effectiveAddress, isFetched, isError]);

  useEffect(() => {
    if (!effectiveAddress) return;
    const handler: EventListener = (evt) => {
      const event = evt as CustomEvent<{ protocol?: string }>;
      if (event?.detail?.protocol !== "raydium") return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.raydium.userPositions(effectiveAddress),
      });
    };
    window.addEventListener("refreshPositions", handler);
    return () => window.removeEventListener("refreshPositions", handler);
  }, [effectiveAddress, queryClient]);

  if (!protocol || !effectiveAddress) return null;
  const hasAny = positions.length > 0 || totalValue > 0;
  if (isLoading && !hasAny) return null;
  if (!isLoading && (isError || positions.length === 0)) return null;

  return (
    <ProtocolCard
      protocol={protocol}
      totalValue={totalValue}
      totalRewardsUsd={totalUnclaimedUsdStr}
      rewardsLabel="Total unclaimed:"
      positions={positions}
      isLoading={isLoading && !hasAny}
      showManageButton={showManageButton}
    />
  );
}
