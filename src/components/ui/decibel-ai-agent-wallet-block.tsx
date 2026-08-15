'use client';

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
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
import { fetchFundingApr, type FundingAprResult } from '@/lib/protocols/decibel/fundingApr';
import { WalletConnectDialog } from '@/components/ui/wallet-connect-dialog';

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
  const [walletDialogOpen, setWalletDialogOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [selectedSafeAddress, setSelectedSafeAddress] = useState<string | null>(null);
  const { setSelectedProtocol } = useProtocol();
  const { setActiveTab, scrollToTop } = useMobileManagement();

  // Headline APR for the card = Decibel perp funding yield. Prefer BTC; fall
  // back to APT. Only surfaced when the funding rate is positive (the agent
  // farms positive funding), mirroring the "Total APR" block on the other cards.
  const [btcFunding, setBtcFunding] = useState<FundingAprResult | null>(null);
  const [aptFunding, setAptFunding] = useState<FundingAprResult | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchFundingApr('BTC/USD').then((d) => {
      if (!cancelled) setBtcFunding(d);
    });
    fetchFundingApr('APT/USD').then((d) => {
      if (!cancelled) setAptFunding(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const fundingApr = useMemo(() => {
    const btc = btcFunding?.avg_yearly_apr_pct;
    if (typeof btc === 'number' && Number.isFinite(btc) && btc > 0) {
      return { market: 'BTC', apr: btc };
    }
    const apt = aptFunding?.avg_yearly_apr_pct;
    if (typeof apt === 'number' && Number.isFinite(apt) && apt > 0) {
      return { market: 'APT', apr: apt };
    }
    return null;
  }, [btcFunding, aptFunding]);

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

  const isCardClickable = hasDecibelSafe && !isCheckingSafes;

  const handleCardClick = () => {
    if (!isCardClickable) return;
    handleManagePosition();
  };

  const handleCardKeyDown = (e: KeyboardEvent) => {
    if (!isCardClickable) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleManagePosition();
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
        role={isCardClickable ? 'button' : undefined}
        tabIndex={isCardClickable ? 0 : undefined}
        aria-label={isCardClickable ? 'Manage Decibel Agent' : undefined}
        onClick={isCardClickable ? handleCardClick : undefined}
        onKeyDown={isCardClickable ? handleCardKeyDown : undefined}
        className={cn(
          // Explicit emerald hue: app's `--success` token is greyscale.
          'h-full min-w-0 overflow-hidden border border-primary/20 transition-all',
          isCardClickable
            ? 'cursor-pointer hover:border-primary/40 hover:bg-muted/20 hover:shadow-md active:scale-[0.995]'
            : 'hover:shadow-md',
          isDraggingAccepted && 'border-2 border-emerald-500 bg-emerald-500/15 ring-2 ring-emerald-500/40',
          isOver && 'border-2 border-emerald-500 bg-emerald-500/30 ring-4 ring-emerald-500',
          className
        )}
      >
        <CardContent className="p-4 sm:p-5 flex flex-col h-full gap-3">
          {/* Header: icon + title + strategy badges (own row → no truncation). */}
          <div className="flex items-start gap-3 min-w-0">
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
              <h3 className="text-base font-semibold text-primary leading-tight">Decibel Agent</h3>
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                {subtitle ? (
                  <p className="w-full text-sm text-muted-foreground">{subtitle}</p>
                ) : null}
                {fundingApr ? (
                  <div className="flex shrink-0 items-baseline gap-1 leading-none">
                    <span className="text-xl font-bold tabular-nums text-foreground">
                      {fundingApr.apr.toFixed(2)}%
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Funding APR · {fundingApr.market}
                    </span>
                  </div>
                ) : null}
                {hasDecibelSafe && decibelSafeAddresses.length > 1 ? (
                  <Select value={selectedSafe ?? ''} onValueChange={setSelectedSafeAddress}>
                    <SelectTrigger
                      className="h-7 w-full max-w-[190px]"
                      onClick={(e) => e.stopPropagation()}
                    >
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
                  <Badge variant="secondary" className="whitespace-nowrap leading-tight">
                    Delta neutral
                  </Badge>
                ) : null}
                {/* Highlight what the safe is earning under the hood. */}
                <Badge
                  variant="secondary"
                  className="whitespace-nowrap border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 leading-tight"
                >
                  Farm funding and AMPs
                </Badge>
              </div>
            </div>
          </div>

          {/* Footer actions, pinned to the bottom so cards align in the row. */}
          <div
            className="mt-auto flex items-center justify-end gap-2 pt-1"
            onClick={isCardClickable ? (e) => e.stopPropagation() : undefined}
          >
            {isCheckingSafes ? (
              <Button size="sm" variant="outline" disabled className="w-full">
                Checking...
              </Button>
            ) : !hasDecibelSafe ? (
              <Button
                size="sm"
                onClick={() => {
                  if (!address) {
                    setWalletDialogOpen(true);
                    return;
                  }
                  setSettingsOpen(true);
                }}
                className="w-full bg-black text-white hover:bg-black/90"
              >
                Create Decibel Agent
              </Button>
            ) : (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 w-9 shrink-0 p-0"
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
                  className="flex-1 bg-success text-success-foreground hover:bg-success/90"
                  onClick={() => setDepositOpen(true)}
                  disabled={!address || !selectedSafe}
                >
                  Deposit
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <DecibelAgentWizard
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        existingDecibelSafe={selectedSafe}
      />

      <WalletConnectDialog open={walletDialogOpen} onOpenChange={setWalletDialogOpen} />

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
        yieldAiSuccessDescription=""
        onDepositSuccess={handleManagePosition}
      />
    </>
  );
}
