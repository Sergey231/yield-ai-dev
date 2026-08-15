'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useWalletData } from '@/contexts/WalletContext';
import { Aptos, AptosConfig, Network, AccountAddress } from '@aptos-labs/ts-sdk';
import { normalizeAuthenticator } from '@/lib/hooks/useTransactionSubmitter';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Download, Info, Target, Upload } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { formatNumber, formatCurrency } from '@/lib/utils/numberFormat';
import { normalizeAddress } from '@/lib/utils/addressNormalization';
import { cn } from '@/lib/utils';
import { DecibelOpenPositionModal, type DecibelOpenPositionMarket } from '@/components/decibel/decibel-open-position-modal';
import {
  buildCloseAtMarketPayload,
  buildCloseAtLimitPayload,
  buildCancelOrderPayload,
  type DecibelMarketConfig,
} from '@/lib/protocols/decibel/closePosition';
import { buildApproveBuilderFeePayload } from '@/lib/protocols/decibel/approveBuilderFee';
import {
  HEDGE_FA,
  buildUnwindHedgePrefillFromClosePosition,
  formatBaseAmountForSwap,
  hasEnoughBaseForHedge,
  hedgeBaseFaFromSymbol,
  parseMarketBaseSymbol,
} from '@/lib/protocols/decibel/hedgePrefill';
import { SwapModal, type SwapModalPrefill } from '@/components/ui/swap-modal';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useProtocol } from '@/lib/contexts/ProtocolContext';
import { useMobileManagement } from '@/contexts/MobileManagementContext';
import { useEffectiveWalletAddresses } from '@/lib/hooks/useEffectiveWalletAddresses';
import { getProtocolByName } from '@/lib/protocols/getProtocolsList';
import { dispatchSelectYieldAiSafe } from '@/lib/query/hooks/protocols/yield-ai/useSelectedYieldAiSafe';
import {
  useDecibelReferralDashboard,
  type DecibelReferralCode,
} from '@/lib/query/hooks/protocols/decibel/useDecibelReferralDashboard';
import { useDecibelSubaccounts } from '@/lib/query/hooks/protocols/decibel/useDecibelSubaccounts';
import { useDecibelUserPositions } from '@/lib/query/hooks/protocols/decibel/useDecibelUserPositions';
import {
  useDecibelAccountOverview,
  useDecibelAmps,
  useDecibelMarkets,
  useDecibelOpenOrders,
  useDecibelPredepositorBalance,
  useDecibelPrices,
  useDecibelVaultPerformance,
} from '@/lib/query/hooks/protocols/decibel/useDecibelPortfolioData';
import {
  useEchelonPositions,
  type EchelonPosition,
} from '@/lib/query/hooks/protocols/echelon/useEchelonPositions';
import { DecibelWithdrawModal } from '@/components/ui/decibel-withdraw-modal';
import { DecibelVaultShareDepositModal } from '@/components/ui/decibel-vault-share-deposit-modal';
import { DecibelVaultShareWithdrawModal } from '@/components/ui/decibel-vault-share-withdraw-modal';
import { DecibelMarketIcon } from '@/components/decibel/DecibelMarketIcon';
import { useDecibelMarketLogosMap } from '@/hooks/useDecibelMarketLogosMap';
import { MARKET_LOGOS } from '@/lib/protocols/decibel/marketIcon';
import { marketNameForFundingApi } from '@/lib/protocols/decibel/fundingApr';

/** Decibel API position shape (snake_case from API) */
export interface DecibelPosition {
  market: string;
  size: number;
  entry_price: number;
  estimated_liquidation_price: number;
  unrealized_funding: number;
  user: string;
  user_leverage: number;
  is_isolated: boolean;
  is_deleted?: boolean;
  sl_limit_price?: number | null;
  sl_trigger_price?: number | null;
  tp_limit_price?: number | null;
  tp_trigger_price?: number | null;
}

/** Decibel vault performance item (from account_vault_performance API, enriched with apr) */
export interface DecibelVaultItem {
  vault?: {
    name?: string;
    address?: string;
    share_asset_metadata?: string;
    share_symbol?: string;
    wallet_share_balance?: number | string;
  };
  account_address?: string;
  current_num_shares?: number | string;
  current_value_of_shares?: number;
  total_deposited?: number;
  total_withdrawn?: number;
  /** Current unrealized vault PnL from Decibel account_vault_performance. */
  unrealized_pnl?: number;
  share_price?: number;
  locked_amount?: number;
  share_asset_metadata?: string;
  share_symbol?: string;
  wallet_share_balance?: number | string;
  /** APR in % (e.g. 2.98 = 2.98%), from API; display as-is, do not multiply by 100 */
  apr?: number;
}

type DecibelAmpsData = {
  rank?: number | null;
  total_amps: number;
  trading_amps?: number;
  referral_amps?: number;
  vault_amps?: number;
  streak_amps?: number;
  bonus_amps?: number;
};

type YieldAiSafesResponse = {
  data?: {
    safeAddresses?: string[];
  };
};

type DeltaNeutralStateResponse = {
  success?: boolean;
  data?: {
    recordExists?: boolean;
    isOpen?: boolean;
    decibelSubaccount?: string;
    perpMarket?: string;
  };
  recordExists?: boolean;
  isOpen?: boolean;
  decibelSubaccount?: string;
  perpMarket?: string;
};

/** Open order from Decibel open_orders API (supports snake_case and common variants) */
export interface DecibelOpenOrder {
  /** Added client-side when aggregating open orders across subaccounts. */
  source_subaccount?: string;
  account?: string;
  user?: string;
  subaccount?: string;
  subaccount_address?: string;
  market?: string;
  market_address?: string;
  price: number;
  size?: number;
  /** API returns human size (e.g. 0.00015) */
  orig_size?: number;
  remaining_size?: number;
  size_delta?: number;
  reduce_only?: boolean;
  is_reduce_only?: boolean;
  order_id?: string;
}

/** Find reduce-only order for this position (same market) */
function getOrderForPosition(
  orders: DecibelOpenOrder[],
  position: DecibelPosition
): DecibelOpenOrder | undefined {
  const posMarket = normalizeAddress(position.market);
  const posSubaccount = normalizeAddress(position.user);
  return orders.find((o) => {
    const orderMarket = normalizeAddress((o.market ?? o.market_address ?? ''));
    const orderSubaccount = normalizeAddress(
      o.source_subaccount ?? o.subaccount ?? o.subaccount_address ?? o.account ?? o.user ?? ''
    );
    const reduceOnly = o.reduce_only ?? o.is_reduce_only === true;
    return orderSubaccount === posSubaccount && orderMarket === posMarket && reduceOnly;
  });
}

const DECIBEL_APP_URL = 'https://app.decibel.trade/';

function yieldAiManagedPositionKey(subaccount: string, market: string): string {
  return `${normalizeAddress(subaccount)}:${normalizeAddress(market)}`;
}

/** Format position size with enough decimals for small amounts (e.g. 0.003706 BTC) */
function formatSize(size: number): string {
  const abs = Math.abs(size);
  if (abs === 0) return '0';
  if (abs < 0.0001) return size.toFixed(8);
  if (abs < 0.01) return size.toFixed(6);
  if (abs < 1) return size.toFixed(4);
  return formatNumber(size, 2);
}

function formatLimitPriceInput(num: number, decimals = 4): string {
  if (!Number.isFinite(num)) return '';
  // Keep a stable decimal precision and avoid thousand separators in <input type="number" />.
  return num.toFixed(decimals);
}

function applyLimitPriceAction(
  current: string,
  markPx: number | null,
  action: 'mark' | 'minus1pct' | 'plus1pct'
): string {
  if (action === 'mark') {
    if (markPx != null && markPx > 0) return formatLimitPriceInput(markPx, 4);
    return current;
  }
  const parsed = parseFloat(current.trim());
  const hasValidInput = Number.isFinite(parsed) && parsed > 0;
  const base = hasValidInput ? parsed : markPx != null && markPx > 0 ? markPx : Number.NaN;
  if (!Number.isFinite(base) || base <= 0) return current;
  const next = action === 'minus1pct' ? base * 0.99 : base * 1.01;
  return formatLimitPriceInput(next, 4);
}

function canAdjustLimitPricePct(current: string, markPx: number | null): boolean {
  const parsed = parseFloat(current.trim());
  if (Number.isFinite(parsed) && parsed > 0) return true;
  return markPx != null && markPx > 0;
}

const FUNDING_APR_PCT_PER_BPS_PER_HOUR = (24 * 365) / 100;

function signedFundingBps(info: { fundingRateBps: number; isFundingPositive: boolean }): number {
  return info.isFundingPositive ? info.fundingRateBps : -info.fundingRateBps;
}

/** Decibel returns funding in bps per funding period; convert to signed percent for UI. */
function formatFundingRatePercent(info: { fundingRateBps: number; isFundingPositive: boolean }): string {
  const percent = signedFundingBps(info) / 100;
  const sign = percent > 0 ? '+' : percent < 0 ? '-' : '';
  return `${sign}${formatNumber(Math.abs(percent), 6)}%`;
}

function formatFundingAprPercent(info: { fundingRateBps: number; isFundingPositive: boolean }): string {
  const apr = signedFundingBps(info) * FUNDING_APR_PCT_PER_BPS_PER_HOUR;
  const sign = apr > 0 ? '+' : apr < 0 ? '-' : '';
  return `${sign}${formatNumber(Math.abs(apr), 2)}% APR`;
}

function formatUsageLimit(value: number | string | undefined): string {
  if (value == null) return 'n/a';
  const raw = String(value);
  const numeric = Number(value);
  if (raw === '18446744073709551615' || numeric > 1_000_000_000_000) return 'unlimited';
  return raw;
}

function pickPrimaryReferralCode(codes: DecibelReferralCode[]): DecibelReferralCode | null {
  return (
    codes.find((code) => code.is_active && code.is_affiliate) ??
    codes.find((code) => code.is_active && formatUsageLimit(code.max_usage) === 'unlimited') ??
    codes.find((code) => code.is_active) ??
    codes[0] ??
    null
  );
}

/** Shorten hex address for display */
function shortenHex(hex: string, head = 6, tail = 4): string {
  if (!hex || !hex.startsWith('0x') || hex.length <= head + tail + 2) return hex;
  return `${hex.slice(0, head + 2)}…${hex.slice(-tail)}`;
}

