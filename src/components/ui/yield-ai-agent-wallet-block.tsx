'use client';

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import Image from 'next/image';
import { useWalletData } from '@/contexts/WalletContext';
import { useYieldAiSafes } from '@/lib/query/hooks/protocols/yield-ai';
import {
  dispatchSelectYieldAiSafe,
  SELECT_SAFE_EVENT,
} from '@/lib/query/hooks/protocols/yield-ai/useSelectedYieldAiSafe';
import { useBatchSafeStrategies } from '@/lib/query/hooks/protocols/yield-ai/useBatchSafeStrategies';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { YieldAiSafeSettingsForm } from '@/components/ui/yield-ai-safe-settings-form';
import { DepositModal } from '@/components/ui/deposit-modal';
import { cn } from '@/lib/utils';
import { getProtocolByName } from '@/lib/protocols/getProtocolsList';
import { USDC_FA_METADATA_MAINNET, USD1_FA_METADATA_MAINNET } from '@/lib/constants/yieldAiVault';
import { normalizeAddress, toCanonicalAddress } from '@/lib/utils/addressNormalization';
import { LineChart, X } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useProtocol } from '@/lib/contexts/ProtocolContext';
import { useMobileManagement } from '@/contexts/MobileManagementContext';
import { AI_AGENT_STRATEGIES } from '@/lib/protocols/yield-ai/strategyRegistry';
import { useCardTokenDrop } from '@/hooks/useCardTokenDrop';
import { useEchelonPools } from '@/lib/query/hooks/protocols/echelon/useEchelonPools';
import { WalletConnectDialog } from '@/components/ui/wallet-connect-dialog';

export interface YieldAiAgentWalletBlockProps {
  className?: string;
}

export interface YieldAiStablecoinAgentActionProps {
  className?: string;
}

const USDC_LOGO_APTOS = 'https://assets.panora.exchange/tokens/aptos/USDC.svg';
const USD1_LOGO_APTOS = 'https://assets.panora.exchange/tokens/aptos/USD1.png';

/** Stablecoins the AI agent safe accepts as a deposit. */
const AI_AGENT_DEPOSIT_TOKENS = [
  { symbol: 'USDC', logo: USDC_LOGO_APTOS, decimals: 6, address: USDC_FA_METADATA_MAINNET },
  { symbol: 'USD1', logo: USD1_LOGO_APTOS, decimals: 6, address: USD1_FA_METADATA_MAINNET },
];

const DECIBEL_STRATEGY_ID = 'decibel_delta_neutral' as const;
const HYPERION_STRATEGY_ID = 'hyperion_lp' as const;

function stablecoinSelectedStorageKey(owner: string) {
  return `yield-ai:selectedStablecoinSafe:${owner.toLowerCase()}`;
}

function primarySelectedStorageKey(owner: string) {
  return `yield-ai:selectedSafe:${owner.toLowerCase()}`;
}

