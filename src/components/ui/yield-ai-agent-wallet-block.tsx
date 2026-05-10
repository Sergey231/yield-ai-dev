'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useWalletData } from '@/contexts/WalletContext';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useYieldAiSafes } from '@/lib/query/hooks/protocols/yield-ai';
import { useSelectedYieldAiSafe } from '@/lib/query/hooks/protocols/yield-ai/useSelectedYieldAiSafe';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { YieldAiSafeSettingsForm } from '@/components/ui/yield-ai-safe-settings-form';
import { DepositModal } from '@/components/ui/deposit-modal';
import { cn } from '@/lib/utils';
import { getProtocolByName } from '@/lib/protocols/getProtocolsList';
import { USDC_FA_METADATA_MAINNET } from '@/lib/constants/yieldAiVault';
import { normalizeAddress } from '@/lib/utils/addressNormalization';
import { Copy, X } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useSafeAiAgentStrategy } from '@/lib/query/hooks/protocols/yield-ai/useSafeAiAgentStrategy';
import { AI_AGENT_STRATEGIES, type AiAgentStrategyId } from '@/lib/protocols/yield-ai/strategyRegistry';
import { STRATEGY_REGISTRY_ENTRYPOINTS, strategyIdArg } from '@/lib/protocols/yield-ai/strategyRegistry';
import { GasStationService } from '@/lib/services/gasStation';
import { toCanonicalAddress } from '@/lib/utils/addressNormalization';

export interface YieldAiAgentWalletBlockProps {
  className?: string;
}

const USDC_LOGO_APTOS = 'https://assets.panora.exchange/tokens/aptos/USDC.svg';

