"use client";

import { useEffect, useMemo, useRef } from "react";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import { ProtocolCard } from "@/shared/ProtocolCard";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { useExponentPositions } from "@/lib/query/hooks/protocols/exponent/useExponentPositions";
import {
  computeExponentTotalUsd,
  mapExponentToProtocolPositions,
} from "@/components/protocols/exponent/mapExponentToProtocolPositions";

type ExponentPositionsListProps = {
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
}: ExponentPositionsListProps) {
  const protocol = getProtocolByName("Exponent");
  const queryClient = useQueryClient();
  const onValueRef = useRef(onPositionsValueChange);
  onValueRef.current = onPositionsValueChange;
  const onCheckCompleteRef = useRef(onPositionsCheckComplete);
  onCheckCompleteRef.current = onPositionsCheckComplete;
  const hasCompletedCheckRef = useRef<string | null>(null);

  const effectiveAddress = (address ?? "").trim();

  const {
    data: positions = [],
    isLoading,
    isFetched,
    isError,
  } = useExponentPositions(effectiveAddress, { refetchOnMount: "always" });

  const totalValue = useMemo(() => computeExponentTotalUsd(positions), [positions]);
  const cardPositions = useMemo(
    () => mapExponentToProtocolPositions(positions),
    [positions]
  );

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
      if (event?.detail?.protocol !== "exponent") return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.exponent.userPositions(effectiveAddress),
      });
    };
    window.addEventListener("refreshPositions", handler);
    return () => window.removeEventListener("refreshPositions", handler);
  }, [effectiveAddress, queryClient]);

  if (!protocol || !effectiveAddress) return null;
  const hasAny = cardPositions.length > 0 || totalValue > 0;
  if (isLoading && !hasAny) return null;
  if (!isLoading && (isError || cardPositions.length === 0)) return null;

  return (
    <ProtocolCard
      protocol={protocol}
      totalValue={totalValue}
      positions={cardPositions}
      isLoading={isLoading && !hasAny}
      showManageButton={showManageButton}
    />
  );
}
