"use client";

import { useEffect, useMemo, useRef } from "react";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import { ProtocolCard } from "@/shared/ProtocolCard";
import { formatNumber } from "@/lib/utils/numberFormat";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { useMeteoraPositions } from "@/lib/query/hooks/protocols/meteora/useMeteoraPositions";
import {
  computeMeteoraFeesUsd,
  computeMeteoraTotalUsd,
  mapMeteoraToProtocolPositions,
} from "@/components/protocols/meteora/mapMeteoraToProtocolPositions";

type MeteoraPositionsListProps = {
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
}: MeteoraPositionsListProps) {
  const protocol = getProtocolByName("Meteora");
  const queryClient = useQueryClient();
  const onValueRef = useRef(onPositionsValueChange);
  onValueRef.current = onPositionsValueChange;
  const onCheckCompleteRef = useRef(onPositionsCheckComplete);
  onCheckCompleteRef.current = onPositionsCheckComplete;
  const hasCompletedCheckRef = useRef<string | null>(null);

  const effectiveAddress = (address ?? "").trim();

  const {
    data: pools = [],
    isLoading,
    isFetched,
    isError,
  } = useMeteoraPositions(effectiveAddress, { refetchOnMount: "always" });

  const totalValue = useMemo(() => computeMeteoraTotalUsd(pools), [pools]);
  const totalFees = useMemo(() => computeMeteoraFeesUsd(pools), [pools]);
  const positions = useMemo(() => mapMeteoraToProtocolPositions(pools), [pools]);

  const totalFeesUsdStr = totalFees > 0 ? `$${formatNumber(totalFees, 2)}` : undefined;

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
      if (event?.detail?.protocol !== "meteora") return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.meteora.userPositions(effectiveAddress),
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
      totalRewardsUsd={totalFeesUsdStr}
      rewardsLabel="💰 Total fees:"
      positions={positions}
      isLoading={isLoading && !hasAny}
      showManageButton={showManageButton}
    />
  );
}
