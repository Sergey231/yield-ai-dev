'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { Loader2, Info, MoreHorizontal } from 'lucide-react';
import { BinChart } from '@/components/protocols/meteora/BinChart';
import { Button } from '@/components/ui/button';
import { Badge } from '@/shared/Badge/Badge';
import { TokenAmountInput } from '@/shared/DepositAmountInput';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { normalizeAddress } from '@/lib/utils/addressNormalization';
import { USDC_FA_METADATA_MAINNET } from '@/lib/constants/yieldAiVault';
import type { HyperionPositionView } from '@/lib/protocols/yield-ai/hyperionLp';
import lendingStyles from '@/shared/ProtocolCard/LendingProtocolCard/LendingProtocolCard.module.css';
import rowStyles from '@/components/protocols/manage-positions/protocols/yield-ai/HyperionPositionRow.module.css';

function fmt(raw: string, decimals: number): string {
  try {
    const v = Number(BigInt(raw)) / 10 ** decimals;
    return v.toLocaleString(undefined, { maximumFractionDigits: decimals > 6 ? 8 : 4 });
  } catch {
    return raw;
  }
}

function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/** Pool-price display at the pool's own precision (stables need 4 decimals). */
function fmtPoolPrice(v: number | null | undefined, decimals: number): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `$${v.toLocaleString(undefined, {
    minimumFractionDigits: decimals > 2 ? decimals : 0,
    maximumFractionDigits: decimals,
  })}`;
}

function tickToPrice(tick: number, decimalsA: number, decimalsB: number): number {
  return Math.pow(1.0001, tick) * 10 ** (decimalsA - decimalsB);
}