export function YieldAiStablecoinAgentAction({ className }: YieldAiStablecoinAgentActionProps) {
  const { address, tokens } = useWalletData();
  const protocol = getProtocolByName('AI agent');
  const { data: safeAddresses = [], isLoading: safesLoading, isFetched: safesFetched } = useYieldAiSafes(address, {
    enabled: Boolean(address),
    refetchOnMount: 'always',
  });

  const normalizedAllSafes = useMemo(
    () => Array.from(new Set(safeAddresses.map((a) => toCanonicalAddress(a)))),
    [safeAddresses]
  );
  const { strategiesMap, isLoading: strategiesLoading } = useBatchSafeStrategies(normalizedAllSafes);
  const strategiesResolved = normalizedAllSafes.length === 0 || !strategiesLoading;
  const stablecoinSafes = useMemo(() => {
    if (!strategiesResolved) return [];
    return normalizedAllSafes.filter((safe) => {
      const id = strategiesMap.get(safe)?.activeStrategyId;
      return id !== DECIBEL_STRATEGY_ID && id !== HYPERION_STRATEGY_ID;
    });
  }, [normalizedAllSafes, strategiesMap, strategiesResolved]);

  const isResolvingSafes =
    Boolean(address) && (safesLoading || (normalizedAllSafes.length > 0 && strategiesLoading));
  const [selectedStablecoinSafe, setSelectedStablecoinSafe] = useState<string | null>(null);

  useEffect(() => {
    if (!address || !safesFetched || !strategiesResolved) return;
    const list = stablecoinSafes;
    if (list.length === 0) {
      setSelectedStablecoinSafe(null);
      return;
    }
    let persistedStable: string | null = null;
    let persistedPrimary: string | null = null;
    try {
      const rawS = window.localStorage.getItem(stablecoinSelectedStorageKey(address));
      persistedStable = rawS ? toCanonicalAddress(rawS) : null;
    } catch {
      persistedStable = null;
    }
    try {
      const rawP = window.localStorage.getItem(primarySelectedStorageKey(address));
      persistedPrimary = rawP ? toCanonicalAddress(rawP) : null;
    } catch {
      persistedPrimary = null;
    }
    const next =
      persistedStable && list.includes(persistedStable)
        ? persistedStable
        : persistedPrimary && list.includes(persistedPrimary)
          ? persistedPrimary
          : list[0];
    setSelectedStablecoinSafe((prev) => (prev === next ? prev : next));
    try {
      window.localStorage.setItem(stablecoinSelectedStorageKey(address), next);
    } catch {
      // ignore
    }
  }, [address, safesFetched, strategiesResolved, stablecoinSafes]);

  const stablecoinSafesKey = stablecoinSafes.join(',');
  useEffect(() => {
    if (!address) return;
    const ownerLc = address.toLowerCase();
    const onSelect = (e: Event) => {
      const detail = (e as CustomEvent<{ owner: string; safeAddress: string }>).detail;
      if (!detail || detail.owner.toLowerCase() !== ownerLc) return;
      const v = toCanonicalAddress(detail.safeAddress);
      const list = stablecoinSafesKey
        ? stablecoinSafesKey.split(',').map((x) => toCanonicalAddress(x))
        : [];
      if (!list.includes(v)) return;
      setSelectedStablecoinSafe(v);
      try {
        window.localStorage.setItem(stablecoinSelectedStorageKey(address), v);
      } catch {
        // ignore
      }
    };
    window.addEventListener(SELECT_SAFE_EVENT, onSelect);
    return () => window.removeEventListener(SELECT_SAFE_EVENT, onSelect);
  }, [address, stablecoinSafesKey]);

  const safeAddress = selectedStablecoinSafe;
  const hasStablecoinSafe = stablecoinSafes.length > 0;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [openDepositAfterCreate, setOpenDepositAfterCreate] = useState(false);

  const yieldAiSafeOptions = useMemo(
    () =>
      stablecoinSafes.map((addr) => {
        const id = strategiesMap.get(addr)?.activeStrategyId ?? 'stablecoin_compound';
        return {
          address: addr,
          strategyLabel: AI_AGENT_STRATEGIES[id]?.label ?? 'Stablecoin compound',
        };
      }),
    [stablecoinSafes, strategiesMap]
  );

  const handleYieldAiSafeChange = (addr: string) => {
    const canon = toCanonicalAddress(addr);
    setSelectedStablecoinSafe(canon);
    if (address) {
      try {
        window.localStorage.setItem(stablecoinSelectedStorageKey(address), canon);
      } catch {
        // ignore
      }
      dispatchSelectYieldAiSafe(address, canon);
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
      {isResolvingSafes ? (
        <Button size="sm" variant="outline" disabled className={cn('w-full', className)}>
          CheckingвЂ¦
        </Button>
      ) : !hasStablecoinSafe ? (
        <Button
          size="sm"
          onClick={() => setSettingsOpen(true)}
          disabled={!address || safesLoading}
          className={cn('w-full bg-black text-white hover:bg-black/90', className)}
        >
          Create AI agent wallet
        </Button>
      ) : (
        <Button
          size="sm"
          className={cn('w-full bg-success text-success-foreground hover:bg-success/90', className)}
          onClick={() => setDepositOpen(true)}
          disabled={!address || !safeAddress}
        >
          Deposit
        </Button>
      )}

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
        tokenIn={AI_AGENT_DEPOSIT_TOKENS[0]}
        tokenOut={AI_AGENT_DEPOSIT_TOKENS[0]}
        tokenInOptions={AI_AGENT_DEPOSIT_TOKENS}
        priceUSD={walletUsdcPriceUsd}
        yieldAiSafeAddress={safeAddress ?? undefined}
        yieldAiSafeOptions={yieldAiSafeOptions}
        onYieldAiSafeChange={handleYieldAiSafeChange}
      />
    </>
  );
}

export function YieldAiAgentWalletBlock({ className }: YieldAiAgentWalletBlockProps) {
  const { address, tokens } = useWalletData();
  const protocol = getProtocolByName('AI agent');
  const [logoError, setLogoError] = useState(false);
  const { setSelectedProtocol } = useProtocol();
  const { setActiveTab, scrollToTop } = useMobileManagement();

  const { data: safeAddresses = [], isLoading: safesLoading, isFetched: safesFetched } = useYieldAiSafes(address, {
    enabled: Boolean(address),
    refetchOnMount: 'always',
  });

  const normalizedAllSafes = useMemo(
    () => Array.from(new Set(safeAddresses.map((a) => toCanonicalAddress(a)))),
    [safeAddresses]
  );

  const { strategiesMap, isLoading: strategiesLoading } = useBatchSafeStrategies(normalizedAllSafes);

  const strategiesResolved = normalizedAllSafes.length === 0 || !strategiesLoading;

  const stablecoinSafes = useMemo(() => {
    if (!strategiesResolved) return [];
    // Hyperion LP safes get their own dedicated card later — keep them out
    // of the stablecoin agent's safe list (and out of the deposit-modal
    // switcher) so users don't accidentally fund a Hyperion safe here.
    return normalizedAllSafes.filter((safe) => {
      const id = strategiesMap.get(safe)?.activeStrategyId;
      return id !== DECIBEL_STRATEGY_ID && id !== HYPERION_STRATEGY_ID;
    });
  }, [normalizedAllSafes, strategiesMap, strategiesResolved]);

  const isResolvingSafes =
    Boolean(address) && (safesLoading || (normalizedAllSafes.length > 0 && strategiesLoading));

  const [selectedStablecoinSafe, setSelectedStablecoinSafe] = useState<string | null>(null);

  useEffect(() => {
    if (!address || !safesFetched || !strategiesResolved) return;
    const list = stablecoinSafes;
    if (list.length === 0) {
      setSelectedStablecoinSafe(null);
      return;
    }
    let persistedStable: string | null = null;
    let persistedPrimary: string | null = null;
    try {
      const rawS = window.localStorage.getItem(stablecoinSelectedStorageKey(address));
      persistedStable = rawS ? toCanonicalAddress(rawS) : null;
    } catch {
      persistedStable = null;
    }
    try {
      const rawP = window.localStorage.getItem(primarySelectedStorageKey(address));
      persistedPrimary = rawP ? toCanonicalAddress(rawP) : null;
    } catch {
      persistedPrimary = null;
    }
    const next =
      persistedStable && list.includes(persistedStable)
        ? persistedStable
        : persistedPrimary && list.includes(persistedPrimary)
          ? persistedPrimary
          : list[0];
    setSelectedStablecoinSafe((prev) => (prev === next ? prev : next));
    if (next) {
      try {
        window.localStorage.setItem(stablecoinSelectedStorageKey(address), next);
      } catch {
        // ignore
      }
    }
  }, [address, safesFetched, strategiesResolved, stablecoinSafes]);

  const stablecoinSafesKey = stablecoinSafes.join(',');
  useEffect(() => {
    if (!address) return;
    const ownerLc = address.toLowerCase();
    const onSelect = (e: Event) => {
      const detail = (e as CustomEvent<{ owner: string; safeAddress: string }>).detail;
      if (!detail || detail.owner.toLowerCase() !== ownerLc) return;
      const v = toCanonicalAddress(detail.safeAddress);
      const list = stablecoinSafesKey
        ? stablecoinSafesKey.split(',').map((x) => toCanonicalAddress(x))
        : [];
      if (!list.includes(v)) return;
      setSelectedStablecoinSafe(v);
      try {
        window.localStorage.setItem(stablecoinSelectedStorageKey(address), v);
      } catch {
        // ignore
      }
    };
    window.addEventListener(SELECT_SAFE_EVENT, onSelect);
    return () => window.removeEventListener(SELECT_SAFE_EVENT, onSelect);
  }, [address, stablecoinSafesKey]);

  const safeAddress = selectedStablecoinSafe;
  const hasStablecoinSafe = stablecoinSafes.length > 0;
  const hasAnySafe = normalizedAllSafes.length > 0;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [walletDialogOpen, setWalletDialogOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [openDepositAfterCreate, setOpenDepositAfterCreate] = useState(false);
  const [depositTokenSymbol, setDepositTokenSymbol] = useState('USDC');
  const depositToken =
    AI_AGENT_DEPOSIT_TOKENS.find((t) => t.symbol === depositTokenSymbol) ??
    AI_AGENT_DEPOSIT_TOKENS[0];

  // Desktop drag-drop: dropping USDC/USD1 from the wallet opens the deposit
  // flow preselected to that token (or the create-safe dialog if none yet).
  const { isDraggingAccepted, isOver, dragHandlers } = useCardTokenDrop({
    acceptedTokens: AI_AGENT_DEPOSIT_TOKENS,
    onDrop: (token) => {
      if (!address) return;
      if (hasStablecoinSafe && safeAddress) {
        setDepositTokenSymbol(token.symbol);
        setDepositOpen(true);
      } else {
        setSettingsOpen(true);
      }
    },
  });

  const subtitle = useMemo(() => {
    if (!address) return 'Connect your wallet to create and fund an AI agent wallet.';
    if (isResolvingSafes) return 'Checking wallet…';
    if (!hasAnySafe) return 'Create an AI agent wallet (safe) with spending limits.';
    if (!hasStablecoinSafe) {
      return 'No stablecoin AI agent wallet yet — create one for USDC yield.';
    }
    // With a stablecoin safe selected we surface the strategy via the badge
    // below; the raw address is intentionally hidden from the main page.
    return '';
  }, [address, hasAnySafe, hasStablecoinSafe, isResolvingSafes]);

  // The stablecoin-compound strategy is hard-wired to the Echelon USD1
  // supply market (see strategyRegistry.ts). We surface that pool's live
  // depositApy as the headline APR of this card — shown unconditionally
  // (even before a safe exists) because the card itself is the entry
  // point into that exact strategy.
  const { data: echelonPoolsResp } = useEchelonPools();
  const stablecoinCompoundApr = useMemo(() => {
    const target = normalizeAddress(USD1_FA_METADATA_MAINNET);
    const pool = echelonPoolsResp?.data?.find(
      (p) => p.token && normalizeAddress(p.token) === target
    );
    return pool?.depositApy ?? null;
  }, [echelonPoolsResp]);

  /** Stablecoin safes annotated with their resolved strategy label, for the
   *  safe-switcher in the deposit modal. */
  const yieldAiSafeOptions = useMemo(
    () =>
      stablecoinSafes.map((addr) => {
        const id = strategiesMap.get(addr)?.activeStrategyId ?? 'stablecoin_compound';
        return {
          address: addr,
          strategyLabel: AI_AGENT_STRATEGIES[id]?.label ?? 'Stablecoin compound',
        };
      }),
    [stablecoinSafes, strategiesMap]
  );

  const handleYieldAiSafeChange = (addr: string) => {
    const canon = toCanonicalAddress(addr);
    setSelectedStablecoinSafe(canon);
    if (address) {
      try {
        window.localStorage.setItem(stablecoinSelectedStorageKey(address), canon);
      } catch {
        // ignore
      }
      dispatchSelectYieldAiSafe(address, canon);
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

  // Switch the manage-positions view to this safe (mirrors the Decibel card).
  const handleManagePosition = () => {
    if (!address || !safeAddress) return;
    dispatchSelectYieldAiSafe(address, safeAddress);
    if (protocol) {
      setSelectedProtocol(protocol);
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

  const isCardClickable = hasStablecoinSafe && !isResolvingSafes;

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
        aria-label={isCardClickable ? 'Manage Yield AI Stablecoin Agent' : undefined}
        onClick={isCardClickable ? handleCardClick : undefined}
        onKeyDown={isCardClickable ? handleCardKeyDown : undefined}
        className={cn(
          // Use an explicit emerald hue for drop-target feedback: the app's
          // `--success` token is greyscale (used for the dark Deposit button),
          // so success/* tints would render grey, not green.
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
          {/* Header: icon + title + subtitle (own row → no truncation). */}
          <div className="flex items-start gap-3 min-w-0">
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
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold text-primary leading-tight">Yield AI Stablecoin Agent</h3>
              {subtitle ? (
                <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>
              ) : null}
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                {/* Stacked USDC + USD1 logos — shown unconditionally so it is
                    obvious which stablecoins this agent accepts. */}
                <div className="relative h-7 w-12 shrink-0" aria-label="Accepts USDC and USD1">
                  <Image
                    src={USDC_LOGO_APTOS}
                    alt="USDC"
                    width={28}
                    height={28}
                    className="absolute left-0 top-0 h-7 w-7 rounded-full ring-2 ring-background"
                    unoptimized
                  />
                  <Image
                    src={USD1_LOGO_APTOS}
                    alt="USD1"
                    width={28}
                    height={28}
                    className="absolute left-5 top-0 h-7 w-7 rounded-full ring-2 ring-background"
                    unoptimized
                  />
                </div>
                {stablecoinCompoundApr != null ? (
                  <div className="flex shrink-0 items-baseline gap-1 leading-none">
                    <span className="text-xl font-bold tabular-nums text-foreground">
                      {stablecoinCompoundApr.toFixed(2)}%
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Total APR
                    </span>
                  </div>
                ) : null}
              </div>
              {/* Safe switcher and strategy tag moved into the Deposit modal —
                  that is where they actually matter. The Manage-positions button
                  always opens the last selected safe (persisted in localStorage). */}
            </div>
          </div>

          {/* Footer actions, pinned to the bottom so cards align in the row. */}
          <div
            className="mt-auto flex items-center justify-end gap-2 pt-1"
            onClick={isCardClickable ? (e) => e.stopPropagation() : undefined}
          >
            {isResolvingSafes ? (
              <Button size="sm" variant="outline" disabled className="w-full">
                Checking…
              </Button>
            ) : !hasStablecoinSafe ? (
              <Button
                size="sm"
                onClick={() => {
                  if (!address) {
                    setWalletDialogOpen(true);
                    return;
                  }
                  setSettingsOpen(true);
                }}
                disabled={safesLoading}
                className="w-full bg-black text-white hover:bg-black/90"
              >
                Create AI agent wallet
              </Button>
            ) : (
              <>
                {safeAddress && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 w-9 shrink-0 p-0"
                        onClick={handleManagePosition}
                        disabled={!address || !safeAddress}
                        aria-label="Manage positions"
                      >
                        <LineChart className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Manage positions</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                <Button
                  size="sm"
                  className="flex-1 bg-success text-success-foreground hover:bg-success/90"
                  onClick={() => {
                    setDepositTokenSymbol('USDC');
                    setDepositOpen(true);
                  }}
                  disabled={!address || !safeAddress}
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
        tokenIn={depositToken}
        tokenOut={depositToken}
        tokenInOptions={AI_AGENT_DEPOSIT_TOKENS}
        priceUSD={walletUsdcPriceUsd}
        yieldAiSafeAddress={safeAddress ?? undefined}
        yieldAiSafeOptions={yieldAiSafeOptions}
        onYieldAiSafeChange={handleYieldAiSafeChange}
        onDepositSuccess={handleManagePosition}
      />

      <WalletConnectDialog open={walletDialogOpen} onOpenChange={setWalletDialogOpen} />
    </>
  );
}
