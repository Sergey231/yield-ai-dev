'use client';

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import Image from 'next/image';
import { useWalletData } from '@/contexts/WalletContext';
import { useYieldAiSafes } from '@/lib/query/hooks/protocols/yield-ai';
import { useBatchSafeStrategies } from '@/lib/query/hooks/protocols/yield-ai/useBatchSafeStrategies';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { YieldAiSafeSettingsForm } from '@/components/ui/yield-ai-safe-settings-form';
import { DepositModal } from '@/components/ui/deposit-modal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getProtocolByName } from '@/lib/protocols/getProtocolsList';
import { YIELD_AI_HYPERION_POOLS } from '@/lib/constants/yieldAiVault';
import { normalizeAddress, toCanonicalAddress } from '@/lib/utils/addressNormalization';
import {
  buildHyperionAgentDepositModalConfig,
  HYPERION_AGENT_DEPOSIT_TOKENS,
} from '@/lib/protocols/yield-ai/hyperionAgentDepositModal';
import { LineChart, X } from 'lucide-react';
import { useProtocol } from '@/lib/contexts/ProtocolContext';
import { useMobileManagement } from '@/contexts/MobileManagementContext';
import { dispatchSelectYieldAiSafe } from '@/lib/query/hooks/protocols/yield-ai/useSelectedYieldAiSafe';
import { useCardTokenDrop } from '@/hooks/useCardTokenDrop';
import { useHyperionPools } from '@/lib/query/hooks/protocols/hyperion/useHyperionPools';
import { WalletConnectDialog } from '@/components/ui/wallet-connect-dialog';

export interface HyperionAiAgentWalletBlockProps {
  className?: string;
}

const USDC_LOGO_APTOS = 'https://assets.panora.exchange/tokens/aptos/USDC.svg';
const WBTC_LOGO_APTOS = 'https://assets.panora.exchange/tokens/aptos/WBTC.png';
const HYPERION_STRATEGY_ID = 'hyperion_lp';

