import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import { ProtocolCard } from "@/shared/ProtocolCard";
import { queryKeys } from "@/lib/query/queryKeys";
import {
  useEchoPositions,
  useEchoPools,
  type EchoPosition,
} from "@/lib/query/hooks/protocols/echo";
import { mapEchoPositionsToProtocolPositions } from "./mapEchoToProtocolPositions";

interface PositionsListProps {
  address?: string;
  onPositionsValueChange?: (value: number) => void;
  refreshKey?: number;
  onPositionsCheckComplete?: () => void;
  showManageButton?: boolean;
  walletTokens?: unknown[];
}

function normalizeAddress(address: string): string {
  if (!address) return "";
  const prefixed = address.startsWith("0x") ? address : `0x${address}`;
  const body = prefixed.slice(2).toLowerCase().replace(/^0+/, "");
  return `0x${body || "0"}`;
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
  const protocol = getProtocolByName("Echo Protocol");
  const onValueRef = useRef(onPositionsValueChange);
  const onCompleteRef = useRef(onPositionsCheckComplete);
  onValueRef.current = onPositionsValueChange;
  onCompleteRef.current = onPositionsCheckComplete;

  const {
    data: positions = [],
    isLoading,
    isFetching,
    error,
  } = useEchoPositions(walletAddress);
  const { data: pools = [] } = useEchoPools();

  const hasError = Boolean(error);

  const aprByUnderlying = useMemo(() => {
    const map = new Map<string, { supplyApy: number; borrowApy: number }>();
    pools.forEach((pool) => {
      map.set(normalizeAddress(pool.underlyingAddress), {
        supplyApy: Number(pool.supplyApy || 0),
        borrowApy: Number(pool.borrowApy || 0),
      });
    });
    return map;
  }, [pools]);

  const positionsWithCachedApr = useMemo<EchoPosition[]>(() => {
    return positions.map((position) => {
      const poolApr = aprByUnderlying.get(normalizeAddress(position.underlyingAddress));
      if (!poolApr) {
        return position;
      }

      const apy = position.type === "borrow" ? poolApr.borrowApy : poolApr.supplyApy;
      return {
        ...position,
        apy,
      };
    });
  }, [positions, aprByUnderlying]);

  const totalValue = useMemo(() => {
    const supplyTotal = positionsWithCachedApr
      .filter((p) => p.type !== "borrow")
      .reduce((sum, p) => sum + (p.valueUSD || 0), 0);
    const borrowTotal = positionsWithCachedApr
      .filter((p) => p.type === "borrow")
      .reduce((sum, p) => sum + (p.valueUSD || 0), 0);
    return supplyTotal - borrowTotal;
  }, [positionsWithCachedApr]);

  const protocolPositions = useMemo(
    () => mapEchoPositionsToProtocolPositions(positionsWithCachedApr),
    [positionsWithCachedApr]
  );

  useEffect(() => {
    if (refreshKey != null && walletAddress) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.echo.userPositions(walletAddress),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.echo.pools(),
      });
    }
  }, [refreshKey, walletAddress, queryClient]);

  useEffect(() => {
    if (!isFetching) {
      onCompleteRef.current?.();
    }
  }, [isFetching]);

  useEffect(() => {
    onValueRef.current?.(totalValue);
  }, [totalValue]);

  if (isLoading && positions.length === 0) {
    return null;
  }
  if (hasError) {
    return null;
  }
  if (positions.length === 0) {
    return null;
  }
  if (!protocol) {
    return null;
  }

  return (
    <ProtocolCard
      protocol={protocol}
      totalValue={totalValue}
      positions={protocolPositions}
      isLoading={isLoading && positions.length === 0}
      showManageButton={showManageButton}
    />
  );
}
