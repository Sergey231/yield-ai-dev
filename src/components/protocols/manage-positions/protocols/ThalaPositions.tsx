'use client';

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { formatNumber, formatCurrency } from "@/lib/utils/numberFormat";
import { ExternalLink, Loader2 } from "lucide-react";
import { queryKeys } from "@/lib/query/queryKeys";
import { useThalaPositions, type ThalaPosition } from "@/lib/query/hooks/protocols/thala";
import { submitAptosTransaction } from "@/lib/mobile/submitAptosTransaction";
import { useNativeWalletStore } from "@/lib/stores/nativeWalletStore";

const THALA_CLMM_PACKAGE =
  "0x075b4890de3e312d9425408c43d9a9752b64ab3562a30e89a55bdc568c645920";
const THALA_FARMING_ADDRESS =
  "0xcb8365dc9f7ac6283169598aaad7db9c7b12f52da127007f37fa4565170ff59c";
const MIN_CLAIMABLE_USD = 0.01;
/** LP swap fees: allow claim below display threshold so small balances remain testable. */
const MIN_CLAIMABLE_FEES_USD = 0;

interface ThalaPositionProps {
  position: ThalaPosition;
  index: number;
}

function formatCurrencyValue(value: number) {
  if (value === 0) return '$0.00';
  if (value > 0 && value < 0.01) return '< $0.01';
  return formatCurrency(value);
}

