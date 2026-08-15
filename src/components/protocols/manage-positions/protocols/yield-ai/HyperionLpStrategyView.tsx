'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertTriangle, SlidersHorizontal, ChevronDown } from 'lucide-react';
import { BinChart } from '@/components/protocols/meteora/BinChart';
import { TokenAmountInput } from '@/shared/DepositAmountInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { queryKeys } from '@/lib/query/queryKeys';
import { cn } from '@/lib/utils';
import {
  type HyperionManageAction,
  type HyperionManageSignedFields,
} from '@/lib/protocols/yield-ai/hyperionManageAuth';
import { signOwnerManageAuth } from '@/lib/protocols/yield-ai/manageAuthClient';
import { useHyperionLpPositions } from '@/lib/query/hooks/protocols/yield-ai/useHyperionLpPositions';
import { useHyperionLpEarningsSummary } from '@/lib/query/hooks/protocols/yield-ai/useHyperionLpEarningsSummary';
import { useYieldAiSafeTokens } from '@/lib/query/hooks/protocols/yield-ai/useYieldAiSafeTokens';
import { useHyperionPools } from '@/lib/query/hooks/protocols/hyperion/useHyperionPools';
import {
  YIELD_AI_HYPERION_POOLS,
  USDC_FA_METADATA_MAINNET,
  type HyperionPoolKey,
} from '@/lib/constants/yieldAiVault';
import { normalizeAddress, toCanonicalAddress } from '@/lib/utils/addressNormalization';
import { HyperionPositionRow } from '@/components/protocols/manage-positions/protocols/yield-ai/HyperionPositionRow';
import lendingStyles from '@/shared/ProtocolCard/LendingProtocolCard/LendingProtocolCard.module.css';

const USDC_DECIMALS = 6;
const DEFAULT_SLIPPAGE_BPS = '100';
const USDC_LOGO_APTOS = 'https://assets.panora.exchange/tokens/aptos/USDC.svg';
const TOKEN_LOGOS: Record<string, string> = {
  USDC: USDC_LOGO_APTOS,
  WBTC: 'https://assets.panora.exchange/tokens/aptos/WBTC.png',
  xBTC: 'https://assets.panora.exchange/tokens/aptos/xBTC.png',
  APT: 'https://assets.panora.exchange/tokens/aptos/APT.svg',
  USDt: 'https://assets.panora.exchange/tokens/aptos/USDT.svg',
  USD1: 'https://assets.panora.exchange/tokens/aptos/USD1.png',
};

/**
 * Stable pools: warn when the pair trades this far off its $1 peg — the
 * position concentrates around the MARKET price, not $1, so a re-peg walks
 * the price across (and out of) the range.
 */
const STABLE_DEPEG_WARN_PCT = 0.3;

function compactUsd(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
}

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

function fmtPercentFromBps(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v / 100).toLocaleString(undefined, { maximumFractionDigits: 3 })}%`;
}

/**
 * Summary-stat label with a hover/tap tooltip explaining where the number comes
 * from. Dotted underline signals "more info" (matches the Yesterday affordance).
 */
function SummaryStatLabel({ label, tip }: { label: string; tip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            lendingStyles.metaLabel,
            'cursor-help border-b border-dotted border-muted-foreground/40'
          )}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

/** Non-USDC leg price in USDC for a tick: 1.0001^tick * 10^(decimalsA - decimalsB). */
function tickToPrice(tick: number, decimalsA: number, decimalsB: number): number {
  return Math.pow(1.0001, tick) * 10 ** (decimalsA - decimalsB);
}

const HYPERION_ALL_POOL_KEYS = Object.keys(YIELD_AI_HYPERION_POOLS) as HyperionPoolKey[];
/**
 * Resolve the pool config for a position by its (tokenA, tokenB) across ALL pools
 * (including uiEnabled:false). The selected-pool dropdown only lists uiEnabled pools,
 * so a position in a non-listed pool (e.g. a stable pair) must be matched by its own
 * tokens — otherwise it inherits the selected pool's symbol/decimals/price and is
 * mislabeled (e.g. USDt shown as WBTC).
 */
function poolForPosition(tokenA: string, tokenB: string) {
  const a = toCanonicalAddress(tokenA);
  const b = toCanonicalAddress(tokenB);
  for (const k of HYPERION_ALL_POOL_KEYS) {
    const cfg = YIELD_AI_HYPERION_POOLS[k];
    const pa = toCanonicalAddress(cfg.tokenA);
    const pb = toCanonicalAddress(cfg.tokenB);
    if ((a === pa && b === pb) || (a === pb && b === pa)) return cfg;
  }
  return null;
}

function snapDown(tick: number, spacing: number): number {
  return Math.floor(tick / spacing) * spacing;
}

function optionalNumber(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Inverse of tickToPrice: USDC price → tick. */
function priceToTick(price: number, decimalsA: number, decimalsB: number): number {
  if (!(price > 0)) return NaN;
  return Math.log(price / 10 ** (decimalsA - decimalsB)) / Math.log(1.0001);
}

type RangeMode = 'percent' | 'price';

interface PoolState {
  currentTick: number;
  currentPrice: number;
  tickSpacing: number;
  decimalsA: number;
  decimalsB: number;
}

interface OpenPreview {
  currentTick: number;
  tickLower: number;
  tickUpper: number;
  swapAmountIn: string;
  quotedSwapAmountOut?: string;
  swapAmountOutMin?: string;
  remainingUsdcBeforeLp?: string;
  estimatedSwapValueUsdc?: number;
  estimatedSwapLossUsdc?: number;
  estimatedSwapLossBps?: number;
}

function openPreviewFromResponse(d: Record<string, unknown>): OpenPreview {
  return {
    currentTick: Number(d.currentTick),
    tickLower: Number(d.tickLower),
    tickUpper: Number(d.tickUpper),
    swapAmountIn: String(d.swapAmountIn ?? '0'),
    quotedSwapAmountOut: d.quotedSwapAmountOut == null ? undefined : String(d.quotedSwapAmountOut),
    swapAmountOutMin: d.swapAmountOutMin == null ? undefined : String(d.swapAmountOutMin),
    remainingUsdcBeforeLp: d.remainingUsdcBeforeLp == null ? undefined : String(d.remainingUsdcBeforeLp),
    estimatedSwapValueUsdc: d.estimatedSwapValueUsdc == null ? undefined : Number(d.estimatedSwapValueUsdc),
    estimatedSwapLossUsdc: d.estimatedSwapLossUsdc == null ? undefined : Number(d.estimatedSwapLossUsdc),
    estimatedSwapLossBps: d.estimatedSwapLossBps == null ? undefined : Number(d.estimatedSwapLossBps),
  };
}

interface HyperionLpStrategyViewProps {
  safeAddress: string;
}

/**
 * User-facing Hyperion CLMM LP management panel for an AI agent safe tagged
 * with the `hyperion_lp` strategy. Handles deposit-funded open (auto-tuned
 * range + zap swap via the live tick), and per-position claim / close /
 * close+convert. All executor actions go through the `manage/*` proxy routes
 * (no cron secret in the browser; authorized by the on-chain strategy tag).
 */