/** Parse market symbol (e.g. "BTC-USDC") into base and quote for labels; returns market as-is if not symbol-like */
function formatDecibelMarket(marketName: string): { base: string; quote: string; displayPair: string } {
  const s = (marketName || '').trim();
  if (!s || s.startsWith('0x') || !s.includes('-')) {
    const display = s.startsWith('0x') ? shortenHex(s) : s || '—';
    return { base: s || '—', quote: '', displayPair: display };
  }
  const parts = s.split('-');
  const base = parts[0]?.toUpperCase() || s;
  const quote = parts[1]?.toUpperCase() || '';
  return { base, quote, displayPair: quote ? `${base}-${quote}` : base };
}

function getVaultName(vault: DecibelVaultItem): string {
  return vault.vault?.name ?? 'Vault';
}

function getVaultShareMetadata(vault: DecibelVaultItem): string {
  return vault.share_asset_metadata ?? vault.vault?.share_asset_metadata ?? '';
}

function getVaultShareSymbol(vault: DecibelVaultItem): string {
  const symbol = vault.share_symbol ?? vault.vault?.share_symbol;
  if (symbol) return symbol;
  return getVaultName(vault).toLowerCase().includes('decibel protocol vault') ? 'DPV' : 'shares';
}

function getVaultSubaccount(vault: DecibelVaultItem): string {
  return vault.account_address ?? '';
}

function getVaultShareBalanceBaseUnits(vault: DecibelVaultItem): string {
  const raw = vault.current_num_shares;
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.floor(raw).toString();
  return '0';
}

function getVaultWalletShareBalanceBaseUnits(vault: DecibelVaultItem): string {
  const raw = vault.wallet_share_balance ?? vault.vault?.wallet_share_balance;
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return Math.floor(raw).toString();
  return '0';
}

function toPositiveBaseUnits(value: unknown): bigint {
  if (typeof value === 'bigint') return value > 0n ? value : 0n;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? BigInt(Math.floor(value)) : 0n;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return /^\d+$/.test(trimmed) ? BigInt(trimmed) : 0n;
  }
  return 0n;
}

function getVaultEchelonShareBalanceBaseUnits(
  vault: DecibelVaultItem,
  echelonPositions: EchelonPosition[]
): string {
  const shareMetadata = getVaultShareMetadata(vault);
  if (!shareMetadata) return '0';
  const normalizedShareMetadata = normalizeAddress(shareMetadata);
  let total = 0n;

  for (const position of echelonPositions) {
    if (position.type && position.type !== 'supply') continue;
    if (normalizeAddress(position.coin) !== normalizedShareMetadata) continue;
    total += toPositiveBaseUnits(position.amount ?? position.supply);
  }

  return total.toString();
}

function hasVaultWalletShareBalance(vault: DecibelVaultItem): boolean {
  return vault.wallet_share_balance !== undefined || vault.vault?.wallet_share_balance !== undefined;
}

function formatVaultShareBaseUnits(baseUnits: string): string {
  const raw = /^\d+$/.test(baseUnits) ? baseUnits : '0';
  const value = Number(raw) / 1_000_000;
  return Number.isFinite(value)
    ? value.toLocaleString('en-US', { maximumFractionDigits: 6 })
    : '0';
}

function addVaultShareBaseUnits(...values: string[]): string {
  return values
    .reduce((sum, value) => sum + toPositiveBaseUnits(value), 0n)
    .toString();
}

function getVaultSharePriceUsd(vault: DecibelVaultItem): number {
  if (typeof vault.share_price === 'number' && Number.isFinite(vault.share_price) && vault.share_price > 0) {
    return vault.share_price;
  }
  const value = vault.current_value_of_shares;
  const sharesBaseUnits = Number(getVaultShareBalanceBaseUnits(vault));
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && Number.isFinite(sharesBaseUnits) && sharesBaseUnits > 0) {
    return value / (sharesBaseUnits / 1_000_000);
  }
  return 0;
}

/** Aptos client for direct submission (no Gas Station). Decibel close uses this to avoid Gas Station rules. */
function getDecibelAptosClient(network: 'testnet' | 'mainnet'): Aptos {
  const aptosNetwork = network === 'testnet' ? Network.TESTNET : Network.MAINNET;
  const config = new AptosConfig({ network: aptosNetwork });
  return new Aptos(config);
}