export function HyperionAiAgentWalletBlock({ className }: HyperionAiAgentWalletBlockProps) {
  const { address } = useWalletData();
  const protocol = getProtocolByName('Hyperion');
  const aiAgentProtocol = getProtocolByName('AI agent');
  const [logoError, setLogoError] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [walletDialogOpen, setWalletDialogOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [openDepositAfterCreate, setOpenDepositAfterCreate] = useState(false);
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

  const hyperionSafeAddresses = useMemo(
    () =>
      normalizedSafes.filter(
        (safe) => strategiesMap.get(safe)?.activeStrategyId === HYPERION_STRATEGY_ID
      ),
    [normalizedSafes, strategiesMap]
  );

  useEffect(() => {
    const first = hyperionSafeAddresses[0] ?? null;
    if (!first) {
      if (selectedSafeAddress) setSelectedSafeAddress(null);
      return;
    }
    if (!selectedSafeAddress || !hyperionSafeAddresses.includes(selectedSafeAddress)) {
      setSelectedSafeAddress(first);
    }
  }, [hyperionSafeAddresses, selectedSafeAddress]);

  const hasHyperionSafe = hyperionSafeAddresses.length > 0;
  const selectedSafe = selectedSafeAddress ?? hyperionSafeAddresses[0] ?? null;

  // Headline APR = the WBTC/USDC pool's full-range APR (swap fees + farm
  // rewards) from the Hyperion pools feed, matched by pool address. Mirrors the
  // "Total APR" block on the other agent cards.
  const { data: hyperionPools = [] } = useHyperionPools();
  const wbtcUsdcApr = useMemo(() => {
    const target = normalizeAddress(YIELD_AI_HYPERION_POOLS.wbtc_usdc.poolAddress);
    const match = (hyperionPools as Array<Record<string, unknown>>).find((p) => {
      const id = (p.id ?? p.poolId ?? (p.pool as { poolId?: string } | undefined)?.poolId) as
        | string
        | undefined;
      return id ? normalizeAddress(id) === target : false;
    });
    if (!match) return null;
    const fee = parseFloat(String(match.feeAPR ?? '0')) || 0;
    const farm = parseFloat(String(match.farmAPR ?? '0')) || 0;
    return fee + farm;
  }, [hyperionPools]);

  // After creating the safe, open the deposit modal once the new Hyperion safe
  // has been picked up and selected.
  useEffect(() => {
    if (!openDepositAfterCreate) return;
    if (!selectedSafe) return;
    setDepositOpen(true);
    setOpenDepositAfterCreate(false);
  }, [openDepositAfterCreate, selectedSafe]);

  // Desktop drag-drop: dropping a supported Hyperion funding token opens the
  // deposit flow (or the create-agent dialog when there is no safe yet).
  const { isDraggingAccepted, isOver, dragHandlers } = useCardTokenDrop({
    acceptedTokens: HYPERION_AGENT_DEPOSIT_TOKENS.map((t) => ({
      symbol: t.symbol,
      address: t.address,
    })),
    onDrop: () => {
      if (!address) return;
      if (hasHyperionSafe && selectedSafe) {
        setDepositOpen(true);
      } else {
        setSettingsOpen(true);
      }
    },
  });

  const subtitle = useMemo(() => {
    if (!address) return 'Connect your wallet to create a Hyperion LP agent.';
    if (isCheckingSafes) return 'Checking Hyperion safes...';
    return '';
  }, [address, isCheckingSafes]);

  const handleManagePosition = () => {
    if (!address || !selectedSafe) return;
    // Persist + broadcast the selected safe so the AI agent manage view opens
    // the Hyperion LP strategy for this exact safe.
    dispatchSelectYieldAiSafe(address, selectedSafe);
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

  const isCardClickable = hasHyperionSafe && !isCheckingSafes;

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

  return (
    <>
      <Card
        {...dragHandlers}
        role={isCardClickable ? 'button' : undefined}
        tabIndex={isCardClickable ? 0 : undefined}
        aria-label={isCardClickable ? 'Manage Hyperion Agent' : undefined}
        onClick={isCardClickable ? handleCardClick : undefined}
        onKeyDown={isCardClickable ? handleCardKeyDown : undefined}
        className={cn(
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
                    alt={protocol.name ?? 'Hyperion'}
                    width={20}
                    height={20}
                    className="object-contain"
                    onError={() => setLogoError(true)}
                    unoptimized
                  />
                ) : (
                  <div className="w-5 h-5 flex items-center justify-center text-[10px] font-semibold text-primary">
                    H
                  </div>
                )}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-primary leading-tight">Hyperion Agent</h3>
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                {subtitle ? (
                  <p className="w-full text-sm text-muted-foreground">{subtitle}</p>
                ) : null}
                <div className="flex min-w-0 items-center gap-2">
                  {/* WBTC + USDC pool icons, to the left of the APR. */}
                  <div className="relative h-7 w-12 shrink-0" aria-label="WBTC / USDC pool">
                    <Image
                      src={WBTC_LOGO_APTOS}
                      alt="WBTC"
                      width={28}
                      height={28}
                      className="absolute left-0 top-0 h-7 w-7 rounded-full ring-2 ring-background"
                      unoptimized
                    />
                    <Image
                      src={USDC_LOGO_APTOS}
                      alt="USDC"
                      width={28}
                      height={28}
                      className="absolute left-5 top-0 h-7 w-7 rounded-full ring-2 ring-background"
                      unoptimized
                    />
                  </div>
                  {wbtcUsdcApr != null ? (
                    <div className="flex min-w-0 items-baseline gap-1 leading-none">
                      <span className="text-xl font-bold tabular-nums text-foreground">
                        {wbtcUsdcApr.toFixed(2)}%
                      </span>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Total APR
                      </span>
                    </div>
                  ) : null}
                </div>
                {hasHyperionSafe && hyperionSafeAddresses.length > 1 ? (
                  <Select value={selectedSafe ?? ''} onValueChange={setSelectedSafeAddress}>
                    <SelectTrigger
                      className="h-7 w-full max-w-[190px]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <SelectValue placeholder="Select safe" />
                    </SelectTrigger>
                    <SelectContent>
                      {hyperionSafeAddresses.map((safe) => (
                        <SelectItem key={safe} value={safe}>
                          {safe.slice(0, 6)}...{safe.slice(-4)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                <Badge
                  variant="secondary"
                  className="whitespace-nowrap border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300 leading-tight"
                >
                  WBTC/USDC LP
                </Badge>
                <Badge
                  variant="secondary"
                  className="whitespace-nowrap border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 leading-tight"
                >
                  Concentrated LP
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
            ) : !hasHyperionSafe ? (
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
                Create Hyperion Agent
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

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto p-6 rounded-2xl w-[calc(100vw-2rem)] sm:w-auto [&>button:last-child]:hidden">
          <DialogHeader>
            <div className="flex items-start justify-between gap-2">
              <DialogTitle>Create Hyperion Agent</DialogTitle>
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
              Create a non-custodial safe for concentrated-liquidity LP on Hyperion. The agent can only
              deploy funds into whitelisted USDC-leg pools — withdrawals to your wallet are yours alone.
            </DialogDescription>
          </DialogHeader>
          <div className="h-2" />

          <YieldAiSafeSettingsForm
            fixedStrategy="hyperion_lp"
            createButtonLabel="Create Hyperion Agent"
            onCreated={() => {
              setSettingsOpen(false);
              setOpenDepositAfterCreate(true);
            }}
          />
        </DialogContent>
      </Dialog>

      <WalletConnectDialog open={walletDialogOpen} onOpenChange={setWalletDialogOpen} />

      <DepositModal
        isOpen={depositOpen}
        onClose={() => setDepositOpen(false)}
        {...buildHyperionAgentDepositModalConfig({
          aiAgentLogoUrl: aiAgentProtocol?.logoUrl ?? '/logo.png',
          hyperionLogoUrl: protocol?.logoUrl,
          yieldAiSafeAddress: selectedSafe ?? undefined,
          onDepositSuccess: handleManagePosition,
        })}
      />
    </>
  );
}
