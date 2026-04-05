import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import { Token } from "@/lib/types/token";
import { filterHyperionVaultTokens } from "@/lib/services/hyperion/vaultTokens";
import { formatCurrency } from "@/lib/utils/numberFormat";
import { ProtocolCard } from "@/shared/ProtocolCard";
import {
  useHyperionPools,
  useHyperionPositions,
  useHyperionVaultData,
} from "@/lib/query/hooks/protocols/hyperion";
import { queryKeys } from "@/lib/query/queryKeys";
import { mapHyperionToProtocolPositions } from "./mapHyperionToProtocolPositions";

interface PositionsListProps {
  address?: string;
  onPositionsValueChange?: (value: number) => void;
  walletTokens?: Token[]; // Добавляем токены кошелька
  refreshKey?: number;
  onPositionsCheckComplete?: () => void;
  showManageButton?: boolean;
}

export function PositionsList({ address, onPositionsValueChange, walletTokens, refreshKey, onPositionsCheckComplete, showManageButton=true }: PositionsListProps) {
  const { account } = useWallet();
  const queryClient = useQueryClient();
  const onValueRef = useRef(onPositionsValueChange);
  const onCompleteRef = useRef(onPositionsCheckComplete);
  onValueRef.current = onPositionsValueChange;
  onCompleteRef.current = onPositionsCheckComplete;

  const walletAddress = address || account?.address?.toString();
  const protocol = getProtocolByName("Hyperion");
  const vaultTokens = useMemo(
    () => filterHyperionVaultTokens((walletTokens ?? []) as Token[]),
    [walletTokens]
  );
  const vaultTokenAddresses = useMemo(
    () => vaultTokens.map((token) => token.address),
    [vaultTokens]
  );

  const {
    data: positions = [],
    isLoading: positionsLoading,
    isFetching: positionsFetching,
    error: positionsError,
  } = useHyperionPositions(walletAddress);
  const { data: pools = [] } = useHyperionPools();
  const { data: vaultData = [], isLoading: vaultLoading } = useHyperionVaultData(
    walletAddress,
    vaultTokenAddresses
  );

  const totalValueWithoutVault = useMemo(
    () =>
      positions.reduce((sum, position) => {
        const positionValue = parseFloat(position.value || "0");
        const farmRewards =
          position.farm?.unclaimed?.reduce(
            (rewardSum: number, reward: { amountUSD?: string }) =>
              rewardSum + parseFloat(reward.amountUSD || "0"),
            0
          ) || 0;
        const feeRewards =
          position.fees?.unclaimed?.reduce(
            (feeSum: number, fee: { amountUSD?: string }) =>
              feeSum + parseFloat(fee.amountUSD || "0"),
            0
          ) || 0;
        return sum + positionValue + farmRewards + feeRewards;
      }, 0),
    [positions]
  );

  const totalVaultValue = useMemo(
    () =>
      vaultData.reduce((sum, vaultInfo) => sum + (vaultInfo.totalValueUSD || 0), 0),
    [vaultData]
  );
  const totalHyperionValue = totalValueWithoutVault + totalVaultValue;

  const totalRewardsValue = useMemo(
    () =>
      positions.reduce((sum, position) => {
        const farmRewards =
          position.farm?.unclaimed?.reduce(
            (rewardSum: number, reward: { amountUSD?: string }) =>
              rewardSum + parseFloat(reward.amountUSD || "0"),
            0
          ) || 0;
        const feeRewards =
          position.fees?.unclaimed?.reduce(
            (feeSum: number, fee: { amountUSD?: string }) =>
              feeSum + parseFloat(fee.amountUSD || "0"),
            0
          ) || 0;
        return sum + farmRewards + feeRewards;
      }, 0),
    [positions]
  );

  const aprByPoolId = useMemo(() => {
    const map: Record<string, number> = {};
    pools.forEach((pool) => {
      const poolId = pool.poolId;
      if (!poolId) return;
      const fee = parseFloat(pool.feeAPR || "0");
      const farm = parseFloat(pool.farmAPR || "0");
      map[poolId] = fee + farm;
    });
    return map;
  }, [pools]);

  const protocolPositions = useMemo(
    () => mapHyperionToProtocolPositions(positions, aprByPoolId, vaultData),
    [positions, aprByPoolId, vaultData]
  );

  const totalRewardsUsd =
    totalRewardsValue > 0
      ? totalRewardsValue < 1
        ? "<$1"
        : formatCurrency(totalRewardsValue, 2)
      : undefined;

  const isLoading = positionsLoading || vaultLoading;
  const isFetching = positionsFetching;

  useEffect(() => {
    if (refreshKey != null && walletAddress) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.hyperion.userPositions(walletAddress),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.hyperion.vaultData(walletAddress),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.hyperion.pools(),
      });
    }
  }, [refreshKey, walletAddress, queryClient]);

  useEffect(() => {
    if (!isFetching) {
      onCompleteRef.current?.();
    }
  }, [isFetching]);

  useEffect(() => {
    onValueRef.current?.(totalHyperionValue);
  }, [totalHyperionValue]);

  if (Boolean(positionsError)) {
    return <div className="text-sm text-red-500">Failed to load positions</div>;
  }

  if (!walletAddress) {
    return <div className="text-sm text-muted-foreground">Connect wallet to view positions</div>;
  }

  if (positions.length === 0 && vaultData.length === 0) {
    return null;
  }

  if (!protocol) {
    return null;
  }

  return (
    <ProtocolCard
      protocol={protocol}
      totalValue={totalHyperionValue}
      totalRewardsUsd={totalRewardsUsd}
      positions={protocolPositions}
      isLoading={isLoading && positions.length === 0 && vaultData.length === 0}
      showManageButton={showManageButton}
    />
  );
}