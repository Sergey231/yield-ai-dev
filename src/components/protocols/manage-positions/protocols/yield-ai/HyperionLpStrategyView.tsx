'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { BinChart } from '@/components/protocols/meteora/BinChart';
import { TokenAmountInput } from '@/shared/DepositAmountInput';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { queryKeys } from '@/lib/query/queryKeys';
import { cn } from '@/lib/utils';
import {
  HYPERION_MANAGE_AUTH_TTL_MS,
  buildHyperionManageAuthMessage,
  type HyperionManageAction,
  type HyperionManageSignedFields,
} from '@/lib/protocols/yield-ai/hyperionManageAuth';
import { useHyperionLpPositions } from '@/lib/query/hooks/protocols/yield-ai/useHyperionLpPositions';
import { useYieldAiSafeTokens } from '@/lib/query/hooks/protocols/yield-ai/useYieldAiSafeTokens';
import { useHyperionPools } from '@/lib/query/hooks/protocols/hyperion/useHyperionPools';
import {
  YIELD_AI_HYPERION_POOLS,
  USDC_FA_METADATA_MAINNET,
  type HyperionPoolKey,
} from '@/lib/constants/yieldAiVault';
import { normalizeAddress, toCanonicalAddress } from '@/lib/utils/addressNormalization';
import type { HyperionPositionView } from '@/lib/protocols/yield-ai/hyperionLp';

const USDC_DECIMALS = 6;
const DEFAULT_HALF_WIDTH_TICKS = '250';
const DEFAULT_SLIPPAGE_BPS = '100';
const USDC_LOGO_APTOS = 'https://assets.panora.exchange/tokens/aptos/USDC.svg';

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

/** Non-USDC leg price in USDC for a tick: 1.0001^tick * 10^(decimalsA - decimalsB). */
function tickToPrice(tick: number, decimalsA: number, decimalsB: number): number {
  return Math.pow(1.0001, tick) * 10 ** (decimalsA - decimalsB);
}

function snapDown(tick: number, spacing: number): number {
  return Math.floor(tick / spacing) * spacing;
}

