import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import { ProtocolCard } from "@/shared/ProtocolCard";
import { queryKeys } from "@/lib/query/queryKeys";
import { useEchelonProtocolCardModel } from "@/lib/query/hooks/protocols/echelon/useEchelonProtocolCardModel";

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

  const protocol = getProtocolByName("Echelon");

  const {
    protocolPositions,
    totalValue,
    totalRewardsUsdFormatted,
    rewardsData,
    isLoading,
    isFetching,
    hasError,
    calculateRewardsValue,
  } = useEchelonProtocolCardModel(walletAddress);

  useEffect(() => {
    onValueRef.current?.(totalValue);
  }, [totalValue]);

  useEffect(() => {
    if (!isFetching) {
      onCompleteRef.current?.();
    }
  }, [isFetching]);

  useEffect(() => {
    if (refreshKey != null && walletAddress) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.echelon.userPositions(walletAddress),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.echelon.rewards(walletAddress),
      });
    }
  }, [refreshKey, walletAddress, queryClient]);

  if (isLoading && protocolPositions.length === 0 && rewardsData.length === 0) return null;
  if (hasError) return null;
  if (protocolPositions.length === 0 && calculateRewardsValue() === 0) return null;
  if (!protocol) return null;

  return (
    <ProtocolCard
      protocol={protocol}
      totalValue={totalValue}
      positions={protocolPositions}
      totalRewardsUsd={totalRewardsUsdFormatted}
      isLoading={isLoading && protocolPositions.length === 0 && rewardsData.length === 0}
      showManageButton={showManageButton}
    />
  );
}
