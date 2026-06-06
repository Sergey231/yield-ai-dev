'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { useWalletData } from '@/contexts/WalletContext';
import { useYieldAiSafes } from '@/lib/query/hooks/protocols/yield-ai';
import { useBatchSafeStrategies } from '@/lib/query/hooks/protocols/yield-ai/useBatchSafeStrategies';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DecibelAgentWizard } from '@/components/ui/decibel-agent-wizard';
import { DepositModal } from '@/components/ui/deposit-modal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getProtocolByName } from '@/lib/protocols/getProtocolsList';
import { USDC_FA_METADATA_MAINNET } from '@/lib/constants/yieldAiVault';
import { normalizeAddress, toCanonicalAddress } from '@/lib/utils/addressNormalization';
import { LineChart } from 'lucide-react';
import { useProtocol } from '@/lib/contexts/ProtocolContext';
import { useMobileManagement } from '@/contexts/MobileManagementContext';
import { dispatchSelectYieldAiSafe } from '@/lib/query/hooks/protocols/yield-ai/useSelectedYieldAiSafe';
import { useCardTokenDrop } from '@/hooks/useCardTokenDrop';

export interface DecibelAiAgentWalletBlockProps {
  className?: string;
}

const USDC_LOGO_APTOS = 'https://assets.panora.exchange/tokens/aptos/USDC.svg';
const DECIBEL_STRATEGY_ID = 'decibel_delta_neutral';

/** The Decibel delta-neutral safe is funded with USDC only. */
const DECIBEL_DEPOSIT_TOKENS = [{ symbol: 'USDC', address: USDC_FA_METADATA_MAINNET }];

