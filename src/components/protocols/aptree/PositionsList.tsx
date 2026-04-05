"use client";

import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import { ProtocolCard } from "@/shared/ProtocolCard";
import { PositionBadge } from "@/shared/ProtocolCard/types";
import { formatNumber } from "@/lib/utils/numberFormat";
import { queryKeys } from "@/lib/query/queryKeys";
import { useAptreePools, useAptreePositions } from "@/lib/query/hooks/protocols/aptree";

interface PositionsListProps {
  address?: string;
  onPositionsValueChange?: (value: number) => void;
  refreshKey?: number;
  onPositionsCheckComplete?: () => void;
  showManageButton?: boolean;
  walletTokens?: unknown[];
}

interface AptreePosition {
  poolId: number;
  assetName: string;
  balance: string;
  value: string;
  displayPrice?: number;
  displayAmount?: string;
  type: "deposit";
  assetInfo?: {
    symbol?: string;
    logoUrl?: string;
    decimals?: number;
    name?: string;
  };
}

export function PositionsList({
  address,
  onPositionsValueChange,
  refreshKey,
  onPositionsCheckComplete,
  showManageButton = true,
}: PositionsListProps) {
  const queryClient = useQueryClient();
  const protocol = getProtocolByName("APTree");
  const onValueRef = useRef(onPositionsValueChange);
  const onCompleteRef = useRef(onPositionsCheckComplete);
  onValueRef.current = onPositionsValueChange;
  onCompleteRef.current = onPositionsCheckComplete;

  const {
    data: positions = [],
    isPending: positionsPending,
    isFetching: positionsFetching,
    error: positionsError,
  } = useAptreePositions(address, {
    refetchOnMount: refreshKey != null ? "always" : undefined,
  });

  const { data: pools = [] } = useAptreePools({
    refetchOnMount: refreshKey != null ? "always" : undefined,
  });

  useEffect(() => {
    const handleRefresh: EventListener = (evt) => {
      const event = evt as CustomEvent<{ protocol?: string }>;
      if (event?.detail?.protocol === "aptree") {
        if (address) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.protocols.aptree.userPositions(address),
          });
        }
        queryClient.invalidateQueries({
          queryKey: queryKeys.protocols.aptree.pools(),
        });
      }
    };
    window.addEventListener("refreshPositions", handleRefresh);
    return () => window.removeEventListener("refreshPositions", handleRefresh);
  }, [address, queryClient]);

  useEffect(() => {
    if (!positionsFetching) {
      onCompleteRef.current?.();
    }
  }, [positionsFetching]);

  const aprPct = useMemo(() => {
    const firstPool = pools?.[0];
    const aprRaw = Number(firstPool?.apr);
    return Number.isFinite(aprRaw) ? aprRaw * 100 : null;
  }, [pools]);

  const totalValue = useMemo(
    () =>
      positions.reduce((sum, p) => {
        const v = Number(p?.value ?? 0);
        return sum + (Number.isFinite(v) ? v : 0);
      }, 0),
    [positions]
  );

  useEffect(() => {
    onValueRef.current?.(totalValue);
  }, [totalValue]);

  const protocolPositions = useMemo(
    () =>
      positions
        .map((position, idx) => {
          const decimals = position.assetInfo?.decimals ?? 6;
          const amountFromBalance = Number(position.balance || 0) / Math.pow(10, decimals);
          const value = Number(position.value || 0);
          const amount = Number(position.displayAmount || amountFromBalance);
          const price = Number.isFinite(Number(position.displayPrice))
            ? Number(position.displayPrice)
            : amount > 0
              ? value / amount
              : undefined;
          const symbol = position.assetInfo?.symbol || position.assetName || "USDT";
          return {
            id: `aptree-${position.poolId}-${idx}`,
            label: symbol,
            value: Number.isFinite(value) ? value : 0,
            logoUrl:
              position.assetInfo?.logoUrl ||
              "https://assets.panora.exchange/tokens/aptos/USDT.svg",
            badge: PositionBadge.Supply,
            subLabel: formatNumber(amount, 2),
            price,
            apr: aprPct != null ? aprPct.toFixed(2) : undefined,
          };
        })
        .sort((a, b) => b.value - a.value),
    [positions, aprPct]
  );

  if (!protocol) {
    return null;
  }

  if (positionsError) {
    return null;
  }

  const hasPositions = positions.length > 0;
  // Hide only after we know the wallet has no APTree position (not while the first fetch is in flight).
  if (!hasPositions && !positionsPending) {
    return null;
  }

  return (
    <ProtocolCard
      protocol={protocol}
      totalValue={totalValue}
      positions={protocolPositions}
      isLoading={positionsPending && !hasPositions}
      showManageButton={showManageButton}
    />
  );
}