export function DecibelPositions() {
  const { account, signTransaction, signAndSubmitTransaction } = useWallet();
  const { effectiveAptosAddress } = useEffectiveWalletAddresses();
  const { tokens: walletTokens } = useWalletData();
  const { toast } = useToast();
  const { setSelectedProtocol } = useProtocol();
  const { setActiveTab, scrollToTop } = useMobileManagement();
  const [positions, setPositions] = useState<DecibelPosition[]>([]);
  const [vaults, setVaults] = useState<DecibelVaultItem[]>([]);
  const [marketNames, setMarketNames] = useState<Record<string, string>>({});
  const [marketsMap, setMarketsMap] = useState<Record<string, DecibelMarketConfig>>({});
  const [decibelNetwork, setDecibelNetwork] = useState<'testnet' | 'mainnet'>('testnet');
  const [closingPositionKey, setClosingPositionKey] = useState<string | null>(null);
  const [closeConfirmPosition, setCloseConfirmPosition] = useState<DecibelPosition | null>(null);
  const [closeMode, setCloseMode] = useState<'market' | 'limit'>('market');
  const [closeLimitPrice, setCloseLimitPrice] = useState('');
  const [dialogMarkPx, setDialogMarkPx] = useState<number | null>(null);
  const [availableToTrade, setAvailableToTrade] = useState<number | null>(null);
  const [totalEquity, setTotalEquity] = useState<number | null>(null);
  const [preDepositSumUsdc, setPreDepositSumUsdc] = useState<number | null>(null);
  const [preDepositLoading, setPreDepositLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [vaultsLoading, setVaultsLoading] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [pricesMap, setPricesMap] = useState<Record<string, number>>({});
  const [fundingRatesMap, setFundingRatesMap] = useState<
    Record<string, { fundingRateBps: number; isFundingPositive: boolean }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [builderConfig, setBuilderConfig] = useState<{ builderAddress: string; builderFeeBps: number } | null>(null);
  const [totalAmps, setTotalAmps] = useState<number | null>(null);
  const [ampsData, setAmpsData] = useState<DecibelAmpsData | null>(null);
  const [ampsLoading, setAmpsLoading] = useState(false);
  const [referralDialogOpen, setReferralDialogOpen] = useState(false);
  const [openOrders, setOpenOrders] = useState<DecibelOpenOrder[]>([]);
  const [, setOpenOrdersLoading] = useState(false);
  const [cancelingOrderId, setCancelingOrderId] = useState<string | null>(null);
  const [yieldAiManagedPositionKeys, setYieldAiManagedPositionKeys] = useState<Set<string>>(new Set());
  const [yieldAiSafeByPositionKey, setYieldAiSafeByPositionKey] = useState<Record<string, string>>({});
  // Journal-cycle (post-migration) DN positions: normalized perp market -> owning safe. These are
  // matched by market because a journal cycle does not store the Decibel subaccount.
  const [yieldAiJournalSafeByMarket, setYieldAiJournalSafeByMarket] = useState<Record<string, string>>({});
  const [selectedSubaccount, setSelectedSubaccount] = useState('');
  const [tradeModalOpen, setTradeModalOpen] = useState(false);
  const [tradeMarket, setTradeMarket] = useState<DecibelOpenPositionMarket | null>(null);
  const [hedgeSwapOpen, setHedgeSwapOpen] = useState(false);
  const [hedgeSwapPrefill, setHedgeSwapPrefill] = useState<SwapModalPrefill | null>(null);
  const [postCloseHedgePromptOpen, setPostCloseHedgePromptOpen] = useState(false);
  const [postCloseUnwindPrefill, setPostCloseUnwindPrefill] = useState<SwapModalPrefill | null>(null);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawSubaccountBalance, setWithdrawSubaccountBalance] = useState<number | null>(null);
  const [vaultShareWithdraw, setVaultShareWithdraw] = useState<DecibelVaultItem | null>(null);
  const [vaultShareDeposit, setVaultShareDeposit] = useState<DecibelVaultItem | null>(null);

  const walletAddress = effectiveAptosAddress ?? undefined;
  const subaccountsQuery = useDecibelSubaccounts(walletAddress);
  const positionsQuery = useDecibelUserPositions(walletAddress);
  const vaultsQuery = useDecibelVaultPerformance(walletAddress);
  const echelonPositionsQuery = useEchelonPositions(walletAddress, {
    enabled: Boolean(walletAddress),
  });
  const marketsQuery = useDecibelMarkets();
  const overviewQuery = useDecibelAccountOverview(walletAddress);
  const pricesQuery = useDecibelPrices(undefined, { enabled: positions.length > 0 });
  const preDepositQuery = useDecibelPredepositorBalance(walletAddress);
  const ampsQuery = useDecibelAmps(walletAddress);

  const openOrderSubaccounts = useMemo(() => {
    if (positions.length > 0) {
      return Array.from(new Set(positions.map((p) => p.user).filter(Boolean)));
    }
    return walletAddress ? [walletAddress] : [];
  }, [positions, walletAddress]);

  const openOrdersQuery = useDecibelOpenOrders(openOrderSubaccounts);

  const subaccountLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const sub of subaccountsQuery.data ?? []) {
      const address = typeof sub.subaccount_address === 'string' ? sub.subaccount_address : '';
      const label = typeof sub.custom_label === 'string' ? sub.custom_label.trim() : '';
      if (address && label) labels[normalizeAddress(address)] = label;
    }
    return labels;
  }, [subaccountsQuery.data]);

  const closeShortHedgeHint = useMemo(() => {
    const pos = closeConfirmPosition;
    if (!pos || pos.size >= 0) return null;
    const mn = marketNames[normalizeAddress(pos.market)] ?? '';
    let baseSym = parseMarketBaseSymbol(mn);
    if (!baseSym) {
      const { base } = formatDecibelMarket(mn);
      const first = base.split(/[/\-_]/)[0]?.trim();
      baseSym = first ? first.toUpperCase() : '';
    }
    if (!baseSym) return null;
    const baseFa = hedgeBaseFaFromSymbol(baseSym);
    if (!baseFa) return null;
    const absSz = Math.abs(pos.size);
    const enoughBase = hasEnoughBaseForHedge(walletTokens, baseFa, absSz);
    const base =
      baseSym === 'BTC' || baseSym === 'WBTC' ? 'WBTC' : baseSym;
    return { base, baseFa, absSz, enoughBase };
  }, [closeConfirmPosition, marketNames, walletTokens]);

  const positionSubaccounts = useMemo(() => {
    const seen = new Set<string>();
    const items: { address: string; normalized: string; label?: string }[] = [];
    for (const pos of positions) {
      const normalized = normalizeAddress(pos.user);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      items.push({
        address: pos.user,
        normalized,
        label: subaccountLabels[normalized],
      });
    }
    return items;
  }, [positions, subaccountLabels]);

  const selectedSubaccountNormalized = useMemo(() => {
    const normalizedSelected = normalizeAddress(selectedSubaccount);
    const selectedExists = positionSubaccounts.some((item) => item.normalized === normalizedSelected);
    return selectedExists ? normalizedSelected : positionSubaccounts[0]?.normalized ?? '';
  }, [positionSubaccounts, selectedSubaccount]);

  const hasMultiplePositionSubaccounts = positionSubaccounts.length > 1;
  const referralDashboard = useDecibelReferralDashboard(walletAddress, {
    enabled: referralDialogOpen && Boolean(walletAddress),
  });

  const visiblePositions = useMemo(() => {
    if (!hasMultiplePositionSubaccounts || !selectedSubaccountNormalized) return positions;
    return positions.filter((pos) => normalizeAddress(pos.user) === selectedSubaccountNormalized);
  }, [hasMultiplePositionSubaccounts, positions, selectedSubaccountNormalized]);

  const marketNamesForLogos = useMemo(() => Object.values(marketNames), [marketNames]);
  const logoUrlsByMarket = useDecibelMarketLogosMap(marketNamesForLogos, MARKET_LOGOS);

  const primarySubaccountAddr = useMemo(() => {
    const list = subaccountsQuery.data ?? [];
    return (
      list.find((sub) => sub.is_primary && sub.is_active)?.subaccount_address ??
      list.find((sub) => sub.is_active)?.subaccount_address ??
      list[0]?.subaccount_address ??
      ''
    );
  }, [subaccountsQuery.data]);

  const withdrawSubaccountAddr = useMemo(() => {
    if (selectedSubaccountNormalized) return selectedSubaccountNormalized;
    if (primarySubaccountAddr) return normalizeAddress(primarySubaccountAddr);
    return positionSubaccounts[0]?.normalized ?? '';
  }, [selectedSubaccountNormalized, primarySubaccountAddr, positionSubaccounts]);

  const withdrawableBalanceUsd = withdrawSubaccountBalance ?? availableToTrade ?? 0;

  useEffect(() => {
    if (!withdrawModalOpen || !withdrawSubaccountAddr) {
      setWithdrawSubaccountBalance(null);
      return;
    }
    let cancelled = false;
    setWithdrawSubaccountBalance(availableToTrade);
    (async () => {
      try {
        const res = await fetch(
          `/api/protocols/decibel/accountOverview?address=${encodeURIComponent(withdrawSubaccountAddr)}`
        );
        const data = await res.json();
        if (cancelled) return;
        const balance =
          data?.success && data?.data?.usdc_cross_withdrawable_balance != null
            ? Number(data.data.usdc_cross_withdrawable_balance)
            : availableToTrade ?? 0;
        setWithdrawSubaccountBalance(balance);
      } catch {
        if (!cancelled) setWithdrawSubaccountBalance(availableToTrade);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [withdrawModalOpen, withdrawSubaccountAddr, availableToTrade]);

  useEffect(() => {
    if (!account?.address) {
      setBuilderConfig(null);
      return;
    }
    let cancelled = false;
    fetch('/api/protocols/decibel/builder-config')
      .then((r) => r.json())
      .then((data: { success?: boolean; builderAddress?: string; builderFeeBps?: number }) => {
        if (cancelled) return;
        if (data?.success && data.builderAddress && typeof data.builderFeeBps === 'number') {
          setBuilderConfig({ builderAddress: data.builderAddress, builderFeeBps: data.builderFeeBps });
        } else {
          setBuilderConfig(null);
        }
      })
      .catch(() => {
        if (!cancelled) setBuilderConfig(null);
      });
    return () => {
      cancelled = true;
    };
  }, [account?.address]);

  useEffect(() => {
    setLoading(positionsQuery.isLoading);
    if (positionsQuery.error) {
      setError(positionsQuery.error instanceof Error ? positionsQuery.error.message : "Failed to load positions");
      setPositions([]);
      return;
    }
    setError(null);
    if (positionsQuery.data) {
      setPositions(positionsQuery.data.filter((p) => !p.is_deleted) as DecibelPosition[]);
    }
  }, [positionsQuery.data, positionsQuery.error, positionsQuery.isLoading]);

  useEffect(() => {
    setVaultsLoading(vaultsQuery.isLoading);
    setVaults(vaultsQuery.data ?? []);
  }, [vaultsQuery.data, vaultsQuery.isLoading]);

  useEffect(() => {
    const nameMap: Record<string, string> = {};
    const configMap: Record<string, DecibelMarketConfig> = {};
    for (const m of marketsQuery.data?.data ?? []) {
      const addr = m.market_addr;
      const name = m.market_name;
      if (addr != null) {
        const key = normalizeAddress(String(addr));
        if (name != null) nameMap[key] = String(name);
        configMap[key] = {
          market_addr: String(addr),
          market_name: m.market_name,
          px_decimals: m.px_decimals ?? 9,
          sz_decimals: m.sz_decimals ?? 9,
          tick_size: m.tick_size ?? 1_000_000,
          lot_size: m.lot_size ?? 100_000_000,
          min_size: m.min_size ?? 1_000_000_000,
        };
      }
    }
    setMarketNames(nameMap);
    setMarketsMap(configMap);
    if (marketsQuery.data?.network === "mainnet" || marketsQuery.data?.network === "testnet") {
      setDecibelNetwork(marketsQuery.data.network);
    }
  }, [marketsQuery.data]);

  useEffect(() => {
    setOverviewLoading(overviewQuery.isLoading);
    if (overviewQuery.data) {
      setAvailableToTrade(
        overviewQuery.data.usdc_cross_withdrawable_balance != null
          ? Number(overviewQuery.data.usdc_cross_withdrawable_balance)
          : null
      );
      setTotalEquity(
        overviewQuery.data.perp_equity_balance != null
          ? Number(overviewQuery.data.perp_equity_balance)
          : null
      );
    } else if (!overviewQuery.isLoading) {
      setAvailableToTrade(null);
      setTotalEquity(null);
    }
  }, [overviewQuery.data, overviewQuery.isLoading]);

  useEffect(() => {
    const map: Record<string, number> = {};
    const fundingMap: Record<string, { fundingRateBps: number; isFundingPositive: boolean }> = {};
    for (const item of pricesQuery.data ?? []) {
      const addr = item.market;
      if (addr != null) {
        const key = normalizeAddress(String(addr));
        const mark = item.mark_px ?? item.mid_px;
        if (typeof mark === "number") map[key] = mark;
        if (typeof item.funding_rate_bps === "number") {
          fundingMap[key] = {
            fundingRateBps: item.funding_rate_bps,
            isFundingPositive: item.is_funding_positive === true,
          };
        }
      }
    }
    setPricesMap(map);
    setFundingRatesMap(fundingMap);
  }, [pricesQuery.data]);

  useEffect(() => {
    setPreDepositLoading(preDepositQuery.isLoading);
    if (typeof preDepositQuery.data === "number") {
      setPreDepositSumUsdc(preDepositQuery.data);
    } else if (!preDepositQuery.isLoading) {
      setPreDepositSumUsdc(null);
    }
  }, [preDepositQuery.data, preDepositQuery.isLoading]);

  useEffect(() => {
    setAmpsLoading(ampsQuery.isLoading);
    setTotalAmps(ampsQuery.data?.total_amps ?? null);
    setAmpsData(ampsQuery.data ?? null);
  }, [ampsQuery.data, ampsQuery.isLoading]);

  useEffect(() => {
    setOpenOrdersLoading(openOrdersQuery.isLoading);
    setOpenOrders(openOrdersQuery.data ?? []);
  }, [openOrdersQuery.data, openOrdersQuery.isLoading]);

  const fetchPositions = useCallback(async () => {
    await positionsQuery.refetch();
  }, [positionsQuery]);

  const fetchVaults = useCallback(async () => {
    await vaultsQuery.refetch();
  }, [vaultsQuery]);

  const fetchOverview = useCallback(async () => {
    await overviewQuery.refetch();
  }, [overviewQuery]);

  const fetchPrices = useCallback(async () => {
    await pricesQuery.refetch();
  }, [pricesQuery]);

  const fetchPreDeposit = useCallback(async () => {
    await preDepositQuery.refetch();
  }, [preDepositQuery]);

  const fetchAmps = useCallback(async () => {
    await ampsQuery.refetch();
  }, [ampsQuery]);

  const fetchOpenOrders = useCallback(async () => {
    await openOrdersQuery.refetch();
  }, [openOrdersQuery]);

  const fetchEchelonPositions = useCallback(async () => {
    await echelonPositionsQuery.refetch();
  }, [echelonPositionsQuery]);

  useEffect(() => {
    const handler = (e: CustomEvent<{ protocol: string; data?: DecibelPosition[] }>) => {
      if (e.detail?.protocol === 'decibel') {
        if (Array.isArray(e.detail.data)) {
          const active = e.detail.data.filter((p) => !p.is_deleted);
          setPositions(active);
        }
        fetchVaults();
        fetchOverview();
        fetchPreDeposit();
        fetchPrices();
        fetchAmps();
        fetchOpenOrders();
        fetchEchelonPositions();
      }
    };
    window.addEventListener('refreshPositions', handler as EventListener);
    return () => window.removeEventListener('refreshPositions', handler as EventListener);
  }, [fetchVaults, fetchOverview, fetchPreDeposit, fetchPrices, fetchAmps, fetchOpenOrders, fetchEchelonPositions]);

  const positionKey = (pos: DecibelPosition) => `${pos.market}-${pos.user}-${pos.size}-${pos.entry_price}`;


  useEffect(() => {
    if (!walletAddress || positions.length === 0) {
      setYieldAiManagedPositionKeys(new Set());
      setYieldAiSafeByPositionKey({});
      setYieldAiJournalSafeByMarket({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const safesRes = await fetch(
          `/api/protocols/yield-ai/safes?owner=${encodeURIComponent(walletAddress)}`
        );
        if (!safesRes.ok) throw new Error(`Yield AI safes request failed: ${safesRes.status}`);
        const safesData = (await safesRes.json()) as YieldAiSafesResponse;
        const safeAddresses = Array.isArray(safesData?.data?.safeAddresses)
          ? safesData.data.safeAddresses
          : [];
        // Journal cycles FIRST (light = fast). The legacy delta-neutral-state call below can take
        // ~15s (indexer close-swap resolver), so we must not block the agent badge behind it.
        const cycleLists = await Promise.all(
          safeAddresses.map(
            async (safeAddress): Promise<Array<{ market: string; subaccount: string | null; safeAddress: string }>> => {
              try {
                const res = await fetch(
                  `/api/protocols/yield-ai/delta-neutral-cycles?safeAddress=${encodeURIComponent(safeAddress)}&light=1`
                );
                if (!res.ok) return [];
                const json = (await res.json()) as {
                  data?: { cycles?: Array<{ perpMarket?: string; isOpen?: boolean; decibelSubaccount?: string | null }> };
                };
                const cycles = json.data?.cycles ?? [];
                return cycles
                  .filter((c) => c?.isOpen && c?.perpMarket)
                  .map((c) => ({
                    market: normalizeAddress(c.perpMarket as string),
                    subaccount: c.decibelSubaccount ? c.decibelSubaccount : null,
                    safeAddress,
                  }));
              } catch {
                return [];
              }
            }
          )
        );
        if (!cancelled) {
          const journalEntries = cycleLists.flat();
          // Exact (subaccount, market) journal matches use the same key scheme as legacy.
          const exact = journalEntries
            .filter((e) => e.subaccount)
            .map((e) => [yieldAiManagedPositionKey(e.subaccount as string, e.market), e.safeAddress] as const);
          setYieldAiManagedPositionKeys(new Set(exact.map(([k]) => k)));
          setYieldAiSafeByPositionKey(Object.fromEntries(exact));
          // Market-only fallback for cycles whose subaccount was not pinned (older opens).
          setYieldAiJournalSafeByMarket(
            Object.fromEntries(journalEntries.filter((e) => !e.subaccount).map((e) => [e.market, e.safeAddress]))
          );
        }

        // Legacy delta_neutral records (slow). Merge into the existing maps when ready.
        const checks = await Promise.all(safeAddresses.map(async (safeAddress) => {
          try {
            const res = await fetch(
              `/api/protocols/yield-ai/delta-neutral-state?safeAddress=${encodeURIComponent(safeAddress)}`
            );
            if (!res.ok) return null;
            const json = (await res.json()) as DeltaNeutralStateResponse;
            const data = json.data ?? json;
            if (!data.recordExists || !data.isOpen || !data.decibelSubaccount || !data.perpMarket) {
              return null;
            }
            return {
              key: yieldAiManagedPositionKey(data.decibelSubaccount, data.perpMarket),
              safeAddress,
            };
          } catch {
            return null;
          }
        }));
        if (!cancelled) {
          const matches = checks.filter((v): v is { key: string; safeAddress: string } => !!v);
          if (matches.length > 0) {
            setYieldAiManagedPositionKeys((prev) => new Set([...prev, ...matches.map((m) => m.key)]));
            setYieldAiSafeByPositionKey((prev) => ({
              ...prev,
              ...Object.fromEntries(matches.map((m) => [m.key, m.safeAddress])),
            }));
          }
        }
      } catch {
        if (!cancelled) {
          setYieldAiManagedPositionKeys(new Set());
          setYieldAiSafeByPositionKey({});
          setYieldAiJournalSafeByMarket({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, positions.length]);
  const handleCloseClick = (pos: DecibelPosition) => {
    setCloseConfirmPosition(pos);
    setCloseMode('market');
    setCloseLimitPrice('');
  };

  const handleViewChartClick = (pos: DecibelPosition) => {
    const marketKey = normalizeAddress(pos.market);
    const marketName = marketNames[marketKey] ?? pos.market;
    setTradeMarket({
      marketAddr: pos.market,
      marketName,
      marketLogoUrl: logoUrlsByMarket[marketNameForFundingApi(marketName)],
    });
    setTradeModalOpen(true);
  };

  const handleManageYieldAiPosition = (safeAddress: string, market?: string) => {
    if (!walletAddress) return;
    // Tell the agent view which position to scroll to + highlight once it loads.
    if (market && typeof window !== 'undefined') {
      sessionStorage.setItem('dnFocusMarket', normalizeAddress(market));
    }
    dispatchSelectYieldAiSafe(walletAddress, safeAddress);
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

  // Fetch mark price when close dialog opens (for limit price hint)
  useEffect(() => {
    if (!closeConfirmPosition) {
      setDialogMarkPx(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/protocols/decibel/prices?market=${encodeURIComponent(closeConfirmPosition.market)}`
        );
        const data = await res.json();
        if (cancelled) return;
        const list = data.success && Array.isArray(data.data) ? data.data : [];
        const item =
          list.find(
            (p: { market?: string }) => normalizeAddress(p.market || '') === normalizeAddress(closeConfirmPosition.market)
          ) ?? list[0];
        const mark = item?.mark_px ?? item?.mid_px ?? closeConfirmPosition.entry_price;
        const markNum = typeof mark === 'number' ? mark : null;
        setDialogMarkPx(markNum);
        // Prefill limit price when mark loads and user already switched to Limit
        if (markNum != null) {
          setCloseLimitPrice((prev) => (prev === '' ? formatNumber(markNum, 4) : prev));
        }
      } catch {
        if (!cancelled) setDialogMarkPx(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [closeConfirmPosition]);

  const handleConfirmClose = useCallback(async () => {
    const pos = closeConfirmPosition;
    const walletAddress = account?.address;
    if (!pos || (!signTransaction && !signAndSubmitTransaction) || !walletAddress) {
      setCloseConfirmPosition(null);
      return;
    }
    const key = positionKey(pos);
    setClosingPositionKey(key);
    try {
      if (builderConfig) {
        const approvalRes = await fetch(
          `/api/protocols/decibel/approved-max-fee?subaccount=${encodeURIComponent(pos.user)}`
        );
        const approvalData = (await approvalRes.json()) as { success?: boolean; approvedMaxFeeBps?: number | null };
        if (approvalRes.ok && approvalData?.success && approvalData.approvedMaxFeeBps == null) {
          if (!account?.address) {
            toast({
              title: 'Wallet not connected',
              description: 'Please reconnect your Aptos wallet and try again.',
              variant: 'destructive',
            });
            return;
          }
          const approvePayload = buildApproveBuilderFeePayload({
            subaccountAddr: pos.user,
            builderAddr: builderConfig.builderAddress,
            maxFeeBps: builderConfig.builderFeeBps,
            isTestnet: decibelNetwork === 'testnet',
          });
          if (signAndSubmitTransaction) {
            await signAndSubmitTransaction({
              data: {
                function: approvePayload.function as `${string}::${string}::${string}`,
                typeArguments: approvePayload.typeArguments,
                functionArguments: approvePayload.functionArguments as (string | number)[],
              },
              options: { maxGasAmount: 20000 },
            });
          } else if (signTransaction) {
            const aptos = getDecibelAptosClient(decibelNetwork);
            const senderAddr = AccountAddress.fromString(walletAddress.toString());
            const transaction = await aptos.transaction.build.simple({
              sender: senderAddr,
              data: {
                function: approvePayload.function as `${string}::${string}::${string}`,
                typeArguments: approvePayload.typeArguments,
                functionArguments: approvePayload.functionArguments as (string | number)[],
              },
              options: { maxGasAmount: 20000 },
            });
            const signResult = await signTransaction({ transactionOrPayload: transaction });
            const { authenticator } = signResult;
            await aptos.transaction.submit.simple({
              transaction,
              senderAuthenticator: normalizeAuthenticator(authenticator),
            });
          } else {
            throw new Error('Wallet does not support signing transactions');
          }
          toast({ title: 'Trading via Yield AI enabled', description: 'Closing position…' });
        }
      }

      const pricesRes = await fetch(`/api/protocols/decibel/prices?market=${encodeURIComponent(pos.market)}`);
      const pricesData = await pricesRes.json();
      const pricesList = pricesData.success && Array.isArray(pricesData.data) ? pricesData.data : [];
      const priceItem = pricesList.find((p: { market?: string }) => normalizeAddress(p.market || '') === normalizeAddress(pos.market))
        ?? pricesList[0];
      const markPx = priceItem?.mark_px ?? priceItem?.mid_px ?? pos.entry_price;
      const marketKey = normalizeAddress(pos.market);
      const marketConfig =
        marketsMap[marketKey] ??
        Object.values(marketsMap).find((m) => normalizeAddress(m.market_addr || '') === marketKey);
      if (!marketConfig) {
        toast({ title: 'Error', description: 'Market config not found. Try refreshing.', variant: 'destructive' });
        setCloseConfirmPosition(null);
        setClosingPositionKey(null);
        return;
      }

      const isLimit = closeMode === 'limit';
      const limitPriceNum = isLimit ? parseFloat(closeLimitPrice) : NaN;
      if (isLimit && (Number.isNaN(limitPriceNum) || limitPriceNum <= 0)) {
        toast({ title: 'Error', description: 'Enter a valid limit price.', variant: 'destructive' });
        setClosingPositionKey(null);
        return;
      }

      const payload = isLimit
        ? buildCloseAtLimitPayload({
            subaccountAddr: pos.user,
            marketAddr: pos.market,
            size: Math.abs(pos.size),
            isLong: pos.size > 0,
            limitPrice: limitPriceNum,
            marketConfig,
            isTestnet: decibelNetwork === 'testnet',
            builderAddr: builderConfig?.builderAddress ?? undefined,
            builderFeeBps: builderConfig?.builderFeeBps ?? undefined,
          })
        : buildCloseAtMarketPayload({
            subaccountAddr: pos.user,
            marketAddr: pos.market,
            size: Math.abs(pos.size),
            isLong: pos.size > 0,
            markPx,
            marketConfig,
            slippageBps: 50,
            isTestnet: decibelNetwork === 'testnet',
            builderAddr: builderConfig?.builderAddress ?? undefined,
            builderFeeBps: builderConfig?.builderFeeBps ?? undefined,
          });

      if (!account?.address) {
        toast({
          title: 'Wallet not connected',
          description: 'Please reconnect your Aptos wallet and try again.',
          variant: 'destructive',
        });
        return;
      }

      let txHash: string;

      if (signAndSubmitTransaction) {
        // Primary path: wallet handles sign + submit (avoids normalizeAuthenticator/INVALID_AUTH_KEY)
        const result = await signAndSubmitTransaction({
          data: {
            function: payload.function as `${string}::${string}::${string}`,
            typeArguments: payload.typeArguments,
            functionArguments: payload.functionArguments as (string | number | boolean | Uint8Array | null)[],
          },
          options: { maxGasAmount: 20000 },
        });
        txHash = typeof result?.hash === 'string' ? result.hash : (result as { hash?: string })?.hash ?? '';
      } else if (signTransaction) {
        // Fallback: manual sign + submit (Decibel not in Gas Station rules)
        const aptos = getDecibelAptosClient(decibelNetwork);
        const senderAddr = AccountAddress.fromString(walletAddress.toString());
        const transaction = await aptos.transaction.build.simple({
          sender: senderAddr,
          data: {
            function: payload.function as `${string}::${string}::${string}`,
            typeArguments: payload.typeArguments,
            functionArguments: payload.functionArguments as (string | number | boolean | Uint8Array | null)[],
          },
          options: { maxGasAmount: 20000 },
        });
        console.log('[Decibel] sender:', senderAddr.toString(), 'wallet:', walletAddress.toString());
        const signResult = await signTransaction({ transactionOrPayload: transaction });
        console.log('[Decibel] signResult keys:', Object.keys(signResult ?? {}));
        const { authenticator } = signResult;
        const response = await aptos.transaction.submit.simple({
          transaction,
          senderAuthenticator: normalizeAuthenticator(authenticator),
        });
        txHash = typeof response?.hash === 'string' ? response.hash : (response as { hash?: string })?.hash ?? '';
      } else {
        throw new Error('Wallet does not support signing transactions');
      }
      toast({
        title: isLimit ? 'Limit close order placed' : 'Position closed',
        description: txHash ? `Transaction ${txHash.slice(0, 6)}...${txHash.slice(-4)}` : 'Transaction submitted',
        action: txHash ? (
          <ToastAction
            altText="View in Explorer"
            onClick={() =>
              window.open(
                `https://explorer.aptoslabs.com/txn/${txHash}?network=${decibelNetwork === 'mainnet' ? 'mainnet' : 'testnet'}`,
                '_blank'
              )
            }
          >
            View in Explorer
          </ToastAction>
        ) : undefined,
      });
      let unwindAfterMarketClose: ReturnType<typeof buildUnwindHedgePrefillFromClosePosition> = null;
      if (!isLimit && pos.size < 0) {
        const mn = marketNames[normalizeAddress(pos.market)] ?? '';
        let baseSym = parseMarketBaseSymbol(mn);
        if (!baseSym) {
          const { base } = formatDecibelMarket(mn);
          const first = base.split(/[/\-_]/)[0]?.trim();
          baseSym = first ? first.toUpperCase() : '';
        }
        const label = baseSym ? `${baseSym}/USD` : mn;
        unwindAfterMarketClose = buildUnwindHedgePrefillFromClosePosition(pos, label);
      }
      setCloseConfirmPosition(null);
      if (unwindAfterMarketClose) {
        setPostCloseUnwindPrefill(unwindAfterMarketClose.prefill);
        setPostCloseHedgePromptOpen(true);
      }
      fetchPositions();
      fetchOpenOrders();
    } catch (err: unknown) {
      const rawMsg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : String(err);
      const isWalletNotConnected =
        (err instanceof Error && err.name === 'WalletNotConnectedError') ||
        (typeof rawMsg === 'string' && rawMsg.includes('WalletNotConnectedError'));
      const testnetHint =
        decibelNetwork === 'testnet'
          ? ' Switch your wallet to Aptos Mainnet and try again.'
          : '';
      const msg = isWalletNotConnected
        ? 'Wallet disconnected or locked. Please unlock or reconnect your Aptos wallet and try again.'
        : (rawMsg || 'Failed to close position') + testnetHint;
      console.error('[Decibel] Close position error:', err);
      toast({
        title: isWalletNotConnected ? 'Wallet not connected' : 'Error',
        description: msg,
        variant: 'destructive',
      });
      setCloseConfirmPosition(null);
    } finally {
      setClosingPositionKey(null);
    }
  }, [
    closeConfirmPosition,
    closeMode,
    closeLimitPrice,
    signTransaction,
    signAndSubmitTransaction,
    account?.address,
    marketsMap,
    marketNames,
    decibelNetwork,
    fetchPositions,
    fetchOpenOrders,
    toast,
    builderConfig,
  ]);

  const handleCancelClose = useCallback(() => {
    setCloseConfirmPosition(null);
    setCloseMode('market');
    setCloseLimitPrice('');
    setDialogMarkPx(null);
    setHedgeSwapOpen(false);
    setHedgeSwapPrefill(null);
  }, []);

  const handleCancelOrder = useCallback(
    async (orderId: string, subaccountAddr: string, marketAddr: string) => {
      if (!orderId || (!signTransaction && !signAndSubmitTransaction) || !account?.address) return;
      setCancelingOrderId(orderId);
      try {
        const payload = buildCancelOrderPayload({
          subaccountAddr,
          marketAddr,
          orderId,
          isTestnet: decibelNetwork === 'testnet',
        });
        if (!account?.address) {
          toast({ title: 'Wallet not connected', description: 'Please reconnect and try again.', variant: 'destructive' });
          return;
        }
        let txHash: string;
        if (signAndSubmitTransaction) {
          const result = await signAndSubmitTransaction({
            data: {
              function: payload.function as `${string}::${string}::${string}`,
              typeArguments: payload.typeArguments,
              functionArguments: payload.functionArguments as (string | number | bigint)[],
            },
            options: { maxGasAmount: 20000 },
          });
          txHash = typeof result?.hash === 'string' ? result.hash : (result as { hash?: string })?.hash ?? '';
        } else if (signTransaction) {
          const aptos = getDecibelAptosClient(decibelNetwork);
          const senderAddr = AccountAddress.fromString(account.address.toString());
          const transaction = await aptos.transaction.build.simple({
            sender: senderAddr,
            data: {
              function: payload.function as `${string}::${string}::${string}`,
              typeArguments: payload.typeArguments,
              functionArguments: payload.functionArguments as (string | number | bigint)[],
            },
            options: { maxGasAmount: 20000 },
          });
          const signResult = await signTransaction({ transactionOrPayload: transaction });
          const { authenticator } = signResult;
          const response = await aptos.transaction.submit.simple({
            transaction,
            senderAuthenticator: normalizeAuthenticator(authenticator),
          });
          txHash = typeof response?.hash === 'string' ? response.hash : (response as { hash?: string })?.hash ?? '';
        } else {
          throw new Error('Wallet does not support signing transactions');
        }
        toast({
          title: 'Order cancelled',
          description: txHash ? `Tx ${txHash.slice(0, 6)}...${txHash.slice(-4)}` : 'Transaction submitted',
          action: txHash ? (
            <ToastAction
              altText="View in Explorer"
              onClick={() =>
                window.open(
                  `https://explorer.aptoslabs.com/txn/${txHash}?network=${decibelNetwork === 'mainnet' ? 'mainnet' : 'testnet'}`,
                  '_blank'
                )
              }
            >
              View in Explorer
            </ToastAction>
          ) : undefined,
        });
        fetchOpenOrders();
        fetchPositions();
        window.dispatchEvent(new CustomEvent('refreshPositions', { detail: { protocol: 'decibel' } }));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast({ title: 'Error', description: msg, variant: 'destructive' });
      } finally {
        setCancelingOrderId(null);
      }
    },
    [decibelNetwork, signTransaction, signAndSubmitTransaction, account?.address, toast, fetchOpenOrders, fetchPositions]
  );

  if (!walletAddress) {
    return (
      <div className="text-sm text-muted-foreground py-4">
        Connect your Aptos wallet to view Decibel positions.
      </div>
    );
  }

  if (loading) {
    return <div className="py-4 text-muted-foreground">Loading Decibel positions...</div>;
  }

  if (error) {
    return (
      <div className="py-4 space-y-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={fetchPositions}>
          Retry
        </Button>
      </div>
    );
  }

  const vaultsTotal = vaults.reduce(
    (sum, v) => sum + (v.current_value_of_shares ?? 0),
    0
  );
  const echelonPositions = echelonPositionsQuery.data ?? [];
  const visibleVaults = vaults.filter((v) => (
    (v.current_value_of_shares ?? 0) > 0 ||
    getVaultShareBalanceBaseUnits(v) !== '0' ||
    getVaultWalletShareBalanceBaseUnits(v) !== '0' ||
    getVaultEchelonShareBalanceBaseUnits(v, echelonPositions) !== '0' ||
    ((v.total_withdrawn ?? 0) > 0)
  ));
  const selectedVaultShareMetadata = vaultShareWithdraw ? getVaultShareMetadata(vaultShareWithdraw) : '';
  const selectedVaultShareSubaccount = vaultShareWithdraw ? getVaultSubaccount(vaultShareWithdraw) : '';
  const selectedVaultDepositMetadata = vaultShareDeposit ? getVaultShareMetadata(vaultShareDeposit) : '';
  const selectedVaultDepositSubaccount = vaultShareDeposit ? getVaultSubaccount(vaultShareDeposit) : '';
  const totalAssets = (totalEquity ?? 0) + vaultsTotal + (preDepositSumUsdc ?? 0);
  const hasTestnetData =
    availableToTrade != null || positions.length > 0 || visibleVaults.length > 0;
  const primaryReferralCode = referralDashboard.data
    ? pickPrimaryReferralCode(referralDashboard.data.codes)
    : null;

  return (
    <div className="space-y-6 text-base">
      {(preDepositSumUsdc != null && preDepositSumUsdc > 0) && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Pre-deposit</span>
          </div>
          <span className="font-medium">
            {preDepositLoading ? '…' : formatCurrency(preDepositSumUsdc ?? 0, 2)}
          </span>
        </div>
      )}
      {(availableToTrade != null || overviewLoading) && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Available to trade</span>
            {hasTestnetData && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex text-muted-foreground cursor-help">
                      <Info className="h-4 w-4" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[220px]">
                    <p>Decibel assets (positions, available to trade, vaults) are included in Total Assets.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium">
              {overviewLoading ? '…' : formatCurrency(availableToTrade ?? 0, 2)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={
                overviewLoading ||
                !withdrawSubaccountAddr ||
                (availableToTrade ?? 0) <= 0 ||
                !signAndSubmitTransaction
              }
              onClick={() => setWithdrawModalOpen(true)}
            >
              Withdraw
            </Button>
          </div>
        </div>
      )}
      {/* AMPs from Decibel points leaderboard */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">AMPs</span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex text-muted-foreground cursor-help">
                  <Info className="h-4 w-4" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[260px]">
                <p className="font-medium mb-1.5">Points breakdown</p>
                <ul className="text-sm text-muted-foreground space-y-0.5">
                  <li>- Trading: {ampsLoading ? '…' : formatNumber(ampsData?.trading_amps ?? 0, 2)} AMP</li>
                  <li>- Referrals: {ampsLoading ? '…' : formatNumber(ampsData?.referral_amps ?? 0, 2)} AMP</li>
                  <li>- Vaults: {ampsLoading ? '…' : formatNumber(ampsData?.vault_amps ?? 0, 2)} AMP</li>
                  <li>- Streak: {ampsLoading ? '…' : formatNumber(ampsData?.streak_amps ?? 0, 2)} AMP</li>
                  {(ampsData?.bonus_amps ?? 0) > 0 && (
                    <li>- Bonus: {ampsLoading ? '…' : formatNumber(ampsData?.bonus_amps ?? 0, 2)} AMP</li>
                  )}
                </ul>
                {ampsData?.rank != null && (
                  <p className="text-xs text-muted-foreground mt-1.5">Rank #{formatNumber(ampsData.rank, 0)}</p>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => setReferralDialogOpen(true)}
          >
            Referral details
          </Button>
          <span className={cn("font-medium", totalAmps == null && !ampsLoading && "text-muted-foreground")}>
          {ampsLoading ? '…' : formatNumber(totalAmps ?? 0, 2)}
          </span>
        </div>
      </div>
      {positions.length === 0 && !vaultsLoading && visibleVaults.length === 0 && (
        <p className="text-base text-muted-foreground py-2">
          No open positions on Decibel. Open positions at{' '}
          <a
            href={DECIBEL_APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            app.decibel.trade
          </a>
        </p>
      )}
      {positions.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="font-medium text-muted-foreground">Positions</span>
              {hasTestnetData && (availableToTrade == null && !overviewLoading) && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex text-muted-foreground cursor-help">
                        <Info className="h-4 w-4" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[220px]">
                      <p>Decibel assets (positions, available to trade, vaults) are included in Total Assets.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            {hasMultiplePositionSubaccounts && (
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">
                  Subaccount
                </span>
                <Select value={selectedSubaccountNormalized} onValueChange={setSelectedSubaccount}>
                  <SelectTrigger className="h-8 w-[260px] max-w-[62vw]">
                    <SelectValue placeholder="Select subaccount" />
                  </SelectTrigger>
                  <SelectContent>
                    {positionSubaccounts.map((subaccount) => (
                      <SelectItem key={subaccount.normalized} value={subaccount.normalized}>
                        <div className="flex items-center gap-2">
                          {subaccount.label && (
                            <span className="font-medium">
                              {subaccount.label}
                            </span>
                          )}
                          <span className={cn('text-xs', subaccount.label ? 'text-muted-foreground' : 'font-medium')}>
                            {shortenHex(subaccount.address)}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <ul className="space-y-3">
            {visiblePositions.map((pos, i) => {
              const marketKey = normalizeAddress(pos.market);
              const marketName = marketNames[marketKey] ?? pos.market;
              const marketLogoUrl = logoUrlsByMarket[marketNameForFundingApi(marketName)];
              const { base, quote, displayPair } = formatDecibelMarket(marketName);
              const showTokenLabels = base && quote && !pos.market.startsWith('0x');
              const notionalUsd = Math.abs(pos.size) * pos.entry_price;
              const marginUsd = pos.user_leverage && pos.user_leverage > 0
                ? notionalUsd / pos.user_leverage
                : notionalUsd;
              const markPx = pricesMap[marketKey] ?? pos.entry_price;
              const pricePnl = pos.size * (markPx - pos.entry_price);
              const fundingDisplay = -pos.unrealized_funding;
              const totalPnl = pricePnl + fundingDisplay;
              const pnlPercent = marginUsd > 0 ? (totalPnl / marginUsd) * 100 : 0;
              const isLong = pos.size > 0;
              const subaccountLabel = subaccountLabels[normalizeAddress(pos.user)];
              const subaccountDisplay = subaccountLabel
                ? `${subaccountLabel} (${shortenHex(pos.user)})`
                : shortenHex(pos.user);
              const managedPositionKey = yieldAiManagedPositionKey(pos.user, pos.market);
              // Journal cycles match by market (no subaccount stored); legacy matches by (subaccount, market).
              const journalSafeAddress = yieldAiJournalSafeByMarket[normalizeAddress(pos.market)];
              const isYieldAiDeltaNeutralPosition =
                yieldAiManagedPositionKeys.has(managedPositionKey) || Boolean(journalSafeAddress);
              const yieldAiSafeAddress = yieldAiSafeByPositionKey[managedPositionKey] ?? journalSafeAddress;
              const fundingRateInfo = fundingRatesMap[marketKey];
              const pnlColor = totalPnl > 0 ? 'text-green-600 dark:text-green-400' : totalPnl < 0 ? 'text-destructive' : 'text-muted-foreground';
              const pricePnlColor = pricePnl > 0 ? 'text-green-600 dark:text-green-400' : pricePnl < 0 ? 'text-destructive' : 'text-muted-foreground';
              const fundingColor = fundingDisplay > 0 ? 'text-green-600 dark:text-green-400' : fundingDisplay < 0 ? 'text-destructive' : 'text-muted-foreground';
              return (
                <li
                  key={`${pos.market}-${pos.user}-${i}`}
                  className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm"
                >
                  {/* Top: pair info | Total PnL, Margin, Close */}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <DecibelMarketIcon
                          logoUrl={marketLogoUrl}
                          marketName={marketName}
                          size={20}
                          className="h-5 w-5"
                        />
                        <span className="font-medium">{displayPair}</span>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-xs font-medium shrink-0',
                            isLong ? 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
                          )}
                        >
                          {isLong ? 'Long' : 'Short'}
                        </Badge>
                        <span className="text-sm text-muted-foreground shrink-0">{pos.user_leverage}x</span>
                        {isYieldAiDeltaNeutralPosition && (
                          <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary shrink-0">
                            AI agent
                          </span>
                        )}
                        {hasMultiplePositionSubaccounts && (
                          <span
                            className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground shrink-0 max-w-[280px] truncate"
                            title={`Subaccount: ${subaccountLabel ? `${subaccountLabel} ` : ''}${pos.user}`}
                          >
                            Subaccount: {subaccountDisplay}
                          </span>
                        )}
                        {pos.is_isolated && (
                          <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                            Isolated
                          </span>
                        )}
                      </div>
                      {(() => {
                        const order = getOrderForPosition(openOrders, pos);
                        if (!order) return null;
                        const marketConfig = marketsMap[marketKey] ?? Object.values(marketsMap).find((m) => normalizeAddress(m.market_addr || '') === marketKey);
                        const pxDecimals = marketConfig?.px_decimals ?? 9;
                        const szDecimals = marketConfig?.sz_decimals ?? 9;
                        // API may return human price (e.g. 70000) or chain units; use as-is if in human range
                        const orderPriceHuman =
                          order.price > 0 && order.price < 1e12
                            ? order.price
                            : order.price / 10 ** pxDecimals;
                        const rawSize = order.remaining_size ?? order.orig_size ?? order.size;
                        const orderSizeHuman =
                          rawSize != null
                            ? rawSize > 0 && rawSize < 1e10
                              ? Math.abs(rawSize)
                              : Math.abs(rawSize) / 10 ** szDecimals
                            : 0;
                        const sizeStr = orderSizeHuman > 0 ? `${formatSize(orderSizeHuman)} @ ` : '';
                        const orderLabel = `Limit close order ${sizeStr || '@ '}${formatNumber(orderPriceHuman, 4)}`;
                        const isCanceling = order.order_id && cancelingOrderId === order.order_id;
                        return (
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="flex items-center gap-1.5 rounded-md border-l-2 border-primary/40 bg-muted/50 pl-2 py-1 pr-2 w-fit">
                                    <Target className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                    <span className="text-sm text-muted-foreground">{orderLabel}</span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="max-w-[240px]">
                                  <p>
                                    Limit close order is active. It will fill when price reaches{' '}
                                    {formatNumber(orderPriceHuman, 4)} or you cancel it.
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            {order.order_id && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-muted-foreground hover:text-destructive"
                                disabled={!!cancelingOrderId}
                                onClick={() => handleCancelOrder(order.order_id!, pos.user, pos.market)}
                              >
                                {isCanceling ? 'Canceling…' : 'Cancel order'}
                              </Button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="flex flex-col items-end shrink-0 ml-auto">
                      <span className={cn('text-2xl font-semibold text-right', pnlColor)}>
                        {totalPnl >= 0 ? '+' : ''}{formatCurrency(totalPnl, 2)}
                      </span>
                      <span className={cn('text-lg font-medium text-right', pnlColor)}>
                        ({pnlPercent >= 0 ? '+' : ''}{formatNumber(pnlPercent, 2)}%)
                      </span>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-sm text-muted-foreground mt-1 cursor-help">
                              Margin: {formatCurrency(marginUsd, 2)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="left" className="max-w-[220px]">
                            <p>Initial margin (collateral at risk) = Notional ÷ Leverage. Used for % PnL and liquidation.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <div className="mt-2 flex items-center gap-2 self-end">
                        {isYieldAiDeltaNeutralPosition ? (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => yieldAiSafeAddress && handleManageYieldAiPosition(yieldAiSafeAddress, pos.market)}
                            disabled={!yieldAiSafeAddress}
                          >
                            Manage in Yield AI agent
                          </Button>
                        ) : (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleViewChartClick(pos)}
                              disabled={!!closingPositionKey}
                            >
                              View chart
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleCloseClick(pos)}
                              disabled={!!closingPositionKey}
                            >
                              {closingPositionKey === positionKey(pos) ? 'Closing…' : 'Close'}
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* PnL breakdown below, with horizontal line */}
                  <div className="mt-2 pt-2 border-t border-border flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="text-muted-foreground">Est. PnL (price):</span>
                    <span className={pricePnlColor}>{pricePnl >= 0 ? '+' : ''}{formatCurrency(pricePnl, 2)}</span>
                    <span className="text-muted-foreground">|</span>
                    <span className="text-muted-foreground">Funding:</span>
                    <span className={fundingColor}>{fundingDisplay >= 0 ? '+' : ''}{formatCurrency(fundingDisplay, 2)}</span>
                    <span className="text-muted-foreground">|</span>
                    <span className="text-muted-foreground">Total:</span>
                    <span className={pnlColor}>{totalPnl >= 0 ? '+' : ''}{formatCurrency(totalPnl, 2)}</span>
                  </div>
                  {/* Details: Entry, Mark, Liq. price, Size, Value — compact, no extra gap */}
                  <div className="mt-2 pt-2 border-t border-border grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm">
                    <div>
                      <span className="text-muted-foreground">Entry price</span>
                      <span className="ml-2">
                        {formatNumber(pos.entry_price)}
                        {showTokenLabels ? ` ${quote}` : ''}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Mark price</span>
                      <span className="ml-2">
                        {formatNumber(markPx)}
                        {showTokenLabels ? ` ${quote}` : ''}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Liq. price</span>
                      <span className="ml-2">
                        {formatNumber(pos.estimated_liquidation_price)}
                        {showTokenLabels ? ` ${quote}` : ''}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        {showTokenLabels ? `Size (${base})` : 'Size'}
                      </span>
                      <span className="ml-2">
                        {formatSize(pos.size)}
                        {showTokenLabels ? ` ${base}` : ''}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Value (USD)</span>
                      <span className="ml-2 font-medium">{formatCurrency(notionalUsd, 2)}</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground">Funding rate</span>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex text-muted-foreground cursor-help">
                                <Info className="h-3.5 w-3.5" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-[260px]">
                              <p>
                                Current signed funding rate for this perp and the equivalent annualized APR.
                                Positive values mean longs pay shorts.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <span className="ml-0">
                        {fundingRateInfo
                          ? formatFundingRatePercent(fundingRateInfo)
                          : '—'}
                      </span>
                      {fundingRateInfo && (
                        <div className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
                          <div>{formatFundingAprPercent(fundingRateInfo)}</div>
                          <div>{fundingRateInfo.isFundingPositive ? 'Longs pay shorts' : 'Shorts pay longs'}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <Dialog open={!!closeConfirmPosition} onOpenChange={(open) => !open && handleCancelClose()}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Close position</DialogTitle>
                {closeConfirmPosition && (
                  <>
                    <p className="text-sm font-medium text-foreground mt-1">Close at:</p>
                    <div className="flex gap-1 p-0.5 rounded-lg border bg-muted/40">
                      <button
                        type="button"
                        onClick={() => setCloseMode('market')}
                        className={cn(
                          'flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                          closeMode === 'market'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        Market
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCloseMode('limit');
                          if (dialogMarkPx != null) setCloseLimitPrice(formatLimitPriceInput(dialogMarkPx, 4));
                        }}
                        className={cn(
                          'flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                          closeMode === 'limit'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        Limit
                      </button>
                    </div>
                    {closeMode === 'limit' && (
                      <div className="space-y-2 pt-2">
                        <Label htmlFor="close-limit-price">Limit price</Label>
                        <Input
                          id="close-limit-price"
                          type="number"
                          step="any"
                          min="0"
                          placeholder={dialogMarkPx != null ? formatLimitPriceInput(dialogMarkPx, 4) : '0'}
                          value={closeLimitPrice}
                          onChange={(e) => setCloseLimitPrice(e.target.value)}
                          className="font-mono"
                        />
                        <div className="flex flex-wrap gap-1.5">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={!canAdjustLimitPricePct(closeLimitPrice, dialogMarkPx)}
                            onClick={() =>
                              setCloseLimitPrice((prev) => applyLimitPriceAction(prev, dialogMarkPx, 'minus1pct'))
                            }
                          >
                            −1%
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={dialogMarkPx == null || dialogMarkPx <= 0}
                            onClick={() =>
                              setCloseLimitPrice(applyLimitPriceAction(closeLimitPrice, dialogMarkPx, 'mark'))
                            }
                          >
                            Mark
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={!canAdjustLimitPricePct(closeLimitPrice, dialogMarkPx)}
                            onClick={() =>
                              setCloseLimitPrice((prev) => applyLimitPriceAction(prev, dialogMarkPx, 'plus1pct'))
                            }
                          >
                            +1%
                          </Button>
                        </div>
                        {dialogMarkPx != null && (
                          <p className="text-xs text-muted-foreground">Mark: {formatNumber(dialogMarkPx, 4)}</p>
                        )}
                      </div>
                    )}
                  </>
                )}
                <DialogDescription>
                  {closeConfirmPosition && (
                    <>
                      Close {formatSize(Math.abs(closeConfirmPosition.size))}{' '}
                      {formatDecibelMarket(marketNames[normalizeAddress(closeConfirmPosition.market)] ?? closeConfirmPosition.market).displayPair}
                      {closeMode === 'market' ? (
                        <>
                          {' '}
                          at market price
                          {dialogMarkPx != null && (
                            <> (~{formatNumber(dialogMarkPx, 4)})</>
                          )}
                          ? This will execute immediately (IOC).
                        </>
                      ) : (
                        <> at your limit price? Order will stay in the book until filled or you cancel it.</>
                      )}
                      {decibelNetwork === 'testnet' && (
                        <span className="mt-2 block text-amber-600 dark:text-amber-400 font-medium">
                          Switch your wallet to Aptos Mainnet before closing.
                        </span>
                      )}
                    </>
                  )}
                </DialogDescription>
              </DialogHeader>
              {closeShortHedgeHint && (
                <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    If you hold spot to hedge this short, you can sell ~{formatSize(closeShortHedgeHint.absSz)}{' '}
                    {closeShortHedgeHint.base} for USDC (same size as this position).
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setHedgeSwapPrefill({
                          fromFaAddress: closeShortHedgeHint.baseFa,
                          toFaAddress: HEDGE_FA.USDC,
                          amount: formatBaseAmountForSwap(closeShortHedgeHint.absSz),
                        });
                        setHedgeSwapOpen(true);
                      }}
                    >
                      Open swap
                    </Button>
                    {!closeShortHedgeHint.enoughBase && (
                      <span className="text-xs text-muted-foreground">
                        Acquire enough {closeShortHedgeHint.base} on your wallet to sell into USDC and unwind a spot
                        hedge.
                      </span>
                    )}
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={handleCancelClose} disabled={!!closingPositionKey}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleConfirmClose}
                  disabled={
                    !!closingPositionKey ||
                    !closeConfirmPosition ||
                    (closeMode === 'limit' &&
                      (!closeLimitPrice.trim() ||
                        Number.isNaN(parseFloat(closeLimitPrice)) ||
                        parseFloat(closeLimitPrice) <= 0))
                  }
                >
                  {closingPositionKey
                    ? closeMode === 'limit'
                      ? 'Placing…'
                      : 'Closing…'
                    : closeMode === 'limit'
                      ? 'Place limit close'
                      : 'Close at market'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}

      {/* Vaults: show when we have vault deposits */}
      {(vaultsLoading || visibleVaults.length > 0) && (
        <div className="space-y-2">
          <h4 className="text-base font-medium mb-2 text-muted-foreground flex items-center gap-2">
            Vaults
            {hasTestnetData && (availableToTrade == null && !overviewLoading) && positions.length === 0 && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex text-muted-foreground cursor-help">
                      <Info className="h-4 w-4" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[220px]">
                    <p>Decibel assets (positions, available to trade, vaults) are included in Total Assets.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </h4>
          {vaultsLoading ? (
            <p className="text-base text-muted-foreground">Loading vaults...</p>
          ) : visibleVaults.length === 0 ? (
            <p className="text-base text-muted-foreground">No vault deposits.</p>
          ) : (
            <ul className="space-y-2">
              {visibleVaults.map((v, i) => {
                const shareMetadata = getVaultShareMetadata(v);
                const shareSubaccount = getVaultSubaccount(v);
                const shareSymbol = getVaultShareSymbol(v);
                const shareBalance = getVaultShareBalanceBaseUnits(v);
                const walletShareBalance = getVaultWalletShareBalanceBaseUnits(v);
                const echelonShareBalance = getVaultEchelonShareBalanceBaseUnits(v, echelonPositions);
                const outsideDecibelShareBalance = addVaultShareBaseUnits(walletShareBalance, echelonShareBalance);
                const walletShareBalanceLoaded = hasVaultWalletShareBalance(v);
                const totalWithdrawn = Number(v.total_withdrawn);
                const redeemedUsd = Number.isFinite(totalWithdrawn) ? totalWithdrawn : null;
                const canWithdrawShares =
                  typeof signAndSubmitTransaction === 'function' &&
                  Boolean(shareMetadata && shareSubaccount && shareBalance !== '0');
                const canDepositShares =
                  typeof signAndSubmitTransaction === 'function' &&
                  Boolean(shareMetadata && shareSubaccount && walletShareBalance !== '0');
                return (
                <li
                  key={`${v.vault?.address ?? 'vault'}-${v.account_address ?? i}`}
                  className="overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm"
                >
                  <div className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1.5fr)_auto_auto_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="min-w-0 truncate text-base font-semibold" title={getVaultName(v)}>
                        {getVaultName(v)}
                      </div>
                      <div className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>In Decibel: {formatVaultShareBaseUnits(shareBalance)} {shareSymbol}</span>
                        {walletShareBalanceLoaded && (
                          <span>In wallet: {formatVaultShareBaseUnits(walletShareBalance)} {shareSymbol}</span>
                        )}
                        {echelonShareBalance !== '0' && (
                          <span>In Echelon: {formatVaultShareBaseUnits(echelonShareBalance)} {shareSymbol}</span>
                        )}
                        {outsideDecibelShareBalance !== '0' && (
                          <span>Outside Decibel: {formatVaultShareBaseUnits(outsideDecibelShareBalance)} {shareSymbol}</span>
                        )}
                        {redeemedUsd != null && redeemedUsd > 0 && (
                          <span>USDC redeemed: {formatCurrency(redeemedUsd, 2)}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center sm:justify-center">
                      {v.apr != null && Number.isFinite(v.apr) && (
                        <Badge
                          variant="outline"
                          className="h-6 border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400"
                        >
                          APR {v.apr.toFixed(2)}%
                        </Badge>
                      )}
                    </div>
                    <div className="sm:text-right">
                        <div className="text-base font-medium">
                          {v.current_value_of_shares != null
                            ? formatCurrency(v.current_value_of_shares, 2)
                            : '—'}
                        </div>
                        {typeof v.unrealized_pnl === 'number' && Number.isFinite(v.unrealized_pnl) ? (
                          <div className={cn('text-sm', v.unrealized_pnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>
                            PnL: {v.unrealized_pnl >= 0 ? '+' : ''}{formatCurrency(v.unrealized_pnl, 2)}
                          </div>
                        ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 px-3 text-xs"
                          disabled={!canDepositShares}
                          onClick={() => setVaultShareDeposit(v)}
                          title={
                            !shareMetadata
                              ? 'Share asset metadata is not available yet. Refresh Decibel positions.'
                              : !shareSubaccount
                                ? 'Vault subaccount is not available yet.'
                                : walletShareBalance === '0'
                                  ? `No ${shareSymbol} shares in your Aptos wallet.`
                                  : undefined
                          }
                        >
                          <Upload className="mr-1.5 h-3.5 w-3.5" />
                          Deposit
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 px-3 text-xs"
                          disabled={!canWithdrawShares}
                          onClick={() => setVaultShareWithdraw(v)}
                          title={
                            !shareMetadata
                              ? 'Share asset metadata is not available yet. Refresh Decibel positions.'
                              : !shareSubaccount
                                ? 'Vault subaccount is not available yet.'
                                : shareBalance === '0'
                                  ? `No ${shareSymbol} shares in this Decibel subaccount.`
                                  : undefined
                          }
                        >
                          <Download className="mr-1.5 h-3.5 w-3.5" />
                          Withdraw
                        </Button>
                    </div>
                  </div>
                </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      <div className="flex items-center justify-between pt-6 pb-6">
        <span className="text-lg">Total assets in Decibel:</span>
        <span className="text-lg font-bold text-primary">{formatCurrency(totalAssets, 2)}</span>
      </div>

      <DecibelOpenPositionModal
        open={tradeModalOpen}
        onOpenChange={(open) => {
          setTradeModalOpen(open);
          if (!open) setTradeMarket(null);
        }}
        market={tradeMarket}
      />
      <Dialog open={referralDialogOpen} onOpenChange={setReferralDialogOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Decibel referral activity</DialogTitle>
            <DialogDescription>
              Referral metrics are loaded only when this dialog opens. Volumes are lifetime values from Decibel.
            </DialogDescription>
          </DialogHeader>

          {referralDashboard.isLoading ? (
            <div className="py-6 text-sm text-muted-foreground">Loading referral activity...</div>
          ) : referralDashboard.isError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {referralDashboard.error instanceof Error
                ? referralDashboard.error.message
                : 'Failed to load Decibel referral activity'}
            </div>
          ) : referralDashboard.data ? (
            <div className="space-y-5">
              {primaryReferralCode && (
                <div className="rounded-lg border bg-primary/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs text-muted-foreground">Your referral code</div>
                      <div className="mt-1 font-mono text-2xl font-semibold tracking-wide">
                        {primaryReferralCode.referral_code}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {primaryReferralCode.is_affiliate && (
                        <Badge variant="outline">Affiliate</Badge>
                      )}
                      <Badge variant={primaryReferralCode.is_active ? 'outline' : 'secondary'}>
                        {primaryReferralCode.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Used {formatNumber(primaryReferralCode.usage_count ?? 0, 0)} /{' '}
                    {formatUsageLimit(primaryReferralCode.max_usage)}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">Referrals</div>
                  <div className="mt-1 text-2xl font-semibold">
                    {formatNumber(referralDashboard.data.summary.total_referrals, 0)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    L1 {formatNumber(referralDashboard.data.summary.l1.count, 0)} / L2{' '}
                    {formatNumber(referralDashboard.data.summary.l2.count, 0)}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">Active users</div>
                  <div className="mt-1 text-2xl font-semibold">
                    {formatNumber(
                      referralDashboard.data.summary.l1.active_count +
                        referralDashboard.data.summary.l2.active_count,
                      0
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    L1 {formatNumber(referralDashboard.data.summary.l1.active_count, 0)} / L2{' '}
                    {formatNumber(referralDashboard.data.summary.l2.active_count, 0)}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="text-xs text-muted-foreground">Referral volume</div>
                  <div className="mt-1 text-2xl font-semibold">
                    {formatCurrency(referralDashboard.data.summary.total_volume, 2)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Referral AMPs {formatNumber(referralDashboard.data.summary.leaderboard.referral_amps, 2)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">L1 direct referrals</span>
                    <Badge variant="outline">
                      {formatNumber(referralDashboard.data.summary.l1.count, 0)}
                    </Badge>
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    Active {formatNumber(referralDashboard.data.summary.l1.active_count, 0)}
                  </div>
                  <div className="mt-1 text-sm">
                    Volume {formatCurrency(referralDashboard.data.summary.l1.total_volume, 2)}
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">L2 network referrals</span>
                    <Badge variant="outline">
                      {formatNumber(referralDashboard.data.summary.l2.count, 0)}
                    </Badge>
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    Active {formatNumber(referralDashboard.data.summary.l2.active_count, 0)}
                  </div>
                  <div className="mt-1 text-sm">
                    Volume {formatCurrency(referralDashboard.data.summary.l2.total_volume, 2)}
                  </div>
                </div>
              </div>

              {referralDashboard.data.codes.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Referral codes</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {referralDashboard.data.codes.map((code) => (
                      <div
                        key={code.referral_code}
                        className="rounded-lg border bg-muted/20 p-3 text-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{code.referral_code}</span>
                          <Badge variant={code.is_active ? 'outline' : 'secondary'}>
                            {code.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          Used {formatNumber(code.usage_count ?? 0, 0)} / {formatUsageLimit(code.max_usage)}
                        </div>
                        {code.is_affiliate && (
                          <div className="mt-1 text-xs text-primary">Affiliate code</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {referralDashboard.data.top_users.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Top referred users</div>
                  <div className="rounded-lg border divide-y">
                    {referralDashboard.data.top_users.slice(0, 8).map((user) => (
                      <div
                        key={`${user.level}-${user.account}-${user.total_volume}`}
                        className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Badge variant="outline">{user.level}</Badge>
                          <span className="font-mono text-xs text-muted-foreground">{user.account}</span>
                          {user.active && (
                            <span className="text-xs text-green-600 dark:text-green-400">active</span>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="font-medium">{formatCurrency(user.total_volume, 2)}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatNumber(user.affiliate_amps_earned, 2)} AMP
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {referralDashboard.data.l2_by_referrer.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-medium">L2 by referrer</div>
                  <div className="rounded-lg border divide-y">
                    {referralDashboard.data.l2_by_referrer.slice(0, 5).map((row) => (
                      <div
                        key={row.referrer}
                        className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
                      >
                        <div>
                          <div className="font-mono text-xs text-muted-foreground">{row.referrer}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {formatNumber(row.count, 0)} users, {formatNumber(row.active_count, 0)} active
                          </div>
                        </div>
                        <div className="font-medium">{formatCurrency(row.total_volume, 2)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {referralDashboard.data.users.truncated && (
                <p className="text-xs text-muted-foreground">
                  Showing a capped Decibel response. Add server-side pagination before exposing full admin drill-down.
                </p>
              )}
              {referralDashboard.data.warnings.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Some Decibel sources returned partial data: {referralDashboard.data.warnings.join('; ')}
                </p>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReferralDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={postCloseHedgePromptOpen}
        onOpenChange={(open) => {
          setPostCloseHedgePromptOpen(open);
          if (!open) setPostCloseUnwindPrefill(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unwind spot hedge?</AlertDialogTitle>
            <AlertDialogDescription>
              Your short was closed at market. If you still hold the base asset as a spot hedge, you can swap it for
              USDC now.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPostCloseUnwindPrefill(null);
                setPostCloseHedgePromptOpen(false);
              }}
            >
              Not now
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (postCloseUnwindPrefill) {
                  setHedgeSwapPrefill(postCloseUnwindPrefill);
                  setHedgeSwapOpen(true);
                }
                setPostCloseUnwindPrefill(null);
                setPostCloseHedgePromptOpen(false);
              }}
            >
              Open swap
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SwapModal
        isOpen={hedgeSwapOpen}
        onClose={() => {
          setHedgeSwapOpen(false);
          setHedgeSwapPrefill(null);
        }}
        prefill={hedgeSwapPrefill}
        variantTitle="Unwind spot hedge"
        variantDescription="Sell base asset for USDC to align with closing your short (Panora gasless swap)."
      />
      {withdrawSubaccountAddr && (
        <DecibelWithdrawModal
          isOpen={withdrawModalOpen}
          onClose={() => setWithdrawModalOpen(false)}
          subaccountAddr={withdrawSubaccountAddr}
          withdrawableBalanceUsd={withdrawableBalanceUsd}
          isTestnet={decibelNetwork === 'testnet'}
        />
      )}
      {vaultShareWithdraw && selectedVaultShareMetadata && selectedVaultShareSubaccount && (
        <DecibelVaultShareWithdrawModal
          isOpen={Boolean(vaultShareWithdraw)}
          onClose={() => setVaultShareWithdraw(null)}
          vaultName={getVaultName(vaultShareWithdraw)}
          subaccountAddr={selectedVaultShareSubaccount}
          assetMetadataAddr={selectedVaultShareMetadata}
          shareBalanceBaseUnits={getVaultShareBalanceBaseUnits(vaultShareWithdraw)}
          shareSymbol={getVaultShareSymbol(vaultShareWithdraw)}
          sharePriceUsd={getVaultSharePriceUsd(vaultShareWithdraw)}
          isTestnet={decibelNetwork === 'testnet'}
        />
      )}
      {vaultShareDeposit && selectedVaultDepositMetadata && selectedVaultDepositSubaccount && (
        <DecibelVaultShareDepositModal
          isOpen={Boolean(vaultShareDeposit)}
          onClose={() => setVaultShareDeposit(null)}
          vaultName={getVaultName(vaultShareDeposit)}
          subaccountAddr={selectedVaultDepositSubaccount}
          assetMetadataAddr={selectedVaultDepositMetadata}
          walletShareBalanceBaseUnits={getVaultWalletShareBalanceBaseUnits(vaultShareDeposit)}
          shareSymbol={getVaultShareSymbol(vaultShareDeposit)}
          sharePriceUsd={getVaultSharePriceUsd(vaultShareDeposit)}
          isTestnet={decibelNetwork === 'testnet'}
        />
      )}
    </div>
  );
}
