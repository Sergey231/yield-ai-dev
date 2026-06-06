"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import { ProtocolCard } from "@/shared/ProtocolCard";
import { formatNumber } from "@/lib/utils/numberFormat";
import { queryKeys } from "@/lib/query/queryKeys";
import { useOrcaPositions } from "@/lib/query/hooks/protocols/orca/useOrcaPositions";
import {
  computeOrcaFeesUsd,
  computeOrcaTotalUsd,
  mapOrcaToProtocolPositions,
} from "@/components/protocols/orca/mapOrcaToProtocolPositions";

type OrcaPositionsListProps = {
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
}: OrcaPositionsListProps) {
  const protocol = getProtocolByName("Orca");
  const queryClient = useQueryClient();
  const onValueRef = useRef(onPositionsValueChange);
  onValueRef.current = onPositionsValueChange;
  const onCheckCompleteRef = useRef(onPositionsCheckComplete);
  onCheckCompleteRef.current = onPositionsCheckComplete;
  const hasCompletedCheckRef = useRef<string | null>(null);

  const effectiveAddress = (address ?? "").trim();

  const {
    data: orcaPositions = [],
    isLoading,
    isFetched,
    isError,
  } = useOrcaPositions(effectiveAddress, { refetchOnMount: "always" });

  const totalValue = useMemo(() => computeOrcaTotalUsd(orcaPositions), [orcaPositions]);
  const totalFees = useMemo(() => computeOrcaFeesUsd(orcaPositions), [orcaPositions]);
  const positions = useMemo(() => mapOrcaToProtocolPositions(orcaPositions), [orcaPositions]);

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
      if (event?.detail?.protocol !== "orca") return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.orca.userPositions(effectiveAddress),
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
      rewardsLabel="Total yield:"
      positions={positions}
      isLoading={isLoading && !hasAny}
      showManageButton={showManageButton}
    />
  );
}
