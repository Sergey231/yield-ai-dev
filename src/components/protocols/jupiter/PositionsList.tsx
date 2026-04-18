"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import { ProtocolCard } from "@/shared/ProtocolCard";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { useJupiterPositions } from "@/lib/query/hooks/protocols/jupiter/useJupiterPositions";
import { computeJupiterTotalValue, mapJupiterToProtocolPositions } from "@/components/protocols/jupiter/mapJupiterToProtocolPositions";
import { isLikelySolanaAddress } from "@/lib/kamino/kvaultVaultAddress";

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
  const searchParams = useSearchParams();
  const onValueRef = useRef(onPositionsValueChange);
  onValueRef.current = onPositionsValueChange;
  const onCheckCompleteRef = useRef(onPositionsCheckComplete);
  onCheckCompleteRef.current = onPositionsCheckComplete;

  const mockEnabled =
    process.env.NEXT_PUBLIC_KAMINO_REWARDS_MOCK === "1" ||
    process.env.NEXT_PUBLIC_KAMINO_REWARDS_MOCK === "true";

  const effectiveAddress = useMemo(() => {
    const base = (address ?? "").trim();
    if (!mockEnabled) return base;
    const raw = (searchParams?.get("jupiterAddress") || searchParams?.get("address") || "").trim();
    if (raw && isLikelySolanaAddress(raw)) return raw;
    return base;
  }, [address, mockEnabled, searchParams]);

  const { data: positions = [], isLoading, isError, isFetched, isFetching } =
    useJupiterPositions(effectiveAddress);

  const totalValue = useMemo(() => computeJupiterTotalValue(positions), [positions]);
  const protocolPositions = useMemo(() => mapJupiterToProtocolPositions(positions), [positions]);
  const cacheKey = useMemo(() => `proto_has_positions:jupiter`, []);
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
    // Preserve prior behaviour: propagate 0 when empty/disabled.
    onValueRef.current?.(effectiveAddress ? totalValue : 0);
  }, [effectiveAddress, totalValue]);

  useEffect(() => {
    if (!effectiveAddress) return;
    const handleRefresh: EventListener = (evt) => {
      const event = evt as CustomEvent<{ protocol?: string }>;
      if (event?.detail?.protocol !== "jupiter") return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.jupiter.userPositions(effectiveAddress),
      });
    };
    window.addEventListener("refreshPositions", handleRefresh);
    return () => window.removeEventListener("refreshPositions", handleRefresh);
  }, [effectiveAddress, queryClient]);

  useEffect(() => {
    if (!effectiveAddress) {
      onCheckCompleteRef.current?.();
      return;
    }
    // Mark protocol check completion when the query has settled.
    if (isFetched && !isFetching) onCheckCompleteRef.current?.();
  }, [effectiveAddress, isFetched, isFetching]);

  useEffect(() => {
    if (!effectiveAddress) return;
    if (!isFetched || isFetching) return;
    const hasPositions = positions.length > 0;
    setLastKnownHasPositions(hasPositions);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(cacheKey, hasPositions ? "1" : "0");
    } catch {
      // ignore
    }
  }, [cacheKey, effectiveAddress, isFetched, isFetching, positions.length]);

  if (!protocol || !effectiveAddress) return null;
  const effectiveLoading = isLoading || (isFetching && positions.length === 0);
  // Sidebar UX: show skeleton only when this protocol previously had positions.
  if (effectiveLoading && positions.length === 0 && !lastKnownHasPositions) return null;
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