export function DecibelAiAgentWalletBlock({ className }: DecibelAiAgentWalletBlockProps) {
  const { address, tokens } = useWalletData();
  const protocol = getProtocolByName('Decibel');
  const aiAgentProtocol = getProtocolByName('AI agent');
  const [logoError, setLogoError] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [selectedSafeAddress, setSelectedSafeAddress] = useState<string | null>(null);
  const { setSelectedProtocol } = useProtocol();
  const { setActiveTab, scrollToTop } = useMobileManagement();

  const { data: safeAddresses = [], isLoading: safesLoading } = useYieldAiSafes(address, {
    enabled: Boolean(address),
    refetchOnMount: 'always',
  });

  const normalizedSafes = useMemo(
    () => Array.from(new Set(safeAddresses.map((safe) => toCanonicalAddress(safe)))),
    [safeAddresses]
  );

  const { strategiesMap, isLoading: strategiesLoading } = useBatchSafeStrategies(normalizedSafes);
  const isCheckingSafes = safesLoading || strategiesLoading;

  const decibelSafeAddresses = useMemo(
    () =>
      normalizedSafes.filter(
        (safe) => strategiesMap.get(safe)?.activeStrategyId === DECIBEL_STRATEGY_ID
      ),
    [normalizedSafes, strategiesMap]
  );

  useEffect(() => {
    const first = decibelSafeAddresses[0] ?? null;
    if (!first) {
      if (selectedSafeAddress) setSelectedSafeAddress(null);
      return;
    }
    if (!selectedSafeAddress || !decibelSafeAddresses.includes(selectedSafeAddress)) {
      setSelectedSafeAddress(first);
    }
  }, [decibelSafeAddresses, selectedSafeAddress]);

  const hasDecibelSafe = decibelSafeAddresses.length > 0;
  const selectedSafe = selectedSafeAddress ?? decibelSafeAddresses[0] ?? null;

  // Desktop drag-drop: dropping USDC from the wallet opens the Decibel
  // deposit flow (or the create-agent wizard when there is no safe yet).
  const { isDraggingAccepted, isOver, dragHandlers } = useCardTokenDrop({
    acceptedTokens: DECIBEL_DEPOSIT_TOKENS,
    onDrop: () => {
      if (!address) return;
      if (hasDecibelSafe && selectedSafe) {
        setDepositOpen(true);
      } else {
        setSettingsOpen(true);
      }
    },
  });

  const subtitle = useMemo(() => {
    if (!address) return 'Connect your wallet to create a Decibel AI agent.';
    if (isCheckingSafes) return 'Checking Decibel safes...';
    if (!hasDecibelSafe) return 'Create a Decibel delta-neutral safe.';
    // With a safe selected we surface the strategy via the badge below; the
    // raw address is intentionally hidden from the main page card.
    return '';
  }, [address, hasDecibelSafe, isCheckingSafes]);

  const handleManagePosition = () => {
    if (!address || !selectedSafe) return;
    // Persist + broadcast: write to localStorage and notify any already-mounted
    // YieldAIPositions consumer via custom event so it switches without remount.
    dispatchSelectYieldAiSafe(address, selectedSafe);
    const aiAgentProtocol = getProtocolByName('AI agent');
    if (aiAgentProtocol) {
      setSelectedProtocol(aiAgentProtocol);
    }
    if (setActiveTab) {
      setActiveTab('ideas');
      setTimeout(() => {
        scrollToTop?.();
      }, 300);
    }
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
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

  return (
    <>
      <Card
        {...dragHandlers}
        className={cn(
          // Explicit emerald hue: app's `--success` token is greyscale.
          'h-full min-w-0 overflow-hidden border border-primary/20 hover:shadow-md transition-all',
          isDraggingAccepted && 'border-2 border-emerald-500 bg-emerald-500/15 ring-2 ring-emerald-500/40',
          isOver && 'border-2 border-emerald-500 bg-emerald-500/30 ring-4 ring-emerald-500',
          className
        )}
      >
        <CardContent className="p-4 sm:p-6 flex flex-col h-full">
          <div className="flex flex-col items-stretch gap-4 flex-1 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-start gap-3 min-w-0 w-full xl:items-center">
              <div className="p-2 bg-primary/10 rounded-full shrink-0">
                <div className="w-5 h-5 relative">
                  {!logoError && protocol?.logoUrl ? (
                    <Image
                      src={protocol.logoUrl}
                      alt={protocol.name ?? 'Decibel'}
                      width={20}
                      height={20}
                      className="object-contain"
                      onError={() => setLogoError(true)}
                      unoptimized
                    />
                  ) : (
                    <div className="w-5 h-5 flex items-center justify-center text-[10px] font-semibold text-primary">
                      D
                    </div>
                  )}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-semibold text-primary truncate">Decibel AI agent</h3>
                <div className="mt-1 flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-1.5">
                  {subtitle ? (
                    <p className="max-w-full text-sm text-muted-foreground truncate">{subtitle}</p>
                  ) : null}
                  {hasDecibelSafe && decibelSafeAddresses.length > 1 ? (
                    <Select value={selectedSafe ?? ''} onValueChange={setSelectedSafeAddress}>
                      <SelectTrigger className="h-8 w-full max-w-full sm:h-7 sm:w-[190px] sm:ml-2">
                        <SelectValue placeholder="Select safe" />
                      </SelectTrigger>
                      <SelectContent>
                        {decibelSafeAddresses.map((safe) => (
                          <SelectItem key={safe} value={safe}>
                            {safe.slice(0, 6)}...{safe.slice(-4)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                  {hasDecibelSafe ? (
                    <Badge variant="secondary" className="max-w-full whitespace-normal text-left leading-tight sm:ml-2 sm:whitespace-nowrap">
                      Decibel delta-neutral
                    </Badge>
                  ) : null}
                  {/* Highlight what the safe is earning under the hood. */}
                  <Badge
                    variant="secondary"
                    className="max-w-full whitespace-nowrap border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 leading-tight"
                  >
                    Farm funding and AMPs
                  </Badge>
                  {/* Copy-address affordance removed from the main page card. */}
                </div>
              </div>
            </div>

            <div className="shrink-0 flex w-full items-center gap-2 xl:w-auto">
              {isCheckingSafes ? (
                <Button size="sm" variant="outline" disabled className="w-full xl:w-auto">
                  Checking...
                </Button>
              ) : !hasDecibelSafe ? (
                <Button
                  size="sm"
                  onClick={() => setSettingsOpen(true)}
                  disabled={!address}
                  className="w-full bg-black text-white hover:bg-black/90 xl:w-auto"
                >
                  Create Decibel AI agent
                </Button>
              ) : (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 w-9 shrink-0 p-0 sm:h-9 sm:w-9"
                        onClick={handleManagePosition}
                        disabled={!address || !selectedSafe}
                        aria-label="Manage Position"
                      >
                        <LineChart className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Manage Position</p>
                    </TooltipContent>
                  </Tooltip>
                  <Button
                    size="sm"
                    className="flex-1 bg-success text-success-foreground hover:bg-success/90 xl:flex-none xl:w-auto"
                    onClick={() => setDepositOpen(true)}
                    disabled={!address || !selectedSafe}
                  >
                    Deposit
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <DecibelAgentWizard
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        existingDecibelSafe={selectedSafe}
      />

      <DepositModal
        isOpen={depositOpen}
        onClose={() => setDepositOpen(false)}
        protocol={{
          name: 'Decibel AI agent',
          // Primary logo = Yield AI agent (this is a Yield AI safe under the
          // hood); Decibel is shown as the stacked secondary badge below.
          logo: aiAgentProtocol?.logoUrl ?? '/logo.png',
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
        yieldAiSafeAddress={selectedSafe ?? undefined}
        secondaryLogoUrl={protocol?.logoUrl}
        secondaryLogoAlt="Decibel"
      />
    </>
  );
}