export function HyperionLpStrategyView({ safeAddress }: HyperionLpStrategyViewProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { account, signMessage } = useWallet();

  // Only UI-enabled pools appear in the dropdown (stables/others stay registry-only).
  const poolKeys = (Object.keys(YIELD_AI_HYPERION_POOLS) as HyperionPoolKey[]).filter(
    (k) => YIELD_AI_HYPERION_POOLS[k].uiEnabled
  );
  const [poolKey, setPoolKey] = useState<HyperionPoolKey>(poolKeys[0]);
  const [usdcAmount, setUsdcAmount] = useState('');
  const [rangeMode, setRangeMode] = useState<RangeMode>('percent');
  const [rangePct, setRangePct] = useState('10');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  // Custom mode reveals dual-asset funding, swap slippage, and explicit price
  // range. AI-managed mode keeps the single-asset USDC zap with the agent range.
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<OpenPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Zap-in preview: collapsed one-liner by default, full breakdown on demand.
  const [zapDetailsOpen, setZapDetailsOpen] = useState(false);

  // First-open risk acknowledgment (per safe, localStorage).
  const riskAckKey = `yield-ai:hyperionRiskAck:${safeAddress.toLowerCase()}`;
  const [riskAcked, setRiskAcked] = useState(false);
  const [showRiskModal, setShowRiskModal] = useState(false);
  const [riskChecked, setRiskChecked] = useState(false);
  useEffect(() => {
    try {
      setRiskAcked(window.localStorage.getItem(riskAckKey) === '1');
    } catch {
      setRiskAcked(false);
    }
  }, [riskAckKey]);

  // Entry mode: zap (USDC only, contract swaps) vs dual (both legs from the
  // safe, no swap). Dual split: 'auto' (B — derive from balances by range) or
  // 'manual' (A — user edits both leg amounts).
  const [entryMode, setEntryMode] = useState<'zap' | 'dual'>('zap');
  // Zap funding token: USDC (default) or the pool's non-USDC token_a — stable
  // pools only (token_a ≈ $1), so a USDt-only safe can open without first
  // swapping to USDC. The executor swaps part of token_a → USDC server-side.
  const [fundingToken, setFundingToken] = useState<'usdc' | 'tokenA'>('usdc');
  const [dualSplit, setDualSplit] = useState<'auto' | 'manual'>('auto');
  const [dualAmountA, setDualAmountA] = useState(''); // tokenA (manual)
  const [dualAmountB, setDualAmountB] = useState(''); // USDC (manual)

  const { data: positions = [], isLoading: positionsLoading } = useHyperionLpPositions(safeAddress);
  const hasOpenPositions = useMemo(() => positions.some((p) => !p.closed), [positions]);
  const { data: earningsSummary, isLoading: earningsLoading } = useHyperionLpEarningsSummary(safeAddress, {
    enabled: hasOpenPositions,
  });
  const { data: safeTokens = [] } = useYieldAiSafeTokens(safeAddress);

  const pool = YIELD_AI_HYPERION_POOLS[poolKey];
  const poolUi = pool.ui;

  // Stable pools in simple mode pin the width to the band the auto-recenter
  // cron maintains — a custom width would be silently re-ranged on the first
  // re-center. Custom mode unlocks the presets (with a warning note).
  const rangeLockedToAgent = !advanced && poolUi.simpleFixedRangePct != null;
  const effectiveRangePct = rangeLockedToAgent ? (poolUi.simpleFixedRangePct as string) : rangePct;

  // Pool switch: range scale differs per pool (±10% WBTC vs ±0.1% stables) —
  // carry-over values would be nonsense, so reset to the pool's defaults.
  useEffect(() => {
    setRangePct(YIELD_AI_HYPERION_POOLS[poolKey].ui.defaultRangePct);
    setRangeMode('percent');
    setPriceMin('');
    setPriceMax('');
    setPreview(null);
    setUsdcAmount('');
    setFundingToken('usdc');
  }, [poolKey]);

  // Live pool state (current tick + price) for the price header + range chart.
  const [poolState, setPoolState] = useState<PoolState | null>(null);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [poolNonce, setPoolNonce] = useState(0);
  const [positionsSectionOpen, setPositionsSectionOpen] = useState(true);
  const [chartSectionOpen, setChartSectionOpen] = useState(true);
  const chartCollapseInitialized = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setPoolState(null);
    setPoolError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/protocols/yield-ai/hyperion-lp/pool?poolKey=${encodeURIComponent(poolKey)}`
        );
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !json?.data) {
          setPoolError(json?.error || `Pool price unavailable (HTTP ${res.status})`);
          return;
        }
        setPoolState(json.data as PoolState);
      } catch (e) {
        if (!cancelled) setPoolError(e instanceof Error ? e.message : 'Network error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [poolKey, poolNonce]);

  // Prospective range for the chart band + open call, computed live from the
  // current tick/price and the active range mode — what the position WILL look
  // like. `% ` and `price` modes yield absolute price levels (sent as explicit
  // ticks); `ticks` yields a centered half-width relative to the live tick.
  const prospectiveRange = useMemo(() => {
    if (!poolState) return null;
    const { currentPrice, tickSpacing: spacing, decimalsA, decimalsB } = poolState;

    let lowerTick: number;
    let upperTick: number;

    if (rangeMode === 'price' && !rangeLockedToAgent) {
      const lo = Number(priceMin);
      const hi = Number(priceMax);
      if (!(lo > 0) || !(hi > 0) || hi <= lo) return null;
      lowerTick = priceToTick(lo, decimalsA, decimalsB);
      upperTick = priceToTick(hi, decimalsA, decimalsB);
    } else {
      const p = Number(effectiveRangePct);
      if (!(p > 0)) return null;
      lowerTick = priceToTick(currentPrice * (1 - p / 100), decimalsA, decimalsB);
      upperTick = priceToTick(currentPrice * (1 + p / 100), decimalsA, decimalsB);
    }

    if (!Number.isFinite(lowerTick) || !Number.isFinite(upperTick)) return null;
    lowerTick = snapDown(lowerTick, spacing);
    upperTick = snapDown(upperTick, spacing);
    if (upperTick <= lowerTick) upperTick = lowerTick + spacing;

    const lowerPrice = tickToPrice(lowerTick, decimalsA, decimalsB);
    const upperPrice = tickToPrice(upperTick, decimalsA, decimalsB);
    const widthPct = currentPrice > 0 ? ((upperPrice - lowerPrice) / 2 / currentPrice) * 100 : 0;
    return { lowerTick, upperTick, lowerPrice, upperPrice, widthPct };
  }, [poolState, rangeMode, rangeLockedToAgent, effectiveRangePct, priceMin, priceMax]);

  const usdcBalance = useMemo(() => {
    const usdc = safeTokens.find(
      (t) =>
        normalizeAddress(t.address) === normalizeAddress(USDC_FA_METADATA_MAINNET) ||
        t.symbol === 'USDC'
    );
    if (!usdc) return 0;
    return Number(usdc.amount) / 10 ** USDC_DECIMALS;
  }, [safeTokens]);

  const usdcBaseUnits = useCallback((): bigint => {
    const n = Number(usdcAmount);
    if (!Number.isFinite(n) || n <= 0) return 0n;
    return BigInt(Math.round(n * 10 ** USDC_DECIMALS));
  }, [usdcAmount]);

  // Safe balance of the pool's non-USDC token_a, read inline (so the zap
  // calculator below can use it without depending on the dual-flow vars).
  const fundingTokenABalance = useMemo(() => {
    const t =
      safeTokens.find((x) => normalizeAddress(x.address) === normalizeAddress(pool.tokenA)) ??
      safeTokens.find((x) => x.symbol === pool.symbolA);
    return t ? Number(t.amount) / 10 ** (t.decimals ?? pool.decimalsA) : 0;
  }, [safeTokens, pool.tokenA, pool.symbolA, pool.decimalsA]);

  // token_a funding only makes sense on stable pools (token_a ≈ $1) and when the
  // safe actually holds some. The active funding token drives the zap amount,
  // balance, and Half/Max below.
  const canFundWithTokenA = poolUi.isStable && fundingTokenABalance > 0;
  const fundingActive: 'usdc' | 'tokenA' = fundingToken === 'tokenA' && canFundWithTokenA ? 'tokenA' : 'usdc';
  const fundingBalance = fundingActive === 'tokenA' ? fundingTokenABalance : usdcBalance;
  const fundingDecimals = fundingActive === 'tokenA' ? pool.decimalsA : USDC_DECIMALS;
  const fundingSymbol = fundingActive === 'tokenA' ? pool.symbolA : 'USDC';

  // Default the zap funding token per pool once balances load: if a stable safe
  // holds token_a but ~no USDC, fund with token_a so the deposit works out of
  // the box. Guarded per pool so it never overrides a manual switch.
  const fundingInitPoolRef = useRef<string | null>(null);
  useEffect(() => {
    if (safeTokens.length === 0 || fundingInitPoolRef.current === poolKey) return;
    fundingInitPoolRef.current = poolKey;
    if (canFundWithTokenA && usdcBalance < 0.01) setFundingToken('tokenA');
  }, [poolKey, safeTokens.length, canFundWithTokenA, usdcBalance]);

  // Generic zap amount in base units for the active funding token.
  const zapAmountBase = useCallback((): bigint => {
    const n = Number(usdcAmount);
    if (!Number.isFinite(n) || n <= 0) return 0n;
    return BigInt(Math.round(n * 10 ** fundingDecimals));
  }, [usdcAmount, fundingDecimals]);

  const amountInputRef = useRef<HTMLInputElement | null>(null);
  const dualARef = useRef<HTMLInputElement | null>(null);
  const dualBRef = useRef<HTMLInputElement | null>(null);
  const setAmountFraction = useCallback(
    (frac: number) => {
      // Floor to cents so rounding never exceeds the on-chain balance.
      const v = Math.max(0, Math.floor(fundingBalance * frac * 100) / 100);
      setUsdcAmount(v ? String(v) : '');
      setPreview(null);
    },
    [fundingBalance]
  );

  // Zap-in calculator: what the entered USDC turns into for the chosen range —
  // the value split across the non-USDC / USDC legs, the balancing swap, and whether
  // the safe holds enough USDC. Pure client-side mirror of the on-chain split.
  const zapEstimate = useMemo(() => {
    if (!poolState || !prospectiveRange) return null;
    const amt = Number(usdcAmount);
    if (!(amt > 0)) return null;

    const { currentTick } = poolState;
    const { lowerTick, upperTick } = prospectiveRange;
    let r: number;
    if (currentTick >= upperTick) {
      r = 0; // entirely USDC side
    } else if (currentTick <= lowerTick) {
      r = 1; // entirely tokenA side
    } else {
      const sp = Math.pow(1.0001, currentTick / 2);
      const spa = Math.pow(1.0001, lowerTick / 2);
      const spb = Math.pow(1.0001, upperTick / 2);
      const valA = sp - (sp * sp) / spb;
      const valB = sp - spa;
      const denom = valA + valB;
      r = denom > 0 ? Math.min(1, Math.max(0, valA / denom)) : 0;
    }

    const tokenAUsd = amt * r;
    const usdcUsd = amt * (1 - r);
    const sufficient = amt <= fundingBalance + 1e-9;
    const inRangeNow = currentTick >= lowerTick && currentTick < upperTick;
    return { r, tokenAUsd, usdcUsd, sufficient, inRangeNow, amt };
  }, [poolState, prospectiveRange, usdcAmount, fundingBalance]);

  const slippageTolLabel = fmtPercentFromBps(Number(slippageBps) || 100);
  const swapInUsd =
    preview && BigInt(preview.swapAmountIn || '0') > 0n
      ? Number(preview.swapAmountIn) / 10 ** USDC_DECIMALS
      : zapEstimate && zapEstimate.tokenAUsd > 0
        ? zapEstimate.tokenAUsd
        : 0;
  // The detailed balancing-swap preview is USDC-oriented (USDC → token_a); the
  // token_a funding path swaps the other way, so hide that block there.
  const showSwapPreview = swapInUsd > 0.001 && fundingActive !== 'tokenA';

  // Safe balance of an arbitrary pool token (positions can live in pools other
  // than the selected one — their Add dialog must see THEIR token's balance).
  const safeBalanceOf = useCallback(
    (address: string, symbol: string, decimals: number): number => {
      const t =
        safeTokens.find((x) => normalizeAddress(x.address) === normalizeAddress(address)) ??
        safeTokens.find((x) => x.symbol === symbol);
      return t ? Number(t.amount) / 10 ** (t.decimals ?? decimals) : 0;
    },
    [safeTokens]
  );

  const tokenAToken = useMemo(
    () =>
      safeTokens.find((t) => normalizeAddress(t.address) === normalizeAddress(pool.tokenA)) ??
      safeTokens.find((t) => t.symbol === pool.symbolA),
    [safeTokens, pool.tokenA, pool.symbolA]
  );
  const tokenABalanceUsd = useMemo(() => (tokenAToken?.value ? Number(tokenAToken.value) : 0), [tokenAToken]);
  const tokenABalance = useMemo(
    () => (tokenAToken ? Number(tokenAToken.amount) / 10 ** (tokenAToken.decimals ?? pool.decimalsA) : 0),
    [tokenAToken, pool.decimalsA]
  );
  const tokenAPrice = useMemo(
    () => (tokenAToken?.price ? Number(tokenAToken.price) : poolState?.currentPrice ?? 0),
    [tokenAToken, poolState]
  );

  // Non-USDC value fraction R for the chosen range — shared by the zap
  // calculator and the dual auto-split. 0 = all-USDC side, 1 = all-tokenA side.
  const rangeFractionR = useMemo(() => {
    if (!poolState || !prospectiveRange) return null;
    const { currentTick } = poolState;
    const { lowerTick, upperTick } = prospectiveRange;
    if (currentTick >= upperTick) return 0;
    if (currentTick <= lowerTick) return 1;
    const sp = Math.pow(1.0001, currentTick / 2);
    const spa = Math.pow(1.0001, lowerTick / 2);
    const spb = Math.pow(1.0001, upperTick / 2);
    const valA = sp - (sp * sp) / spb;
    const valB = sp - spa;
    const denom = valA + valB;
    return denom > 0 ? Math.min(1, Math.max(0, valA / denom)) : 0;
  }, [poolState, prospectiveRange]);

  // Dual auto-split (mode B): deploy the safe's balances at the range ratio R,
  // bounded by the binding leg; the surplus of the other leg stays in the safe.
  const dualAuto = useMemo(() => {
    if (entryMode !== 'dual' || dualSplit !== 'auto' || rangeFractionR == null || tokenAPrice <= 0) return null;
    const r = rangeFractionR;
    const balAUsd = tokenABalance * tokenAPrice;
    const balBUsd = usdcBalance; // USDC value (≈$1)
    // Largest total (USD) deployable in ratio R within both balances.
    const capByA = r > 0 ? balAUsd / r : Infinity;
    const capByB = r < 1 ? balBUsd / (1 - r) : Infinity;
    const totalUsd = Math.max(0, Math.min(capByA, capByB));
    if (!Number.isFinite(totalUsd) || totalUsd <= 0) {
      // Single-sided range: deploy only the relevant leg.
      const aUsd = r >= 1 ? balAUsd : 0;
      const bUsd = r <= 0 ? balBUsd : 0;
      return { aUsd, bUsd, aHuman: aUsd / tokenAPrice, bHuman: bUsd, totalUsd: aUsd + bUsd };
    }
    const aUsd = totalUsd * r;
    const bUsd = totalUsd * (1 - r);
    return { aUsd, bUsd, aHuman: aUsd / tokenAPrice, bHuman: bUsd, totalUsd };
  }, [entryMode, dualSplit, rangeFractionR, tokenABalance, tokenAPrice, usdcBalance]);

  // Resolved dual leg amounts (base units) for submit + preview.
  const dualAmounts = useMemo(() => {
    if (entryMode !== 'dual') return null;
    if (dualSplit === 'auto') {
      if (!dualAuto) return null;
      // Floor slightly to stay within on-chain balances.
      const aBase = BigInt(Math.floor(dualAuto.aHuman * 10 ** pool.decimalsA));
      const bBase = BigInt(Math.floor(dualAuto.bHuman * 10 ** pool.decimalsB));
      return { aBase, bBase, aHuman: dualAuto.aHuman, bHuman: dualAuto.bHuman };
    }
    const aHuman = Number(dualAmountA);
    const bHuman = Number(dualAmountB);
    if (!(aHuman > 0) && !(bHuman > 0)) return null;
    return {
      aBase: BigInt(Math.floor((aHuman > 0 ? aHuman : 0) * 10 ** pool.decimalsA)),
      bBase: BigInt(Math.floor((bHuman > 0 ? bHuman : 0) * 10 ** pool.decimalsB)),
      aHuman: aHuman > 0 ? aHuman : 0,
      bHuman: bHuman > 0 ? bHuman : 0,
    };
  }, [entryMode, dualSplit, dualAuto, dualAmountA, dualAmountB, pool.decimalsA, pool.decimalsB]);

  // Pool APR (swap fees + farm rewards) from the existing Hyperion pools feed,
  // matched by pool address. This is the pool's full-range APR; a concentrated
  // position earns proportionally more while in range, nothing while out.
  const { data: hyperionPools = [] } = useHyperionPools();
  const poolApr = useMemo(() => {
    const target = normalizeAddress(pool.poolAddress);
    const match = (hyperionPools as Array<Record<string, unknown>>).find((p) => {
      const id = (p.id ?? p.poolId ?? (p.pool as { poolId?: string } | undefined)?.poolId) as
        | string
        | undefined;
      return id ? normalizeAddress(id) === target : false;
    });
    if (!match) return null;
    const fee = parseFloat(String(match.feeAPR ?? '0')) || 0;
    const farm = parseFloat(String(match.farmAPR ?? '0')) || 0;
    return { fee, farm, total: fee + farm };
  }, [hyperionPools, pool.poolAddress]);

  // Per-pool APR + TVL for the dropdown (matched by pool address).
  const poolMetaByKey = useMemo(() => {
    const list = hyperionPools as Array<Record<string, unknown>>;
    const m: Record<string, { aprTotal: number; tvlUsd: number }> = {};
    for (const k of poolKeys) {
      const target = normalizeAddress(YIELD_AI_HYPERION_POOLS[k].poolAddress);
      const match = list.find((p) => {
        const id = (p.id ?? p.poolId ?? (p.pool as { poolId?: string } | undefined)?.poolId) as string | undefined;
        return id ? normalizeAddress(id) === target : false;
      });
      if (!match) continue;
      const apr = (parseFloat(String(match.feeAPR ?? '0')) || 0) + (parseFloat(String(match.farmAPR ?? '0')) || 0);
      const tvl = parseFloat(String(match.tvlUSD ?? '0')) || 0;
      m[k] = { aprTotal: apr, tvlUsd: tvl };
    }
    return m;
  }, [hyperionPools, poolKeys]);

  // Total APR (fee + farm) for an arbitrary pool address, matched against the live
  // Hyperion pools list. Used so each position shows ITS pool's APR, not the
  // currently-selected pool's (a USDt position must not show the WBTC pool APR).
  const aprTotalForPoolAddress = useCallback(
    (poolAddress: string): number | null => {
      const target = normalizeAddress(poolAddress);
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
    },
    [hyperionPools]
  );

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.protocols.yieldAi.hyperionLpPositions(safeAddress),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.protocols.yieldAi.safeTokens(safeAddress),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.protocols.yieldAi.hyperionLpEarningsSummary(safeAddress),
    });
  }, [queryClient, safeAddress]);

  const signManageAction = useCallback(
    (action: HyperionManageAction, fields: HyperionManageSignedFields) =>
      signOwnerManageAuth({ account, signMessage, action, fields }),
    [account, signMessage]
  );

  const callOpen = useCallback(
    async (dryRun: boolean) => {
      const isTokenA = fundingActive === 'tokenA';
      const amount = isTokenA ? zapAmountBase() : usdcBaseUnits();
      if (amount <= 0n) {
        toast({ title: `Enter a ${fundingSymbol} amount`, variant: 'destructive' });
        return;
      }
      const balanceBaseUnits = BigInt(Math.floor(fundingBalance * 10 ** fundingDecimals));
      if (amount > balanceBaseUnits) {
        toast({
          title: `Insufficient ${fundingSymbol} in safe`,
          description: `Safe holds ${fundingBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${fundingSymbol}. Deposit more or lower the amount.`,
          variant: 'destructive',
        });
        return;
      }
      // `ticks` mode: send half-width so the server centers on the live tick.
      // `%`/`price` modes: send the absolute tick levels the user chose.
      const rangeBody =
        prospectiveRange
        ? { tickLower: prospectiveRange.lowerTick, tickUpper: prospectiveRange.upperTick }
        : null;
      if (!rangeBody) {
        toast({ title: 'Set a valid range first', variant: 'destructive' });
        return;
      }
      setBusy(dryRun ? 'preview' : 'open');
      try {
        const dryRunFlag = Boolean(dryRun);
        const canonicalSafeAddress = toCanonicalAddress(safeAddress);
        // Auth field shape must match the route exactly (key order included).
        const auth = dryRunFlag
          ? undefined
          : await signManageAction(
              'hyperion_lp_manage_open',
              isTokenA
                ? {
                    safeAddress: canonicalSafeAddress,
                    mode: 'zap',
                    inputToken: 'tokenA',
                    amountBaseUnits: amount.toString(),
                    poolKey,
                    tickLower: optionalNumber((rangeBody as { tickLower?: unknown }).tickLower),
                    tickUpper: optionalNumber((rangeBody as { tickUpper?: unknown }).tickUpper),
                    slippageBps: optionalNumber(slippageBps),
                    dryRun: dryRunFlag,
                  }
                : {
                    safeAddress: canonicalSafeAddress,
                    usdcAmountInBaseUnits: amount.toString(),
                    poolKey,
                    tickLower: optionalNumber((rangeBody as { tickLower?: unknown }).tickLower),
                    tickUpper: optionalNumber((rangeBody as { tickUpper?: unknown }).tickUpper),
                    slippageBps: optionalNumber(slippageBps),
                    dryRun: dryRunFlag,
                  }
            );
        const res = await fetch('/api/protocols/yield-ai/hyperion-lp/manage/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            safeAddress,
            ...(isTokenA
              ? { mode: 'zap', inputToken: 'tokenA', amountBaseUnits: amount.toString() }
              : { usdcAmountInBaseUnits: amount.toString() }),
            poolKey,
            ...rangeBody,
            slippageBps: Number(slippageBps),
            dryRun,
            auth,
          }),
        });
        const json = await res.json();
        if (!res.ok || json?.error || !json?.data) {
          throw new Error(json?.error || `HTTP ${res.status}`);
        }
        const d = json.data;
        // The USDC zap returns a swap/range preview; the token_a path returns a
        // different shape, so the client-side estimate carries that case.
        if (!isTokenA) setPreview(openPreviewFromResponse(d));
        if (!dryRun) {
          const hash = d.openHash ?? d.hash;
          toast({ title: 'LP position opened', description: hash ? `tx ${String(hash).slice(0, 10)}…` : 'Submitted' });
          setUsdcAmount('');
          setPreview(null);
          refresh();
        }
      } catch (e) {
        toast({
          title: dryRun ? 'Preview failed' : 'Open failed',
          description: e instanceof Error ? e.message : String(e),
          variant: 'destructive',
        });
      } finally {
        setBusy(null);
      }
    },
    [
      safeAddress,
      poolKey,
      rangeMode,
      prospectiveRange,
      slippageBps,
      usdcBaseUnits,
      zapAmountBase,
      fundingActive,
      fundingSymbol,
      fundingBalance,
      fundingDecimals,
      signManageAction,
      toast,
      refresh,
    ]
  );

  // Open a dual (two-sided) position — both legs from the safe, no swap.
  const callOpenDual = useCallback(async () => {
    if (!dualAmounts || (dualAmounts.aBase <= 0n && dualAmounts.bBase <= 0n)) {
      toast({ title: 'Enter token amounts', variant: 'destructive' });
      return;
    }
    const aBalBase = BigInt(Math.floor(tokenABalance * 10 ** pool.decimalsA));
    const bBalBase = BigInt(Math.floor(usdcBalance * 10 ** pool.decimalsB));
    if (dualAmounts.aBase > aBalBase || dualAmounts.bBase > bBalBase) {
      toast({
        title: 'Insufficient balance in safe',
        description: `Safe holds ${tokenABalance.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${pool.symbolA} · ${usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${pool.symbolB}.`,
        variant: 'destructive',
      });
      return;
    }
    const rangeBody =
      prospectiveRange
        ? { tickLower: prospectiveRange.lowerTick, tickUpper: prospectiveRange.upperTick }
        : null;
    if (!rangeBody) {
      toast({ title: 'Set a valid range first', variant: 'destructive' });
      return;
    }
    setBusy('open');
    try {
      const auth = await signManageAction('hyperion_lp_manage_open', {
        safeAddress: toCanonicalAddress(safeAddress),
        mode: 'dual',
        amountABaseUnits: dualAmounts.aBase.toString(),
        amountBBaseUnits: dualAmounts.bBase.toString(),
        poolKey,
        tickLower: optionalNumber((rangeBody as { tickLower?: unknown }).tickLower),
        tickUpper: optionalNumber((rangeBody as { tickUpper?: unknown }).tickUpper),
        dryRun: false,
      });
      const res = await fetch('/api/protocols/yield-ai/hyperion-lp/manage/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          safeAddress,
          mode: 'dual',
          amountABaseUnits: dualAmounts.aBase.toString(),
          amountBBaseUnits: dualAmounts.bBase.toString(),
          poolKey,
          ...rangeBody,
          auth,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.error || !json?.data) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      toast({
        title: 'LP position opened (dual)',
        description: json.data.hash ? `tx ${String(json.data.hash).slice(0, 10)}…` : 'Submitted',
      });
      setDualAmountA('');
      setDualAmountB('');
      refresh();
    } catch (e) {
      toast({ title: 'Open (dual) failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }, [dualAmounts, tokenABalance, usdcBalance, pool, rangeMode, prospectiveRange, safeAddress, poolKey, signManageAction, toast, refresh]);

  const callClaim = useCallback(
    async (position: string) => {
      setBusy(`claim:${position}`);
      try {
        const auth = await signManageAction('hyperion_lp_manage_claim', {
          safeAddress: toCanonicalAddress(safeAddress),
          position,
          dryRun: false,
        });
        const res = await fetch('/api/protocols/yield-ai/hyperion-lp/manage/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ safeAddress, position, auth }),
        });
        const json = await res.json();
        if (!res.ok || json?.error) {
          throw new Error(json?.error || `HTTP ${res.status}`);
        }
        toast({ title: 'Fees claimed' });
        refresh();
      } catch (e) {
        toast({ title: 'Claim failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
      } finally {
        setBusy(null);
      }
    },
    [safeAddress, signManageAction, toast, refresh]
  );

  const callClose = useCallback(
    async (position: string, convert: boolean) => {
      setBusy(`${convert ? 'convert' : 'close'}:${position}`);
      try {
        const auth = await signManageAction('hyperion_lp_manage_close', {
          safeAddress: toCanonicalAddress(safeAddress),
          position,
          poolKey,
          claimFirst: true,
          convert,
          slippageBps: optionalNumber(slippageBps),
          dryRun: false,
        });
        const res = await fetch('/api/protocols/yield-ai/hyperion-lp/manage/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ safeAddress, position, poolKey, convert, slippageBps: Number(slippageBps), auth }),
        });
        const json = await res.json();
        if (!res.ok || json?.error) {
          throw new Error(json?.error || `HTTP ${res.status}`);
        }
        toast({
          title: convert ? 'Closed & converted to USDC' : 'Position closed',
          description: 'Funds returned to the safe.',
        });
        refresh();
      } catch (e) {
        toast({
          title: convert ? 'Close & convert failed' : 'Close failed',
          description: e instanceof Error ? e.message : String(e),
          variant: 'destructive',
        });
      } finally {
        setBusy(null);
      }
    },
    [safeAddress, poolKey, slippageBps, signManageAction, toast, refresh]
  );

  // Add both legs (dual) to an existing position — funds from the safe, no swap.
  const callAddDual = useCallback(
    async (position: string, aBase: bigint, bBase: bigint) => {
      if (aBase <= 0n && bBase <= 0n) {
        toast({ title: 'Enter amounts to add', variant: 'destructive' });
        return;
      }
      const aBalBase = BigInt(Math.floor(tokenABalance * 10 ** pool.decimalsA));
      const bBalBase = BigInt(Math.floor(usdcBalance * 10 ** pool.decimalsB));
      if (aBase > aBalBase || bBase > bBalBase) {
        toast({ title: 'Insufficient balance in safe', variant: 'destructive' });
        return;
      }
      setBusy(`add:${position}`);
      try {
        const auth = await signManageAction('hyperion_lp_manage_add', {
          safeAddress: toCanonicalAddress(safeAddress),
          position,
          mode: 'dual',
          amountABaseUnits: aBase.toString(),
          amountBBaseUnits: bBase.toString(),
          dryRun: false,
        });
        const res = await fetch('/api/protocols/yield-ai/hyperion-lp/manage/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            safeAddress,
            position,
            mode: 'dual',
            amountABaseUnits: aBase.toString(),
            amountBBaseUnits: bBase.toString(),
            auth,
          }),
        });
        const json = await res.json();
        if (!res.ok || json?.error || !json?.data) {
          throw new Error(json?.error || `HTTP ${res.status}`);
        }
        toast({ title: 'Added to position', description: json.data.hash ? `tx ${String(json.data.hash).slice(0, 10)}…` : 'Submitted' });
        refresh();
      } catch (e) {
        toast({ title: 'Add failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
      } finally {
        setBusy(null);
      }
    },
    [safeAddress, tokenABalance, usdcBalance, pool.decimalsA, pool.decimalsB, signManageAction, toast, refresh]
  );

  // Single-token ("zap") add to an existing position: the executor swaps the
  // surplus to the position's range ratio (USDC via the contract zap entry;
  // token_a via a vault swap + dual add).
  const callAddZap = useCallback(
    async (position: string, inputToken: 'tokenA' | 'usdc', amountBase: bigint) => {
      if (amountBase <= 0n) {
        toast({ title: 'Enter an amount to add', variant: 'destructive' });
        return;
      }
      setBusy(`add:${position}`);
      try {
        const slip = optionalNumber(slippageBps) ?? 100;
        const auth = await signManageAction('hyperion_lp_manage_add', {
          safeAddress: toCanonicalAddress(safeAddress),
          position,
          mode: 'zap',
          inputToken,
          amountBaseUnits: amountBase.toString(),
          slippageBps: slip,
          dryRun: false,
        });
        const res = await fetch('/api/protocols/yield-ai/hyperion-lp/manage/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            safeAddress,
            position,
            mode: 'zap',
            inputToken,
            amountBaseUnits: amountBase.toString(),
            slippageBps: slip,
            auth,
          }),
        });
        const json = await res.json();
        if (!res.ok || json?.error || !json?.data) {
          throw new Error(json?.error || `HTTP ${res.status}`);
        }
        const hash = json.data.addHash ?? json.data.hash;
        toast({ title: 'Added to position', description: hash ? `tx ${String(hash).slice(0, 10)}…` : 'Submitted' });
        refresh();
      } catch (e) {
        toast({ title: 'Add failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
      } finally {
        setBusy(null);
      }
    },
    [safeAddress, slippageBps, signManageAction, toast, refresh]
  );

  // Auto-preview: dry-run the open whenever amount/range changes (debounced).
  // Balance is NOT required for quote preview — only the Open button checks it.
  useEffect(() => {
    let cancelled = false;
    const amount = usdcBaseUnits();
    const rangeBody =
      prospectiveRange
        ? { tickLower: prospectiveRange.lowerTick, tickUpper: prospectiveRange.upperTick }
        : null;
    // Only the USDC zap has a swap/range dry-run preview. token_a funding uses
    // the client-side estimate (its server response shape differs).
    if (entryMode !== 'zap' || fundingActive === 'tokenA' || amount <= 0n || !rangeBody) {
      setPreview(null);
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/protocols/yield-ai/hyperion-lp/manage/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            safeAddress,
            usdcAmountInBaseUnits: amount.toString(),
            poolKey,
            ...rangeBody,
            slippageBps: Number(slippageBps),
            dryRun: true,
          }),
        });
        const json = await res.json();
        if (!cancelled && res.ok && json?.data) {
          setPreview(openPreviewFromResponse(json.data as Record<string, unknown>));
        } else if (!cancelled) {
          setPreview(null);
        }
      } catch {
        if (!cancelled) setPreview(null);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [entryMode, fundingActive, safeAddress, poolKey, rangeMode, rangePct, priceMin, priceMax, slippageBps, prospectiveRange, usdcAmount, usdcBaseUnits]);

  const openPositions = positions.filter((p) => !p.closed);

  // The price chart renders for volatile pools only (WBTC/USDC). Open it by
  // default while opening a fresh position (no positions yet) — the live price +
  // range band is the main decision aid there — but collapse it once the user
  // already has open positions, leaving expansion to their choice. Ref guard
  // runs this once, so manual toggles afterward stick.
  useEffect(() => {
    if (positionsLoading || chartCollapseInitialized.current) return;
    chartCollapseInitialized.current = true;
    setChartSectionOpen(openPositions.length === 0);
  }, [positionsLoading, openPositions.length]);

  const openPositionsSummary = useMemo(() => {
    if (openPositions.length === 0) return null;
    const totalUsd = openPositions.reduce((sum, p) => sum + (p.valueUsd ?? 0), 0);
    const totalEarnedUsd = openPositions.reduce(
      (sum, p) => sum + (p.claimedUsd ?? 0) + (p.feesUsd ?? 0) + (p.rewardsUsd ?? 0),
      0
    );
    const aprs = openPositions
      .map((p) => (p.active ? (p.aprPct ?? null) : null))
      .filter((v): v is number => v != null && Number.isFinite(v));
    const avgApr = aprs.length > 0 ? aprs.reduce((a, b) => a + b, 0) / aprs.length : null;
    const pnlValues = openPositions
      .map((p) => p.pnlUsd ?? null)
      .filter((v): v is number => v != null && Number.isFinite(v));
    const totalPnlUsd = pnlValues.length > 0 ? pnlValues.reduce((a, b) => a + b, 0) : null;
    return { totalUsd, totalEarnedUsd, totalPnlUsd, avgApr, count: openPositions.length };
  }, [openPositions]);

  // Open dispatch + first-open risk gate.
  const proceedOpen = useCallback(() => {
    void (entryMode === 'dual' ? callOpenDual() : callOpen(false));
  }, [entryMode, callOpen, callOpenDual]);
  const handleOpenClick = useCallback(() => {
    if (!riskAcked) {
      setRiskChecked(false);
      setShowRiskModal(true);
      return;
    }
    proceedOpen();
  }, [riskAcked, proceedOpen]);
  const confirmRisk = useCallback(() => {
    try {
      window.localStorage.setItem(riskAckKey, '1');
    } catch {
      /* ignore */
    }
    setRiskAcked(true);
    setShowRiskModal(false);
    proceedOpen();
  }, [riskAckKey, proceedOpen]);

  // Capital-efficiency multiplier `m` of a tick range vs a full-range position
  // for the same capital: m = 2√p / (2√p − √p_lower − p/√p_upper). Tighter range
  // ⇒ higher m ⇒ proportionally more fees per $ WHILE the price stays in range.
  const concentrationOf = useCallback(
    (lowerTick: number, upperTick: number): number | null => {
      if (!poolState) return null;
      const sp = Math.pow(1.0001, poolState.currentTick / 2);
      const spa = Math.pow(1.0001, lowerTick / 2);
      const spb = Math.pow(1.0001, upperTick / 2);
      const denom = 2 * sp - spa - (sp * sp) / spb;
      if (!(denom > 0)) return null;
      const m = (2 * sp) / denom;
      return Number.isFinite(m) && m > 0 ? m : null;
    },
    [poolState]
  );

  const concentration = useMemo(
    () => (prospectiveRange ? concentrationOf(prospectiveRange.lowerTick, prospectiveRange.upperTick) : null),
    [prospectiveRange, concentrationOf]
  );

  // Range-dependent APR estimate. The pool feed's APR already reflects the pool's
  // *current* concentrated liquidity, so we cannot just multiply it by the full-
  // range factor (that double-counts → absurd numbers). Instead we anchor: a
  // ±reference range (per-pool: ±5% volatile, ±0.05% stable — the band Hyperion's
  // own headline APR implies) ≈ the reported pool APR, and scale the fee side by the
  // chosen range's concentration relative to that reference, clamped to a sane
  // band. Farm rewards are kept flat (conservative). Recomputes with the range.
  const referenceRangePct = poolUi.aprReferencePct;
  const RANGE_APR_RATIO_MIN = 0.3;
  const RANGE_APR_RATIO_MAX = 4;
  const concentrationRef = useMemo(() => {
    if (!poolState) return null;
    const { currentPrice, tickSpacing, decimalsA, decimalsB } = poolState;
    let lo = priceToTick(currentPrice * (1 - referenceRangePct / 100), decimalsA, decimalsB);
    let hi = priceToTick(currentPrice * (1 + referenceRangePct / 100), decimalsA, decimalsB);
    lo = snapDown(lo, tickSpacing);
    hi = snapDown(hi, tickSpacing);
    if (hi <= lo) hi = lo + tickSpacing;
    return concentrationOf(lo, hi);
  }, [poolState, concentrationOf, referenceRangePct]);

  const rangeApr = useMemo(() => {
    if (!poolApr) return null;
    const ratio =
      concentration && concentrationRef && concentrationRef > 0
        ? Math.min(RANGE_APR_RATIO_MAX, Math.max(RANGE_APR_RATIO_MIN, concentration / concentrationRef))
        : 1;
    return {
      base: poolApr.total,
      fee: poolApr.fee,
      farm: poolApr.farm,
      ratio,
      total: poolApr.fee * ratio + poolApr.farm,
    };
  }, [poolApr, concentration, concentrationRef]);

  // Stable pools: deviation of token_a from its $1 peg. The position centers
  // on the MARKET price — surfacing the deviation stops "why did my range not
  // start at $1" confusion and warns before opening into a live depeg.
  const depeg = useMemo(() => {
    if (!poolUi.isStable || !poolState || !(poolState.currentPrice > 0)) return null;
    const devPct = (poolState.currentPrice - 1) * 100;
    return { devPct, warn: Math.abs(devPct) > STABLE_DEPEG_WARN_PCT };
  }, [poolUi.isStable, poolState]);

  // Existing open positions overlaid on the same chart (dashed line-pairs).
  const positionRanges = useMemo(() => {
    if (!poolState) return undefined;
    return openPositions.map((p, i) => ({
      lowerPrice: tickToPrice(p.tickLower, pool.decimalsA, pool.decimalsB),
      upperPrice: tickToPrice(p.tickUpper, pool.decimalsA, pool.decimalsB),
      label: `#${i + 1}`,
      inRange: p.active,
    }));
  }, [openPositions, poolState, pool]);

  // Token logos (from safe token rows) for the regular-Hyperion-style card.
  const logoBySymbol = useMemo(() => {
    const m: Record<string, string | undefined> = {};
    for (const t of safeTokens) if (t.symbol) m[t.symbol] = t.logoUrl;
    return m;
  }, [safeTokens]);


  return (
    <div className="space-y-4">
      {poolError ? (
        <button
          type="button"
          onClick={() => setPoolNonce((n) => n + 1)}
          className="text-xs text-red-500 underline-offset-2 hover:underline"
          title={poolError}
        >
          price unavailable — retry
        </button>
      ) : null}

      {/* Open positions — surfaced on top when the user already has one. */}
      {positionsLoading || openPositions.length > 0 ? (
        <div className={lendingStyles.section}>
          <div
            className={lendingStyles.sectionHeader}
            onClick={() => setPositionsSectionOpen((v) => !v)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setPositionsSectionOpen((v) => !v)}
          >
            <div className={lendingStyles.sectionHeaderMain}>
              <div className={lendingStyles.sectionTitle}>
                <span className={lendingStyles.sectionTitleFull}>
                  Open positions ({openPositionsSummary?.count ?? 0})
                </span>
              </div>
              {openPositionsSummary && !positionsLoading ? (
                <div className={lendingStyles.sectionMetaRow}>
                  <div className={lendingStyles.metaItem}>
                    <SummaryStatLabel
                      label="LP value"
                      tip="Current USD value of both token legs in your open positions, priced at live Panora spot. Excludes uncollected fees and rewards."
                    />
                    <span className={lendingStyles.metaValue}>{fmtUsd(openPositionsSummary.totalUsd)}</span>
                  </div>
                  <div className={lendingStyles.metaItem}>
                    <SummaryStatLabel
                      label="Total earned"
                      tip="Lifetime fees + rewards from these positions — already claimed to your safe plus what's still uncollected. Reconstructed from on-chain vault events; net of the protocol performance fee."
                    />
                    <span className={lendingStyles.metaValue}>
                      {openPositionsSummary.totalEarnedUsd > 0
                        ? fmtUsd(openPositionsSummary.totalEarnedUsd)
                        : '—'}
                    </span>
                  </div>
                  <div className={lendingStyles.metaItem}>
                    <SummaryStatLabel
                      label="Yesterday"
                      tip="Fees and rewards actually claimed to your safe during the previous UTC calendar day. Excludes uncollected fees, LP value changes, and PnL."
                    />
                    <span
                      className={cn(
                        lendingStyles.metaValue,
                        earningsSummary != null && earningsSummary.profitYesterdayUsd > 0
                          ? 'text-green-600 dark:text-green-400'
                          : earningsSummary != null && earningsSummary.profitYesterdayUsd < 0
                            ? 'text-red-500'
                            : null
                      )}
                    >
                      {earningsLoading
                        ? '…'
                        : earningsSummary != null
                          ? earningsSummary.profitYesterdayUsd < 0
                            ? `−${fmtUsd(Math.abs(earningsSummary.profitYesterdayUsd)).slice(1)}`
                            : fmtUsd(earningsSummary.profitYesterdayUsd)
                          : '—'}
                    </span>
                  </div>
                  <div className={lendingStyles.metaItem}>
                    <SummaryStatLabel
                      label="PnL"
                      tip="Position value + all earned (claimed and uncollected) minus the USD deposited into these positions (from vault open/add events). Includes impermanent loss, so it can differ from earned. Shows — when the deposit basis isn't available."
                    />
                    <span
                      className={cn(
                        lendingStyles.metaValue,
                        openPositionsSummary.totalPnlUsd != null && openPositionsSummary.totalPnlUsd >= 0
                          ? 'text-green-600 dark:text-green-400'
                          : openPositionsSummary.totalPnlUsd != null
                            ? 'text-red-500'
                            : null
                      )}
                    >
                      {openPositionsSummary.totalPnlUsd != null
                        ? `${openPositionsSummary.totalPnlUsd >= 0 ? '+' : '−'}${fmtUsd(Math.abs(openPositionsSummary.totalPnlUsd))}`
                        : '—'}
                    </span>
                  </div>
                  <div className={lendingStyles.metaItem}>
                    <SummaryStatLabel
                      label="APR"
                      tip="Annualized estimate: total earned ÷ the USD you deposited, projected over a year from how long the position has been open (falls back to current value if the deposit basis isn't indexed). Active positions only. An estimate from past fees, not a guaranteed forward rate."
                    />
                    <span className={lendingStyles.metaValue}>
                      {openPositionsSummary.avgApr != null
                        ? `${openPositionsSummary.avgApr.toFixed(2)}%`
                        : '—'}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
            <ChevronDown
              className={cn(lendingStyles.chevron, !positionsSectionOpen && lendingStyles.chevronCollapsed)}
            />
          </div>
          {positionsSectionOpen ? (
            <div className={lendingStyles.rows}>
              {positionsLoading ? (
                <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading positions…
                </div>
              ) : (
                <>
                  <div className={lendingStyles.tableHeader}>
                    <div className={lendingStyles.colAsset}>POOL</div>
                    <div className={lendingStyles.colApr}>APR</div>
                    <div className={lendingStyles.colValue}>VALUE</div>
                    <div className={lendingStyles.colActions} aria-hidden />
                  </div>
                  {openPositions.map((p, i) => {
                    const posPool = poolForPosition(p.tokenA, p.tokenB) ?? pool;
                    const posIsSelected = posPool.poolAddress === pool.poolAddress;
                    const posMidTick = Math.round((p.tickLower + p.tickUpper) / 2);
                    const posPrice = posIsSelected
                      ? poolState?.currentPrice ?? tickToPrice(posMidTick, posPool.decimalsA, posPool.decimalsB)
                      : tickToPrice(posMidTick, posPool.decimalsA, posPool.decimalsB);
                    return (
                      <HyperionPositionRow
                        key={p.position}
                        p={p}
                        index={i + 1}
                        busy={busy}
                        currentPrice={posPrice}
                        decimalsA={posPool.decimalsA}
                        decimalsB={posPool.decimalsB}
                        symbolA={posPool.symbolA}
                        symbolB={posPool.symbolB}
                        logoA={logoBySymbol[posPool.symbolA] ?? TOKEN_LOGOS[posPool.symbolA]}
                        logoB={logoBySymbol[posPool.symbolB] ?? USDC_LOGO_APTOS}
                        accrued={{
                          feesUsd: p.feesUsd ?? 0,
                          rewardsUsd: p.rewardsUsd ?? 0,
                          valueUsd: p.valueUsd ?? null,
                          feesBreakdown: p.feesBreakdown ?? [],
                          rewardsBreakdown: p.rewardsBreakdown ?? [],
                          aprPct: p.aprPct ?? null,
                          pnlUsd: p.pnlUsd ?? null,
                          pnlUnavailableReason: p.pnlUnavailableReason ?? null,
                          claimedUsd: p.claimedUsd ?? 0,
                        }}
                        poolAprPct={aprTotalForPoolAddress(posPool.poolAddress)}
                        chartTokenAMint={posPool.tokenA}
                        safeBalanceA={safeBalanceOf(posPool.tokenA, posPool.symbolA, posPool.decimalsA)}
                        safeBalanceB={usdcBalance}
                        slippageBps={slippageBps}
                        priceDecimals={posPool.ui.priceDecimals}
                        showPriceChart
                        chartPriceSource={posPool.ui.isStable ? 'hyperion-pool' : 'birdeye'}
                        chartPoolKey={posPool.ui.isStable ? posPool.key : undefined}
                        onClaim={() => void callClaim(p.position)}
                        onClose={(convert) => void callClose(p.position, convert)}
                        onAddDual={(aBase, bBase) => void callAddDual(p.position, aBase, bBase)}
                        onAddZap={(tok, base) => void callAddZap(p.position, tok, base)}
                      />
                    );
                  })}
                </>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Open position */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="text-sm font-semibold text-foreground">Open new position</div>
            <p className="text-xs text-muted-foreground">
              {advanced
                ? 'Custom funding, range, and swap settings for this open.'
                : poolUi.simpleFixedRangePct != null
                  ? 'AI-managed default: USDC in, agent-maintained stable range.'
                  : 'AI-managed default: USDC in with the pool default range.'}
            </p>
          </div>
          <div className="inline-flex rounded-md bg-muted p-1">
            {([false, true] as const).map((custom) => (
              <button
                key={String(custom)}
                type="button"
                onClick={() => {
                  setAdvanced(custom);
                  if (!custom) {
                    setEntryMode('zap');
                  }
                }}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  advanced === custom
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                aria-pressed={advanced === custom}
              >
                {custom ? <SlidersHorizontal className="h-3.5 w-3.5" /> : null}
                {custom ? 'Custom' : 'AI-managed'}
              </button>
            ))}
          </div>
        </div>

        {/* Pool + deposit side by side on wide screens — top-aligned. */}
        <div className="grid items-start gap-3 lg:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Pool</Label>
            <Select value={poolKey} onValueChange={(v) => setPoolKey(v as HyperionPoolKey)}>
              {/* Sized to visually match the TokenAmountInput on the right. */}
              <SelectTrigger className="h-auto rounded-2xl border px-3 py-3 text-sm sm:px-4 sm:py-3.5">
                <span className="flex w-full items-center gap-2.5">
                  <span className="flex shrink-0">
                    {TOKEN_LOGOS[pool.symbolA] ? (
                      <img src={TOKEN_LOGOS[pool.symbolA]} alt={pool.symbolA} className="h-9 w-9 rounded-full border bg-background object-contain sm:h-11 sm:w-11" />
                    ) : null}
                    {TOKEN_LOGOS[pool.symbolB] ? (
                      <img src={TOKEN_LOGOS[pool.symbolB]} alt={pool.symbolB} className="-ml-2 h-9 w-9 rounded-full border bg-background object-contain sm:h-11 sm:w-11" />
                    ) : null}
                  </span>
                  <span className="flex min-w-0 flex-col items-start gap-0.5 leading-tight">
                    <span className="font-medium">{pool.label}</span>
                    {poolMetaByKey[poolKey] ? (
                      <span className="text-[11px] text-muted-foreground">
                        <span className="text-green-600 dark:text-green-400">
                          {poolMetaByKey[poolKey].aprTotal.toFixed(1)}% APR
                        </span>
                        {poolMetaByKey[poolKey].tvlUsd > 0 ? ` · TVL ${compactUsd(poolMetaByKey[poolKey].tvlUsd)}` : ''}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">Concentrated LP pool</span>
                    )}
                  </span>
                </span>
              </SelectTrigger>
              <SelectContent>
                {poolKeys.map((k) => {
                  const cfg = YIELD_AI_HYPERION_POOLS[k];
                  const meta = poolMetaByKey[k];
                  return (
                    <SelectItem key={k} value={k}>
                      <div className="flex w-full items-center gap-2">
                        <span className="flex shrink-0">
                          {TOKEN_LOGOS[cfg.symbolA] ? (
                            <img src={TOKEN_LOGOS[cfg.symbolA]} alt={cfg.symbolA} className="h-5 w-5 rounded-full border bg-background object-contain" />
                          ) : null}
                          {TOKEN_LOGOS[cfg.symbolB] ? (
                            <img src={TOKEN_LOGOS[cfg.symbolB]} alt={cfg.symbolB} className="-ml-1.5 h-5 w-5 rounded-full border bg-background object-contain" />
                          ) : null}
                        </span>
                        <span className="font-medium">{cfg.label}</span>
                        {meta ? (
                          <span className="ml-auto pl-2 text-[11px] text-muted-foreground">
                            <span className="text-green-600 dark:text-green-400">{meta.aprTotal.toFixed(1)}% APR</span>
                            {meta.tvlUsd > 0 ? ` · TVL ${compactUsd(meta.tvlUsd)}` : ''}
                          </span>
                        ) : null}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Right column: funding; custom mode can use one asset or both safe balances. */}
          <div className="space-y-2">
            {advanced ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-[11px] text-muted-foreground">Funding</Label>
                <div className="flex items-center gap-1">
                  {(['zap', 'dual'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setEntryMode(m)}
                      className={cn(
                        'rounded border px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        entryMode === m
                          ? 'border-border bg-background text-foreground shadow-sm'
                          : 'border-transparent bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                      )}
                    >
                      {m === 'zap' ? 'USDC only' : 'Both assets'}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

        {entryMode === 'zap' ? (
          /* USDC amount with built-in Half / Max (app-standard) */
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <Label className="text-[11px] text-muted-foreground">Deposit {fundingSymbol}</Label>
                {advanced ? (
                  <p className="text-[11px] text-muted-foreground">
                    Agent swaps only the portion needed to match the selected range.
                  </p>
                ) : null}
              </div>
              {/* Stable pools: fund from USDC or from the safe's token_a (USDt). */}
              {canFundWithTokenA ? (
                <div className="flex items-center gap-1">
                  {(['usdc', 'tokenA'] as const).map((ft) => (
                    <button
                      key={ft}
                      type="button"
                      onClick={() => {
                        setFundingToken(ft);
                        setUsdcAmount('');
                        setPreview(null);
                      }}
                      className={cn(
                        'rounded border px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        fundingActive === ft
                          ? 'border-border bg-background text-foreground shadow-sm'
                          : 'border-transparent bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                      )}
                    >
                      {ft === 'usdc' ? 'USDC' : pool.symbolA}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <TokenAmountInput
              tokenLogoUrl={
                fundingActive === 'tokenA'
                  ? tokenAToken?.logoUrl ?? TOKEN_LOGOS[pool.symbolA] ?? ''
                  : USDC_LOGO_APTOS
              }
              tokenSymbol={fundingSymbol}
              amountString={usdcAmount}
              onAmountChange={(v) => {
                setUsdcAmount(v.replace(/[^0-9.]/g, ''));
                setPreview(null);
              }}
              priceUSD={fundingActive === 'tokenA' ? tokenAPrice || 1 : 1}
              availableText={`${fundingBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${fundingSymbol}`}
              inputRef={amountInputRef}
              onHalf={() => setAmountFraction(0.5)}
              onMax={() => setAmountFraction(1)}
              isOverBalance={Number(usdcAmount) > fundingBalance + 1e-9}
            />
            {fundingActive === 'tokenA' ? (
              <p className="text-[11px] text-muted-foreground">
                Agent swaps ~half of your {pool.symbolA} to USDC, then opens the position. Surplus
                returns to the safe.
              </p>
            ) : null}
            {advanced ? (
              <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2.5 py-2">
                <div className="space-y-0.5">
                  <Label className="text-[11px] text-muted-foreground">Max swap slippage</Label>
                  <p className="text-[11px] text-muted-foreground">Used only for the balancing swap.</p>
                </div>
                <div className="relative w-24">
                  <Input
                    inputMode="numeric"
                    value={slippageBps}
                    onChange={(e) => setSlippageBps(e.target.value.replace(/[^0-9]/g, ''))}
                    className="h-8 pr-9 text-sm"
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                    bps
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          /* Dual: auto (B) derives both legs from balances by range; manual (A) lets you edit both */
          <div className="space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-0.5">
                <Label className="text-[11px] text-muted-foreground">Use both safe assets</Label>
                <p className="text-[11px] text-muted-foreground">No swap. Surplus stays in the safe.</p>
              </div>
              <div className="flex items-center gap-1">
                {(['auto', 'manual'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDualSplit(m)}
                    className={cn(
                      'rounded border px-2 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      dualSplit === m
                        ? 'border-border bg-background text-foreground shadow-sm'
                        : 'border-transparent bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                    )}
                  >
                    {m === 'auto' ? 'Auto ratio' : 'Manual amounts'}
                  </button>
                ))}
              </div>
            </div>

            {dualSplit === 'auto' ? (
              <div className="space-y-1.5 rounded-md border bg-background/60 p-2.5 text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>{pool.symbolA}</span>
                  <span className="tabular-nums text-foreground">
                    {dualAmounts ? dualAmounts.aHuman.toLocaleString(undefined, { maximumFractionDigits: 8 }) : '0'}
                    {dualAuto ? ` · ${fmtUsd(dualAuto.aUsd)}` : ''}
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>{pool.symbolB}</span>
                  <span className="tabular-nums text-foreground">
                    {dualAmounts ? dualAmounts.bHuman.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '0'}
                    {dualAuto ? ` · ${fmtUsd(dualAuto.bUsd)}` : ''}
                  </span>
                </div>
                <div className="border-t pt-1.5 text-[11px] text-muted-foreground">
                  Deploys both legs at the range ratio (no swap). Safe holds{' '}
                  {tokenABalance.toLocaleString(undefined, { maximumFractionDigits: 6 })} {pool.symbolA} ·{' '}
                  {usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} {pool.symbolB}. The surplus
                  leg stays in the safe.
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <TokenAmountInput
                  tokenLogoUrl={tokenAToken?.logoUrl ?? TOKEN_LOGOS[pool.symbolA] ?? ''}
                  tokenSymbol={pool.symbolA}
                  amountString={dualAmountA}
                  onAmountChange={(v) => setDualAmountA(v.replace(/[^0-9.]/g, ''))}
                  priceUSD={tokenAPrice}
                  availableText={`${tokenABalance.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${pool.symbolA}`}
                  inputRef={dualARef}
                  onHalf={() => setDualAmountA(String(Math.floor(tokenABalance * 0.5 * 1e8) / 1e8))}
                  onMax={() => setDualAmountA(String(Math.floor(tokenABalance * 1e8) / 1e8))}
                  isOverBalance={Number(dualAmountA) > tokenABalance + 1e-12}
                />
                <TokenAmountInput
                  tokenLogoUrl={USDC_LOGO_APTOS}
                  tokenSymbol={pool.symbolB}
                  amountString={dualAmountB}
                  onAmountChange={(v) => setDualAmountB(v.replace(/[^0-9.]/g, ''))}
                  priceUSD={1}
                  availableText={`${usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${pool.symbolB}`}
                  inputRef={dualBRef}
                  onHalf={() => setDualAmountB(String(Math.floor(usdcBalance * 0.5 * 100) / 100))}
                  onMax={() => setDualAmountB(String(Math.floor(usdcBalance * 100) / 100))}
                  isOverBalance={Number(dualAmountB) > usdcBalance + 1e-9}
                />
              </div>
            )}
          </div>
        )}

            {/* Primary CTA lives next to the deposit — same column, same width. */}
            <Button
              disabled={
                busy !== null ||
                (entryMode === 'zap'
                  ? zapEstimate
                    ? !zapEstimate.sufficient
                    : false
                  : !dualAmounts || (dualAmounts.aBase <= 0n && dualAmounts.bBase <= 0n))
              }
              onClick={handleOpenClick}
              className="h-10 w-full px-6 text-sm font-semibold"
            >
              {busy === 'open' ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : entryMode === 'dual' ? (
                'Open position with both assets'
              ) : (
                `Open position${usdcAmount ? ` · ${usdcAmount} ${fundingSymbol}` : ''}`
              )}
            </Button>
          </div>
        </div>

        {/* Range: ±% presets or explicit min/max price. Stable pools in simple
            mode pin the width to the agent-maintained band instead. */}
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-[11px] text-muted-foreground">Range</Label>

            {rangeLockedToAgent ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex cursor-help items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium tabular-nums">
                    ±{poolUi.simpleFixedRangePct}%
                    <span className="font-normal text-muted-foreground">AI agent maintains this band</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-[260px] text-xs">
                  The agent re-centers stable positions hourly at ±{poolUi.simpleFixedRangePct}% around
                  the live price. AI-managed mode opens at the same width so your position is never silently
                  re-ranged. Use Custom to pick a custom width.
                </TooltipContent>
              </Tooltip>
            ) : (
              <>
            <div className="flex items-center gap-1">
              {(['percent', 'price'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    // Switching to Price: prefill min/max from the current ±%
                    // range so the chart/levels carry over seamlessly.
                    if (m === 'price' && prospectiveRange) {
                      setPriceMin(String(Number(prospectiveRange.lowerPrice.toFixed(6))));
                      setPriceMax(String(Number(prospectiveRange.upperPrice.toFixed(6))));
                    }
                    setRangeMode(m);
                    setPreview(null);
                  }}
                  className={cn(
                    'rounded border px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    rangeMode === m
                      ? 'border-border bg-background text-foreground shadow-sm'
                      : 'border-transparent bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                  )}
                >
                  {m === 'percent' ? '±%' : 'Price'}
                </button>
              ))}
            </div>

            {rangeMode === 'percent' ? (
              <div className="flex items-center gap-1">
                {poolUi.rangePresetsPct.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      setRangePct(p);
                      setPreview(null);
                    }}
                    className={cn(
                      'rounded border px-2 py-1 text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      rangePct === p
                        ? 'border-border bg-background text-foreground shadow-sm'
                        : 'border-transparent bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                    )}
                  >
                    ±{p}%
                  </button>
                ))}
                <div className="relative w-20">
                  <Input
                    inputMode="decimal"
                    value={rangePct}
                    onChange={(e) => {
                      setRangePct(e.target.value.replace(/[^0-9.]/g, ''));
                      setPreview(null);
                    }}
                    placeholder={poolUi.rangePresetsPct[0]}
                    className="h-8 pr-6 text-sm"
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    %
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  inputMode="decimal"
                  value={priceMin}
                  onChange={(e) => {
                    setPriceMin(e.target.value.replace(/[^0-9.]/g, ''));
                    setPreview(null);
                  }}
                  placeholder={poolState ? `Min (${fmtPoolPrice(poolState.currentPrice, poolUi.priceDecimals)})` : 'Min price'}
                  className="h-8 w-28 text-sm"
                />
                <Input
                  inputMode="decimal"
                  value={priceMax}
                  onChange={(e) => {
                    setPriceMax(e.target.value.replace(/[^0-9.]/g, ''));
                    setPreview(null);
                  }}
                  placeholder="Max price"
                  className="h-8 w-28 text-sm"
                />
              </div>
            )}
              </>
            )}

            {/* Estimated in-range APR for the chosen range. Recomputes with the
                range: anchored so a ±10% range ≈ the pool's reported APR, scaled
                by concentration and clamped (see rangeApr memo). */}
            {rangeApr ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="ml-auto inline-flex cursor-help items-center rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">
                    APR ≈ {rangeApr.total.toFixed(1)}%
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-[260px] text-xs">
                  <div>
                    Pool APR {rangeApr.base.toFixed(1)}% — fees {rangeApr.fee.toFixed(1)}% + rewards{' '}
                    {rangeApr.farm.toFixed(1)}%
                  </div>
                  <div className="mt-1">
                    This range: fee side ×{rangeApr.ratio.toFixed(2)} vs a ±{referenceRangePct}% range →
                    est. in-range APR ≈{' '}
                    <span className="font-medium text-foreground">{rangeApr.total.toFixed(1)}%</span>.
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    Estimate. Earned only while the price stays in range; tighter ranges leave range sooner.
                  </div>
                </TooltipContent>
              </Tooltip>
            ) : null}
          </div>

          {/* Stable pools: peg deviation + warning when opening into a depeg. */}
          {depeg ? (
            <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px]">
              <span
                className={cn(
                  'tabular-nums',
                  depeg.warn ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
                )}
              >
                {pool.symbolA} {fmtPoolPrice(poolState?.currentPrice, poolUi.priceDecimals)} ·{' '}
                {depeg.devPct >= 0 ? '+' : '−'}
                {Math.abs(depeg.devPct).toFixed(2)}% vs $1 peg
              </span>
              {depeg.warn ? (
                <span className="text-amber-600 dark:text-amber-400">
                  The position centers on the market price, not $1 — a re-peg walks the price across
                  the range and converts the position along the way.
                </span>
              ) : null}
            </div>
          ) : null}

          {/* Custom width on a stable pool: it lasts only until the
              agent's next re-center, which returns the band to the fixed width. */}
          {advanced && poolUi.simpleFixedRangePct != null && rangePct !== poolUi.simpleFixedRangePct ? (
            <p className="pt-0.5 text-[11px] text-muted-foreground">
              Custom width applies to this open only — the next auto-rebalance re-centers at ±
              {poolUi.simpleFixedRangePct}%.
            </p>
          ) : null}
        </div>

        {zapEstimate ? (
          <div className="space-y-2 rounded-md border bg-muted/30 p-2.5 text-xs">
            {prospectiveRange ? (
              <div className="text-[11px] leading-snug text-muted-foreground">
                Range{' '}
                <span className="font-medium text-foreground">
                  {fmtPoolPrice(prospectiveRange.lowerPrice, poolUi.priceDecimals)} –{' '}
                  {fmtPoolPrice(prospectiveRange.upperPrice, poolUi.priceDecimals)}
                </span>{' '}
                <span>
                  (±{prospectiveRange.widthPct.toLocaleString(undefined, { maximumFractionDigits: 2 })}%)
                </span>
                {preview && showSwapPreview ? (
                  <>
                    {' '}
                    · swap{' '}
                    <span className="font-mono text-foreground">
                      {fmt(preview.swapAmountIn, USDC_DECIMALS)} USDC → {pool.symbolA}
                    </span>
                  </>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setZapDetailsOpen((v) => !v)}
              className="flex w-full items-start justify-between gap-2 text-left"
            >
              <span className="min-w-0 text-muted-foreground">
                <span className="font-medium text-foreground">You get:</span>{' '}
                <span className="tabular-nums">
                  {Math.round(zapEstimate.r * 100)}% {pool.symbolA} / {Math.round((1 - zapEstimate.r) * 100)}%{' '}
                  {pool.symbolB}
                </span>
                {previewLoading ? (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    {' '}
                    · <Loader2 className="h-3 w-3 animate-spin" /> quoting swap
                  </span>
                ) : preview?.estimatedSwapLossBps != null && showSwapPreview ? (
                  <span
                    className={cn(
                      'tabular-nums',
                      (preview.estimatedSwapLossUsdc ?? 0) > 0.005
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-muted-foreground'
                    )}
                  >
                    {' '}
                    · swap impact {fmtPercentFromBps(preview.estimatedSwapLossBps)}
                  </span>
                ) : null}
                {rangeApr ? (
                  <span className="tabular-nums">
                    {' '}
                    · ≈ {fmtUsd((zapEstimate.amt * rangeApr.total) / 100 / 365)}/day
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-1 pt-0.5 text-muted-foreground">
                {zapDetailsOpen ? 'hide' : 'details'}
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', zapDetailsOpen && 'rotate-180')} />
              </span>
            </button>
            {zapEstimate.inRangeNow ? null : (
              <div className="text-amber-600 dark:text-amber-400">range is off current price</div>
            )}
            {zapDetailsOpen ? (
              <div className="space-y-2 border-t pt-2">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Composition
                </div>
                <div className="grid max-w-md grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-muted-foreground">
                  <span>{pool.symbolA} leg</span>
                  <span className="tabular-nums text-foreground">
                    {fmtUsd(zapEstimate.tokenAUsd)} ({Math.round(zapEstimate.r * 100)}%)
                  </span>
                  <span>{pool.symbolB} leg</span>
                  <span className="tabular-nums text-foreground">
                    {fmtUsd(zapEstimate.usdcUsd)} ({Math.round((1 - zapEstimate.r) * 100)}%)
                  </span>
                </div>
                <div className="flex h-1.5 max-w-md overflow-hidden rounded bg-muted">
                  <div
                    style={{ width: `${Math.round(zapEstimate.r * 100)}%`, backgroundColor: 'rgba(249,115,22,0.7)' }}
                  />
                  <div className="flex-1" style={{ backgroundColor: 'rgba(59,130,246,0.7)' }} />
                </div>

                {showSwapPreview ? (
                  <>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Balancing swap
                    </div>
                    <p className="max-w-md text-[11px] leading-snug text-muted-foreground">
                      {previewLoading ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" /> Fetching Hyperion quote…
                        </span>
                      ) : (
                        <>
                          <span className="tabular-nums text-foreground">
                            {fmtUsd(swapInUsd)} USDC → {pool.symbolA}
                          </span>
                          {preview?.quotedSwapAmountOut ? (
                            <>
                              {' '}
                              · expected{' '}
                              <span className="tabular-nums text-foreground">
                                {fmt(preview.quotedSwapAmountOut, pool.decimalsA)} {pool.symbolA}
                              </span>
                            </>
                          ) : (
                            <> · ~estimate (quote pending)</>
                          )}
                          {preview?.swapAmountOutMin ? (
                            <>
                              {' '}
                              · min{' '}
                              <span className="tabular-nums text-foreground">
                                {fmt(preview.swapAmountOutMin, pool.decimalsA)} {pool.symbolA}
                              </span>{' '}
                              ({slippageTolLabel} tol.)
                            </>
                          ) : null}
                          {preview?.estimatedSwapLossBps != null ? (
                            <>
                              {' '}
                              · impact{' '}
                              <span
                                className={cn(
                                  'tabular-nums font-medium',
                                  (preview.estimatedSwapLossUsdc ?? 0) > 0.005
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-foreground'
                                )}
                              >
                                {fmtPercentFromBps(preview.estimatedSwapLossBps)}
                              </span>
                            </>
                          ) : null}
                        </>
                      )}
                    </p>
                    {preview?.remainingUsdcBeforeLp ? (
                      <div className="grid max-w-md grid-cols-[1fr_auto] gap-x-3 text-muted-foreground">
                        <span>USDC kept for LP</span>
                        <span className="tabular-nums text-foreground">
                          {fmt(preview.remainingUsdcBeforeLp, USDC_DECIMALS)} USDC
                        </span>
                      </div>
                    ) : null}
                  </>
                ) : null}

                {rangeApr ? (
                  <div className="grid max-w-md grid-cols-[1fr_auto] gap-x-3 text-muted-foreground">
                    <span>Est. APR (this range)</span>
                    <span className="tabular-nums text-foreground">
                      {rangeApr.total.toFixed(1)}%{' '}
                      <span className="text-muted-foreground">
                        (pool {rangeApr.base.toFixed(1)}% · ×{rangeApr.ratio.toFixed(2)})
                      </span>
                    </span>
                  </div>
                ) : null}

                <div className="max-w-md border-t pt-1.5 text-[11px] text-muted-foreground">
                  Zap-in deposits USDC only. Your existing {pool.symbolA}
                  {tokenABalanceUsd > 0 ? ` (${fmtUsd(tokenABalanceUsd)})` : ''} stays in the safe unless you use
                  Both assets funding in Custom mode.
                </div>
              </div>
            ) : null}
            {zapEstimate.sufficient ? null : (
              <div className="space-y-0.5 pt-0.5 text-red-500">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Not enough {fundingSymbol} — safe holds{' '}
                  {fundingBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Swap quote and preview above are for the entered amount (planning only).
                </p>
              </div>
            )}
          </div>
        ) : null}

        {poolState && prospectiveRange ? (
          <div className={lendingStyles.section}>
            <div
              className={lendingStyles.sectionHeader}
              onClick={() => setChartSectionOpen((v) => !v)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setChartSectionOpen((v) => !v)}
            >
              <div className={lendingStyles.sectionHeaderMain}>
                <div className={lendingStyles.sectionTitle}>
                  <span className={lendingStyles.sectionTitleFull}>Price chart</span>
                </div>
                <div className={lendingStyles.sectionMetaRow}>
                  <div className={lendingStyles.metaItem}>
                    <span className={lendingStyles.metaLabel}>Pool</span>
                    <span className={lendingStyles.metaValue}>
                      {pool.symbolA}/{pool.symbolB}
                    </span>
                  </div>
                </div>
              </div>
              <ChevronDown
                className={cn(lendingStyles.chevron, !chartSectionOpen && lendingStyles.chevronCollapsed)}
              />
            </div>
            {chartSectionOpen ? (
              <div className="space-y-2 px-2 pb-2 pt-1">
                <BinChart
                  tokenXMint={pool.tokenA}
                  tokenXSymbol={pool.symbolA}
                  tokenYSymbol={pool.symbolB}
                  chain="aptos"
                  priceSource={poolUi.isStable ? 'hyperion-pool' : 'birdeye'}
                  poolKey={poolUi.isStable ? pool.key : undefined}
                  height={240}
                  lowerBinPrice={prospectiveRange.lowerPrice}
                  upperBinPrice={prospectiveRange.upperPrice}
                  activeBinPrice={poolState.currentPrice}
                  lowerLabel="Min"
                  upperLabel="Max"
                  extraRanges={positionRanges}
                  priceDecimals={poolUi.priceDecimals}
                />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-0.5 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-3 rounded-sm" style={{ backgroundColor: 'rgba(99,102,241,0.45)' }} />
                    new range
                  </span>
                  {positionRanges && positionRanges.length > 0 ? (
                    <>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block h-2.5 w-3 rounded-sm" style={{ backgroundColor: 'rgba(34,197,94,0.45)' }} />
                        open position (in range)
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="inline-block h-2.5 w-3 rounded-sm" style={{ backgroundColor: 'rgba(249,115,22,0.45)' }} />
                        open position (out of range)
                      </span>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

      </div>

      {/* First-open risk acknowledgment */}
      <Dialog open={showRiskModal} onOpenChange={setShowRiskModal}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Before you open an LP position</DialogTitle>
            <DialogDescription>
              Concentrated-liquidity LP is not a stablecoin deposit. Please confirm you understand:
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            <li>• <span className="font-medium">Impermanent / divergence loss</span> — on withdrawal the USD value can be less than simply holding the two tokens.</li>
            <li>• The position <span className="font-medium">stops earning when the price leaves your range</span> until it returns or is re-centered.</li>
            <li>• The position&apos;s <span className="font-medium">value in USDC can fall below what you deposited</span> — principal is at risk.</li>
            <li>• Non-USDC legs are <span className="font-medium">volatile</span>; this is not a fixed-yield product.</li>
            <li>• Displayed <span className="font-medium">APR is the pool&apos;s recent rate, not a promise</span>.</li>
          </ul>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={riskChecked} onChange={(e) => setRiskChecked(e.target.checked)} className="h-4 w-4" />
            I understand and accept these risks.
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowRiskModal(false)}>
              Cancel
            </Button>
            <Button disabled={!riskChecked} onClick={confirmRisk}>
              Continue
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

