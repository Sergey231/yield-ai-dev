'use client';

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { formatNumber, formatCurrency } from "@/lib/utils/numberFormat";
import { ClaimSuccessModal } from '@/components/ui/claim-success-modal';
import { ExternalLink } from "lucide-react";
import { queryKeys } from "@/lib/query/queryKeys";
import { useThalaPositions, type ThalaPosition } from "@/lib/query/hooks/protocols/thala";

interface ThalaPositionProps {
  position: ThalaPosition;
  index: number;
  onClaimSuccess?: (rewards: Array<{
    symbol: string;
    amount: number;
    usdValue: number;
    logoUrl?: string | null;
    tokenAddress?: string;
  }>, transactionHash: string) => void;
}

function formatCurrencyValue(value: number) {
  if (value === 0) return '$0.00';
  if (value > 0 && value < 0.01) return '< $0.01';
  return formatCurrency(value);
}

function ThalaPositionCard({ position, index, onClaimSuccess }: ThalaPositionProps) {
  const [isClaiming, setIsClaiming] = useState(false);
  const { signAndSubmitTransaction, account } = useWallet();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const tokenEntries = [
    {
      symbol: position.token0.symbol,
      amount: position.token0.amount,
      value: position.token0.valueUSD
    },
    {
      symbol: position.token1.symbol,
      amount: position.token1.amount,
      value: position.token1.valueUSD
    }
  ];

  const handleClaimRewards = async () => {
    if (!signAndSubmitTransaction || !account?.address || position.rewards.length === 0) return;

    try {
      setIsClaiming(true);
      const THALA_FARMING_ADDRESS = "0xcb8365dc9f7ac6283169598aaad7db9c7b12f52da127007f37fa4565170ff59c";

      const claimedRewardsList: Array<{
        symbol: string;
        amount: number;
        usdValue: number;
        logoUrl?: string | null;
        tokenAddress?: string;
      }> = [];
      let lastTransactionHash: string | undefined;

      for (const reward of position.rewards) {
        const payload = {
          function: `${THALA_FARMING_ADDRESS}::farming::claim_token_reward_entry` as `${string}::${string}::${string}`,
          typeArguments: [],
          functionArguments: [
            position.positionAddress,
            reward.tokenAddress
          ]
        };

        const response = await signAndSubmitTransaction({
          data: payload,
          options: { maxGasAmount: 20000 },
        });

        lastTransactionHash = response.hash;

        if (claimedRewardsList.length === 0) {
          claimedRewardsList.push({
            symbol: reward.symbol,
            amount: reward.amount,
            usdValue: reward.valueUSD,
            logoUrl: reward.logoUrl,
            tokenAddress: reward.tokenAddress
          });
        }
      }

      if (onClaimSuccess && lastTransactionHash && claimedRewardsList.length > 0) {
        setTimeout(() => {
          onClaimSuccess(claimedRewardsList, lastTransactionHash);
        }, 250);
      }

      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.thala.userPositions(account.address.toString()),
      });
    } catch (error) {
      console.error('Error claiming Thala rewards:', error);
      toast({ title: "Error", description: "Failed to claim rewards", variant: "destructive" });
    } finally {
      setIsClaiming(false);
    }
  };

  return (
    <div key={`${position.positionId}-${index}`} className="mt-2 pb-2 border-b last:border-b-0">
      <div className="flex flex-wrap justify-between items-center mb-2">
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2 mr-2">
            {position.token0.logoUrl && (
              <img
                src={position.token0.logoUrl}
                alt={position.token0.symbol}
                className="w-8 h-8 rounded-full border-2 border-white object-contain"
              />
            )}
            {position.token1.logoUrl && (
              <img
                src={position.token1.logoUrl}
                alt={position.token1.symbol}
                className="w-8 h-8 rounded-full border-2 border-white object-contain"
              />
            )}
          </div>
          <span className="text-lg font-semibold">
            {position.token0.symbol} / {position.token1.symbol}
          </span>
          {position.inRange ? (
            <span className="px-2 py-1 rounded bg-green-500/10 text-green-600 text-xs font-semibold ml-2">Active</span>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="bg-error-muted text-error border-error/20 text-xs font-normal px-2 py-0.5 h-5 ml-2 cursor-help">
                    Inactive
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Liquidity is currently outside the active price range</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {position.staked ? (
            <Badge
              variant="outline"
              className="bg-warning-muted text-warning border-warning/20 text-xs font-normal px-2 py-0.5 h-5 ml-2"
            >
              Staked
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="bg-muted text-muted-foreground border-border/40 text-xs font-normal px-2 py-0.5 h-5 ml-2"
            >
              Not staked
            </Badge>
          )}
        </div>
        <div className="flex items-centern gap-2">
          {typeof position.apr === 'number' && position.apr > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs font-normal px-2 py-0.5 h-5 cursor-help"
                  >
                    APR: {formatNumber(position.apr, 2)}%
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">Pool APR (total)</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <span className="text-lg font-bold">{formatCurrencyValue(position.positionValueUSD)}</span>
        </div>
      </div>
      <div className="flex flex-wrap justify-between items-start">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {tokenEntries.map((te) => (
            <div key={`amt-${te.symbol}`}>
              <div className="text-gray-500">{te.symbol} Amount</div>
              <div className="font-medium">{formatNumber(te.amount, 6)}</div>
            </div>
          ))}
          {tokenEntries.map((te) => (
            <div key={`val-${te.symbol}`}>
              <div className="text-gray-500">{te.symbol} Value</div>
              <div className="font-medium">{formatCurrencyValue(te.value)}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-col items-end gap-2 text-sm">
          {position.rewards.length > 0 && (
            <div className="mt-2 text-right">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="text-gray-500 mb-1 cursor-help">
                      🎁 Rewards: {formatCurrencyValue(position.rewardsValueUSD)}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <div className="space-y-1 text-xs max-h-48 overflow-auto">
                      {position.rewards.map((reward, rewardIndex) => (
                        <div key={rewardIndex} className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            {reward.logoUrl && (
                              <img src={reward.logoUrl} alt={reward.symbol} className="w-4 h-4 rounded-full" />
                            )}
                            <span>{reward.symbol}</span>
                          </div>
                          <span className="font-semibold">{formatNumber(reward.amount, 6)}</span>
                        </div>
                      ))}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
          <div className="flex items-center gap-2">
            {position.rewards.length > 0 && position.rewardsValueUSD >= 0.01 && (
              <button
                className="px-3 py-1 bg-success text-success-foreground rounded text-sm font-semibold disabled:opacity-60"
                onClick={handleClaimRewards}
                disabled={isClaiming}
              >
                {isClaiming ? 'Claiming...' : 'Claim'}
              </button>
            )}
            {position.poolAddress && position.positionAddress && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="px-3 py-1 bg-secondary text-secondary-foreground rounded text-sm font-semibold hover:bg-secondary/80 transition-colors flex items-center gap-1.5"
                      onClick={() => {
                        const manageUrl = `https://app.thala.fi/pools/${position.poolAddress}/positions/${position.positionAddress}`;
                        window.open(manageUrl, '_blank');
                      }}
                    >
                      Manage
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Position management is performed on the Thala website</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ThalaPositions() {
  const { account } = useWallet();
  const queryClient = useQueryClient();
  const walletAddress = account?.address?.toString();
  const [showClaimSuccessModal, setShowClaimSuccessModal] = useState(false);
  const [claimedRewards, setClaimedRewards] = useState<Array<{
    symbol: string;
    amount: number;
    usdValue: number;
    logoUrl?: string | null;
    tokenAddress?: string;
  }>>([]);
  const [claimTransactionHash, setClaimTransactionHash] = useState<string | undefined>();

  const {
    data: positionsData = [],
    isLoading,
    error,
  } = useThalaPositions(walletAddress, {
    refetchOnMount: 'always',
  });

  const positions = useMemo(
    () =>
      [...positionsData].sort((a, b) => (b.positionValueUSD || 0) - (a.positionValueUSD || 0)),
    [positionsData]
  );

  useEffect(() => {
    const handleRefresh: EventListener = (evt) => {
      const event = evt as CustomEvent<{ protocol?: string }>;
      if (event?.detail?.protocol === 'thala' && walletAddress) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.protocols.thala.userPositions(walletAddress),
        });
      }
    };

    window.addEventListener('refreshPositions', handleRefresh);
    return () => {
      window.removeEventListener('refreshPositions', handleRefresh);
    };
  }, [walletAddress, queryClient]);

  if (isLoading) {
    return <div>Loading positions...</div>;
  }

  if (error) {
    return <div className="text-red-500">Failed to load positions</div>;
  }

  if (positions.length === 0) {
    return null;
  }

  const totalValue = positions.reduce((sum, position) => sum + (position.positionValueUSD || 0), 0);
  const totalRewards = positions.reduce((sum, position) => sum + (position.rewardsValueUSD || 0), 0);

  return (
    <div className="w-full mb-6 py-2">
      <div className="space-y-4 text-base">
        {positions.map((position, index) => (
          <ThalaPositionCard
            key={`${position.positionId}-${index}`}
            position={position}
            index={index}
            onClaimSuccess={(rewards, hash) => {
              setClaimedRewards(rewards);
              setClaimTransactionHash(hash);
              setShowClaimSuccessModal(true);
            }}
          />
        ))}
        <div className="pt-6 pb-6">
          <div className="hidden md:block">
            <div className="flex items-center justify-between">
              <span className="text-xl">Total assets in Thala:</span>
              <span className="text-xl text-primary font-bold">{formatCurrency(totalValue)}</span>
            </div>
            {totalRewards > 0 && (
              <div className="flex justify-end mt-2">
                <div className="text-right">
                  <div className="text-sm text-muted-foreground flex items-center gap-1 justify-end">
                    <span>💰</span>
                    <span>including rewards {formatCurrency(totalRewards)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="md:hidden space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-lg">Total assets in Thala:</span>
              <span className="text-lg text-primary font-bold">{formatCurrency(totalValue)}</span>
            </div>
            {totalRewards > 0 && (
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground flex items-center gap-1">
                  <span>💰</span>
                  <span>including rewards ${totalRewards.toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <ClaimSuccessModal
        isOpen={showClaimSuccessModal}
        onClose={() => {
          setShowClaimSuccessModal(false);
          setClaimedRewards([]);
          setClaimTransactionHash(undefined);
        }}
        transactionHash={claimTransactionHash}
        rewards={claimedRewards}
        protocolName="Thala"
      />
    </div>
  );
}