export function YieldAiAgentWalletBlock({ className }: YieldAiAgentWalletBlockProps) {
  const { address, tokens } = useWalletData();
  const { signAndSubmitTransaction } = useWallet();
  const protocol = getProtocolByName('AI agent');
  const [logoError, setLogoError] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: safeAddresses = [], isLoading: safesLoading } = useYieldAiSafes(address, {
    enabled: Boolean(address),
    refetchOnMount: 'always',
  });

  const { selectedSafeAddress: safeAddress, setSelectedSafeAddress, safeAddresses: normalizedSafes } =
    useSelectedYieldAiSafe({ owner: address, safeAddresses });
  const hasSafe = Boolean(safeAddress);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [openDepositAfterCreate, setOpenDepositAfterCreate] = useState(false);

  const subtitle = useMemo(() => {
    if (!address) return 'Connect your wallet to create and fund an AI agent wallet.';
    if (safesLoading) return 'Checking wallet…';
    if (!hasSafe) return 'Create an AI agent wallet (safe) with spending limits.';
    return `Safe ${safeAddress?.slice(0, 6)}...${safeAddress?.slice(-4)}`;
  }, [address, safesLoading, hasSafe, safeAddress]);

  const { data: safeStrategy } = useSafeAiAgentStrategy(safeAddress ?? undefined, { enabled: Boolean(safeAddress) });
  const activeStrategyId: AiAgentStrategyId | null = safeStrategy?.activeStrategyId ?? null;

  const switchStrategy = async (next: AiAgentStrategyId) => {
    if (!safeAddress) return;
    if (!signAndSubmitTransaction) {
      toast({
        title: 'Wallet required',
        description: 'Connect your Aptos wallet to switch AI agent strategy.',
        variant: 'destructive',
      });
      return;
    }
    try {
      const gasStationSubmitter = GasStationService.getInstance().getTransactionSubmitter();
      if (!gasStationSubmitter) {
        throw new Error('Gas Station is not available. Configure NEXT_PUBLIC_APTOS_GAS_STATION_KEY.');
      }

      const attach = async (strategyId: string) => {
        await signAndSubmitTransaction({
          data: {
            function: STRATEGY_REGISTRY_ENTRYPOINTS.attachStrategy as `${string}::${string}::${string}`,
            typeArguments: [],
            functionArguments: [toCanonicalAddress(safeAddress), strategyIdArg(strategyId)],
          },
          options: { maxGasAmount: 70_000 },
          transactionSubmitter: gasStationSubmitter as any,
        });
      };
      const detach = async (strategyId: string) => {
        await signAndSubmitTransaction({
          data: {
            function: STRATEGY_REGISTRY_ENTRYPOINTS.detachStrategy as `${string}::${string}::${string}`,
            typeArguments: [],
            functionArguments: [toCanonicalAddress(safeAddress), strategyIdArg(strategyId)],
          },
          options: { maxGasAmount: 70_000 },
          transactionSubmitter: gasStationSubmitter as any,
        });
      };

      const attachedIds = safeStrategy?.activeStrategyIds ?? [];
      const opposite: AiAgentStrategyId =
        next === 'decibel_delta_neutral' ? 'stablecoin_compound' : 'decibel_delta_neutral';

      await attach(next);
      // Only detach the opposite canonical tag if it is actually attached.
      if (attachedIds.includes(opposite)) {
        await detach(opposite);
      }

      toast({
        title: 'Strategy updated',
        description: `Active AI agent: ${AI_AGENT_STRATEGIES[next].label}`,
      });

      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.yieldAi.safeActiveStrategy(safeAddress),
      });
    } catch (err) {
      toast({
        title: 'Failed to switch strategy',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const walletUsdcPriceUsd = useMemo(() => {
    const usdc = tokens?.find(
      (t) =>
        normalizeAddress(t.address) === normalizeAddress(USDC_FA_METADATA_MAINNET) ||
        t.symbol === 'USDC'
    );
    return usdc?.price ? parseFloat(usdc.price) : 1;
  }, [tokens]);

  useEffect(() => {
    if (!openDepositAfterCreate) return;
    if (!safeAddress) return;
    setDepositOpen(true);
    setOpenDepositAfterCreate(false);
  }, [openDepositAfterCreate, safeAddress]);

  return (
    <>
      <Card className={cn('h-full border-primary/20 hover:shadow-md transition-shadow', className)}>
        <CardContent className="p-6 flex flex-col h-full">
          <div className="flex items-center justify-between gap-4 flex-1 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 bg-primary/10 rounded-full shrink-0">
                <div className="w-5 h-5 relative">
                  {!logoError && protocol?.logoUrl ? (
                    <Image
                      src={protocol.logoUrl}
                      alt={protocol.name ?? 'AI agent'}
                      width={20}
                      height={20}
                      className="object-contain"
                      onError={() => setLogoError(true)}
                      unoptimized
                    />
                  ) : (
                    <div className="w-5 h-5 flex items-center justify-center text-[10px] font-semibold text-primary">
                      YA
                    </div>
                  )}
                </div>
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-primary">Yield AI agent</h3>
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-sm text-muted-foreground truncate">{subtitle}</p>
                  {hasSafe && normalizedSafes.length > 1 ? (
                    <Select value={safeAddress ?? ''} onValueChange={setSelectedSafeAddress}>
                      <SelectTrigger className="h-7 w-[190px] ml-2">
                        <SelectValue placeholder="Select safe" />
                      </SelectTrigger>
                      <SelectContent>
                        {normalizedSafes.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s.slice(0, 6)}…{s.slice(-4)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                  {hasSafe && activeStrategyId ? (
                    <Badge variant="secondary" className="ml-2">
                      {AI_AGENT_STRATEGIES[activeStrategyId].label}
                    </Badge>
                  ) : null}
                  {hasSafe && safeAddress && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={() => {
                            navigator.clipboard
                              .writeText(safeAddress)
                              .then(() =>
                                toast({
                                  title: 'Copied',
                                  description: 'Safe address copied to clipboard',
                                })
                              )
                              .catch(() =>
                                toast({
                                  title: 'Copy failed',
                                  variant: 'destructive',
                                })
                              );
                          }}
                          aria-label="Copy safe address"
                        >
                          <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Copy safe address</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
            </div>

            <div className="shrink-0 flex items-center gap-2">
              {!hasSafe ? (
                <Button
                  size="sm"
                  onClick={() => setSettingsOpen(true)}
                  disabled={!address || safesLoading}
                  className="bg-black text-white hover:bg-black/90"
                >
                  Create AI agent wallet
                </Button>
              ) : (
                <>
                  {/* Temporarily hidden - Create new safe button */}
                  {false && (
                    <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)} disabled={!address}>
                      Create new safe
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="bg-success text-success-foreground hover:bg-success/90"
                    onClick={() => setDepositOpen(true)}
                    disabled={!address}
                  >
                    Deposit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      switchStrategy(activeStrategyId === 'decibel_delta_neutral' ? 'stablecoin_compound' : 'decibel_delta_neutral')
                    }
                    disabled={!address || !activeStrategyId}
                  >
                    Switch strategy
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto p-6 rounded-2xl w-[calc(100vw-2rem)] sm:w-auto [&>button:last-child]:hidden">
          <DialogHeader>
            <div className="flex items-start justify-between gap-2">
              <DialogTitle>AI agent wallet settings</DialogTitle>
              <Button
                onClick={() => setSettingsOpen(false)}
                variant="ghost"
                size="icon"
                className="h-8 w-8 p-0"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="h-2" />
            <DialogDescription>
              Configure spending limits for the AI agent wallet and create the safe.
            </DialogDescription>
          </DialogHeader>
          <div className="h-2" />

          <YieldAiSafeSettingsForm
            onCreated={() => {
              // Requirement: show notification first (handled in form), then open deposit modal.
              setSettingsOpen(false);
              setOpenDepositAfterCreate(true);
            }}
          />
        </DialogContent>
      </Dialog>

      <DepositModal
        isOpen={depositOpen}
        onClose={() => setDepositOpen(false)}
        protocol={{
          name: protocol?.name ?? 'AI agent',
          logo: protocol?.logoUrl ?? '/logo.png',
          apy: 0,
          key: 'yield-ai',
        }}
        tokenIn={{
          symbol: 'USDC',
          logo: USDC_LOGO_APTOS,
          decimals: 6,
          address: USDC_FA_METADATA_MAINNET,
        }}
        tokenOut={{
          symbol: 'USDC',
          logo: USDC_LOGO_APTOS,
          decimals: 6,
          address: USDC_FA_METADATA_MAINNET,
        }}
        priceUSD={walletUsdcPriceUsd}
        yieldAiSafeAddress={safeAddress ?? undefined}
      />
    </>
  );
}