function ThalaPositionCard({ position, index }: ThalaPositionProps) {
  const [isClaimingFees, setIsClaimingFees] = useState(false);
  const [isClaimingRewards, setIsClaimingRewards] = useState(false);
  const { signAndSubmitTransaction, account } = useWallet();
  const injectedAptosAddress = useNativeWalletStore((s) => s.aptosAddress);
  const effectiveAptosAddress = account?.address?.toString() ?? injectedAptosAddress ?? null;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const feesValueUSD = position.feesValueUSD ?? position.fees?.feesValueUSD ?? 0;
  const fee0 = position.fees?.token0;
  const fee1 = position.fees?.token1;
  const manageUrl =
    position.poolAddress && position.positionAddress
      ? `https://app.thala.fi/pools/${position.poolAddress}/positions/${position.positionAddress}`
      : null;
  const hasUncollectedFees =
    feesValueUSD > MIN_CLAIMABLE_FEES_USD ||
    (fee0?.amount ?? 0) > 0 ||
    (fee1?.amount ?? 0) > 0;
  // scripts::collect_fees requires the caller to own the position NFT; staked positions
  // are custodied by Thala farming, so fee collection must happen on app.thala.fi.
  const canClaimFeesInApp =
    hasUncollectedFees &&
    Boolean(position.positionAddress) &&
    !position.staked;
  const collectFeesOnThala =
    position.staked && hasUncollectedFees && Boolean(manageUrl);
  const canClaimRewards =
    position.rewards.length > 0 && position.rewardsValueUSD >= MIN_CLAIMABLE_USD;
  const isBusy = isClaimingFees || isClaimingRewards;

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

  const invalidateThalaPositions = () => {
    if (!effectiveAptosAddress) return;
    queryClient.invalidateQueries({
      queryKey: queryKeys.protocols.thala.userPositions(effectiveAptosAddress),
    });
    window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "thala" } }));
  };

  const handleClaimFees = async () => {
    if ((!signAndSubmitTransaction && !effectiveAptosAddress) || !effectiveAptosAddress || !canClaimFeesInApp) {
      if (position.staked && hasUncollectedFees && manageUrl) {
        window.open(manageUrl, "_blank");
      }
      return;
    }

    try {
      setIsClaimingFees(true);

      const response = await submitAptosTransaction({
        transaction: {
          data: {
            function: `${THALA_CLMM_PACKAGE}::scripts::collect_fees` as `${string}::${string}::${string}`,
            typeArguments: [],
            functionArguments: [position.positionAddress],
          },
          options: { maxGasAmount: 20000 },
        },
        signAndSubmitTransaction: signAndSubmitTransaction as any,
        connected: !!account,
        address: effectiveAptosAddress,
      });

      toast({
        title: "Fees claimed",
        description: `Collected ${formatCurrencyValue(feesValueUSD)} in LP fees.`,
        action: response.hash ? (
          <ToastAction
            altText="View in Explorer"
            onClick={() =>
              window.open(`https://explorer.aptoslabs.com/txn/${response.hash}?network=mainnet`, "_blank")
            }
          >
            View in Explorer
          </ToastAction>
        ) : undefined,
      });

      invalidateThalaPositions();
    } catch (error) {
      console.error("Error claiming Thala LP fees:", error);
      toast({
        title: "Claim failed",
        description: "Failed to claim LP fees",
        variant: "destructive",
      });
    } finally {
      setIsClaimingFees(false);
    }
  };

  const handleClaimRewards = async () => {
    if ((!signAndSubmitTransaction && !effectiveAptosAddress) || !effectiveAptosAddress || !canClaimRewards) return;

    try {
      setIsClaimingRewards(true);

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

        const response = await submitAptosTransaction({
          transaction: {
            data: payload,
            options: { maxGasAmount: 20000 },
          } as any,
          signAndSubmitTransaction: signAndSubmitTransaction as any,
          connected: !!account,
          address: effectiveAptosAddress,
        });

        lastTransactionHash = response.hash;
      }

      toast({
        title: "Rewards claimed",
        description: `Collected ${formatCurrencyValue(position.rewardsValueUSD)} in farming rewards.`,
        action: lastTransactionHash ? (
          <ToastAction
            altText="View in Explorer"
            onClick={() =>
              window.open(`https://explorer.aptoslabs.com/txn/${lastTransactionHash}?network=mainnet`, "_blank")
            }
          >
            View in Explorer
          </ToastAction>
        ) : undefined,
      });

      invalidateThalaPositions();
    } catch (error) {
      console.error('Error claiming Thala rewards:', error);
      toast({ title: "Claim failed", description: "Failed to claim rewards", variant: "destructive" });
    } finally {
      setIsClaimingRewards(false);
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
          {feesValueUSD > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="text-sm text-gray-600 cursor-help">
                    Fees: {formatCurrencyValue(feesValueUSD)}
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <div className="space-y-1 text-xs">
                    <p className="font-medium">Uncollected LP swap fees</p>
                    {fee0 && fee0.amount > 0 && (
                      <p>{formatNumber(fee0.amount, fee0.amount < 1 ? 6 : 4)} {fee0.symbol}</p>
                    )}
                    {fee1 && fee1.amount > 0 && (
                      <p>{formatNumber(fee1.amount, fee1.amount < 1 ? 6 : 4)} {fee1.symbol}</p>
                    )}
                    <p className="font-semibold pt-1 border-t border-border/40">
                      Total: {formatCurrencyValue(feesValueUSD)}
                    </p>
                    {position.staked ? (
                      <p className="text-muted-foreground pt-1">
                        Staked positions must collect LP fees on the Thala website.
                      </p>
                    ) : null}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {position.rewards.length > 0 && (
            <div className="mt-2 text-right">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex w-fit text-gray-500 mb-1 cursor-help">
                      🎁 Rewards: {formatCurrencyValue(position.rewardsValueUSD)}
                    </span>
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
          <div className="flex gap-2">
            {canClaimFeesInApp && (
              <Button
                size="sm"
                className="h-8 bg-success text-success-foreground hover:bg-success/90"
                onClick={handleClaimFees}
                disabled={!signAndSubmitTransaction || isBusy}
              >
                {isClaimingFees ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Claiming…
                  </>
                ) : (
                  "Claim"
                )}
              </Button>
            )}
            {collectFeesOnThala && manageUrl && (
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={() => window.open(manageUrl, "_blank")}
              >
                Collect on Thala
              </Button>
            )}
            {canClaimRewards && (
              <Button
                size="sm"
                variant={canClaimFeesInApp ? "outline" : "default"}
                className={
                  canClaimFeesInApp
                    ? "h-8"
                    : "h-8 bg-success text-success-foreground hover:bg-success/90"
                }
                onClick={handleClaimRewards}
                disabled={!signAndSubmitTransaction || isBusy}
              >
                {isClaimingRewards ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Claiming…
                  </>
                ) : canClaimFeesInApp ? (
                  "Claim rewards"
                ) : (
                  "Claim"
                )}
              </Button>
            )}
            {manageUrl && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => window.open(manageUrl, "_blank")}
                aria-label="Open on Thala"
                title="Open on Thala"
              >
                <ExternalLink className="h-4 w-4" />
              </Button>
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
  const totalFees = positions.reduce(
    (sum, position) => sum + (position.feesValueUSD ?? position.fees?.feesValueUSD ?? 0),
    0
  );
  const totalRewards = positions.reduce((sum, position) => sum + (position.rewardsValueUSD || 0), 0);

  return (
    <div className="w-full mb-6 py-2">
      <div className="space-y-4 text-base">
        {positions.map((position, index) => (
          <ThalaPositionCard
            key={`${position.positionId}-${index}`}
            position={position}
            index={index}
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
            {totalFees > 0 && (
              <div className="flex justify-end mt-2">
                <div className="text-right">
                  <div className="text-sm text-muted-foreground flex items-center gap-1 justify-end">
                    <span>💰</span>
                    <span>including uncollected fees {formatCurrency(totalFees)}</span>
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
            {totalFees > 0 && (
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground flex items-center gap-1">
                  <span>💰</span>
                  <span>including uncollected fees ${totalFees.toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