function formatOpenedAtLabel(openedAt: string): string | null {
  const n = Number(openedAt);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Elapsed time since on-chain `openedAt` (resets after re-center). */
function formatPositionAge(openedAtSec: number, nowSec = Math.floor(Date.now() / 1000)): string | null {
  if (!Number.isFinite(openedAtSec) || openedAtSec <= 0) return null;
  const elapsedSec = Math.max(0, nowSec - openedAtSec);
  const minutes = Math.floor(elapsedSec / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function isUsdcMetadata(addr: string): boolean {
  return normalizeAddress(addr) === normalizeAddress(USDC_FA_METADATA_MAINNET);
}

const LP_ACTION_DIALOG_CLOSE_BTN =
  '[&>button:last-child]:right-3 [&>button:last-child]:top-3 [&>button:last-child]:size-7 [&>button:last-child>svg]:size-3.5 sm:[&>button:last-child]:right-5 sm:[&>button:last-child]:top-5 sm:[&>button:last-child]:size-7 sm:[&>button:last-child>svg]:size-3.5 [&>button:last-child]:transition-colors [&>button:last-child]:hover:bg-muted/40';

const LP_ACTION_DIALOG_CONTENT_CLASS = cn(
  'flex w-full min-w-0 max-w-[min(100vw-2rem,425px)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[425px]',
  'max-h-[min(92dvh,100svh)]',
  'max-sm:top-[max(0.75rem,env(safe-area-inset-top,0px))] max-sm:translate-y-0',
  'max-sm:max-h-[calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-1.5rem)]',
  LP_ACTION_DIALOG_CLOSE_BTN
);

function formatSafeBalanceText(value: number, maxFrac: number, symbol: string): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: maxFrac })} ${symbol}`;
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string; logo?: string }>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="inline-flex w-full rounded-lg border p-0.5">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2.5 text-sm font-medium transition-colors sm:py-2',
              active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/50'
            )}
          >
            {opt.logo ? (
              <Image
                src={opt.logo}
                alt=""
                width={16}
                height={16}
                className="rounded-full"
                unoptimized
              />
            ) : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function InfoCallout({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-md border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground sm:text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 leading-snug">{children}</span>
    </div>
  );
}

/**
 * Pad on the derived token_b leg of a dual add. Hyperion sizes the added
 * liquidity from token_a and requires the matching token_b at the execution
 * tick — a shortfall aborts with pool_v3::EAMOUNT_B_INPUT_LESS. The price can
 * drift between input and execution, so over-supply token_b slightly; the
 * surplus returns to the safe as leftover.
 */
const ADD_B_PAD = 1.01;

type Accrued = {
  feesUsd: number;
  rewardsUsd: number;
  valueUsd: number | null;
  feesBreakdown?: Array<{ symbol: string; amount: number }>;
  rewardsBreakdown?: Array<{ symbol: string; amount: number }>;
  aprPct?: number | null;
  pnlUsd?: number | null;
  pnlUnavailableReason?: string | null;
  claimedUsd?: number;
};

export function HyperionPositionRow({
  p,
  index,
  busy,
  currentPrice,
  decimalsA,
  decimalsB,
  symbolA,
  symbolB,
  logoA,
  logoB,
  accrued,
  poolAprPct,
  chartTokenAMint,
  safeBalanceA,
  safeBalanceB,
  slippageBps,
  priceDecimals = 2,
  showPriceChart = true,
  chartPriceSource = 'birdeye',
  chartPoolKey,
  onClaim,
  onClose,
  onAddDual,
  onAddZap,
}: {
  p: HyperionPositionView;
  index: number;
  busy: string | null;
  currentPrice: number | null;
  decimalsA: number;
  decimalsB: number;
  symbolA: string;
  symbolB: string;
  logoA?: string;
  logoB?: string;
  accrued?: Accrued;
  poolAprPct?: number | null;
  chartTokenAMint: string;
  safeBalanceA: number;
  safeBalanceB: number;
  slippageBps: string;
  /** Decimals for pool-price displays (range bounds, chart) — 4 for stables. */
  priceDecimals?: number;
  showPriceChart?: boolean;
  /** Stable pools use Hyperion tick snapshots; volatile use Birdeye. */
  chartPriceSource?: 'birdeye' | 'hyperion-pool';
  chartPoolKey?: string;
  onClaim: () => void;
  onClose: (convert: boolean) => void;
  onAddDual: (amountABase: bigint, amountBBase: bigint) => void;
  /** Single-token add: the executor swaps the surplus to the range ratio. */
  onAddZap: (inputToken: 'tokenA' | 'usdc', amountBase: bigint) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [convertToUsdc, setConvertToUsdc] = useState(true);
  const [addA, setAddA] = useState('');
  const [addB, setAddB] = useState('');
  const [closePreviewUsd, setClosePreviewUsd] = useState<number | null>(null);
  const [closePreviewLoading, setClosePreviewLoading] = useState(false);
  const [closePreviewError, setClosePreviewError] = useState<string | null>(null);

  const addABase = useMemo(() => {
    const n = Number(addA);
    return n > 0 ? BigInt(Math.floor(n * 10 ** decimalsA)) : 0n;
  }, [addA, decimalsA]);
  const addBBase = useMemo(() => {
    const n = Number(addB);
    return n > 0 ? BigInt(Math.floor(n * 10 ** decimalsB)) : 0n;
  }, [addB, decimalsB]);

  // Dual-add leg pairing. The pool does NOT scale an unbalanced add down to
  // the smaller leg (`min = 0` notwithstanding), so the two amounts must
  // follow the position's own range ratio: editing one leg derives the other,
  // and "max" fills the largest pair both balances can cover.
  const addRatio = useMemo(() => {
    if (currentPrice == null || !(currentPrice > 0)) return null;
    // sqrt of the raw tick price (1.0001^tick), comparable with tick bounds.
    const sp = Math.sqrt(currentPrice * 10 ** (decimalsB - decimalsA));
    const spa = Math.pow(1.0001, p.tickLower / 2);
    const spb = Math.pow(1.0001, p.tickUpper / 2);
    if (sp >= spb) return { side: 'b' as const, bPerA: null };
    if (sp <= spa) return { side: 'a' as const, bPerA: null };
    const valA = sp - (sp * sp) / spb;
    const valB = sp - spa;
    if (!(valA > 0) || !(valB > 0)) return null;
    // token_b (≈USD) needed per 1 token_a, before padding.
    return { side: 'both' as const, bPerA: currentPrice * (valB / valA) };
  }, [currentPrice, decimalsA, decimalsB, p.tickLower, p.tickUpper]);

  const floorA = useCallback(
    (v: number) => Math.max(0, Math.floor(v * 10 ** decimalsA) / 10 ** decimalsA),
    [decimalsA]
  );
  const ceilB = (v: number) => Math.max(0, Math.ceil(v * 1e4) / 1e4);
  const requiredBForA = useCallback(
    (aHuman: number) => (addRatio?.bPerA ? aHuman * addRatio.bPerA * ADD_B_PAD : 0),
    [addRatio]
  );
  const aForBudgetB = useCallback(
    (bHuman: number) => (addRatio?.bPerA ? bHuman / ADD_B_PAD / addRatio.bPerA : 0),
    [addRatio]
  );

  const handleAddAChange = (raw: string) => {
    setAddA(raw);
    if (addRatio?.side !== 'both') return;
    const a = Number(raw);
    setAddB(a > 0 ? String(ceilB(requiredBForA(a))) : '');
  };
  const handleAddBChange = (raw: string) => {
    setAddB(raw);
    if (addRatio?.side !== 'both') return;
    const b = Number(raw);
    setAddA(b > 0 ? String(floorA(aForBudgetB(b))) : '');
  };
  // Largest ratio-correct pair both balances can cover (both "max" buttons).
  const fillAddMaxPair = () => {
    const a = floorA(Math.min(safeBalanceA, aForBudgetB(safeBalanceB)));
    const b = a > 0 ? Math.min(ceilB(requiredBForA(a)), safeBalanceB) : 0;
    setAddA(a > 0 ? String(a) : '');
    setAddB(b > 0 ? String(b) : '');
  };

  const addAHuman = Number(addA) || 0;
  const addBHuman = Number(addB) || 0;
  const addOverBalance = addAHuman > safeBalanceA + 1e-9 || addBHuman > safeBalanceB + 1e-9;
  const addAmountsInvalid =
    addRatio?.side === 'both'
      ? addABase <= 0n || addBBase <= 0n
      : addABase <= 0n && addBBase <= 0n;

  // Single-token ("zap") add: deposit one token, the executor swaps the
  // surplus to the position's range ratio. Default mode — it is the common
  // "top up with what I have" case; the token defaults to the larger balance.
  const [addMode, setAddMode] = useState<'zap' | 'dual'>('zap');
  const [zapToken, setZapToken] = useState<'tokenA' | 'usdc'>('tokenA');
  const [zapAmount, setZapAmount] = useState('');
  const zapInputRef = useRef<HTMLInputElement>(null);
  const addAInputRef = useRef<HTMLInputElement>(null);
  const addBInputRef = useRef<HTMLInputElement>(null);
  const zapDecimals = zapToken === 'tokenA' ? decimalsA : decimalsB;
  const zapBalance = zapToken === 'tokenA' ? safeBalanceA : safeBalanceB;
  const zapSymbol = zapToken === 'tokenA' ? symbolA : symbolB;
  const zapBase = useMemo(() => {
    const n = Number(zapAmount);
    return n > 0 ? BigInt(Math.floor(n * 10 ** zapDecimals)) : 0n;
  }, [zapAmount, zapDecimals]);
  const zapHuman = Number(zapAmount) || 0;
  const zapOverBalance = zapHuman > zapBalance + 1e-9;
  const zapLogo = zapToken === 'tokenA' ? (logoA ?? '/file.svg') : (logoB ?? '/file.svg');
  const zapPriceUsd = zapToken === 'tokenA' ? (currentPrice ?? 0) : 1;

  const setZapHalf = useCallback(() => {
    const v = Math.floor(zapBalance * 0.5 * 10 ** zapDecimals) / 10 ** zapDecimals;
    setZapAmount(v > 0 ? String(v) : '');
  }, [zapBalance, zapDecimals]);

  const setZapMax = useCallback(() => {
    const v = Math.floor(zapBalance * 10 ** zapDecimals) / 10 ** zapDecimals;
    setZapAmount(v > 0 ? String(v) : '');
  }, [zapBalance, zapDecimals]);

  const addConfirmDisabled =
    addMode === 'zap' ? zapBase <= 0n || zapOverBalance : addAmountsInvalid || addOverBalance;

  const lowerPrice = tickToPrice(p.tickLower, decimalsA, decimalsB);
  const upperPrice = tickToPrice(p.tickUpper, decimalsA, decimalsB);
  const amountAHuman = Number(p.amountA) / 10 ** decimalsA;
  const amountBHuman = Number(p.amountB) / 10 ** decimalsB;
  const valueA = currentPrice != null ? amountAHuman * currentPrice : null;
  const computedUsd = valueA != null ? valueA + amountBHuman : null;
  const totalUsd = accrued?.valueUsd != null ? accrued.valueUsd : computedUsd;

  const feesUsd = accrued?.feesUsd ?? 0;
  const rewardsUsd = accrued?.rewardsUsd ?? 0;
  const claimedUsd = accrued?.claimedUsd ?? 0;
  const uncollectedUsd = feesUsd + rewardsUsd;
  const totalEarnedUsd = claimedUsd + uncollectedUsd;
  const feesBreakdown = accrued?.feesBreakdown ?? [];
  const rewardsBreakdown = accrued?.rewardsBreakdown ?? [];

  const legAUsd = valueA;
  const legBUsd = amountBHuman;
  const compTotal = (legAUsd ?? 0) + legBUsd;
  const shareA = legAUsd != null && compTotal > 0 ? (legAUsd / compTotal) * 100 : null;
  const shareB = shareA != null ? 100 - shareA : null;

  const openedAtLabel = formatOpenedAtLabel(p.openedAt);
  const activeForLabel = formatPositionAge(Number(p.openedAt));

  const tokenAIsUsdc = isUsdcMetadata(p.tokenA);

  const pendingFeeAHuman = p.pendingFeeA ? Number(p.pendingFeeA) / 10 ** decimalsA : 0;
  const pendingFeeBHuman = p.pendingFeeB ? Number(p.pendingFeeB) / 10 ** decimalsB : 0;

  const nonUsdcHuman = tokenAIsUsdc
    ? amountBHuman + pendingFeeBHuman
    : amountAHuman + pendingFeeAHuman;
  const usdcLegHuman = tokenAIsUsdc
    ? amountAHuman + pendingFeeAHuman
    : amountBHuman + pendingFeeBHuman;
  const nonUsdcSymbol = tokenAIsUsdc ? symbolB : symbolA;
  const nonUsdcDecimals = tokenAIsUsdc ? decimalsB : decimalsA;
  const nonUsdcMetadata = tokenAIsUsdc ? p.tokenB : p.tokenA;
  const nonUsdcUsdAtSpot =
    tokenAIsUsdc ? amountBHuman + pendingFeeBHuman : valueA != null ? valueA + pendingFeeAHuman * (currentPrice ?? 1) : null;

  const keepProceedsUsd = useMemo(() => {
    if (totalUsd != null) return totalUsd + uncollectedUsd;
    if (computedUsd != null) return computedUsd + uncollectedUsd;
    return null;
  }, [totalUsd, computedUsd, uncollectedUsd]);

  const fmtTokenList = (list: Array<{ symbol: string; amount: number }>): string =>
    list.length
      ? list.map((t) => `${t.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${t.symbol}`).join(' · ')
      : 'none';

  const loadClosePreview = useCallback(async () => {
    if (!convertToUsdc) {
      setClosePreviewUsd(keepProceedsUsd);
      setClosePreviewError(null);
      setClosePreviewLoading(false);
      return;
    }

    if (nonUsdcHuman <= 0) {
      setClosePreviewUsd(usdcLegHuman);
      setClosePreviewError(null);
      setClosePreviewLoading(false);
      return;
    }

    setClosePreviewLoading(true);
    setClosePreviewError(null);
    try {
      const slippagePct = (Number(slippageBps) || 100) / 100;
      const res = await fetch('/api/swap/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'hyperion',
          fromTokenAddress: nonUsdcMetadata,
          toTokenAddress: USDC_FA_METADATA_MAINNET,
          amount: String(nonUsdcHuman),
          decimals: nonUsdcDecimals,
          slippagePercentage: String(slippagePct),
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.error) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      const quotedUsdc = Number(json.amountOut) / 10 ** 6;
      if (!Number.isFinite(quotedUsdc)) {
        throw new Error('Invalid quote');
      }
      setClosePreviewUsd(usdcLegHuman + quotedUsdc);
    } catch (e) {
      setClosePreviewUsd(null);
      setClosePreviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setClosePreviewLoading(false);
    }
  }, [
    convertToUsdc,
    keepProceedsUsd,
    nonUsdcHuman,
    nonUsdcMetadata,
    nonUsdcDecimals,
    slippageBps,
    usdcLegHuman,
  ]);

  useEffect(() => {
    if (!closeOpen) return;
    void loadClosePreview();
  }, [closeOpen, convertToUsdc, loadClosePreview]);

  const swapLossUsd =
    convertToUsdc && closePreviewUsd != null && nonUsdcUsdAtSpot != null
      ? Math.max(0, nonUsdcUsdAtSpot + usdcLegHuman - closePreviewUsd)
      : null;

  const closeBusy = busy === `close:${p.position}` || busy === `convert:${p.position}`;
  const claimBusy = busy === `claim:${p.position}`;
  const addBusy = busy === `add:${p.position}`;

  const addConfirmHint = useMemo(() => {
    if (addBusy) return null;
    if (addMode === 'zap') {
      if (zapOverBalance) return 'Exceeds safe balance';
      if (zapBase <= 0n) return 'Enter an amount';
      return null;
    }
    if (addOverBalance) return 'Exceeds safe balance';
    if (addAmountsInvalid) return 'Enter valid amounts for both legs';
    return null;
  }, [addBusy, addMode, zapOverBalance, zapBase, addOverBalance, addAmountsInvalid]);

  const handleConfirmClose = () => {
    onClose(convertToUsdc);
    setCloseOpen(false);
  };

  const handleConfirmAdd = () => {
    if (addMode === 'zap') {
      onAddZap(zapToken, zapBase);
    } else {
      onAddDual(addABase, addBBase);
    }
    setAddOpen(false);
    setAddA('');
    setAddB('');
    setZapAmount('');
  };

  const openAddDialog = () => {
    setAddA('');
    setAddB('');
    setZapAmount('');
    setAddMode('zap');
    setZapToken(safeBalanceA * (currentPrice ?? 1) >= safeBalanceB ? 'tokenA' : 'usdc');
    setAddOpen(true);
  };

  const openCloseDialog = () => {
    setConvertToUsdc(true);
    setCloseOpen(true);
  };

  const actionsBusy = busy !== null;

  const aprLabel =
    accrued?.aprPct != null && p.active
      ? `${accrued.aprPct.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}%`
      : poolAprPct != null && p.active
        ? `${poolAprPct.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}%`
        : null;

  const renderApr = () =>
    aprLabel ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="success" className={lendingStyles.aprPill}>
            {aprLabel}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="max-w-[240px] text-xs">
            {accrued?.aprPct != null
              ? 'Realized APR: total earned (claimed + unclaimed fees and rewards) vs the USD you deposited, annualized over the position age. Falls back to current value if the deposit basis is not indexed.'
              : 'Pool headline APR (fees + rewards while in range).'}
          </p>
        </TooltipContent>
      </Tooltip>
    ) : (
      <span className={lendingStyles.aprEmpty}>—</span>
    );

  return (
    <>
      <div className={lendingStyles.row}>
        <div className={lendingStyles.tableRow}>
          <div className={lendingStyles.colAsset}>
            <div className={lendingStyles.assetCell}>
              <div className="flex shrink-0 items-center -space-x-2">
                {logoA ? (
                  <Image
                    src={logoA}
                    alt={symbolA}
                    width={36}
                    height={36}
                    className={lendingStyles.logoLg}
                    unoptimized
                  />
                ) : (
                  <div className={lendingStyles.logoLg} aria-hidden />
                )}
                {logoB ? (
                  <Image
                    src={logoB}
                    alt={symbolB}
                    width={36}
                    height={36}
                    className={cn(lendingStyles.logoLg, 'ring-2 ring-background')}
                    unoptimized
                  />
                ) : (
                  <div className={cn(lendingStyles.logoLg, 'ring-2 ring-background')} aria-hidden />
                )}
              </div>
              <div className={lendingStyles.assetMeta}>
                <div className={cn(lendingStyles.assetTop, rowStyles.poolAssetTop)}>
                  <span className={cn(lendingStyles.assetSymbol, rowStyles.poolSymbol)}>
                    {symbolA}/{symbolB}
                  </span>
                  <Badge variant={p.active ? 'success' : 'outline'} className={lendingStyles.roleBadge}>
                    {p.active ? 'Active' : 'Inactive'}
                  </Badge>
                  <div className={cn(lendingStyles.aprInlineMobile, rowStyles.aprInline)}>{renderApr()}</div>
                </div>
              </div>
            </div>
          </div>

          <div className={lendingStyles.colApr}>{renderApr()}</div>

          <div className={lendingStyles.colValue}>
            <div className={lendingStyles.valueCell}>
              <div className={lendingStyles.valueUsd}>{totalUsd != null ? fmtUsd(totalUsd) : '—'}</div>
              {totalEarnedUsd > 0 ? (
                <div className="text-sm font-semibold tabular-nums text-green-600 dark:text-green-400">
                  +{fmtUsd(totalEarnedUsd)} earned
                </div>
              ) : null}
            </div>
          </div>

          <div className={cn(lendingStyles.colActions, rowStyles.colActionsContainer)}>
            <div className={cn(lendingStyles.actionsCell, rowStyles.actionsCell)}>
              <div className={rowStyles.actionsDesktop}>
                <Button
                  size="sm"
                  variant="outline"
                  className={cn('h-8 shrink-0 p-0', rowStyles.iconActionBtn)}
                  aria-label="Position details"
                  disabled={actionsBusy}
                  onClick={() => setDetailsOpen(true)}
                >
                  <Info className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={rowStyles.textActionBtn}
                  disabled={actionsBusy}
                  onClick={openAddDialog}
                >
                  {addBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={rowStyles.textActionBtn}
                  disabled={actionsBusy || uncollectedUsd <= 0}
                  onClick={onClaim}
                >
                  {claimBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Claim'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={rowStyles.textActionBtn}
                  disabled={actionsBusy}
                  onClick={openCloseDialog}
                >
                  {closeBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Close'}
                </Button>
              </div>

              <div className={rowStyles.actionsCompact}>
                <Button
                  size="sm"
                  variant="outline"
                  className={cn('h-8 shrink-0 p-0', rowStyles.iconActionBtn)}
                  aria-label="Position details"
                  disabled={actionsBusy}
                  onClick={() => setDetailsOpen(true)}
                >
                  <Info className="h-3.5 w-3.5" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className={cn('h-8 shrink-0 cursor-pointer p-0', rowStyles.iconActionBtn)}
                      aria-label="Position actions"
                      disabled={actionsBusy}
                    >
                      {addBusy || claimBusy || closeBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="cursor-pointer"
                      disabled={actionsBusy}
                      onSelect={openAddDialog}
                    >
                      {addBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Add liquidity
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="cursor-pointer"
                      disabled={actionsBusy || uncollectedUsd <= 0}
                      onSelect={onClaim}
                    >
                      {claimBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Claim fees
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="cursor-pointer"
                      variant="destructive"
                      disabled={actionsBusy}
                      onSelect={openCloseDialog}
                    >
                      {closeBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Close position
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <div className="max-h-[90dvh] overflow-y-auto overscroll-contain px-6 pb-6 pt-6">
            <DialogHeader className="pr-8 text-left">
              <DialogTitle>
                {symbolA}/{symbolB} position #{index}
              </DialogTitle>
              <DialogDescription>
                fee {p.feeTier} · range {fmtPoolPrice(lowerPrice, priceDecimals)} – {fmtPoolPrice(upperPrice, priceDecimals)}
              </DialogDescription>
            </DialogHeader>
            {showPriceChart &&
            currentPrice != null &&
            Number.isFinite(lowerPrice) &&
            Number.isFinite(upperPrice) ? (
              <div className="mt-4 border-b pb-4">
                <BinChart
                  tokenXMint={chartTokenAMint}
                  tokenXSymbol={symbolA}
                  tokenYSymbol={symbolB}
                  chain="aptos"
                  priceSource={chartPriceSource}
                  poolKey={chartPoolKey}
                  height={220}
                  lowerBinPrice={lowerPrice}
                  upperBinPrice={upperPrice}
                  activeBinPrice={currentPrice}
                  lowerLabel="Min"
                  upperLabel="Max"
                  priceDecimals={priceDecimals}
                />
              </div>
            ) : null}
            <div className="mt-4 space-y-3 text-sm">
            {openedAtLabel || activeForLabel ? (
              <>
                {openedAtLabel ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Open since</span>
                    <span className="tabular-nums">{openedAtLabel}</span>
                  </div>
                ) : null}
                {activeForLabel ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Active for</span>
                    <span className="tabular-nums">{activeForLabel}</span>
                  </div>
                ) : null}
              </>
            ) : null}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Position value</span>
              <span className="font-medium tabular-nums">{totalUsd != null ? fmtUsd(totalUsd) : '—'}</span>
            </div>
            {accrued?.pnlUsd != null ? (
              <div className="space-y-0.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">PnL</span>
                  <span
                    className={cn(
                      'font-medium tabular-nums',
                      accrued.pnlUsd >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'
                    )}
                  >
                    {accrued.pnlUsd >= 0 ? '+' : '−'}
                    {fmtUsd(Math.abs(accrued.pnlUsd)).slice(1)}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Position value + earned (claimed and unclaimed) minus deployed basis from vault events.
                  Includes impermanent loss; not the same as earned alone.
                </p>
              </div>
            ) : accrued?.pnlUnavailableReason ? (
              <div className="text-xs text-muted-foreground">PnL unavailable: {accrued.pnlUnavailableReason}</div>
            ) : null}
            <div className="space-y-1 border-t pt-3">
              <div className="text-xs font-medium text-muted-foreground">Composition</div>
              <div className="flex justify-between text-xs">
                <span>{symbolA}</span>
                <span className="tabular-nums">
                  {fmt(p.amountA, decimalsA)}
                  {legAUsd != null ? ` · ${fmtUsd(legAUsd)}` : ''}
                  {shareA != null ? ` · ${shareA.toFixed(0)}%` : ''}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span>{symbolB}</span>
                <span className="tabular-nums">
                  {fmt(p.amountB, decimalsB)} · {fmtUsd(legBUsd)}
                  {shareB != null ? ` · ${shareB.toFixed(0)}%` : ''}
                </span>
              </div>
              {shareA != null ? (
                <div className="flex h-1.5 w-full overflow-hidden rounded bg-muted">
                  <div style={{ width: `${shareA}%`, backgroundColor: 'rgba(249,115,22,0.7)' }} />
                  <div className="flex-1" style={{ backgroundColor: 'rgba(59,130,246,0.7)' }} />
                </div>
              ) : null}
            </div>
            <div className="space-y-1 border-t pt-3">
              <div className="text-xs font-medium text-muted-foreground">Fees + rewards</div>
              <div className="flex justify-between text-xs">
                <span>Total earned</span>
                <span className="font-medium tabular-nums">{fmtUsd(totalEarnedUsd)}</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Claimed</span>
                <span className="tabular-nums">{fmtUsd(claimedUsd)}</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Unclaimed</span>
                <span className="tabular-nums">{fmtUsd(uncollectedUsd)}</span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                fees {fmtUsd(feesUsd)} — {fmtTokenList(feesBreakdown)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                rewards {fmtUsd(rewardsUsd)} — {fmtTokenList(rewardsBreakdown)}
              </div>
            </div>
            <div className="space-y-1 border-t pt-3 text-xs">
              <div className="font-medium text-muted-foreground">APR</div>
              {accrued?.aprPct != null ? (
                <div className="flex justify-between">
                  <span>Realized (earned / value)</span>
                  <span className="tabular-nums">~{accrued.aprPct.toFixed(1)}%</span>
                </div>
              ) : null}
              {poolAprPct != null ? (
                <div className="flex justify-between text-muted-foreground">
                  <span>Pool headline</span>
                  <span className="tabular-nums">~{poolAprPct.toFixed(1)}%</span>
                </div>
              ) : null}
            </div>
          </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className={LP_ACTION_DIALOG_CONTENT_CLASS}>
          <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-6">
            <DialogHeader className="min-w-0 pr-11 text-left sm:pr-12">
              <div className="flex min-w-0 items-center gap-2">
                <div className="relative h-7 w-10 shrink-0">
                  {logoA ? (
                    <Image
                      src={logoA}
                      alt={symbolA}
                      width={28}
                      height={28}
                      className="h-7 w-7 rounded-full"
                      unoptimized
                    />
                  ) : null}
                  {logoB ? (
                    <Image
                      src={logoB}
                      alt={symbolB}
                      width={16}
                      height={16}
                      className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full ring-2 ring-background"
                      unoptimized
                    />
                  ) : null}
                </div>
                <DialogTitle className="min-w-0 truncate text-base sm:text-lg">
                  Add liquidity · {symbolA}/{symbolB}
                </DialogTitle>
              </div>
              <DialogDescription>
                {addMode === 'zap'
                  ? 'Deposit one token — the vault swaps the surplus to match the range.'
                  : 'Deposit both legs from the safe into this position (no swap).'}
              </DialogDescription>
            </DialogHeader>

            <SegmentedControl
              value={addMode}
              onChange={setAddMode}
              options={[
                { value: 'zap', label: 'Single token' },
                { value: 'dual', label: 'Both tokens' },
              ]}
            />

            {addMode === 'zap' ? (
              <div className="space-y-3">
                <SegmentedControl
                  value={zapToken}
                  onChange={(t) => {
                    setZapToken(t);
                    setZapAmount('');
                  }}
                  options={[
                    { value: 'tokenA', label: symbolA, logo: logoA },
                    { value: 'usdc', label: symbolB, logo: logoB },
                  ]}
                />
                <TokenAmountInput
                  tokenLogoUrl={zapLogo}
                  tokenSymbol={zapSymbol}
                  amountString={zapAmount}
                  onAmountChange={(v) => setZapAmount(v.replace(/[^0-9.]/g, ''))}
                  priceUSD={zapPriceUsd}
                  availableText={formatSafeBalanceText(
                    zapBalance,
                    zapDecimals > 6 ? 6 : zapDecimals > 2 ? 4 : 2,
                    zapSymbol
                  )}
                  inputRef={zapInputRef}
                  onHalf={setZapHalf}
                  onMax={setZapMax}
                  isOverBalance={zapOverBalance}
                />
                {zapOverBalance ? (
                  <p className="text-sm text-red-500">
                    Exceeds safe balance ({formatSafeBalanceText(zapBalance, 6, zapSymbol)}).
                  </p>
                ) : (
                  <InfoCallout>
                    Part of the {zapSymbol} is swapped to the position&apos;s range ratio (pool fee +
                    slippage apply); leftovers return to the safe.
                  </InfoCallout>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-col gap-3">
                  <div
                    className={cn(addRatio?.side === 'b' && 'pointer-events-none opacity-50')}
                    aria-disabled={addRatio?.side === 'b'}
                  >
                    <TokenAmountInput
                      tokenLogoUrl={logoA ?? '/file.svg'}
                      tokenSymbol={symbolA}
                      amountString={addA}
                      onAmountChange={(v) => handleAddAChange(v.replace(/[^0-9.]/g, ''))}
                      priceUSD={currentPrice ?? 0}
                      availableText={formatSafeBalanceText(safeBalanceA, 6, symbolA)}
                      inputRef={addAInputRef}
                      onHalf={() =>
                        handleAddAChange(String(floorA(safeBalanceA * 0.5)))
                      }
                      onMax={() =>
                        addRatio?.side === 'both'
                          ? fillAddMaxPair()
                          : setAddA(String(floorA(safeBalanceA)))
                      }
                      isOverBalance={addAHuman > safeBalanceA + 1e-9}
                    />
                  </div>
                  <div
                    className={cn(addRatio?.side === 'a' && 'pointer-events-none opacity-50')}
                    aria-disabled={addRatio?.side === 'a'}
                  >
                    <TokenAmountInput
                      tokenLogoUrl={logoB ?? '/file.svg'}
                      tokenSymbol={symbolB}
                      amountString={addB}
                      onAmountChange={(v) => handleAddBChange(v.replace(/[^0-9.]/g, ''))}
                      priceUSD={1}
                      availableText={formatSafeBalanceText(safeBalanceB, 2, symbolB)}
                      inputRef={addBInputRef}
                      onHalf={() =>
                        handleAddBChange(
                          String(Math.floor(safeBalanceB * 0.5 * 100) / 100)
                        )
                      }
                      onMax={() =>
                        addRatio?.side === 'both'
                          ? fillAddMaxPair()
                          : setAddB(String(Math.floor(safeBalanceB * 100) / 100))
                      }
                      isOverBalance={addBHuman > safeBalanceB + 1e-9}
                    />
                  </div>
                </div>
                {addOverBalance ? (
                  <p className="text-sm text-red-500">
                    Exceeds safe balance ({formatSafeBalanceText(safeBalanceA, 6, symbolA)} ·{' '}
                    {formatSafeBalanceText(safeBalanceB, 2, symbolB)}).
                  </p>
                ) : addRatio?.side === 'both' && addRatio.bPerA != null ? (
                  <InfoCallout>
                    Amounts are paired at this position&apos;s range ratio (≈
                    {addRatio.bPerA.toLocaleString(undefined, { maximumFractionDigits: 2 })} {symbolB}{' '}
                    per 1 {symbolA}, +1% buffer) — the pool rejects an unbalanced add. Surplus{' '}
                    {symbolB} returns to the safe.
                  </InfoCallout>
                ) : addRatio?.side === 'b' ? (
                  <InfoCallout>
                    Price is above this position&apos;s range — only {symbolB} can be added.
                  </InfoCallout>
                ) : addRatio?.side === 'a' ? (
                  <InfoCallout>
                    Price is below this position&apos;s range — only {symbolA} can be added.
                  </InfoCallout>
                ) : null}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t px-6 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-4">
            {addConfirmHint ? (
              <p className="mb-2 text-center text-xs text-muted-foreground sm:text-left">{addConfirmHint}</p>
            ) : null}
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                className="h-10 w-full sm:w-auto"
                disabled={addBusy}
                onClick={() => setAddOpen(false)}
              >
                Cancel
              </Button>
              <Button
                className="h-10 w-full sm:w-auto"
                disabled={addBusy || addConfirmDisabled}
                onClick={handleConfirmAdd}
              >
                {addBusy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Adding liquidity…
                  </>
                ) : (
                  'Confirm add'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={closeOpen}
        onOpenChange={(open) => {
          setCloseOpen(open);
          if (open) setConvertToUsdc(true);
        }}
      >
        <DialogContent className={LP_ACTION_DIALOG_CONTENT_CLASS}>
          <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-6">
            <DialogHeader className="min-w-0 pr-11 text-left sm:pr-12">
              <div className="flex min-w-0 items-center gap-2">
                <div className="relative h-7 w-10 shrink-0">
                  {logoA ? (
                    <Image
                      src={logoA}
                      alt={symbolA}
                      width={28}
                      height={28}
                      className="h-7 w-7 rounded-full"
                      unoptimized
                    />
                  ) : null}
                  {logoB ? (
                    <Image
                      src={logoB}
                      alt={symbolB}
                      width={16}
                      height={16}
                      className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full ring-2 ring-background"
                      unoptimized
                    />
                  ) : null}
                </div>
                <DialogTitle className="min-w-0 truncate text-base sm:text-lg">
                  Close position · {symbolA}/{symbolB}
                </DialogTitle>
              </div>
              <DialogDescription>
                Claims pending fees, removes liquidity, and returns funds to the safe.
              </DialogDescription>
            </DialogHeader>

            <div className="inline-flex w-full rounded-lg border p-0.5">
              <button
                type="button"
                onClick={() => setConvertToUsdc(true)}
                className={cn(
                  'flex flex-1 items-center justify-center rounded-md px-2 py-2.5 text-sm font-medium transition-colors sm:py-2',
                  convertToUsdc
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted/50'
                )}
              >
                Convert to USDC
              </button>
              <button
                type="button"
                onClick={() => setConvertToUsdc(false)}
                className={cn(
                  'flex flex-1 items-center justify-center rounded-md px-2 py-2.5 text-sm font-medium transition-colors sm:py-2',
                  !convertToUsdc
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted/50'
                )}
              >
                Keep tokens
              </button>
            </div>

            <div className="rounded-2xl border bg-muted/40 px-3 py-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Est. proceeds</span>
                <span className="font-medium tabular-nums">
                  {closePreviewLoading ? (
                    <Loader2 className="inline h-4 w-4 animate-spin" />
                  ) : closePreviewUsd != null ? (
                    fmtUsd(closePreviewUsd)
                  ) : (
                    '—'
                  )}
                </span>
              </div>
              {convertToUsdc ? (
                <>
                  {nonUsdcHuman > 0 ? (
                    <div className="mt-1.5 text-xs text-muted-foreground sm:text-sm">
                      Swaps ~{nonUsdcHuman.toLocaleString(undefined, { maximumFractionDigits: 6 })}{' '}
                      {nonUsdcSymbol} → USDC
                    </div>
                  ) : null}
                  {swapLossUsd != null && swapLossUsd > 0.01 ? (
                    <div className="mt-1.5 text-xs text-amber-600 dark:text-amber-400 sm:text-sm">
                      Est. swap impact ~{fmtUsd(swapLossUsd)}
                    </div>
                  ) : null}
                </>
              ) : (
                // Keep tokens: list the actual tokens returned to the safe + their
                // spot USD value (no swap), instead of only a single USD total.
                <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground sm:text-sm">
                  {nonUsdcHuman > 0 ? (
                    <div className="flex justify-between gap-2">
                      <span>
                        ~{nonUsdcHuman.toLocaleString(undefined, { maximumFractionDigits: 6 })} {nonUsdcSymbol}
                      </span>
                      <span className="tabular-nums">
                        {nonUsdcUsdAtSpot != null ? fmtUsd(nonUsdcUsdAtSpot) : '—'}
                      </span>
                    </div>
                  ) : null}
                  {usdcLegHuman > 0 ? (
                    <div className="flex justify-between gap-2">
                      <span>~{usdcLegHuman.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC</span>
                      <span className="tabular-nums">{fmtUsd(usdcLegHuman)}</span>
                    </div>
                  ) : null}
                </div>
              )}
              {closePreviewError ? (
                <div className="mt-1.5 text-xs text-destructive sm:text-sm">
                  Quote unavailable: {closePreviewError}
                </div>
              ) : null}
            </div>

            <InfoCallout>
              Fees are claimed automatically on a schedule. Manual claim is available in the menu.
            </InfoCallout>
          </div>

          <div className="shrink-0 border-t px-6 pb-[max(1rem,env(safe-area-inset-bottom,0px))] pt-4">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                className="h-10 w-full sm:w-auto"
                disabled={closeBusy}
                onClick={() => setCloseOpen(false)}
              >
                Cancel
              </Button>
              <Button
                className="h-10 w-full sm:w-auto"
                disabled={closeBusy}
                onClick={handleConfirmClose}
              >
                {closeBusy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Closing…
                  </>
                ) : convertToUsdc ? (
                  'Close → USDC'
                ) : (
                  'Close position'
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
