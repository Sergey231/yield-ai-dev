import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import { formatCurrency } from "@/lib/utils/numberFormat";
import { ProtocolCard } from "@/shared/ProtocolCard";
import { queryKeys } from "@/lib/query/queryKeys";
import { useThalaPositions } from "@/lib/query/hooks/protocols/thala";
import { mapThalaPositionsToProtocolPositions } from "./mapThalaToProtocolPositions";

interface PositionsListProps {
  address?: string;
  onPositionsValueChange?: (value: number) => void;
  refreshKey?: number;
  onPositionsCheckComplete?: () => void;
  showManageButton?: boolean;
}

export function PositionsList({ address, onPositionsValueChange, refreshKey, onPositionsCheckComplete, showManageButton = true }: PositionsListProps) {
  const { account } = useWallet();
  const queryClient = useQueryClient();
  const walletAddress = address || account?.address?.toString();
  const protocol = getProtocolByName("Thala");
  const onValueRef = useRef(onPositionsValueChange);
  const onCompleteRef = useRef(onPositionsCheckComplete);
  onValueRef.current = onPositionsValueChange;
  onCompleteRef.current = onPositionsCheckComplete;

  const {
    data: positions = [],
    isLoading,
    isFetching,
    error,
  } = useThalaPositions(walletAddress);

  const hasError = Boolean(error);
  const totalValue = useMemo(
    () =>
      positions.reduce(
        (sum, position) => sum + (position.positionValueUSD || 0),
        0
      ),
    [positions]
  );
  const totalRewardsValue = useMemo(
    () =>
      positions.reduce(
        (sum, position) => sum + (position.rewardsValueUSD || 0),
        0
      ),
    [positions]
  );
  const protocolPositions = useMemo(
    () => mapThalaPositionsToProtocolPositions(positions),
    [positions]
  );
  const totalRewardsUsd =
    totalRewardsValue > 0 ? formatCurrency(totalRewardsValue, 2) : undefined;

  useEffect(() => {
    if (refreshKey != null && walletAddress) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.thala.userPositions(walletAddress),
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
      totalRewardsUsd={totalRewardsUsd}
      positions={protocolPositions}
      isLoading={isLoading && positions.length === 0}
      showManageButton={showManageButton}
    />
  );
}
