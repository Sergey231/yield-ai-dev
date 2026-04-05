"use client";

import { useEffect, useMemo, useRef } from "react";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import { ProtocolCard } from "@/shared/ProtocolCard";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { useJupiterPositions } from "@/lib/query/hooks/protocols/jupiter/useJupiterPositions";
import { computeJupiterTotalValue, mapJupiterToProtocolPositions } from "@/components/protocols/jupiter/mapJupiterToProtocolPositions";

interface PositionsListProps {
  address?: string;
  onPositionsValueChange?: (value: number) => void;
  showManageButton?: boolean;
  onPositionsCheckComplete?: () => void;
}

export function PositionsList({
  address,
  onPositionsValueChange,
  showManageButton = true,
  onPositionsCheckComplete,
}: PositionsListProps) {
  const protocol = getProtocolByName("Jupiter");
  const queryClient = useQueryClient();
  const onValueRef = useRef(onPositionsValueChange);
  onValueRef.current = onPositionsValueChange;
  const onCheckCompleteRef = useRef(onPositionsCheckComplete);
  onCheckCompleteRef.current = onPositionsCheckComplete;

  const { data: positions = [], isLoading, isError, isFetched, isFetching } = useJupiterPositions(address);

  const totalValue = useMemo(() => computeJupiterTotalValue(positions), [positions]);
  const protocolPositions = useMemo(() => mapJupiterToProtocolPositions(positions), [positions]);

  useEffect(() => {
    // Preserve prior behaviour: propagate 0 when empty/disabled.
    onValueRef.current?.(address ? totalValue : 0);
  }, [address, totalValue]);

  useEffect(() => {
    if (!address) return;
    const handleRefresh: EventListener = (evt) => {
      const event = evt as CustomEvent<{ protocol?: string }>;
      if (event?.detail?.protocol !== "jupiter") return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.jupiter.userPositions(address),
      });
    };
    window.addEventListener("refreshPositions", handleRefresh);
    return () => window.removeEventListener("refreshPositions", handleRefresh);
  }, [address, queryClient]);

  useEffect(() => {
    if (!address) {
      onCheckCompleteRef.current?.();
      return;
    }
    // Mark protocol check completion when the query has settled.
    if (isFetched && !isFetching) onCheckCompleteRef.current?.();
  }, [address, isFetched, isFetching]);

  if (!protocol || !address) return null;
  const effectiveLoading = isLoading || (isFetching && positions.length === 0);
  if (!effectiveLoading && (isError || positions.length === 0)) return null;

  return (
    <ProtocolCard
      protocol={protocol}
      totalValue={totalValue}
      positions={protocolPositions}
      isLoading={effectiveLoading}
      showManageButton={showManageButton}
    />
  );
}