function optionalNumber(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`;
}

function signatureLikeToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return bytesToHex(value);
  if (Array.isArray(value) && value.every((x) => typeof x === 'number')) {
    return bytesToHex(Uint8Array.from(value));
  }
  if (value && typeof value === 'object' && 'toUint8Array' in value) {
    const bytes = (value as { toUint8Array: () => Uint8Array }).toUint8Array();
    return bytesToHex(bytes);
  }
  if (value && typeof value === 'object' && 'toString' in value) {
    return String(value);
  }
  return '';
}

/** Inverse of tickToPrice: USDC price → tick. */
function priceToTick(price: number, decimalsA: number, decimalsB: number): number {
  if (!(price > 0)) return NaN;
  return Math.log(price / 10 ** (decimalsA - decimalsB)) / Math.log(1.0001);
}

type RangeMode = 'percent' | 'price' | 'ticks';

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

  const poolKeys = Object.keys(YIELD_AI_HYPERION_POOLS) as HyperionPoolKey[];
  const [poolKey, setPoolKey] = useState<HyperionPoolKey>(poolKeys[0]);
  const [usdcAmount, setUsdcAmount] = useState('');
  const [rangeMode, setRangeMode] = useState<RangeMode>('percent');
  const [rangePct, setRangePct] = useState('2.5');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [halfWidthTicks, setHalfWidthTicks] = useState(DEFAULT_HALF_WIDTH_TICKS);
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<OpenPreview | null>(null);

  // Entry mode: zap (USDC only, contract swaps) vs dual (both legs from the
  // safe, no swap). Dual split: 'auto' (B — derive from balances by range) or
  // 'manual' (A — user edits both leg amounts).
  const [entryMode, setEntryMode] = useState<'zap' | 'dual'>('zap');
  const [dualSplit, setDualSplit] = useState<'auto' | 'manual'>('auto');
  const [dualAmountA, setDualAmountA] = useState(''); // WBTC (manual)
  const [dualAmountB, setDualAmountB] = useState(''); // USDC (manual)

  const { data: positions = [], isLoading: positionsLoading } = useHyperionLpPositions(safeAddress);
  const { data: safeTokens = [] } = useYieldAiSafeTokens(safeAddress);

  const pool = YIELD_AI_HYPERION_POOLS[poolKey];

  // Live pool state (current tick + price) for the price header + range chart.
  const [poolState, setPoolState] = useState<PoolState | null>(null);
  const [poolError, setPoolError] = useState<string | null>(null);
  const [poolNonce, setPoolNonce] = useState(0);
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
    const { currentTick, currentPrice, tickSpacing: spacing, decimalsA, decimalsB } = poolState;

    let lowerTick: number;
    let upperTick: number;

    if (rangeMode === 'price') {
      const lo = Number(priceMin);
      const hi = Number(priceMax);
      if (!(lo > 0) || !(hi > 0) || hi <= lo) return null;
      lowerTick = priceToTick(lo, decimalsA, decimalsB);
      upperTick = priceToTick(hi, decimalsA, decimalsB);
    } else if (rangeMode === 'percent') {
      const p = Number(rangePct);
      if (!(p > 0)) return null;
      lowerTick = priceToTick(currentPrice * (1 - p / 100), decimalsA, decimalsB);
      upperTick = priceToTick(currentPrice * (1 + p / 100), decimalsA, decimalsB);
    } else {
      const hw = Math.max(10, Math.trunc(Number(halfWidthTicks) || 0));
      lowerTick = currentTick - hw;
      upperTick = currentTick + hw;
    }

    if (!Number.isFinite(lowerTick) || !Number.isFinite(upperTick)) return null;
    lowerTick = snapDown(lowerTick, spacing);
    upperTick = snapDown(upperTick, spacing);
    if (upperTick <= lowerTick) upperTick = lowerTick + spacing;

    const lowerPrice = tickToPrice(lowerTick, decimalsA, decimalsB);
    const upperPrice = tickToPrice(upperTick, decimalsA, decimalsB);
    const widthPct = currentPrice > 0 ? ((upperPrice - lowerPrice) / 2 / currentPrice) * 100 : 0;
    return { lowerTick, upperTick, lowerPrice, upperPrice, widthPct };
  }, [poolState, rangeMode, rangePct, priceMin, priceMax, halfWidthTicks]);

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

  const amountInputRef = useRef<HTMLInputElement | null>(null);
  const dualARef = useRef<HTMLInputElement | null>(null);
  const dualBRef = useRef<HTMLInputElement | null>(null);
  const setAmountFraction = useCallback(
    (frac: number) => {
      // Floor to cents so rounding never exceeds the on-chain balance.
      const v = Math.max(0, Math.floor(usdcBalance * frac * 100) / 100);
      setUsdcAmount(v ? String(v) : '');
      setPreview(null);
    },
    [usdcBalance]
  );

  // Zap-in calculator: what the entered USDC turns into for the chosen range —
  // the value split across the WBTC / USDC legs, the balancing swap, and whether
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
      r = 1; // entirely WBTC side
    } else {
      const sp = Math.pow(1.0001, currentTick / 2);
      const spa = Math.pow(1.0001, lowerTick / 2);
      const spb = Math.pow(1.0001, upperTick / 2);
      const valA = sp - (sp * sp) / spb;
      const valB = sp - spa;
      const denom = valA + valB;
      r = denom > 0 ? Math.min(1, Math.max(0, valA / denom)) : 0;
    }

    const wbtcUsd = amt * r;
    const usdcUsd = amt * (1 - r);
    const sufficient = amt <= usdcBalance + 1e-9;
    const inRangeNow = currentTick >= lowerTick && currentTick < upperTick;
    return { r, wbtcUsd, usdcUsd, sufficient, inRangeNow, amt };
  }, [poolState, prospectiveRange, usdcAmount, usdcBalance]);

  const wbtcToken = useMemo(() => safeTokens.find((t) => t.symbol === 'WBTC'), [safeTokens]);
  const wbtcBalanceUsd = useMemo(() => (wbtcToken?.value ? Number(wbtcToken.value) : 0), [wbtcToken]);
  const wbtcBalance = useMemo(
    () => (wbtcToken ? Number(wbtcToken.amount) / 10 ** (wbtcToken.decimals ?? pool.decimalsA) : 0),
    [wbtcToken, pool.decimalsA]
  );
  const wbtcPrice = useMemo(() => (wbtcToken?.price ? Number(wbtcToken.price) : poolState?.currentPrice ?? 0), [wbtcToken, poolState]);

  // Non-USDC (WBTC) value fraction R for the chosen range — shared by the zap
  // calculator and the dual auto-split. 0 = all-USDC side, 1 = all-WBTC side.
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
    if (entryMode !== 'dual' || dualSplit !== 'auto' || rangeFractionR == null || wbtcPrice <= 0) return null;
    const r = rangeFractionR;
    const balAUsd = wbtcBalance * wbtcPrice; // WBTC value
    const balBUsd = usdcBalance; // USDC value (≈$1)
    // Largest total (USD) deployable in ratio R within both balances.
    const capByA = r > 0 ? balAUsd / r : Infinity;
    const capByB = r < 1 ? balBUsd / (1 - r) : Infinity;
    const totalUsd = Math.max(0, Math.min(capByA, capByB));
    if (!Number.isFinite(totalUsd) || totalUsd <= 0) {
      // Single-sided range: deploy only the relevant leg.
      const aUsd = r >= 1 ? balAUsd : 0;
      const bUsd = r <= 0 ? balBUsd : 0;
      return { aUsd, bUsd, aHuman: aUsd / wbtcPrice, bHuman: bUsd, totalUsd: aUsd + bUsd };
    }
    const aUsd = totalUsd * r;
    const bUsd = totalUsd * (1 - r);
    return { aUsd, bUsd, aHuman: aUsd / wbtcPrice, bHuman: bUsd, totalUsd };
  }, [entryMode, dualSplit, rangeFractionR, wbtcBalance, wbtcPrice, usdcBalance]);

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

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.protocols.yieldAi.hyperionLpPositions(safeAddress),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.protocols.yieldAi.safeTokens(safeAddress),
    });
  }, [queryClient, safeAddress]);

  const signManageAction = useCallback(
    async (action: HyperionManageAction, fields: HyperionManageSignedFields) => {
      if (!account?.address || !signMessage) {
        throw new Error('Connect the safe owner wallet to authorize this action.');
      }

      const publicKey = signatureLikeToString(account.publicKey);
      if (!publicKey) {
        throw new Error('Connected wallet did not expose a public key for authorization.');
      }

      const expiresAt = Date.now() + HYPERION_MANAGE_AUTH_TTL_MS;
      const message = buildHyperionManageAuthMessage({ action, fields, expiresAt });
      const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const signed = await signMessage({
        message,
        nonce,
        address: true,
        application: true,
        chainId: true,
      });

      const fullMessage = typeof signed.fullMessage === 'string' ? signed.fullMessage : '';
      const signature = signatureLikeToString(signed.signature);
      if (!fullMessage || !signature) {
        throw new Error('Wallet did not return a verifiable message signature.');
      }

      return {
        ownerAddress: account.address.toString(),
        publicKey,
        signature,
        fullMessage,
        nonce,
        expiresAt,
      };
    },
    [account, signMessage]
  );

  const callOpen = useCallback(
    async (dryRun: boolean) => {
      const amount = usdcBaseUnits();
      if (amount <= 0n) {
        toast({ title: 'Enter a USDC amount', variant: 'destructive' });
        return;
      }
      const balanceBaseUnits = BigInt(Math.floor(usdcBalance * 10 ** USDC_DECIMALS));
      if (amount > balanceBaseUnits) {
        toast({
          title: 'Insufficient USDC in safe',
          description: `Safe holds ${usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC. Deposit more or lower the amount.`,
          variant: 'destructive',
        });
        return;
      }
      // `ticks` mode: send half-width so the server centers on the live tick.
      // `%`/`price` modes: send the absolute tick levels the user chose.
      const rangeBody =
        rangeMode === 'ticks'
          ? { halfWidthTicks: Number(halfWidthTicks) }
          : prospectiveRange
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
        const auth = dryRunFlag
          ? undefined
          : await signManageAction('hyperion_lp_manage_open', {
              safeAddress: canonicalSafeAddress,
              usdcAmountInBaseUnits: amount.toString(),
              poolKey,
              halfWidthTicks: optionalNumber((rangeBody as { halfWidthTicks?: unknown }).halfWidthTicks),
              tickLower: optionalNumber((rangeBody as { tickLower?: unknown }).tickLower),
              tickUpper: optionalNumber((rangeBody as { tickUpper?: unknown }).tickUpper),
              slippageBps: optionalNumber(slippageBps),
              dryRun: dryRunFlag,
            });
        const res = await fetch('/api/protocols/yield-ai/hyperion-lp/manage/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            safeAddress,
            usdcAmountInBaseUnits: amount.toString(),
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
        setPreview({
          currentTick: d.currentTick,
          tickLower: d.tickLower,
          tickUpper: d.tickUpper,
          swapAmountIn: d.swapAmountIn,
        });
        if (!dryRun) {
          toast({ title: 'LP position opened', description: d.hash ? `tx ${String(d.hash).slice(0, 10)}…` : 'Submitted' });
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
    [safeAddress, poolKey, rangeMode, halfWidthTicks, prospectiveRange, slippageBps, usdcBaseUnits, usdcBalance, signManageAction, toast, refresh]
  );

  // Open a dual (two-sided) position — both legs from the safe, no swap.
  const callOpenDual = useCallback(async () => {
    if (!dualAmounts || (dualAmounts.aBase <= 0n && dualAmounts.bBase <= 0n)) {
      toast({ title: 'Enter token amounts', variant: 'destructive' });
      return;
    }
    const aBalBase = BigInt(Math.floor(wbtcBalance * 10 ** pool.decimalsA));
    const bBalBase = BigInt(Math.floor(usdcBalance * 10 ** pool.decimalsB));
    if (dualAmounts.aBase > aBalBase || dualAmounts.bBase > bBalBase) {
      toast({
        title: 'Insufficient balance in safe',
        description: `Safe holds ${wbtcBalance.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${pool.symbolA} · ${usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${pool.symbolB}.`,
        variant: 'destructive',
      });
      return;
    }
    const rangeBody =
      rangeMode === 'ticks'
        ? { halfWidthTicks: Number(halfWidthTicks) }
        : prospectiveRange
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
        halfWidthTicks: optionalNumber((rangeBody as { halfWidthTicks?: unknown }).halfWidthTicks),
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
  }, [dualAmounts, wbtcBalance, usdcBalance, pool, rangeMode, halfWidthTicks, prospectiveRange, safeAddress, poolKey, signManageAction, toast, refresh]);

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
      const aBalBase = BigInt(Math.floor(wbtcBalance * 10 ** pool.decimalsA));
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
    [safeAddress, wbtcBalance, usdcBalance, pool.decimalsA, pool.decimalsB, signManageAction, toast, refresh]
  );

  // Auto-preview: silently dry-run the open whenever the amount/range changes
  // (debounced) so the computed range + swap split stay live without a button.
  useEffect(() => {
    let cancelled = false;
    const amount = usdcBaseUnits();
    const balanceBaseUnits = BigInt(Math.floor(usdcBalance * 10 ** USDC_DECIMALS));
    const rangeBody =
      rangeMode === 'ticks'
        ? { halfWidthTicks: Number(halfWidthTicks) }
        : prospectiveRange
          ? { tickLower: prospectiveRange.lowerTick, tickUpper: prospectiveRange.upperTick }
          : null;
    if (entryMode !== 'zap' || amount <= 0n || amount > balanceBaseUnits || !rangeBody) {
      setPreview(null);
      return;
    }
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
          const d = json.data;
          setPreview({ currentTick: d.currentTick, tickLower: d.tickLower, tickUpper: d.tickUpper, swapAmountIn: d.swapAmountIn });
        }
      } catch {
        /* silent — the live client-side estimate still shows */
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [entryMode, safeAddress, poolKey, rangeMode, rangePct, priceMin, priceMax, halfWidthTicks, slippageBps, prospectiveRange, usdcAmount, usdcBalance, usdcBaseUnits]);

  const openPositions = positions.filter((p) => !p.closed);

  // Capital efficiency of the chosen range vs a full-range position (same $).
  // m = 2√p / (2√p − √p_lower − p/√p_upper). Tighter range ⇒ higher m ⇒ more
  // fees per dollar WHILE in range. Relative metric only — no APR assumptions.
  const concentration = useMemo(() => {
    if (!poolState || !prospectiveRange) return null;
    const sp = Math.pow(1.0001, poolState.currentTick / 2);
    const spa = Math.pow(1.0001, prospectiveRange.lowerTick / 2);
    const spb = Math.pow(1.0001, prospectiveRange.upperTick / 2);
    const denom = 2 * sp - spa - (sp * sp) / spb;
    if (!(denom > 0)) return null;
    const m = (2 * sp) / denom;
    if (!Number.isFinite(m) || m <= 0) return null;
    return m;
  }, [poolState, prospectiveRange]);

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
    <div className="space-y-4 rounded-lg border bg-card/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-sm font-semibold">Hyperion CLMM LP</h3>
          {poolState ? (
            <span className="text-xs text-muted-foreground">
              {pool.symbolA} ≈ <span className="font-medium text-foreground">{fmtUsd(poolState.currentPrice)}</span>
            </span>
          ) : poolError ? (
            <button
              type="button"
              onClick={() => setPoolNonce((n) => n + 1)}
              className="text-xs text-red-500 underline-offset-2 hover:underline"
              title={poolError}
            >
              price unavailable — retry
            </button>
          ) : (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> loading price…
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {poolApr ? (
            <Badge
              variant="outline"
              className="border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300"
              title={`Pool APR — fees ${poolApr.fee.toFixed(1)}% + rewards ${poolApr.farm.toFixed(1)}%. Full-range pool APR; a concentrated position earns more while in range.`}
            >
              APR ≈ {poolApr.total.toFixed(1)}%
            </Badge>
          ) : null}
          <span className="text-xs text-muted-foreground">
            Safe USDC: {usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      {/* Open position */}
      <div className="space-y-3 rounded-md border bg-background/60 p-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Pool</Label>
            <Select value={poolKey} onValueChange={(v) => setPoolKey(v as HyperionPoolKey)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {poolKeys.map((k) => (
                  <SelectItem key={k} value={k}>
                    {YIELD_AI_HYPERION_POOLS[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Swap slippage (bps)</Label>
            <Input
              inputMode="numeric"
              value={slippageBps}
              onChange={(e) => setSlippageBps(e.target.value.replace(/[^0-9]/g, ''))}
              className="h-9 text-sm"
            />
          </div>
        </div>

        {/* Entry mode: Zap (USDC only, swap) vs Dual (both legs, no swap) */}
        <div className="flex items-center justify-between">
          <Label className="text-[11px] text-muted-foreground">Entry</Label>
          <div className="flex items-center gap-1">
            {(['zap', 'dual'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setEntryMode(m)}
                className={cn(
                  'rounded px-2 py-0.5 text-xs transition-colors',
                  entryMode === m ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                )}
              >
                {m === 'zap' ? 'Zap (USDC)' : 'Dual (2 assets)'}
              </button>
            ))}
          </div>
        </div>

        {entryMode === 'zap' ? (
          /* USDC amount with built-in Half / Max (app-standard) */
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Deposit USDC into the position</Label>
            <TokenAmountInput
              tokenLogoUrl={USDC_LOGO_APTOS}
              tokenSymbol="USDC"
              amountString={usdcAmount}
              onAmountChange={(v) => {
                setUsdcAmount(v.replace(/[^0-9.]/g, ''));
                setPreview(null);
              }}
              priceUSD={1}
              availableText={`${usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 4 })} USDC`}
              inputRef={amountInputRef}
              onHalf={() => setAmountFraction(0.5)}
              onMax={() => setAmountFraction(1)}
              isOverBalance={Number(usdcAmount) > usdcBalance + 1e-9}
            />
          </div>
        ) : (
          /* Dual: auto (B) derives both legs from balances by range; manual (A) lets you edit both */
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[11px] text-muted-foreground">Use both assets from the safe</Label>
              <div className="flex items-center gap-1">
                {(['auto', 'manual'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDualSplit(m)}
                    className={cn(
                      'rounded px-2 py-0.5 text-[11px] transition-colors',
                      dualSplit === m ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    )}
                  >
                    {m === 'auto' ? 'Auto-split' : 'Manual'}
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
                  {wbtcBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })} {pool.symbolA} ·{' '}
                  {usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })} {pool.symbolB}. The surplus
                  leg stays in the safe.
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <TokenAmountInput
                  tokenLogoUrl={wbtcToken?.logoUrl ?? ''}
                  tokenSymbol={pool.symbolA}
                  amountString={dualAmountA}
                  onAmountChange={(v) => setDualAmountA(v.replace(/[^0-9.]/g, ''))}
                  priceUSD={wbtcPrice}
                  availableText={`${wbtcBalance.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${pool.symbolA}`}
                  inputRef={dualARef}
                  onHalf={() => setDualAmountA(String(Math.floor(wbtcBalance * 0.5 * 1e8) / 1e8))}
                  onMax={() => setDualAmountA(String(Math.floor(wbtcBalance * 1e8) / 1e8))}
                  isOverBalance={Number(dualAmountA) > wbtcBalance + 1e-12}
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

        {/* Range selection: percent / price (min–max) / ticks */}
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-[11px] text-muted-foreground">Range</Label>
            <div className="flex items-center gap-1">
              {(['percent', 'price', 'ticks'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setRangeMode(m);
                    setPreview(null);
                  }}
                  className={cn(
                    'rounded px-2 py-0.5 text-xs transition-colors',
                    rangeMode === m
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  )}
                >
                  {m === 'percent' ? '±%' : m === 'price' ? 'Price' : 'Ticks'}
                </button>
              ))}
            </div>
          </div>
          {rangeMode === 'percent' ? (
            <div className="relative">
              <Input
                inputMode="decimal"
                value={rangePct}
                onChange={(e) => {
                  setRangePct(e.target.value.replace(/[^0-9.]/g, ''));
                  setPreview(null);
                }}
                placeholder="2.5"
                className="h-9 pr-7 text-sm"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                %
              </span>
            </div>
          ) : rangeMode === 'price' ? (
            <div className="grid grid-cols-2 gap-2">
              <Input
                inputMode="decimal"
                value={priceMin}
                onChange={(e) => {
                  setPriceMin(e.target.value.replace(/[^0-9.]/g, ''));
                  setPreview(null);
                }}
                placeholder={poolState ? `Min (${fmtUsd(poolState.currentPrice)})` : 'Min price'}
                className="h-9 text-sm"
              />
              <Input
                inputMode="decimal"
                value={priceMax}
                onChange={(e) => {
                  setPriceMax(e.target.value.replace(/[^0-9.]/g, ''));
                  setPreview(null);
                }}
                placeholder="Max price"
                className="h-9 text-sm"
              />
            </div>
          ) : (
            <Input
              inputMode="numeric"
              value={halfWidthTicks}
              onChange={(e) => {
                setHalfWidthTicks(e.target.value.replace(/[^0-9]/g, ''));
                setPreview(null);
              }}
              placeholder="250"
              className="h-9 text-sm"
            />
          )}
        </div>

        {prospectiveRange ? (
          <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
            Selected range:{' '}
            <span className="font-medium text-foreground">
              {fmtUsd(prospectiveRange.lowerPrice)} – {fmtUsd(prospectiveRange.upperPrice)}
            </span>{' '}
            <span className="text-muted-foreground">
              (±{prospectiveRange.widthPct.toLocaleString(undefined, { maximumFractionDigits: 2 })}% around{' '}
              {fmtUsd(poolState?.currentPrice)})
            </span>
            {preview ? (
              <>
                {' '}· swap to {pool.symbolA}:{' '}
                <span className="font-mono text-foreground">{fmt(preview.swapAmountIn, USDC_DECIMALS)} USDC</span>
              </>
            ) : null}
          </div>
        ) : null}

        {/* Zap-in calculator: what the deposit becomes + sufficiency */}
        {zapEstimate ? (
          <div className="space-y-1.5 rounded-md border bg-muted/30 p-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium text-foreground">Position preview (Zap-in)</span>
              {zapEstimate.inRangeNow ? null : (
                <span className="text-amber-600 dark:text-amber-400">range is off current price</span>
              )}
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>{pool.symbolA} leg</span>
              <span className="tabular-nums text-foreground">
                {fmtUsd(zapEstimate.wbtcUsd)} ({Math.round(zapEstimate.r * 100)}%)
              </span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>{pool.symbolB} leg</span>
              <span className="tabular-nums text-foreground">
                {fmtUsd(zapEstimate.usdcUsd)} ({Math.round((1 - zapEstimate.r) * 100)}%)
              </span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>balancing swap</span>
              <span className="tabular-nums">
                ≈ {fmtUsd(zapEstimate.wbtcUsd)} USDC → {pool.symbolA}
              </span>
            </div>
            {poolApr ? (
              <div className="flex justify-between text-muted-foreground">
                <span>pool APR (fees + rewards)</span>
                <span className="tabular-nums text-foreground">
                  {poolApr.total.toFixed(1)}%{' '}
                  <span className="text-muted-foreground">
                    ({poolApr.fee.toFixed(1)}% + {poolApr.farm.toFixed(1)}%)
                  </span>
                </span>
              </div>
            ) : null}
            {concentration ? (
              <div className="flex justify-between text-muted-foreground">
                <span>capital efficiency (this range)</span>
                <span className="tabular-nums text-foreground">
                  ≈ {concentration < 100 ? concentration.toFixed(1) : Math.round(concentration)}× vs full range
                </span>
              </div>
            ) : null}
            {concentration ? (
              <div className="border-t pt-1.5 text-[11px] text-muted-foreground">
                Tighter range → up to {concentration < 100 ? concentration.toFixed(1) : Math.round(concentration)}× more
                fees/rewards per $ <span className="font-medium">while in range</span>, but it leaves range sooner →
                more re-centering. Earns nothing while out of range.
              </div>
            ) : null}
            <div
              className={cn(
                'flex items-center gap-1.5 pt-0.5',
                zapEstimate.sufficient ? 'text-green-600 dark:text-green-400' : 'text-red-500'
              )}
            >
              {zapEstimate.sufficient ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Enough USDC in safe ({usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })})
                </>
              ) : (
                <>
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Not enough USDC — safe holds {usdcBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </>
              )}
            </div>
            <div className="border-t pt-1.5 text-[11px] text-muted-foreground">
              Zap-in deposits USDC only. Your existing {pool.symbolA}
              {wbtcBalanceUsd > 0 ? ` (${fmtUsd(wbtcBalanceUsd)})` : ''} stays in the safe — dual-leg
              deposit (using both legs) isn’t available yet.
            </div>
          </div>
        ) : null}

        {poolState && prospectiveRange ? (
          <BinChart
            tokenXMint={pool.tokenA}
            tokenXSymbol={pool.symbolA}
            tokenYSymbol={pool.symbolB}
            chain="aptos"
            height={240}
            lowerBinPrice={prospectiveRange.lowerPrice}
            upperBinPrice={prospectiveRange.upperPrice}
            activeBinPrice={poolState.currentPrice}
            lowerLabel="Min"
            upperLabel="Max"
            extraRanges={positionRanges}
          />
        ) : null}

        {poolState && prospectiveRange ? (
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
        ) : null}

        <Button
          disabled={
            busy !== null ||
            (entryMode === 'zap'
              ? zapEstimate
                ? !zapEstimate.sufficient
                : false
              : !dualAmounts || (dualAmounts.aBase <= 0n && dualAmounts.bBase <= 0n))
          }
          onClick={() => void (entryMode === 'dual' ? callOpenDual() : callOpen(false))}
          className="h-11 w-full text-base font-semibold"
        >
          {busy === 'open' ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : entryMode === 'dual' ? (
            'Open LP position (dual)'
          ) : (
            `Open LP position${usdcAmount ? ` · ${usdcAmount} USDC` : ''}`
          )}
        </Button>
      </div>

      {/* Positions */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Open positions</div>
        {positionsLoading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading positions…
          </div>
        ) : openPositions.length === 0 ? (
          <div className="py-2 text-sm text-muted-foreground">No open LP positions.</div>
        ) : (
          openPositions.map((p, i) => (
            <PositionRow
              key={p.position}
              p={p}
              index={i + 1}
              busy={busy}
              currentPrice={poolState?.currentPrice ?? null}
              decimalsA={poolState?.decimalsA ?? 8}
              decimalsB={poolState?.decimalsB ?? 6}
              symbolA={pool.symbolA}
              symbolB={pool.symbolB}
              logoA={logoBySymbol[pool.symbolA] ?? wbtcToken?.logoUrl}
              logoB={logoBySymbol[pool.symbolB] ?? USDC_LOGO_APTOS}
              accrued={{
                feesUsd: p.feesUsd ?? 0,
                rewardsUsd: p.rewardsUsd ?? 0,
                valueUsd: p.valueUsd ?? null,
                feesBreakdown: p.feesBreakdown ?? [],
                rewardsBreakdown: p.rewardsBreakdown ?? [],
                aprPct: p.aprPct ?? null,
              }}
              safeBalanceA={wbtcBalance}
              safeBalanceB={usdcBalance}
              onClaim={() => void callClaim(p.position)}
              onClose={() => void callClose(p.position, false)}
              onConvert={() => void callClose(p.position, true)}
              onAddDual={(aBase, bBase) => void callAddDual(p.position, aBase, bBase)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function PositionRow({
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
  safeBalanceA,
  safeBalanceB,
  onClaim,
  onClose,
  onConvert,
  onAddDual,
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
  accrued?: {
    feesUsd: number;
    rewardsUsd: number;
    valueUsd: number | null;
    feesBreakdown?: Array<{ symbol: string; amount: number }>;
    rewardsBreakdown?: Array<{ symbol: string; amount: number }>;
    aprPct?: number | null;
  };
  safeBalanceA: number;
  safeBalanceB: number;
  onClaim: () => void;
  onClose: () => void;
  onConvert: () => void;
  onAddDual: (amountABase: bigint, amountBBase: bigint) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [addA, setAddA] = useState('');
  const [addB, setAddB] = useState('');
  const addABase = (() => {
    const n = Number(addA);
    return n > 0 ? BigInt(Math.floor(n * 10 ** decimalsA)) : 0n;
  })();
  const addBBase = (() => {
    const n = Number(addB);
    return n > 0 ? BigInt(Math.floor(n * 10 ** decimalsB)) : 0n;
  })();
  const lowerPrice = tickToPrice(p.tickLower, decimalsA, decimalsB);
  const upperPrice = tickToPrice(p.tickUpper, decimalsA, decimalsB);
  const amountAHuman = Number(p.amountA) / 10 ** decimalsA;
  const amountBHuman = Number(p.amountB) / 10 ** decimalsB;
  const valueA = currentPrice != null ? amountAHuman * currentPrice : null;
  const computedUsd = valueA != null ? valueA + amountBHuman : null;
  // Prefer the SDK's position value when available (matches regular Hyperion).
  const totalUsd = accrued?.valueUsd != null ? accrued.valueUsd : computedUsd;
  const feesUsd = accrued?.feesUsd ?? 0;
  const rewardsUsd = accrued?.rewardsUsd ?? 0;
  const feesBreakdown = accrued?.feesBreakdown ?? [];
  const rewardsBreakdown = accrued?.rewardsBreakdown ?? [];
  const aprPct = accrued?.aprPct ?? null;
  const fmtTokenList = (list: Array<{ symbol: string; amount: number }>): string =>
    list.length
      ? list.map((t) => `${t.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${t.symbol}`).join(' · ')
      : 'none';
  // Composition: per-leg USD value + share. USDC leg ≈ its amount; non-USDC leg
  // priced at the current pool price.
  const legAUsd = valueA;
  const legBUsd = amountBHuman;
  const compTotal = (legAUsd ?? 0) + legBUsd;
  const shareA = legAUsd != null && compTotal > 0 ? (legAUsd / compTotal) * 100 : null;
  const shareB = shareA != null ? 100 - shareA : null;
  return (
    <div className="rounded-lg border bg-card">
      {/* Header — mirrors the regular Hyperion position card */}
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-center">
            <div className="flex">
              {logoA ? (
                <img src={logoA} alt={symbolA} className="h-6 w-6 rounded-full border bg-background object-contain" />
              ) : (
                <div className="h-6 w-6 rounded-full border bg-muted" />
              )}
              {logoB ? (
                <img src={logoB} alt={symbolB} className="-ml-2 h-6 w-6 rounded-full border bg-background object-contain" />
              ) : (
                <div className="-ml-2 h-6 w-6 rounded-full border bg-muted" />
              )}
            </div>
            <Badge
              variant="outline"
              className={cn(
                'mt-1 h-5 py-0 text-[10px]',
                p.active
                  ? 'border-green-500/20 bg-green-500/10 text-green-600'
                  : 'border-red-500/20 bg-red-500/10 text-red-600'
              )}
            >
              {p.active ? 'Active' : 'Inactive'}
            </Badge>
          </div>
          <div className="ml-1 flex flex-col">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                #{index}
              </span>
              {symbolA}/{symbolB}
              {aprPct != null ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help rounded border border-green-500/30 bg-green-500/10 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-300">
                      ~{aprPct.toLocaleString(undefined, { maximumFractionDigits: 1 })}% APR
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-[220px] text-xs">
                      Est. annualized from uncollected fees + rewards since open. Resets on claim;
                      0 while out of range.
                    </p>
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>
            <div className="text-[11px] text-muted-foreground">
              fee {p.feeTier} · {fmtUsd(lowerPrice)} – {fmtUsd(upperPrice)}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end">
          <div className="text-base font-medium">{totalUsd != null ? fmtUsd(totalUsd) : '—'}</div>
          <div className="text-[11px] text-muted-foreground">value</div>
        </div>
      </div>
      {/* Composition — per-leg amount, USD value and share + proportion bar */}
      <div className="space-y-1 border-t px-3 py-2 text-[11px]">
        <div className="text-muted-foreground">Composition</div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: 'rgba(249,115,22,0.85)' }} />
            {symbolA}
          </span>
          <span className="tabular-nums text-foreground">
            {fmt(p.amountA, decimalsA)}
            {legAUsd != null ? ` · ${fmtUsd(legAUsd)}` : ''}
            {shareA != null ? ` · ${shareA.toFixed(0)}%` : ''}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: 'rgba(59,130,246,0.85)' }} />
            {symbolB}
          </span>
          <span className="tabular-nums text-foreground">
            {fmt(p.amountB, decimalsB)} · {fmtUsd(legBUsd)}
            {shareB != null ? ` · ${shareB.toFixed(0)}%` : ''}
          </span>
        </div>
        {shareA != null ? (
          <div className="mt-0.5 flex h-1.5 w-full overflow-hidden rounded bg-muted">
            <div style={{ width: `${shareA}%`, backgroundColor: 'rgba(249,115,22,0.7)' }} />
            <div className="flex-1" style={{ backgroundColor: 'rgba(59,130,246,0.7)' }} />
          </div>
        ) : null}
      </div>
      {/* Pending fees + rewards (from the Hyperion SDK feed) */}
      <div className="flex items-center justify-between border-t px-3 py-1.5 text-[11px]">
        <span className="text-muted-foreground">Uncollected</span>
        <span className="flex items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help text-muted-foreground underline decoration-dotted underline-offset-2">
                fees <span className="font-medium text-foreground">{fmtUsd(feesUsd)}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Uncollected fees: {fmtTokenList(feesBreakdown)}</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help text-muted-foreground underline decoration-dotted underline-offset-2">
                rewards <span className="font-medium text-foreground">{fmtUsd(rewardsUsd)}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Uncollected rewards: {fmtTokenList(rewardsBreakdown)}</p>
            </TooltipContent>
          </Tooltip>
        </span>
      </div>
      {/* Inline "Add (dual)" form — both legs from the safe, position's range */}
      {showAdd ? (
        <div className="space-y-2 border-t px-3 py-2 text-[11px]">
          <div className="text-muted-foreground">Add both legs from the safe (no swap)</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-0.5">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{symbolA}</span>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setAddA(String(Math.floor(safeBalanceA * 1e8) / 1e8))}
                >
                  max {safeBalanceA.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                </button>
              </div>
              <Input
                inputMode="decimal"
                value={addA}
                onChange={(e) => setAddA(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="0.0"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{symbolB}</span>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setAddB(String(Math.floor(safeBalanceB * 100) / 100))}
                >
                  max {safeBalanceB.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </button>
              </div>
              <Input
                inputMode="decimal"
                value={addB}
                onChange={(e) => setAddB(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="0.0"
                className="h-8 text-xs"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy !== null || (addABase <= 0n && addBBase <= 0n)}
              onClick={() => onAddDual(addABase, addBBase)}
            >
              {busy === `add:${p.position}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Confirm add'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {/* Actions */}
      <div className="flex flex-wrap gap-2 border-t px-3 py-2">
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => setShowAdd((v) => !v)}>
          Add
        </Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={onClaim}>
          {busy === `claim:${p.position}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Claim fees'}
        </Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={onClose}>
          {busy === `close:${p.position}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Close'}
        </Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={onConvert}>
          {busy === `convert:${p.position}` ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            'Close → USDC'
          )}
        </Button>
      </div>
    </div>
  );
}
