"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useWalletData } from "@/contexts/WalletContext";
import Image from "next/image";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Token } from "@/lib/types/token";
import {
  APTOS_COIN_TYPE,
  USDC_FA_METADATA_MAINNET,
  WBTC_FA_METADATA_MAINNET,
  XBTC_FA_METADATA_MAINNET,
  USD1_FA_METADATA_MAINNET,
  ELON_FA_METADATA_MAINNET,
  THAPT_FA_METADATA_MAINNET,
  YIELD_AI_HYPERION_POOLS,
} from "@/lib/constants/yieldAiVault";
import { rangeAdjustedApr } from "@/lib/protocols/yield-ai/hyperionRangeApr";
import { formatCurrency, formatNumber } from "@/lib/utils/numberFormat";
import { useToast } from "@/components/ui/use-toast";
import { normalizeAddress } from "@/lib/utils/addressNormalization";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, History, Info, Loader2, PauseCircle, PlayCircle, Plus, Settings, XCircle } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { DepositModal } from "@/components/ui/deposit-modal";
import { DecibelDepositModal } from "@/components/ui/decibel-deposit-modal";
import { HyperionLpStrategyView } from "@/components/protocols/manage-positions/protocols/yield-ai/HyperionLpStrategyView";
import { useHyperionLpPositions } from "@/lib/query/hooks/protocols/yield-ai/useHyperionLpPositions";
import { buildHyperionAgentDepositModalConfig } from "@/lib/protocols/yield-ai/hyperionAgentDepositModal";
import { DeltaNeutralPriceFundingChart } from "@/components/decibel/delta-neutral-price-funding-chart";
import type { DeltaNeutralLpLeg } from "@/app/api/protocols/yield-ai/delta-neutral-cycles/route";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import { YieldAIWithdrawModal } from "@/components/ui/yield-ai-withdraw-modal";
import { YieldAiEchelonWithdrawModal } from "@/components/ui/yield-ai-echelon-withdraw-modal";
import { YieldAiHistoryModal } from "@/components/ui/yield-ai-history-modal";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import {
  useYieldAiDepositHistory,
  useYieldAiSafes,
  useYieldAiSafeTokens,
  useDeltaNeutralState,
  useDeltaNeutralCycles,
  useDeltaNeutralHistory,
  useYieldAiStablecoinCompoundHistory,
  useYieldAiSafePaused,
  useSelectedYieldAiSafe,
  useVaultFaSwapLimits,
} from "@/lib/query/hooks/protocols/yield-ai";
import { useSafeAiAgentStrategy } from "@/lib/query/hooks/protocols/yield-ai/useSafeAiAgentStrategy";
import { useBatchSafeStrategies } from "@/lib/query/hooks/protocols/yield-ai/useBatchSafeStrategies";
import {
  AI_AGENT_STRATEGIES,
  AI_AGENT_STRATEGY_BADGE_CLASS,
} from "@/lib/protocols/yield-ai/strategyRegistry";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useDecibelUserPositions } from "@/lib/query/hooks/protocols/decibel/useDecibelUserPositions";
import { useDecibelMarketPrice } from "@/lib/query/hooks/protocols/decibel/useDecibelMarketPrice";
import { useDecibelPositionLedger } from "@/lib/query/hooks/protocols/decibel/useDecibelPositionLedger";
import { decibelChainUnitsToHumanBase } from "@/lib/protocols/decibel/closePosition";
import { useEchelonProtocolCardModel } from "@/lib/query/hooks/protocols/echelon/useEchelonProtocolCardModel";
import type { EchelonModalRow } from "@/lib/query/hooks/protocols/echelon/useEchelonProtocolCardModel";
import { useEchelonPools } from "@/lib/query/hooks/protocols/echelon/useEchelonPools";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { areAddressesEqual, toCanonicalAddress } from "@/lib/utils/addressNormalization";
import { buildDelegateTradingPayload } from "@/lib/protocols/decibel/delegateTrading";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  buildVaultExecuteWithdrawAllEchelonFaAsOwnerPayload,
  buildSetSafePausedPayload,
  buildSetFaSwapLimitsPayload,
} from "@/lib/protocols/yield-ai/vaultDeposit";
import { signOwnerManageAuth } from "@/lib/protocols/yield-ai/manageAuthClient";
import type { ManageAuthFields } from "@/lib/protocols/yield-ai/manageAuth";
import {
  HEDGE_FA,
  formatUsdcAmountForSwap,
  hasEnoughUsdcForHedge,
  humanBalanceForFa,
} from "@/lib/protocols/decibel/hedgePrefill";
import { SwapModal, type SwapModalPrefill } from "@/components/ui/swap-modal";
import { PnlSummaryRow } from "@/components/ui/pnl-summary-row";
import { DecibelOnboardingCard } from "@/components/protocols/yield-ai/DecibelOnboardingCard";
import { useDecibelSubaccounts } from "@/lib/query/hooks/protocols/decibel/useDecibelSubaccounts";
import { useDecibelAccountBalance } from "@/lib/query/hooks/protocols/decibel/useDecibelAccountBalance";
import { useDecibelBuilderFeeApproval } from "@/lib/query/hooks/protocols/decibel/useDecibelBuilderFeeApproval";
import { useBatchDecibelSubaccountReadiness } from "@/lib/query/hooks/protocols/decibel/useBatchDecibelSubaccountReadiness";
import { useDecibelDeltaNeutralOpenPreview } from "@/lib/query/hooks/protocols/decibel/useDecibelDeltaNeutralOpenPreview";
import { useDecibelDeltaNeutralClosePreview } from "@/lib/query/hooks/protocols/decibel/useDecibelDeltaNeutralClosePreview";
import { fetchFundingApr } from "@/lib/protocols/decibel/fundingApr";
import {
  APT_FA_METADATA_MAINNET,
  getClientDecibelBtcSpotAsset,
  getDecibelSpotAssetForMetadata,
  isDecibelBtcSpotMetadata,
} from "@/lib/protocols/decibel/deltaNeutralSpotAssets";
import { submitAptosTransaction } from "@/lib/mobile/submitAptosTransaction";
import { useNativeWalletStore } from "@/lib/stores/nativeWalletStore";

const USDC_LOGO_APTOS = "https://assets.panora.exchange/tokens/aptos/USDC.svg";
const USD1_LOGO_APTOS = "https://assets.panora.exchange/tokens/aptos/USD1.png";

/** Stablecoins the AI agent safe accepts as a deposit. */
const AI_AGENT_DEPOSIT_TOKENS = [
  { symbol: "USDC", logo: USDC_LOGO_APTOS, decimals: 6, address: USDC_FA_METADATA_MAINNET },
  { symbol: "USD1", logo: USD1_LOGO_APTOS, decimals: 6, address: USD1_FA_METADATA_MAINNET },
];
const MIN_VISIBLE_USD = 0.0001;

function spotAssetLabel(spotAssetMetadata: string): string {
  const known = getDecibelSpotAssetForMetadata(spotAssetMetadata);
  if (known) return known.label;
  return spotAssetMetadata;
}

function isApt(spotAssetMetadata: string): boolean {
  return normalizeAddress(spotAssetMetadata) === normalizeAddress(APT_FA_METADATA_MAINNET);
}

/**
 * Worst-case margin multiple for an LP-hedge position opened at the center of a symmetric
 * log-price range ±rangePct% (r = 1 + rangePct/100, matching halfWidthTicksForPct's convention).
 * As price falls toward the range's lower bound, the CLMM position sheds its USDC leg for more
 * of the base asset, so the 1x short (and its required margin) must grow to match. The worst case
 * — price sitting exactly at the lower bound — needs margin_atOpen * (sqrt(r) + 1) / r. Narrower
 * ranges have a HIGHER multiple (composition swings more per unit of price move near a closer
 * bound), not lower — e.g. ±10% ≈ 1.86x vs ±20% ≈ 1.75x vs ±50% ≈ 1.48x.
 */
function lpHedgeWorstCaseMarginMultiple(rangePct: number): number {
  const r = 1 + Math.max(0.1, rangePct) / 100;
  return (Math.sqrt(r) + 1) / r;
}

function envFlag(raw: string | undefined, defaultValue = false): boolean {
  if (raw == null) return defaultValue;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return defaultValue;
}

/** Toggle Decibel delegation + executor test UI (client-side flag). */
const SHOW_EXECUTOR_TRADE_BLOCK = envFlag(process.env.NEXT_PUBLIC_SHOW_EXECUTOR_TRADE_BLOCK, false);
const MAX_SPOT_HEDGE_UNDERFUND_PCT = 0.01;
const MAX_SPOT_HEDGE_UNDERFUND_USDC = 0.25;

function maxSpotHedgeUnderfundUsd(requiredUsdc: number): number {
  if (!Number.isFinite(requiredUsdc) || requiredUsdc <= 0) return 0;
  return Math.min(requiredUsdc * MAX_SPOT_HEDGE_UNDERFUND_PCT, MAX_SPOT_HEDGE_UNDERFUND_USDC);
}

function isSpotHedgeFundingAcceptableUsd(availableUsdc: number, requiredUsdc: number): boolean {
  if (!Number.isFinite(availableUsdc) || !Number.isFinite(requiredUsdc)) return false;
  if (availableUsdc >= requiredUsdc) return true;
  return requiredUsdc - availableUsdc <= maxSpotHedgeUnderfundUsd(requiredUsdc);
}

function aptosMainnetTxnExplorerUrl(version: string): string | null {
  if (!version || version === "0") return null;
  if (!/^\d+$/.test(version.trim())) return null;
  return `https://explorer.aptoslabs.com/txn/${version.trim()}?network=mainnet`;
}

function formatUnixSecondsLabel(s: string): string {
  if (!s || s === "0") return "—";
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return new Date(n * 1000).toLocaleString();
}

export function YieldAIPositions() {
  const { account, signAndSubmitTransaction, signMessage } = useWallet();
  const injectedAptosAddress = useNativeWalletStore((s) => s.aptosAddress);
  const effectiveAptosAddress = injectedAptosAddress ?? account?.address?.toString() ?? null;
  const { tokens: walletTokens } = useWalletData();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Wallet-signed owner authorization for user-initiated executor routes.
  // Fields must be the exact values sent in the request body (same key order).
  const signManageAction = useCallback(
    (action: string, fields: ManageAuthFields) =>
      signOwnerManageAuth({ account, signMessage, action, fields }),
    [account, signMessage]
  );
  const configuredBtcSpotAsset = useMemo(() => getClientDecibelBtcSpotAsset(), []);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedWithdrawToken, setSelectedWithdrawToken] = useState<Token | null>(null);
  const [showEchelonWithdrawConfirm, setShowEchelonWithdrawConfirm] = useState(false);
  const [selectedEchelonWithdrawRow, setSelectedEchelonWithdrawRow] = useState<EchelonModalRow | null>(
    null
  );
  const [isExecutingEchelonWithdrawToSafe, setIsExecutingEchelonWithdrawToSafe] = useState(false);
  const [echelonAdapterAddress, setEchelonAdapterAddress] = useState<string | null>(null);
  const [echelonAdapterLoadError, setEchelonAdapterLoadError] = useState<string | null>(null);
  const [executorAsset, setExecutorAsset] = useState<"BTC" | "APT">("BTC");
  const [executorSizeUsd, setExecutorSizeUsd] = useState<string>("10");
  // DN hedge variant: "spot" (hold spot) or "lp" (Hyperion APT/USDC LP long leg). LP is APT-only.
  const [dnHedgeMode, setDnHedgeMode] = useState<"spot" | "lp">("spot");
  // LP-hedge DN is in private beta — the LP toggle is hidden for wallets outside this allowlist.
  // UX-only: the real gate is server-side (executor-open-delta-neutral, fail-closed). Addresses
  // aren't secret, so a NEXT_PUBLIC_ var doubles as both the server's and the client's source.
  const isLpDnBetaUser = useMemo(() => {
    const list = (process.env.NEXT_PUBLIC_LP_DN_ALLOWLIST || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => normalizeAddress(toCanonicalAddress(v)));
    if (list.length === 0 || !account?.address) return false;
    return list.includes(normalizeAddress(toCanonicalAddress(account.address.toString())));
  }, [account?.address]);
  // Guard against stale "lp" mode surviving a wallet switch to a non-beta wallet.
  useEffect(() => {
    if (dnHedgeMode === "lp" && !isLpDnBetaUser) setDnHedgeMode("spot");
  }, [dnHedgeMode, isLpDnBetaUser]);
  const [lpRangePct, setLpRangePct] = useState<string>("20");
  const [lpPoolKey, setLpPoolKey] = useState<"apt_usdc" | "wbtc_usdc">("apt_usdc");
  // Live apt_usdc pool APR feed for the LP-hedge preview (fetched when LP mode is active).
  const [lpPoolApr, setLpPoolApr] = useState<{ feeApr: number; farmApr: number; currentTick: number } | null>(null);
  useEffect(() => {
    if (dnHedgeMode !== "lp") return;
    let cancelled = false;
    (async () => {
      try {
        const poolId = YIELD_AI_HYPERION_POOLS[lpPoolKey].poolAddress;
        const res = await fetch(`/api/protocols/hyperion/pools/${poolId}`);
        const json = await res.json();
        const data = json?.data;
        const p = Array.isArray(data) ? data[0] : data;
        const currentTick = Number(p?.pool?.currentTick ?? p?.currentTick);
        if (!cancelled && Number.isFinite(currentTick)) {
          setLpPoolApr({ feeApr: Number(p?.feeAPR) || 0, farmApr: Number(p?.farmAPR) || 0, currentTick });
        }
      } catch {
        /* preview-only; ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dnHedgeMode, lpPoolKey]);
  const lpRangeApr = useMemo(
    () =>
      lpPoolApr
        ? rangeAdjustedApr({
            feeAprPct: lpPoolApr.feeApr,
            farmAprPct: lpPoolApr.farmApr,
            currentTick: lpPoolApr.currentTick,
            rangePct: Number(lpRangePct),
            referenceRangePct: YIELD_AI_HYPERION_POOLS[lpPoolKey].ui.aprReferencePct,
            tickSpacing: YIELD_AI_HYPERION_POOLS[lpPoolKey].tickSpacing,
          })
        : null,
    [lpPoolApr, lpRangePct, lpPoolKey]
  );
  const [debouncedExecutorSizeUsd, setDebouncedExecutorSizeUsd] = useState<number | null>(10);
  // Auto-fill MAX size once per "session" until the user manually edits the field.
  const [executorSizeDirty, setExecutorSizeDirty] = useState(false);
  const [executorSubmitting, setExecutorSubmitting] = useState(false);
  const [showClosedStrategyRecap, setShowClosedStrategyRecap] = useState(false);
  const [showClosedStrategyRecapDetails, setShowClosedStrategyRecapDetails] = useState(false);
  const [executorMarketName, setExecutorMarketName] = useState<string | null>(null);
  const executorAmountInputRef = useRef<HTMLInputElement>(null);
  const [executorMarketAddr, setExecutorMarketAddr] = useState<string | null>(null);
  const [executorFundingApr24h, setExecutorFundingApr24h] = useState<number | null>(null);
  const [openPositionFundingApr24h, setOpenPositionFundingApr24h] = useState<number | null>(null);
  const [showUsd1ConvertConfirm, setShowUsd1ConvertConfirm] = useState(false);
  const [usd1ConvertAmountBaseUnits, setUsd1ConvertAmountBaseUnits] = useState<string>("0");
  const [isConvertingUsd1ToUsdc, setIsConvertingUsd1ToUsdc] = useState(false);
  const [executorHedgeHint, setExecutorHedgeHint] = useState<{
    sizeUsd: number;
    asset: "BTC" | "APT";
  } | null>(null);
  const [hedgeSwapOpen, setHedgeSwapOpen] = useState(false);
  const [hedgeSwapPrefill, setHedgeSwapPrefill] = useState<SwapModalPrefill | null>(null);
  const [closeDeltaNeutralOpen, setCloseDeltaNeutralOpen] = useState(false);
  const [closeDeltaNeutralSubmitting, setCloseDeltaNeutralSubmitting] = useState(false);
  const [closeDeltaNeutralResult, setCloseDeltaNeutralResult] = useState<{
    success: boolean;
    closeTxHash?: string | null;
    swapTxHash?: string | null;
    swapSkippedReason?: string | null;
    recordCloseTxHash?: string | null;
    error?: string;
    /** Populated when the server returned a structured daily-limit error. */
    dailyLimit?: {
      code: "DAILY_LIMIT_EXHAUSTED" | "DAILY_LIMIT_EXCEEDED";
      maxDailyUsdc: string | null;
      maxPerTxUsdc: string | null;
      spentTodayUsdc: string | null;
      remainingUsdc: string | null;
      secondsUntilRollover: number | null;
    };
  } | null>(null);
  const [closeDeltaNeutralForceMode, setCloseDeltaNeutralForceMode] = useState(false);
  const [closeDeltaNeutralForceRequested, setCloseDeltaNeutralForceRequested] = useState(false);
  const [openDeltaNeutralModalOpen, setOpenDeltaNeutralModalOpen] = useState(false);
  const [openDeltaNeutralResult, setOpenDeltaNeutralResult] = useState<{
    success: boolean;
    openTxHash?: string | null;
    swapTxHash?: string | null;
    recordOpenTxHash?: string | null;
    error?: string;
  } | null>(null);
  const [swapResidualOpen, setSwapResidualOpen] = useState(false);
  const [swapResidualSubmitting, setSwapResidualSubmitting] = useState(false);
  const [convertStaleAptOpen, setConvertStaleAptOpen] = useState(false);
  const [convertStaleAptSubmitting, setConvertStaleAptSubmitting] = useState(false);
  const [convertStaleXbtcOpen, setConvertStaleXbtcOpen] = useState(false);
  const [convertStaleXbtcSubmitting, setConvertStaleXbtcSubmitting] = useState(false);
  const [selectedStaleBtc, setSelectedStaleBtc] = useState<{
    metadata: string;
    label: string;
    baseUnits: bigint;
  } | null>(null);
  const [isPauseToggling, setIsPauseToggling] = useState(false);
  // Owner-editable FA-swap limits dialog (vault::set_fa_swap_limits).
  const [showLimitsDialog, setShowLimitsDialog] = useState(false);
  const [limitPerTxInput, setLimitPerTxInput] = useState("");
  const [limitDailyInput, setLimitDailyInput] = useState("");
  const [limitsSubmitting, setLimitsSubmitting] = useState(false);
  const [showDeltaNeutralDetails, setShowDeltaNeutralDetails] = useState(false);
  const [onboardingOverride, setOnboardingOverride] = useState<boolean | null>(null);
  const [decibelTopUpOpen, setDecibelTopUpOpen] = useState(false);
  // Controlled state for the Position-Summary "Price chart" collapsible so the
  // Funding row in the breakdown below can open it on click and scroll to it.
  const [openPositionChartOpen, setOpenPositionChartOpen] = useState(false);
  const openPositionChartRef = useRef<HTMLDivElement | null>(null);
  const handleScrollToFundingChart = useCallback(() => {
    setOpenPositionChartOpen(true);
    // Wait for the next frame so Radix has the content mounted before scrolling.
    requestAnimationFrame(() => {
      openPositionChartRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }, []);

  const executorHedgeUsdcOk = useMemo(() => {
    if (!executorHedgeHint) return false;
    return hasEnoughUsdcForHedge(walletTokens, executorHedgeHint.sizeUsd);
  }, [executorHedgeHint, walletTokens]);
  const walletAddress = effectiveAptosAddress ?? undefined;
  const {
    data: safeAddresses = [],
    isLoading: safesLoading,
    error: safesError,
    isFetched: safesFetched,
  } = useYieldAiSafes(walletAddress, { refetchOnMount: "always" });

  const {
    selectedSafeAddress: safeAddr,
    setSelectedSafeAddress: setSelectedSafeAddr,
    safeAddresses: normalizedSafes,
  } = useSelectedYieldAiSafe({
    owner: walletAddress,
    safeAddresses,
    safesListFetched: !walletAddress || safesFetched,
  });

  const { data: isPaused = false } = useYieldAiSafePaused(safeAddr ?? undefined);

  const { data: aiAgentStrategy } = useSafeAiAgentStrategy(safeAddr ?? undefined);
  const activeStrategyId = aiAgentStrategy?.activeStrategyId ?? "stablecoin_compound";
  const isDeltaNeutralStrategy = activeStrategyId === "decibel_delta_neutral";

  useEffect(() => {
    const sizeNum = Number(executorSizeUsd);
    const nextSize = Number.isFinite(sizeNum) && sizeNum > 0 ? sizeNum : null;
    const timeout = window.setTimeout(() => {
      setDebouncedExecutorSizeUsd(nextSize);
    }, 450);
    return () => window.clearTimeout(timeout);
  }, [executorSizeUsd]);

  // Daily FA-swap budget on the safe. Used to warn / block the Close dialog
  // before the executor tx aborts on `Move abort ::vault: 0x8`, and to
  // pre-fill the "AI agent swap limits" dialog — which is available for every
  // strategy, so the query must not be gated on delta-neutral.
  const { data: vaultFaSwapLimits } = useVaultFaSwapLimits(safeAddr ?? undefined, {
    enabled: Boolean(safeAddr),
  });

  // Get strategies for all safe addresses for better safe selector display
  const { strategiesMap, isLoading: strategiesLoading } = useBatchSafeStrategies(normalizedSafes);

  // Get Decibel subaccounts for executor functionality
  const { data: decibelSubaccounts = [] } = useDecibelSubaccounts(walletAddress);
  const primaryDecibelSubaccount = decibelSubaccounts.find(sub => sub.is_primary && sub.is_active)?.subaccount_address ||
                                   decibelSubaccounts.find(sub => sub.is_active)?.subaccount_address ||
                                   '';

  const [selectedDecibelSubaccount, setSelectedDecibelSubaccount] = useState<string>("");
  // Default-selection effect lives further down in this file (after `deltaNeutral`
  // is declared) so it can prefer the on-chain DN record's subaccount when present.

  const { data: decibelBalance } = useDecibelAccountBalance(
    selectedDecibelSubaccount || undefined,
    { enabled: Boolean(selectedDecibelSubaccount) }
  );

  const availableToTradeUsdc = useMemo(() => {
    const v = Number(decibelBalance?.usdc_cross_withdrawable_balance);
    return Number.isFinite(v) && v >= 0 ? v : null;
  }, [decibelBalance?.usdc_cross_withdrawable_balance]);

  // Builder-fee approval status for the selected (UI) trading subaccount. Used to
  // gate the Open button: trading without approval is technically possible (executor
  // would proceed without builder fee) but we want the user to explicitly approve so
  // the AI agent earns its protocol fee. UX choice — see strategy-registry-and-dn-v2.md.
  const selectedSubaccountBuilderApproval = useDecibelBuilderFeeApproval({
    subaccount: selectedDecibelSubaccount || undefined,
    enabled: Boolean(selectedDecibelSubaccount),
  });

  const walletUsdcBalance = useMemo(() => {
    return humanBalanceForFa(walletTokens, HEDGE_FA.USDC);
  }, [walletTokens]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/protocols/decibel/markets");
        const json = await res.json();
        const list: Array<{ market_name?: string; market_addr?: string }> =
          json?.success && Array.isArray(json?.data) ? json.data : [];
        const asset = executorAsset;
        const extractBaseSymbol = (name: string): string => {
          const upper = name.toUpperCase();
          return upper.split(/[-/_\s]/)[0] || upper;
        };
        const candidates = list.filter((m) => {
          const name = String(m.market_name || "").toUpperCase();
          if (!name) return false;
          if (name.startsWith(`${asset}-`) || name.startsWith(`${asset}/`) || name.startsWith(`${asset}_`)) return true;
          return extractBaseSymbol(name) === asset;
        });
        const selected = candidates[0]?.market_name ? String(candidates[0].market_name) : null;
        const selectedAddr = candidates[0]?.market_addr ? String(candidates[0].market_addr) : null;
        if (!cancelled) {
          setExecutorMarketName(selected);
          setExecutorMarketAddr(selectedAddr);
        }
      } catch {
        if (!cancelled) {
          setExecutorMarketName(null);
          setExecutorMarketAddr(null);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [executorAsset]);

  useEffect(() => {
    let cancelled = false;
    async function loadFunding() {
      if (!executorMarketName) {
        setExecutorFundingApr24h(null);
        return;
      }
      const r = await fetchFundingApr(executorMarketName, "24h");
      if (cancelled) return;
      setExecutorFundingApr24h(r?.avg_yearly_apr_pct ?? null);
    }
    void loadFunding();
    return () => {
      cancelled = true;
    };
  }, [executorMarketName]);


  const {
    data: tokens = [],
    isLoading: safeTokensLoading,
  } = useYieldAiSafeTokens(safeAddr ?? undefined, {
    enabled: Boolean(safeAddr),
    refetchOnMount: "always",
  });

  const {
    data: deltaNeutral,
    isLoading: deltaNeutralLoading,
    error: deltaNeutralError,
  } = useDeltaNeutralState(safeAddr ?? undefined);

  // strategy_journal cycles (post-migration DN positions). Dual-read alongside the legacy
  // V2 state above; multiple cycles per safe are allowed, but only on DIFFERENT markets.
  const { data: deltaNeutralCyclesData, isFetching: deltaNeutralCyclesFetching } =
    useDeltaNeutralCycles(safeAddr ?? undefined, {
      refetchOnMount: "always",
      subaccount: selectedDecibelSubaccount || undefined,
    });
  const [closingCycleId, setClosingCycleId] = useState<string | null>(null);
  const [rehedgingCycleId, setRehedgingCycleId] = useState<string | null>(null);
  // Cycle id pending a close-confirmation dialog (with loss estimate), like the v1 flow.
  const [closeCyclePromptId, setCloseCyclePromptId] = useState<string | null>(null);
  // Top-up modal target ("Add" on a journal position card). The amount is modal-local so the
  // create form's size state stays untouched.
  const [addTarget, setAddTarget] = useState<{ cycleId: string; asset: "BTC" | "APT"; isLp: boolean } | null>(null);
  const [addSizeUsd, setAddSizeUsd] = useState<string>("");
  // Market to scroll to + briefly highlight (set when arriving from the Decibel "Manage" button).
  const [highlightedDnMarket, setHighlightedDnMarket] = useState<string | null>(null);
  const baseSymbolOfMarket = (name: string | null | undefined): string =>
    (name || "").toUpperCase().split(/[-/_\s]/)[0] || "";

  // Unified DN positions: legacy delta_neutral record + every strategy_journal cycle, normalized
  // into one shape so they render as identical rows in the list below.
  type DnPositionRow = {
    source: "legacy" | "journal";
    key: string;
    cycleId: string | null;
    asset: "BTC" | "APT";
    marketAddr: string;
    marketName: string;
    shortSizeHuman: number | null;
    /** LIVE Decibel short (abs, human). The journal-recorded shortSizeHuman can lag by a lot
     * when a rehedge order landed but its record_action tx failed — prefer live for drift/display. */
    liveShortSizeHuman: number | null;
    spotHuman: number | null;
    notionalUsd: number;
    openedAt: number;
    // Live real-quote valuation (journal cycles only for now).
    spotValueUsd: number | null;
    perpUPnlUsd: number | null;
    estCloseUsd: number | null;
    markPx: number | null;
    perpEntryPx: number | null;
    perpMarginUsd: number | null;
    perpFundingUsd: number | null;
    fundingAprPct: number | null;
    decibelEquityUsd: number | null;
    totalValueUsd: number | null;
    pnlPriceUsd: number | null;
    deployedUsd: number | null;
    realizedAprPct: number | null;
    realizedAgeDays: number | null;
    // LP-hedge cycles: the live Hyperion LP long leg (range, composition, in-range). Null for spot.
    lpLeg: DeltaNeutralLpLeg | null;
  };
  const journalRows: DnPositionRow[] = (deltaNeutralCyclesData?.cycles ?? []).map((c) => {
    const asset: "BTC" | "APT" = baseSymbolOfMarket(c.marketName) === "APT" ? "APT" : "BTC";
    return {
      source: "journal",
      key: `journal-${c.cycleId}`,
      cycleId: c.cycleId,
      asset,
      marketAddr: c.perpMarket,
      marketName: c.marketName ?? `${asset}/USD`,
      shortSizeHuman: c.shortSizeHuman,
      liveShortSizeHuman: c.liveShortSizeHuman ?? null,
      spotHuman: Number(c.baseExposure) / 1e8, // BTC(WBTC)/APT spot both 8 decimals
      notionalUsd: Number(c.usdcNotionalOpen) / 1e6,
      openedAt: Number(c.openedAt),
      spotValueUsd: c.spotValueUsd ?? null,
      perpUPnlUsd: c.perpUPnlUsd ?? null,
      estCloseUsd: c.estCloseUsd ?? null,
      markPx: c.markPx ?? null,
      perpEntryPx: c.perpEntryPx ?? null,
      perpMarginUsd: c.perpMarginUsd ?? null,
      perpFundingUsd: c.perpFundingUsd ?? null,
      fundingAprPct: c.fundingAprPct ?? null,
      decibelEquityUsd: c.decibelEquityUsd ?? null,
      totalValueUsd: c.totalValueUsd ?? null,
      pnlPriceUsd: c.pnlPriceUsd ?? null,
      deployedUsd: c.deployedUsd ?? null,
      realizedAprPct: c.realizedAprPct ?? null,
      realizedAgeDays: c.realizedAgeDays ?? null,
      lpLeg: c.lpLeg ?? null,
    };
  });
  const legacyRows: DnPositionRow[] =
    deltaNeutral?.isOpen && deltaNeutral.recordExists
      ? [
          (() => {
            const isApt =
              normalizeAddress(toCanonicalAddress(deltaNeutral.spotAssetMetadata || "0x0")) ===
              normalizeAddress("0xa");
            const asset: "BTC" | "APT" = isApt ? "APT" : "BTC";
            const szDec = deltaNeutral.szDecimals ?? 8;
            const shortHuman = Number(deltaNeutral.filledShortSize) / 10 ** szDec;
            const spotHuman = deltaNeutral.spotBalanceHumanApprox
              ? Number(String(deltaNeutral.spotBalanceHumanApprox).replace(/,/g, ""))
              : null;
            return {
              source: "legacy" as const,
              key: "legacy",
              cycleId: null,
              asset,
              marketAddr: deltaNeutral.perpMarket,
              marketName: `${asset}/USD`,
              shortSizeHuman: Number.isFinite(shortHuman) ? shortHuman : null,
              liveShortSizeHuman: null,
              spotHuman: spotHuman != null && Number.isFinite(spotHuman) ? spotHuman : null,
              notionalUsd: Number(deltaNeutral.usdcSwappedIn) / 1e6,
              openedAt: Number(deltaNeutral.openedAt),
              spotValueUsd: null,
              perpUPnlUsd: null,
              estCloseUsd: null,
              markPx: null,
              perpEntryPx: null,
              perpMarginUsd: null,
              perpFundingUsd: null,
              fundingAprPct: null,
              decibelEquityUsd: null,
              totalValueUsd: null,
              pnlPriceUsd: null,
              deployedUsd: null,
              realizedAprPct: null,
              realizedAgeDays: null,
              lpLeg: null,
            };
          })(),
        ]
      : [];
  const dnPositions: DnPositionRow[] = [...legacyRows, ...journalRows];
  // Markets already running a position — block opening a duplicate on the same asset.
  const busyAssets = new Set<string>(dnPositions.map((p) => p.asset));
  // Spot-DN and LP-DN on the SAME asset share the Decibel subaccount + perp market, so a second DN
  // stacks shorts and corrupts per-cycle hedge/rehedge accounting. Track which mode is open per asset
  // so the open form can block the colliding combination (spot-on-LP and vice versa).
  const lpDnAssets = new Set<string>(dnPositions.filter((p) => p.lpLeg).map((p) => p.asset));
  const spotDnAssets = new Set<string>(dnPositions.filter((p) => !p.lpLeg).map((p) => p.asset));
  // Form-level availability: the bottom form is CREATE-only — top-ups live on each position
  // card's "Add" button (modal). When no market is free, the form collapses to an explainer.
  const canCreateAnyDn = (["BTC", "APT"] as const).some((a) => !busyAssets.has(a));

  // Spot-leg FA metadata of every OPEN DN position (journal cycles + legacy). These assets live
  // in the safe but belong to a position, so we hide them from the agent wallet list (#2) — they
  // are shown inside the expanded position instead.
  const dnSpotLegMetadata = new Set<string>();
  (deltaNeutralCyclesData?.cycles ?? []).forEach((c) => {
    // Only hide the spot leg for hold-spot DN cycles. LP-hedge cycles keep their base INSIDE the
    // Hyperion LP (not loose in the safe), so any loose spot of that asset is genuinely separate
    // money and must stay visible + convertible (e.g. a spot-DN accidentally stacked on an LP-DN).
    const isLpCycle = Boolean(c.lpPosition) && !/^0x0+$/.test(normalizeAddress(c.lpPosition));
    if (c.isOpen && c.spotMetadata && !isLpCycle) {
      dnSpotLegMetadata.add(normalizeAddress(c.spotMetadata));
    }
  });
  if (deltaNeutral?.isOpen && deltaNeutral.spotAssetMetadata) {
    dnSpotLegMetadata.add(normalizeAddress(deltaNeutral.spotAssetMetadata));
  }
  const isDnSpotLegToken = (tokenAddress: string): boolean => {
    const norm =
      tokenAddress === APTOS_COIN_TYPE
        ? normalizeAddress(APT_FA_METADATA_MAINNET)
        : normalizeAddress(tokenAddress);
    return dnSpotLegMetadata.has(norm);
  };

  // Arriving from the Decibel "Manage in Yield AI agent" button: scroll to + highlight the
  // matching position once the list is loaded. The target market is passed via sessionStorage.
  useEffect(() => {
    if (!isDeltaNeutralStrategy || dnPositions.length === 0 || typeof window === "undefined") return;
    const focus = sessionStorage.getItem("dnFocusMarket");
    if (!focus) return;
    const el = document.getElementById(`dn-position-${focus}`);
    if (!el) return;
    sessionStorage.removeItem("dnFocusMarket");
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedDnMarket(focus);
    const t = setTimeout(() => setHighlightedDnMarket(null), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDeltaNeutralStrategy, dnPositions.length]);
  // Legacy positions can't be topped up, so their asset stays fully blocked in the create form.
  // Journal-backed assets stay selectable (the form flips to "Add"/top-up mode).
  const legacyBusyAssets = new Set<string>(legacyRows.map((p) => p.asset));

  const {
    data: deltaNeutralOpenPreview,
    isFetching: deltaNeutralOpenPreviewLoading,
    error: deltaNeutralOpenPreviewError,
  } = useDecibelDeltaNeutralOpenPreview({
    asset: executorAsset,
    sizeUsd: debouncedExecutorSizeUsd ?? undefined,
    enabled: Boolean(
      isDeltaNeutralStrategy &&
        !busyAssets.has(executorAsset) &&
        debouncedExecutorSizeUsd != null &&
        debouncedExecutorSizeUsd > 0
    ),
  });

  const {
    data: deltaNeutralClosePreview,
    isFetching: deltaNeutralClosePreviewLoading,
    error: deltaNeutralClosePreviewError,
  } = useDecibelDeltaNeutralClosePreview({
    safeAddress: safeAddr ?? undefined,
    enabled: Boolean(closeDeltaNeutralOpen && deltaNeutral?.isOpen && safeAddr),
  });

  // Builder-fee approval for the ACTUAL on-chain DN subaccount (when a position is open).
  // This is used for fee estimates shown in the "Position summary" waterfall.
  const recordSubaccountBuilderApproval = useDecibelBuilderFeeApproval({
    subaccount: deltaNeutral?.decibelSubaccount || undefined,
    enabled: Boolean(deltaNeutral?.recordExists && deltaNeutral?.isOpen && deltaNeutral?.decibelSubaccount),
  });

  // Batch readiness check (delegated + builder-fee approved) across all
  // subaccounts — used by the default-selection effect below to prefer a
  // ready-to-trade subaccount over the bare primary.
  const activeSubaccountAddresses = useMemo(
    () => decibelSubaccounts.filter((s) => s.is_active).map((s) => s.subaccount_address),
    [decibelSubaccounts]
  );
  const { readiness: subaccountReadiness, isLoading: subaccountReadinessLoading } = useBatchDecibelSubaccountReadiness(
    activeSubaccountAddresses
  );
  const readyDecibelSubaccounts = useMemo(() => {
    const readySet = new Set(
      subaccountReadiness
        .filter((r) => r.isReady)
        .map((r) => normalizeAddress(r.subaccount))
    );
    return decibelSubaccounts.filter(
      (s) => s.is_active && readySet.has(normalizeAddress(s.subaccount_address))
    );
  }, [decibelSubaccounts, subaccountReadiness]);
  const selectedDecibelSubaccountReady = useMemo(() => {
    if (!selectedDecibelSubaccount) return false;
    const selected = normalizeAddress(selectedDecibelSubaccount);
    return readyDecibelSubaccounts.some(
      (s) => normalizeAddress(s.subaccount_address) === selected
    );
  }, [readyDecibelSubaccounts, selectedDecibelSubaccount]);

  // Default subaccount selection. Priority:
  //   1. On-chain DN record's subaccount (= last / currently traded)
  //   2. Active subaccount that is delegated AND has builder-fee approved at the
  //      required cap (= ready to trade right now without extra signatures)
  // Never selects a subaccount that is missing delegation or builder-fee approval.
  useEffect(() => {
    if (subaccountReadinessLoading) return;
    if (selectedDecibelSubaccountReady) return;

    let next: string | undefined;
    if (deltaNeutral?.recordExists && deltaNeutral.decibelSubaccount) {
      const onChainCanonical = normalizeAddress(deltaNeutral.decibelSubaccount);
      const match = readyDecibelSubaccounts.find(
        (s) => normalizeAddress(s.subaccount_address) === onChainCanonical
      );
      if (match) next = match.subaccount_address;
    }
    if (!next) next = readyDecibelSubaccounts[0]?.subaccount_address;
    if (next) setSelectedDecibelSubaccount(next);
    else if (selectedDecibelSubaccount) setSelectedDecibelSubaccount("");
  }, [
    selectedDecibelSubaccount,
    subaccountReadinessLoading,
    deltaNeutral?.recordExists,
    deltaNeutral?.decibelSubaccount,
    readyDecibelSubaccounts,
    selectedDecibelSubaccountReady,
  ]);
  // Lazy-loaded only when the DN history modal is open (it does an indexer
  // scan + N fullnode fetches, so we don't want to pay that price on every
  // page render).
  const {
    data: deltaNeutralHistory,
    isLoading: deltaNeutralHistoryLoading,
    error: deltaNeutralHistoryError,
  } = useDeltaNeutralHistory(safeAddr ?? undefined, {
    // Also fetch while a position is open (not just when the history modal is
    // up) so the technical-details panel can link the record_open tx of the
    // current position.
    enabled:
      isDeltaNeutralStrategy &&
      Boolean(safeAddr) &&
      (showHistoryModal || Boolean(deltaNeutral?.isOpen)),
    limit: 100,
  });

  // The on-chain deal that is currently open (no record_close yet). Used by
  // the history modal (highlight block) and the technical-details tx links.
  const currentOpenDeal = useMemo(() => {
    if (!deltaNeutral?.isOpen) return null;
    const deals = deltaNeutralHistory?.deals ?? [];
    return deals.find((d) => d.close == null) ?? null;
  }, [deltaNeutral?.isOpen, deltaNeutralHistory]);

  const {
    data: stablecoinOps,
    isLoading: stablecoinOpsLoading,
    error: stablecoinOpsError,
  } = useYieldAiStablecoinCompoundHistory(safeAddr ?? undefined, {
    enabled: showHistoryModal && !isDeltaNeutralStrategy && Boolean(safeAddr),
    limit: 200,
  });
  const { data: decibelPositions = [], isLoading: decibelPositionsLoading } = useDecibelUserPositions(walletAddress);

  const openPositionAsset = useMemo<"BTC" | "APT" | null>(() => {
    if (!deltaNeutral?.recordExists || !deltaNeutral.isOpen) return null;
    const spot = normalizeAddress(deltaNeutral.spotAssetMetadata);
    if (isDecibelBtcSpotMetadata(spot)) return "BTC";
    if (spot === normalizeAddress(APT_FA_METADATA_MAINNET)) return "APT";
    return null;
  }, [deltaNeutral?.recordExists, deltaNeutral?.isOpen, deltaNeutral?.spotAssetMetadata]);

  useEffect(() => {
    let cancelled = false;
    async function loadFunding() {
      if (!openPositionAsset) {
        setOpenPositionFundingApr24h(null);
        return;
      }
      const r = await fetchFundingApr(`${openPositionAsset}/USD`, "24h");
      if (cancelled) return;
      setOpenPositionFundingApr24h(r?.avg_yearly_apr_pct ?? null);
    }
    void loadFunding();
    return () => {
      cancelled = true;
    };
  }, [openPositionAsset]);

  const {
    modalRows: echelonModalRows,
    totalValue: echelonTotalValue,
    rewardsValueUsd: echelonRewardsValueUsd,
    isLoading: echelonLoading,
    echelonRewardRows,
  } = useEchelonProtocolCardModel(safeAddr ?? undefined, {
    enabled: Boolean(safeAddr),
    refetchOnMount: "always",
  });

  const { data: echelonPoolsResp } = useEchelonPools({ enabled: Boolean(safeAddr) });
  const echelonAprByMarketObj = useMemo(() => {
    const pools = echelonPoolsResp?.data ?? [];
    const map = new Map<
      string,
      {
        supplyApr: number;
        supplyBaseApr: number;
        borrowApr: number;
        borrowBaseApr: number;
        supplyRewardsApr: number;
        borrowRewardsApr: number;
      }
    >();
    for (const p of pools) {
      if (!p.marketAddress) continue;
      const key = normalizeAddress(p.marketAddress);
      // `/api/protocols/echelon/v2/pools` returns APRs in percent units already.
      // Supply:
      // - `depositApy` is total (base + rewards).
      // - `totalSupplyApr` is base (lending + staking), without rewards.
      // - `supplyRewardsApr` is rewards-only.
      const supplyApr = p.depositApy ?? 0;
      const supplyBaseApr = p.totalSupplyApr ?? 0;
      // Borrow:
      // - `borrowAPY` is base borrow APR (without rewards).
      // - `borrowRewardsApr` is rewards-only.
      const borrowBaseApr = p.borrowAPY ?? 0;
      const borrowApr = borrowBaseApr + (p.borrowRewardsApr ?? 0);
      map.set(key, {
        supplyApr,
        supplyBaseApr,
        borrowApr,
        borrowBaseApr,
        supplyRewardsApr: p.supplyRewardsApr ?? 0,
        borrowRewardsApr: p.borrowRewardsApr ?? 0,
      });
    }
    return map;
  }, [echelonPoolsResp?.data]);

  const reloadSafeData = useCallback(async () => {
    // Managed positions uses cached data from sidebar when available.
    // This method keeps the existing refreshPositions event wiring intact by invalidating queries.
    if (!walletAddress) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.safes(walletAddress) });
    if (safeAddr) {
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.safeTokens(safeAddr) });
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.deltaNeutralState(safeAddr) });
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.hyperionLpPositions(safeAddr) });
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.echelon.userPositions(safeAddr) });
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.echelon.rewards(safeAddr) });
    }
    if (walletAddress) {
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.decibel.userPositions(walletAddress) });
    }
  }, [queryClient, walletAddress, safeAddr]);




  const handleExecutorOpenShort = async () => {
    if (!account?.address) {
      toast({
        title: "Wallet not connected",
        description: "Connect your wallet to continue.",
        variant: "destructive",
      });
      return;
    }
    if (!primaryDecibelSubaccount) {
      toast({
        title: "Subaccount required",
        description: "No active Decibel subaccount found.",
        variant: "destructive",
      });
      return;
    }
    const sizeUsd = Number(executorSizeUsd);
    if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) {
      toast({
        title: "Invalid size",
        description: "Enter a valid USD size.",
        variant: "destructive",
      });
      return;
    }
    try {
      setExecutorSubmitting(true);
      const auth = await signManageAction("decibel_open_short", {
        subaccount: primaryDecibelSubaccount,
        asset: executorAsset,
        sizeUsd,
      });
      const response = await fetch("/api/protocols/decibel/executor-open-short", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: account.address.toString(),
          subaccount: primaryDecibelSubaccount,
          asset: executorAsset,
          sizeUsd,
          auth,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.success) {
        throw new Error(json?.error || "Failed to open short via executor");
      }

      const hash = json?.data?.openTxHash as string | undefined;
      setExecutorHedgeHint({ sizeUsd, asset: executorAsset });
      toast({
        title: "Executor short opened",
        description: hash
          ? `${executorAsset} short 1x submitted: ${hash.slice(0, 6)}...${hash.slice(-4)}`
          : `${executorAsset} short 1x submitted.`,
      });
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "decibel" } }));
      }, 1500);
    } catch (err) {
      toast({
        title: "Executor short failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setExecutorSubmitting(false);
    }
  };

  const handleExecutorOpenDeltaNeutral = async () => {
    if (!account?.address) {
      toast({
        title: "Wallet not connected",
        description: "Connect your wallet to continue.",
        variant: "destructive",
      });
      return;
    }
    if (!safeAddr) {
      toast({
        title: "Safe not found",
        description: "Create a safe first (AI agent wallet).",
        variant: "destructive",
      });
      return;
    }
    if (!selectedDecibelSubaccount) {
      toast({
        title: "Subaccount required",
        description: "Select an active Decibel subaccount.",
        variant: "destructive",
      });
      return;
    }
    const sizeUsd = Number(executorSizeUsd);
    if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) {
      toast({
        title: "Invalid size",
        description: "Enter a valid USD size.",
        variant: "destructive",
      });
      return;
    }

    // LP-hedge variant: open a Hyperion LP (APT/USDC or WBTC/USDC) + short the base leg on Decibel.
    if (dnHedgeMode === "lp") {
      if (sizeUsd < 10) {
        toast({ title: "Invalid size", description: "Minimum LP size is 10 USDC.", variant: "destructive" });
        return;
      }
      const rangePct = Number(lpRangePct);
      if (!Number.isFinite(rangePct) || rangePct < 1 || rangePct > 95) {
        toast({ title: "Invalid range", description: "Range must be between 1% and 95%.", variant: "destructive" });
        return;
      }
      if (safeUsdcBalance + 1e-9 < sizeUsd) {
        toast({
          title: "Not enough USDC in safe",
          description: `LP needs ${sizeUsd.toFixed(2)} USDC; the safe has ${safeUsdcBalance.toFixed(2)} USDC.`,
          variant: "destructive",
        });
        return;
      }
      try {
        setExecutorSubmitting(true);
        setOpenDeltaNeutralResult(null);
        setOpenDeltaNeutralModalOpen(true);
        const auth = await signManageAction("decibel_dn_lp_open", {
          safeAddress: safeAddr,
          subaccount: selectedDecibelSubaccount,
          poolKey: lpPoolKey,
          sizeUsd,
          rangePct,
        });
        const usdcAmountInBaseUnits = BigInt(Math.round(sizeUsd * 1e6)).toString();
        const response = await fetch("/api/protocols/decibel/executor-open-delta-neutral", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "lp",
            owner: account.address.toString(),
            subaccount: selectedDecibelSubaccount,
            safeAddress: safeAddr,
            usdcAmountInBaseUnits,
            rangePct,
            poolKey: lpPoolKey,
            auth,
          }),
        });
        const json = await response.json();
        if (!response.ok || !json?.success) {
          throw new Error(json?.error || "Failed to open LP delta-neutral via executor");
        }
        const d = json?.data ?? {};
        setOpenDeltaNeutralResult({
          success: true,
          openTxHash: d.openTxHash ?? null,
          swapTxHash: null,
          recordOpenTxHash: d.openCycleTxHash ?? null,
        });
        toast({
          title: "LP delta-neutral opened",
          description: `${lpPoolKey === "wbtc_usdc" ? "WBTC/USDC LP + BTC" : "APT/USDC LP + APT"} short submitted (cycle #${d.cycleId ?? "?"}).`,
        });
        if (safeAddr) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.deltaNeutralCycles(safeAddr) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.safeTokens(safeAddr) });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setOpenDeltaNeutralResult({ success: false, error: msg });
        toast({ title: "LP delta-neutral open failed", description: msg, variant: "destructive" });
      } finally {
        setExecutorSubmitting(false);
      }
      return;
    }

    if (sizeUsd < 10) {
      toast({
        title: "Invalid size",
        description: "Minimum trade size is 10 USDC.",
        variant: "destructive",
      });
      return;
    }
    if (safeUsdcBalance <= 1e-9) {
      toast({
        title: "Safe USDC required",
        description: "Deposit USDC to the AI agent safe before opening a delta-neutral position.",
        variant: "destructive",
      });
      return;
    }
    if (
      deltaNeutralOpenPreview?.bufferedUsdcInUsd != null &&
      !isSpotHedgeFundingAcceptableUsd(safeUsdcBalance, deltaNeutralOpenPreview.bufferedUsdcInUsd)
    ) {
      toast({
        title: "Not enough USDC in safe",
        description: `Spot hedge needs ${deltaNeutralOpenPreview.bufferedUsdcInUsd.toFixed(6)} USDC, but the safe has ${safeUsdcBalance.toFixed(6)} USDC.`,
        variant: "destructive",
      });
      return;
    }
    if (Number.isFinite(maxSizeUsd) && sizeUsd - maxSizeUsd > 1e-9) {
      toast({
        title: "Size too large",
        description: `Max allowed size is ${maxSizeUsd.toFixed(2)} USDC (min of safe USDC and Decibel available).`,
        variant: "destructive",
      });
      return;
    }
    try {
      setExecutorSubmitting(true);
      setOpenDeltaNeutralResult(null);
      setOpenDeltaNeutralModalOpen(true);
      const auth = await signManageAction("decibel_dn_open", {
        safeAddress: safeAddr,
        subaccount: selectedDecibelSubaccount,
        asset: executorAsset,
        sizeUsd,
      });
      const response = await fetch("/api/protocols/decibel/executor-open-delta-neutral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: account.address.toString(),
          subaccount: selectedDecibelSubaccount,
          safeAddress: safeAddr,
          asset: executorAsset,
          sizeUsd,
          auth,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.success) {
        throw new Error(json?.error || "Failed to open delta-neutral via executor");
      }
      const openHash = json?.data?.openTxHash as string | undefined;
      const swapHash = json?.data?.swapTxHash as string | undefined;
      const recordOpenHash = json?.data?.recordOpenTxHash as string | undefined;

      setOpenDeltaNeutralResult({
        success: true,
        openTxHash: openHash ?? null,
        swapTxHash: swapHash ?? null,
        recordOpenTxHash: recordOpenHash ?? null,
      });
      setExecutorHedgeHint(null);
      toast({
        title: "Delta-neutral opened",
        description: `${executorAsset} short + safe swap submitted.`,
      });
      if (safeAddr) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.deltaNeutralState(safeAddr) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.deltaNeutralCycles(safeAddr) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.safeTokens(safeAddr) });
      }
      if (walletAddress) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.protocols.decibel.userPositions(walletAddress) });
      }
      if (selectedDecibelSubaccount) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.protocols.decibel.accountBalance(selectedDecibelSubaccount),
        });
      }
      // Re-fetch once more shortly after — the new cycle's views/extras may lag the open response.
      setTimeout(() => {
        if (safeAddr) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.deltaNeutralCycles(safeAddr) });
        }
        window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "decibel" } }));
        window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "yield-ai" } }));
      }, 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setOpenDeltaNeutralResult({ success: false, error: msg });
      toast({
        title: "Delta-neutral open failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setExecutorSubmitting(false);
    }
  };

  const handleExecutorCloseDeltaNeutral = async (opts?: { force?: boolean }) => {
    const force = opts?.force === true;
    if (!account?.address || !safeAddr || !deltaNeutral?.isOpen) {
      toast({
        title: "Cannot close",
        description: "Missing wallet, safe, or no open delta-neutral record.",
        variant: "destructive",
      });
      return;
    }
    try {
      setCloseDeltaNeutralSubmitting(true);
      setCloseDeltaNeutralResult(null);
      setCloseDeltaNeutralForceMode(force);
      const auth = await signManageAction("decibel_dn_close", {
        safeAddress: safeAddr,
        subaccount: deltaNeutral.decibelSubaccount,
        asset: executorAsset,
        force,
      });
      const response = await fetch("/api/protocols/decibel/executor-close-delta-neutral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: account.address.toString(),
          subaccount: deltaNeutral.decibelSubaccount,
          safeAddress: safeAddr,
          asset: executorAsset,
          force,
          auth,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.success) {
        // Surface the structured daily-limit error so the result view can
        // render a friendly explanation instead of "Move abort 0x8".
        if (
          json?.code === "DAILY_LIMIT_EXHAUSTED" ||
          json?.code === "DAILY_LIMIT_EXCEEDED"
        ) {
          const d = json.data ?? {};
          setCloseDeltaNeutralResult({
            success: false,
            error: json.error || "Daily limit reached",
            dailyLimit: {
              code: json.code,
              maxDailyUsdc: d.maxDailyUsdc ?? null,
              maxPerTxUsdc: d.maxPerTxUsdc ?? null,
              spentTodayUsdc: d.spentTodayUsdc ?? null,
              remainingUsdc: d.remainingUsdc ?? null,
              secondsUntilRollover: d.secondsUntilRollover ?? null,
            },
          });
          toast({
            title: "Daily limit reached",
            description:
              "The AI agent safe has hit its daily swap cap. Try again after the next UTC midnight.",
            variant: "destructive",
          });
          return;
        }
        throw new Error(json?.error || "Failed to close delta-neutral via executor");
      }
      setCloseDeltaNeutralResult({
        success: true,
        closeTxHash: json?.data?.closeTxHash ?? null,
        swapTxHash: json?.data?.swapTxHash ?? null,
        swapSkippedReason: json?.data?.swapSkippedReason ?? null,
        recordCloseTxHash: json?.data?.recordCloseTxHash ?? null,
      });
      toast({
        title: "Delta-neutral closed",
        description: "Decibel short reduced, safe swap, and on-chain record updated.",
      });
      if (safeAddr) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.deltaNeutralState(safeAddr) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.safeTokens(safeAddr) });
      }
      if (walletAddress) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.protocols.decibel.userPositions(walletAddress) });
      }
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "decibel" } }));
        window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "yield-ai" } }));
      }, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setCloseDeltaNeutralResult({ success: false, error: msg });
      toast({
        title: "Delta-neutral close failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setCloseDeltaNeutralSubmitting(false);
    }
  };

  // Close a single strategy_journal cycle (post-migration DN position). Resolves the market from
  // the cycle on the server, so the asset field is only part of the signed authorization.
  const handleRehedgeCycle = async (cycle: { cycleId: string; asset: "BTC" | "APT" }) => {
    if (!account?.address || !safeAddr || !selectedDecibelSubaccount) {
      toast({
        title: "Cannot rehedge",
        description: "Connect the owner wallet, a safe, and an active Decibel subaccount.",
        variant: "destructive",
      });
      return;
    }
    try {
      setRehedgingCycleId(cycle.cycleId);
      const auth = await signManageAction("decibel_dn_rehedge", {
        safeAddress: safeAddr,
        subaccount: selectedDecibelSubaccount,
        cycleId: cycle.cycleId,
      });
      const res = await fetch("/api/protocols/decibel/executor-rehedge-delta-neutral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: account.address.toString(),
          safeAddress: safeAddr,
          subaccount: selectedDecibelSubaccount,
          cycleId: cycle.cycleId,
          auth,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || "Rehedge failed");
      const d = json.data ?? {};
      const dAbs = Number(d.deltaApt);
      const dec = cycle.asset === "BTC" ? 6 : 2;
      toast({
        title:
          d.action === "in-band"
            ? "Already balanced"
            : d.action === "margin-skip"
              ? "Rehedge skipped"
              : "Rehedged",
        description:
          d.action === "in-band"
            ? `Delta within band${Number.isFinite(dAbs) ? ` (Δ ${dAbs.toFixed(dec)} ${cycle.asset})` : ""}.`
            : d.action === "margin-skip"
              ? String(d.note || "Not enough free margin to grow the short.")
              : `${d.action === "grow-short" ? "Grew" : "Reduced"} short by ${Number(d.adjustedApt).toFixed(dec)} ${cycle.asset}.`,
      });
      if (safeAddr) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.deltaNeutralCycles(safeAddr) });
      }
    } catch (err) {
      toast({
        title: "Rehedge failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRehedgingCycleId(null);
    }
  };

  const handleCloseCycle = async (cycle: { cycleId: string; marketName: string | null }) => {
    if (!account?.address || !safeAddr || !selectedDecibelSubaccount) {
      toast({
        title: "Cannot close",
        description: "Missing wallet, safe, or Decibel subaccount.",
        variant: "destructive",
      });
      return;
    }
    const asset: "BTC" | "APT" = baseSymbolOfMarket(cycle.marketName) === "APT" ? "APT" : "BTC";
    try {
      setClosingCycleId(cycle.cycleId);
      // Field order must mirror the server (assertOwnerManageAuth): safeAddress, subaccount, asset, force, cycleId.
      const auth = await signManageAction("decibel_dn_close", {
        safeAddress: safeAddr,
        subaccount: selectedDecibelSubaccount,
        asset,
        force: false,
        cycleId: cycle.cycleId,
      });
      const response = await fetch("/api/protocols/decibel/executor-close-delta-neutral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: account.address.toString(),
          subaccount: selectedDecibelSubaccount,
          safeAddress: safeAddr,
          asset,
          force: false,
          cycleId: cycle.cycleId,
          auth,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.success) {
        throw new Error(json?.error || "Failed to close delta-neutral cycle");
      }
      toast({
        title: "Delta-neutral cycle closed",
        description: `Cycle #${cycle.cycleId} closed: Decibel short reduced, spot swapped, journal updated.`,
      });
      if (safeAddr) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.deltaNeutralCycles(safeAddr) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.deltaNeutralState(safeAddr) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.safeTokens(safeAddr) });
      }
      if (walletAddress) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.protocols.decibel.userPositions(walletAddress) });
      }
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "decibel" } }));
        window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "yield-ai" } }));
      }, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Cycle close failed", description: msg, variant: "destructive" });
    } finally {
      setClosingCycleId(null);
    }
  };

  // Add (top up) an existing LP-DN cycle with USDC: swap the range split USDC→base, dual-add into
  // the cycle's OWN LP range, grow the short to the new live base (margin-guarded) — one
  // LIQUIDITY_ADD journal action. Private beta, same allowlist as LP open (server-enforced).
  const handleExecutorAddLpDeltaNeutral = async (cycleId: string, sizeUsd: number) => {
    if (!account?.address || !safeAddr || !selectedDecibelSubaccount) {
      toast({ title: "Cannot add", description: "Missing wallet, safe, or Decibel subaccount.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(sizeUsd) || sizeUsd < 10) {
      toast({ title: "Invalid size", description: "Minimum add size is 10 USDC.", variant: "destructive" });
      return;
    }
    if (safeUsdcBalance + 1e-9 < sizeUsd) {
      toast({
        title: "Not enough USDC in safe",
        description: `Add needs ${sizeUsd.toFixed(2)} USDC; the safe has ${safeUsdcBalance.toFixed(2)} USDC.`,
        variant: "destructive",
      });
      return;
    }
    try {
      setExecutorSubmitting(true);
      const usdcAmountInBaseUnits = BigInt(Math.round(sizeUsd * 1e6)).toString();
      const auth = await signManageAction("decibel_dn_lp_add", {
        safeAddress: safeAddr,
        subaccount: selectedDecibelSubaccount,
        cycleId,
        usdcAmountInBaseUnits,
      });
      const response = await fetch("/api/protocols/decibel/executor-add-delta-neutral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "lp",
          owner: account.address.toString(),
          safeAddress: safeAddr,
          subaccount: selectedDecibelSubaccount,
          cycleId,
          usdcAmountInBaseUnits,
          auth,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.success) {
        throw new Error(json?.error || "Failed to add to the LP delta-neutral position");
      }
      const d = json?.data ?? {};
      const shortAction = d?.shortAdjust?.action;
      toast({
        title: "Added to LP-DN position",
        description:
          shortAction === "margin-skip"
            ? `LP grew by ~$${(Number(d.lpAddedValueUsdc ?? 0) / 1e6).toFixed(2)}, but the short could NOT grow (no free margin) — top up Decibel margin, the position runs under-hedged until then.`
            : `Cycle #${cycleId}: LP +$${(Number(d.lpAddedValueUsdc ?? 0) / 1e6).toFixed(2)}, short resized to match.`,
        ...(shortAction === "margin-skip" ? { variant: "destructive" as const } : {}),
      });
      setAddTarget(null);
      setAddSizeUsd("");
      if (safeAddr) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.deltaNeutralCycles(safeAddr) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.safeTokens(safeAddr) });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "LP-DN add failed", description: msg, variant: "destructive" });
    } finally {
      setExecutorSubmitting(false);
    }
  };

  // Add (top up) an existing journal cycle: increase the short + buy matching spot, recorded as
  // a LIQUIDITY_ADD action. Only journal-backed positions can be topped up (legacy has no add).
  const handleExecutorAddDeltaNeutral = async (cycleId: string, asset: "BTC" | "APT", sizeUsd: number) => {
    if (!account?.address || !safeAddr || !selectedDecibelSubaccount) {
      toast({ title: "Cannot add", description: "Missing wallet, safe, or Decibel subaccount.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(sizeUsd) || sizeUsd < 10) {
      toast({ title: "Invalid size", description: "Minimum add size is 10 USDC.", variant: "destructive" });
      return;
    }
    try {
      setExecutorSubmitting(true);
      // Field order must mirror the server: safeAddress, subaccount, asset, sizeUsd, cycleId.
      const auth = await signManageAction("decibel_dn_add", {
        safeAddress: safeAddr,
        subaccount: selectedDecibelSubaccount,
        asset,
        sizeUsd,
        cycleId,
      });
      const response = await fetch("/api/protocols/decibel/executor-add-delta-neutral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: account.address.toString(),
          subaccount: selectedDecibelSubaccount,
          safeAddress: safeAddr,
          asset,
          sizeUsd,
          cycleId,
          auth,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.success) {
        throw new Error(json?.error || "Failed to add to delta-neutral position");
      }
      toast({ title: "Added to position", description: `Cycle #${cycleId}: short increased + spot bought.` });
      setAddTarget(null);
      setAddSizeUsd("");
      if (safeAddr) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.deltaNeutralCycles(safeAddr) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.safeTokens(safeAddr) });
      }
      if (walletAddress) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.protocols.decibel.userPositions(walletAddress) });
      }
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "decibel" } }));
        window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "yield-ai" } }));
      }, 1500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Add failed", description: msg, variant: "destructive" });
    } finally {
      setExecutorSubmitting(false);
    }
  };

  const aptosTxnHashExplorerUrl = (hash?: string | null): string | null =>
    hash ? `https://explorer.aptoslabs.com/txn/${hash}?network=mainnet` : null;

  const forceRefreshDeltaNeutralState = () => {
    if (safeAddr) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.deltaNeutralState(safeAddr) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.safeTokens(safeAddr) });
    }
    if (walletAddress) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.protocols.decibel.userPositions(walletAddress) });
    }
    if (selectedDecibelSubaccount) {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.decibel.accountBalance(selectedDecibelSubaccount),
      });
    }
    window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "decibel" } }));
    window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "yield-ai" } }));
  };

  const handleConvertStaleApt = async () => {
    if (!account?.address || !safeAddr) {
      toast({
        title: "Cannot convert",
        description: "Connect a wallet and select a safe.",
        variant: "destructive",
      });
      return;
    }
    try {
      setConvertStaleAptSubmitting(true);
      const auth = await signManageAction("decibel_dn_residual_swap", {
        safeAddress: safeAddr,
        subaccount: null,
        spotMetadata: APT_FA_METADATA_MAINNET,
      });
      const response = await fetch("/api/protocols/decibel/executor-swap-delta-neutral-residual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: account.address.toString(),
          safeAddress: safeAddr,
          spotMetadata: APT_FA_METADATA_MAINNET,
          auth,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.success) {
        throw new Error(json?.error || "Failed to convert APT to USDC");
      }
      const swapHash = json?.data?.swapTxHash as string | undefined;
      const amt = json?.data?.spotSwapAmountInBaseUnits as string | undefined;
      setConvertStaleAptOpen(false);
      toast({
        title: "APT → USDC swap submitted",
        description:
          (amt ? `Amount (base units): ${amt}. ` : "") +
          (swapHash ? `Tx: ${swapHash.slice(0, 10)}…${swapHash.slice(-6)}` : ""),
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.safeTokens(safeAddr) });
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "yield-ai" } }));
      }, 1500);
    } catch (err) {
      toast({
        title: "Convert APT failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setConvertStaleAptSubmitting(false);
    }
  };

  const handleConvertStaleXbtc = async () => {
    if (!account?.address || !safeAddr) {
      toast({
        title: "Cannot convert",
        description: "Connect a wallet and select a safe.",
        variant: "destructive",
      });
      return;
    }
    const staleBtc = selectedStaleBtc ?? {
      metadata: XBTC_FA_METADATA_MAINNET,
      label: "xBTC",
      baseUnits: safeXbtcBaseUnits,
    };
    try {
      setConvertStaleXbtcSubmitting(true);
      const auth = await signManageAction("decibel_dn_residual_swap", {
        safeAddress: safeAddr,
        subaccount: null,
        spotMetadata: staleBtc.metadata,
      });
      const response = await fetch("/api/protocols/decibel/executor-swap-delta-neutral-residual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: account.address.toString(),
          safeAddress: safeAddr,
          spotMetadata: staleBtc.metadata,
          auth,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.success) {
        throw new Error(json?.error || `Failed to convert ${staleBtc.label} to USDC`);
      }
      const swapHash = json?.data?.swapTxHash as string | undefined;
      const amt = json?.data?.spotSwapAmountInBaseUnits as string | undefined;
      setConvertStaleXbtcOpen(false);
      toast({
        title: `${staleBtc.label} -> USDC swap submitted`,
        description:
          (amt ? `Amount (base units): ${amt}. ` : "") +
          (swapHash ? `Tx: ${swapHash.slice(0, 10)}…${swapHash.slice(-6)}` : ""),
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.safeTokens(safeAddr) });
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "yield-ai" } }));
      }, 1500);
    } catch (err) {
      toast({
        title: `Convert ${staleBtc.label} failed`,
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setConvertStaleXbtcSubmitting(false);
    }
  };

  const handleExecutorSwapDeltaNeutralResidual = async () => {
    if (!account?.address || !safeAddr || !deltaNeutral?.recordExists || deltaNeutral.isOpen) {
      toast({
        title: "Cannot swap",
        description: "Missing wallet, safe, or position is not in a closed state.",
        variant: "destructive",
      });
      return;
    }
    try {
      setSwapResidualSubmitting(true);
      const auth = await signManageAction("decibel_dn_residual_swap", {
        safeAddress: safeAddr,
        subaccount: deltaNeutral.decibelSubaccount,
        spotMetadata: null,
      });
      const response = await fetch("/api/protocols/decibel/executor-swap-delta-neutral-residual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: account.address.toString(),
          subaccount: deltaNeutral.decibelSubaccount,
          safeAddress: safeAddr,
          auth,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.success) {
        throw new Error(json?.error || "Failed to swap residual spot via executor");
      }
      const swapHash = json?.data?.swapTxHash as string | undefined;
      const amt = json?.data?.spotSwapAmountInBaseUnits as string | undefined;
      setSwapResidualOpen(false);
      toast({
        title: "Residual spot swap submitted",
        description:
          (amt ? `Amount (base units): ${amt}. ` : "") +
          (swapHash ? `Tx: ${swapHash.slice(0, 10)}…${swapHash.slice(-6)}` : ""),
      });
      if (safeAddr) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.deltaNeutralState(safeAddr) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.safeTokens(safeAddr) });
      }
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "yield-ai" } }));
      }, 1500);
    } catch (err) {
      toast({
        title: "Residual swap failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSwapResidualSubmitting(false);
    }
  };

  const deltaNeutralPerpRow = useMemo(() => {
    if (!deltaNeutral?.recordExists || !deltaNeutral.isOpen) return null;
    const m = normalizeAddress(deltaNeutral.perpMarket);
    const u = normalizeAddress(deltaNeutral.decibelSubaccount);
    return (
      decibelPositions.find(
        (p) =>
          normalizeAddress(String(p.user || "")) === u &&
          normalizeAddress(String(p.market || "")) === m &&
          Number(p.size) < 0
      ) ?? null
    );
  }, [deltaNeutral, decibelPositions]);

  // Live Decibel mark + current funding rate for the recorded perp market.
  const perpMarketAddr = deltaNeutral?.recordExists ? deltaNeutral.perpMarket : undefined;
  const { data: decibelMarketPrice } = useDecibelMarketPrice(perpMarketAddr);

  // Position window for realized PnL / fees / cumulative funding since open.
  const positionWindow = useMemo(() => {
    if (!deltaNeutral?.recordExists) return null;
    const openedAtSec = Number(deltaNeutral.openedAt || "0");
    if (!Number.isFinite(openedAtSec) || openedAtSec <= 0) return null;
    const fromUnixMs = openedAtSec * 1000;
    if (deltaNeutral.isOpen) {
      return { fromUnixMs, toUnixMs: null as number | null };
    }
    const closedAtSec = Number(deltaNeutral.closedAt || "0");
    // +2 min buffer — close settlement events can land slightly after the registry timestamp.
    const toUnixMs = closedAtSec > 0 ? closedAtSec * 1000 + 120_000 : Date.now();
    return { fromUnixMs, toUnixMs };
  }, [deltaNeutral]);

  const { data: decibelLedger } = useDecibelPositionLedger({
    subaccount: deltaNeutral?.decibelSubaccount,
    market: deltaNeutral?.perpMarket,
    fromUnixMs: positionWindow?.fromUnixMs,
    toUnixMs: positionWindow?.toUnixMs ?? null,
    enabled: Boolean(deltaNeutral?.recordExists && positionWindow),
  });

  const deltaNeutralSpotToken = useMemo(() => {
    if (!deltaNeutral?.spotAssetMetadata) return null;
    const sm = normalizeAddress(deltaNeutral.spotAssetMetadata);
    // APT special-case: DN record stores 0xa, but useYieldAiSafeTokens keys APT
    // under APTOS_COIN_TYPE (coin form) via the coin::balance fallback.
    if (sm === normalizeAddress(APT_FA_METADATA_MAINNET)) {
      return (
        tokens.find(
          (t) => t.address === APTOS_COIN_TYPE || normalizeAddress(t.address) === sm
        ) ?? null
      );
    }
    return tokens.find((t) => normalizeAddress(t.address) === sm) ?? null;
  }, [deltaNeutral, tokens]);

  const filledShortHumanOnChain = useMemo(() => {
    if (!deltaNeutral?.filledShortSize) return null;
    try {
      const sz = deltaNeutral.szDecimals ?? 8;
      const n = decibelChainUnitsToHumanBase(BigInt(deltaNeutral.filledShortSize), sz);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }, [deltaNeutral]);

  const deltaNeutralIndexerSpotBase = useMemo(() => {
    if (!deltaNeutral?.spotBalanceBaseUnits) return BigInt(0);
    try {
      return BigInt(deltaNeutral.spotBalanceBaseUnits);
    } catch {
      return BigInt(0);
    }
  }, [deltaNeutral?.spotBalanceBaseUnits]);

  const deltaNeutralSpotTokenHuman = useMemo(() => {
    if (!deltaNeutralSpotToken) return 0;
    const raw = parseFloat(deltaNeutralSpotToken.amount || "0");
    const d = deltaNeutralSpotToken.decimals ?? 8;
    if (!Number.isFinite(raw)) return 0;
    return raw / Math.pow(10, d);
  }, [deltaNeutralSpotToken]);

  /**
   * Route reads indexer + on-chain primary store and uses the larger value, so we enable
   * the button as long as either source reports a positive balance.
   */
  const deltaNeutralResidualSwapUsable =
    deltaNeutralIndexerSpotBase > BigInt(0) || deltaNeutralSpotTokenHuman > 0;

  const deltaNeutralResidualSwapVisible = Boolean(
    deltaNeutral?.recordExists && !deltaNeutral.isOpen && deltaNeutralResidualSwapUsable
  );

  // Legacy single-position card retired: all DN positions (legacy record + journal cycles) now
  // render in the unified list below. Kept as a flag (not deleted) to hide the old card cleanly.
  const showDeltaNeutralCard = false;

  // No initial fetch here: safe and token data are via useQuery (cached).


  useEffect(() => {
    const handleRefresh: EventListener = (evt) => {
      const event = evt as CustomEvent<{ protocol: string }>;
      if (event?.detail?.protocol === "yield-ai" || event?.detail?.protocol === "echelon") {
        void reloadSafeData();
      }
    };
    window.addEventListener("refreshPositions", handleRefresh);
    return () => window.removeEventListener("refreshPositions", handleRefresh);
  }, [reloadSafeData]);

  const handleTogglePause = async () => {
    if (!safeAddr || !signAndSubmitTransaction) return;
    setIsPauseToggling(true);
    const newPaused = !isPaused;
    try {
      const payload = buildSetSafePausedPayload(safeAddr, newPaused);
      await signAndSubmitTransaction({
        data: {
          function: payload.function as `${string}::${string}::${string}`,
          typeArguments: payload.typeArguments,
          functionArguments: payload.functionArguments,
        },
      });
      queryClient.setQueryData(queryKeys.protocols.yieldAi.safePaused(safeAddr), newPaused);
      toast({
        title: newPaused ? "Agent paused" : "Agent resumed",
        description: newPaused
          ? "Rebalancing stopped. Withdrawals still work."
          : "Agent will resume rebalancing on next cycle.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      toast({ title: newPaused ? "Pause failed" : "Resume failed", description: msg, variant: "destructive" });
    } finally {
      setIsPauseToggling(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.safePaused(safeAddr) });
    }
  };

  // Pre-fill the limits dialog from the current on-chain config and open it.
  const openLimitsDialog = () => {
    const usdFromBaseUnits = (raw: string | undefined) =>
      raw ? String(Number(BigInt(raw)) / 1_000_000) : "";
    setLimitPerTxInput(usdFromBaseUnits(vaultFaSwapLimits?.maxPerTxUsdc));
    setLimitDailyInput(usdFromBaseUnits(vaultFaSwapLimits?.maxDailyUsdc));
    setShowLimitsDialog(true);
  };

  // The swap-limits query may resolve after the dialog opens (or after the
  // dropdown prefill ran before data was ready). Backfill empty inputs once
  // the on-chain config arrives, without clobbering anything the user typed.
  useEffect(() => {
    if (!showLimitsDialog || !vaultFaSwapLimits?.exists) return;
    const usdFromBaseUnits = (raw: string | undefined) =>
      raw ? String(Number(BigInt(raw)) / 1_000_000) : "";
    setLimitPerTxInput((prev) =>
      prev === "" ? usdFromBaseUnits(vaultFaSwapLimits.maxPerTxUsdc) : prev
    );
    setLimitDailyInput((prev) =>
      prev === "" ? usdFromBaseUnits(vaultFaSwapLimits.maxDailyUsdc) : prev
    );
  }, [showLimitsDialog, vaultFaSwapLimits]);

  const handleSetFaSwapLimits = async () => {
    if (!safeAddr || !signAndSubmitTransaction || limitsSubmitting) return;
    const perTx = Number(limitPerTxInput);
    const daily = Number(limitDailyInput);
    if (!Number.isFinite(perTx) || perTx <= 0 || !Number.isFinite(daily) || daily <= 0) {
      toast({
        title: "Invalid limits",
        description: "Both limits must be positive USDC amounts.",
        variant: "destructive",
      });
      return;
    }
    if (daily < perTx) {
      toast({
        title: "Invalid limits",
        description: "Daily limit must be at least the per-transaction limit.",
        variant: "destructive",
      });
      return;
    }
    setLimitsSubmitting(true);
    try {
      const payload = buildSetFaSwapLimitsPayload({
        safeAddress: safeAddr,
        maxPerTxUsdcBaseUnits: BigInt(Math.round(perTx * 1_000_000)),
        maxDailyUsdcBaseUnits: BigInt(Math.round(daily * 1_000_000)),
      });
      await signAndSubmitTransaction({
        data: {
          function: payload.function as `${string}::${string}::${string}`,
          typeArguments: payload.typeArguments,
          functionArguments: payload.functionArguments,
        },
      });
      toast({
        title: "Swap limits updated",
        description: `Per-tx ${formatCurrency(perTx, 2)} · daily ${formatCurrency(daily, 2)}.`,
      });
      setShowLimitsDialog(false);
      // Give the indexer a moment, then refresh the on-chain config.
      setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.protocols.yieldAi.vaultFaSwapLimits(safeAddr),
        });
      }, 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update limits";
      toast({ title: "Update failed", description: msg, variant: "destructive" });
    } finally {
      setLimitsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!safeAddr) {
      setEchelonAdapterAddress(null);
      setEchelonAdapterLoadError(null);
      return;
    }
    let cancelled = false;
    setEchelonAdapterLoadError(null);
    void (async () => {
      try {
        const res = await fetch("/api/protocols/yield-ai/echelon-adapter-address");
        const json = (await res.json()) as { data?: { address?: string }; error?: string };
        if (cancelled) return;
        if (!res.ok || json.error) {
          setEchelonAdapterLoadError(json.error || `HTTP ${res.status}`);
          setEchelonAdapterAddress(null);
          return;
        }
        const addr = json.data?.address;
        if (typeof addr === "string" && addr.length >= 10) {
          setEchelonAdapterAddress(addr);
        } else {
          setEchelonAdapterLoadError("Invalid Echelon adapter address");
          setEchelonAdapterAddress(null);
        }
      } catch (e) {
        if (!cancelled) {
          setEchelonAdapterLoadError(e instanceof Error ? e.message : "Failed to load Echelon adapter");
          setEchelonAdapterAddress(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [safeAddr]);

  const closeEchelonWithdrawDialog = () => {
    setShowEchelonWithdrawConfirm(false);
    setSelectedEchelonWithdrawRow(null);
  };

  const afterEchelonWithdrawSubmitted = (full: boolean) => {
    closeEchelonWithdrawDialog();
    if (safeAddr) {
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.echelon.userPositions(safeAddr) });
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.echelon.rewards(safeAddr) });
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.safeTokens(safeAddr) });
    }
    toast({
      title: full ? "Echelon exit submitted" : "Partial withdraw submitted",
      description: full
        ? "Full position is being withdrawn from Echelon into your AI agent safe."
        : "Requested amount is being withdrawn from Echelon into your AI agent safe. Use Withdraw in the AI agent wallet section to send it to your wallet.",
    });
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "yield-ai" } }));
    }, 2000);
  };

  const handleEchelonWithdrawConfirm = async (amountBaseUnits: bigint, isFull: boolean) => {
    if (!selectedEchelonWithdrawRow || !safeAddr) return;
    if (amountBaseUnits <= 0n) {
      toast({
        title: "Invalid amount",
        description: "Enter a positive amount within the supplied balance.",
        variant: "destructive",
      });
      return;
    }
    const marketObj = toCanonicalAddress(selectedEchelonWithdrawRow.marketObj);

    if (isFull) {
      // Full exit: owner-signed withdraw_all (works even while the agent is paused).
      if (!echelonAdapterAddress) return;
      if (!signAndSubmitTransaction && !effectiveAptosAddress) {
        toast({
          title: "Unsupported wallet",
          description: "Current wallet cannot sign and submit transactions.",
          variant: "destructive",
        });
        return;
      }

      try {
        setIsExecutingEchelonWithdrawToSafe(true);
        const payload = buildVaultExecuteWithdrawAllEchelonFaAsOwnerPayload({
          safeAddress: toCanonicalAddress(safeAddr),
          adapterAddress: toCanonicalAddress(echelonAdapterAddress),
          marketObj,
        });

        const result = await submitAptosTransaction({
          transaction: {
            data: {
              function: payload.function as `${string}::${string}::${string}`,
              typeArguments: payload.typeArguments,
              functionArguments: payload.functionArguments,
            },
            options: { maxGasAmount: 50000 },
          },
          signAndSubmitTransaction: signAndSubmitTransaction as any,
          connected: Boolean(account?.address),
          address: effectiveAptosAddress,
        });

        if (!result?.hash) {
          throw new Error("Transaction was submitted without hash");
        }
        afterEchelonWithdrawSubmitted(true);
      } catch (err) {
        console.error("execute_withdraw_all_echelon_fa_as_owner failed:", err);
        toast({
          title: "Echelon withdraw failed",
          description: err instanceof Error ? err.message : "Transaction failed. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsExecutingEchelonWithdrawToSafe(false);
      }
      return;
    }

    // Partial withdraw: executor-signed vault::execute_withdraw_echelon_fa
    // (the route converts this underlying amount to market shares).
    try {
      setIsExecutingEchelonWithdrawToSafe(true);
      const amountStr = amountBaseUnits.toString();
      const auth = await signManageAction("echelon_partial_withdraw", {
        safeAddress: safeAddr,
        marketObj,
        amountBaseUnits: amountStr,
      });
      const res = await fetch("/api/protocols/yield-ai/echelon-withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          safeAddress: safeAddr,
          marketObj,
          amountBaseUnits: amountStr,
          auth,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: { hash?: string }; error?: string };
      if (!res.ok || json.error) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      afterEchelonWithdrawSubmitted(false);
    } catch (err) {
      console.error("execute_withdraw_echelon_fa failed:", err);
      toast({
        title: "Echelon withdraw failed",
        description: err instanceof Error ? err.message : "Withdraw failed. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsExecutingEchelonWithdrawToSafe(false);
    }
  };

  const handleUsd1ConvertConfirm = async () => {
    if (!safeAddr) return;
    if (isConvertingUsd1ToUsdc) return;
    try {
      setIsConvertingUsd1ToUsdc(true);
      const auth = await signManageAction("usd1_to_usdc_swap", {
        safeAddress: safeAddr,
        amountInBaseUnits: usd1ConvertAmountBaseUnits,
      });
      const res = await fetch("/api/protocols/yield-ai/swap/usd1-to-usdc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          safeAddress: safeAddr,
          amountInBaseUnits: usd1ConvertAmountBaseUnits,
          auth,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: { hash?: string }; error?: string };
      if (!res.ok || json.error) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      toast({
        title: "Conversion submitted",
        description: "USD1 → USDC swap submitted by the executor.",
      });
      setShowUsd1ConvertConfirm(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.safeTokens(safeAddr) });
    } catch (err) {
      console.error("USD1->USDC conversion failed:", err);
      const message = err instanceof Error ? err.message : "Conversion failed";
      toast({
        title: "Conversion failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsConvertingUsd1ToUsdc(false);
    }
  };

  // For Decibel delta-neutral safes we intentionally ignore Echelon rewards in totals:
  // this safe is meant to be "manual" and reward trackers can show stale <$1
  // claimables from past activity, which is confusing in the DN UI.
  const totalRewardsValue = 0;
  const echelonRewardsValueUsdEffective = isDeltaNeutralStrategy ? 0 : echelonRewardsValueUsd;
  const combinedRewardsValue = totalRewardsValue + echelonRewardsValueUsdEffective;
  const REWARDS_SHOW_EPS = 1e-8;
  const hasAnyRewards =
    totalRewardsValue > REWARDS_SHOW_EPS || echelonRewardsValueUsdEffective > REWARDS_SHOW_EPS;
  const includingRewardsLabel =
    combinedRewardsValue > 0 && combinedRewardsValue < 1
      ? "<$1"
      : formatCurrency(combinedRewardsValue, 2);

  // Extract exact USDC amount for onboarding and hedge sufficiency checks.
  const safeUsdcBalance = useMemo(() => {
    const usdcToken = tokens.find(
      (t) =>
        normalizeAddress(t.address) === normalizeAddress(USDC_FA_METADATA_MAINNET) ||
        t.symbol === 'USDC'
    );
    if (!usdcToken) return 0;
    const rawAmount = Number(usdcToken.amount);
    const decimals = usdcToken.decimals ?? 6;
    if (Number.isFinite(rawAmount) && rawAmount >= 0) {
      return rawAmount / 10 ** decimals;
    }
    const fallback = Number(usdcToken.value);
    return Number.isFinite(fallback) && fallback >= 0 ? fallback : 0;
  }, [tokens]);

  const maxSizeUsd = useMemo(() => {
    // Reserve 2.5% + $0.05 on the safe USDC side. Open route stacks several costs above sizeUsd:
    //   - Decibel lot rounding (filledShort rounds UP to lot_size; can exceed requested size by 0.5-1%),
    //   - Hyperion pool fee (~50 bps for feeTier 1, baked into exact-out amountIn),
    //   - INPUT_BUFFER_BPS = 20 bps that we add on top of the quote,
    //   - tick drift between quote and swap-tx (a few blocks).
    // Worst case observed ~2.1% (BTC pool, $42 size). 1% reserve previously failed in production
    // — bumping to 2.5% to cover lot-round + fee + buffer + drift comfortably.
    const safeBudgetForSize = Math.max(0, (safeUsdcBalance - 0.05) / 1.025);
    if (availableToTradeUsdc == null) return safeBudgetForSize;
    return Math.max(0, Math.min(safeBudgetForSize, availableToTradeUsdc));
  }, [availableToTradeUsdc, safeUsdcBalance]);

  // Default the "Open" size to MAX (once) when entering the open-position UI.
  // Do not overwrite if the user has typed any value.
  useEffect(() => {
    if (!isDeltaNeutralStrategy) return;
    if (deltaNeutral?.isOpen) return;
    if (!safeAddr) return;
    if (!selectedDecibelSubaccount) return;
    if (executorSizeDirty) return;
    if (!Number.isFinite(maxSizeUsd) || !(maxSizeUsd > 0)) return;
    const m = Math.max(0, Math.floor(maxSizeUsd * 100) / 100);
    // Avoid pointless state updates (and preserve a user's already-maxed value if present).
    if (executorSizeUsd.trim() === String(m)) return;
    setExecutorSizeUsd(String(m));
  }, [
    isDeltaNeutralStrategy,
    deltaNeutral?.isOpen,
    safeAddr,
    selectedDecibelSubaccount,
    executorSizeDirty,
    maxSizeUsd,
    executorSizeUsd,
  ]);

  // Reset the auto-fill guard when switching safes (new context).
  useEffect(() => {
    setExecutorSizeDirty(false);
  }, [safeAddr]);

  // Stale APT in safe (e.g. leftover after a previous APT-DN cycle when current DN is xBTC).
  // useYieldAiSafeTokens keys APT under APTOS_COIN_TYPE via coin::balance fallback, while the
  // DN record stores 0xa — match either form.
  const safeAptBaseUnits = useMemo(() => {
    const aptToken = tokens.find(
      (t) =>
        t.address === APTOS_COIN_TYPE ||
        normalizeAddress(t.address) === normalizeAddress(APT_FA_METADATA_MAINNET)
    );
    if (!aptToken) return BigInt(0);
    const raw = aptToken.amount;
    if (typeof raw === "string" && /^\d+$/.test(raw)) return BigInt(raw);
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return BigInt(Math.trunc(raw));
    return BigInt(0);
  }, [tokens]);

  // Hide the "convert stale APT" button when APT is the live hedge — server enforces this too.
  const aptIsActiveHedge =
    Boolean(deltaNeutral?.recordExists && deltaNeutral.isOpen) &&
    isApt(deltaNeutral!.spotAssetMetadata);

  // Show only above 0.01 APT (1e6 base units, 8 decimals) — below this, swap fees would dominate.
  const STALE_APT_DUST_BASE_UNITS = BigInt(1_000_000);

  const safeWbtcBaseUnits = useMemo(() => {
    const wbtcToken = tokens.find(
      (t) => normalizeAddress(t.address) === normalizeAddress(WBTC_FA_METADATA_MAINNET)
    );
    if (!wbtcToken) return BigInt(0);
    const raw = wbtcToken.amount;
    if (typeof raw === "string" && /^\d+$/.test(raw)) return BigInt(raw);
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return BigInt(Math.trunc(raw));
    return BigInt(0);
  }, [tokens]);

  const safeXbtcBaseUnits = useMemo(() => {
    const xbtcToken = tokens.find(
      (t) => normalizeAddress(t.address) === normalizeAddress(XBTC_FA_METADATA_MAINNET)
    );
    if (!xbtcToken) return BigInt(0);
    const raw = xbtcToken.amount;
    if (typeof raw === "string" && /^\d+$/.test(raw)) return BigInt(raw);
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return BigInt(Math.trunc(raw));
    return BigInt(0);
  }, [tokens]);

  // Hide stale BTC conversion when that metadata is the live hedge — server enforces this too.
  const wbtcIsActiveHedge =
    Boolean(deltaNeutral?.recordExists && deltaNeutral.isOpen) &&
    Boolean(deltaNeutral) &&
    normalizeAddress(deltaNeutral!.spotAssetMetadata) === normalizeAddress(WBTC_FA_METADATA_MAINNET);
  const xbtcIsActiveHedge =
    Boolean(deltaNeutral?.recordExists && deltaNeutral.isOpen) &&
    Boolean(deltaNeutral) &&
    normalizeAddress(deltaNeutral!.spotAssetMetadata) === normalizeAddress(XBTC_FA_METADATA_MAINNET);

  // BTC assets have 8 decimals; 1000 base units = 0.00001 BTC ≈ $0.8 dust threshold at $80k/BTC.
  const STALE_BTC_DUST_BASE_UNITS = BigInt(1_000);

  // Hyperion LP positions live inside the safe but aren't safe FA balances —
  // add their USD value to the safe total for hyperion_lp safes.
  const { data: hyperionLpPositions = [] } = useHyperionLpPositions(safeAddr ?? undefined, {
    enabled: activeStrategyId === "hyperion_lp" && Boolean(safeAddr),
  });
  const hyperionLpValue = useMemo(
    () =>
      hyperionLpPositions
        .filter((p) => !p.closed)
        .reduce((sum, p) => sum + (p.valueUsd ?? 0), 0),
    [hyperionLpPositions]
  );

  const totalValue =
    tokens.reduce((sum, t) => sum + (t.value ? parseFloat(t.value) : 0), 0) +
    totalRewardsValue +
    echelonTotalValue +
    hyperionLpValue;

  const { data: depositHistory, isLoading: historyLoading, isFetching: historyFetching } = useYieldAiDepositHistory(
    safeAddr ?? undefined,
    Number.isFinite(totalValue) ? totalValue : null,
    { enabled: Boolean(safeAddr) }
  );

  const holdingDays = depositHistory?.pnlStats?.holdingDays ?? 0;
  const pnlRaw = depositHistory?.pnlStats?.pnl ?? null;
  const aprRaw = depositHistory?.pnlStats?.apr ?? null;
  const netDepositsRaw = depositHistory?.netDeposits ?? null;

  const pnlUsd = pnlRaw != null ? parseFloat(pnlRaw) : null;
  const aprPct = holdingDays >= 7 && aprRaw != null ? parseFloat(aprRaw) : null;
  const netDepositsUsd = netDepositsRaw != null ? parseFloat(netDepositsRaw) : null;

  // Strategy-level fee APR: everything the LP positions earned (claimed +
  // uncollected fees/rewards, open and closed) over the same time-weighted
  // average capital used for Historical APR. Same denominator → the two badges
  // are directly comparable; the difference between them is price moves / IL.
  const hyperionFeeAprPct = useMemo(() => {
    if (activeStrategyId !== "hyperion_lp") return null;
    const avgCapital = parseFloat(depositHistory?.pnlStats?.avgCapitalUsd ?? "");
    const periodDays = depositHistory?.pnlStats?.periodDays ?? 0;
    if (!Number.isFinite(avgCapital) || avgCapital <= 0.01 || periodDays < 1) return null;
    let earnedUsd = 0;
    for (const p of hyperionLpPositions) {
      earnedUsd += p.claimedUsd ?? 0;
      if (!p.closed) earnedUsd += (p.feesUsd ?? 0) + (p.rewardsUsd ?? 0);
    }
    if (earnedUsd <= 0) return null;
    return (earnedUsd / avgCapital) * (365 / periodDays) * 100;
  }, [activeStrategyId, hyperionLpPositions, depositHistory]);

  const aiAgentProtocolConfig = useMemo(() => getProtocolByName("AI agent"), []);
  const decibelProtocolConfig = useMemo(() => getProtocolByName("Decibel"), []);
  const hyperionProtocolConfig = useMemo(() => getProtocolByName("Hyperion"), []);
  const isHyperionLpStrategy = activeStrategyId === "hyperion_lp";
  const walletUsdcPriceUsd = useMemo(() => {
    const usdc = walletTokens?.find(
      (t) =>
        normalizeAddress(t.address) === normalizeAddress(USDC_FA_METADATA_MAINNET) ||
        t.symbol === "USDC"
    );
    return usdc?.price ? parseFloat(usdc.price) : 1;
  }, [walletTokens]);

  const depositModalConfig = useMemo(() => {
    if (isHyperionLpStrategy && safeAddr) {
      return buildHyperionAgentDepositModalConfig({
        aiAgentLogoUrl: aiAgentProtocolConfig?.logoUrl ?? "/logo.png",
        hyperionLogoUrl: hyperionProtocolConfig?.logoUrl,
        yieldAiSafeAddress: safeAddr,
        apy: aprPct ?? 0,
      });
    }
    const usdc = AI_AGENT_DEPOSIT_TOKENS[0];
    if (isDeltaNeutralStrategy) {
      return {
        protocol: {
          name: "Decibel AI agent",
          logo: aiAgentProtocolConfig?.logoUrl ?? "/logo.png",
          apy: aprPct ?? 0,
          key: "yield-ai" as const,
        },
        tokenIn: usdc,
        tokenOut: usdc,
        tokenInOptions: [usdc],
        priceUSD: walletUsdcPriceUsd,
        yieldAiSafeAddress: safeAddr ?? undefined,
        secondaryLogoUrl: decibelProtocolConfig?.logoUrl,
        secondaryLogoAlt: "Decibel",
        yieldAiSuccessDescription: "",
      };
    }
    return {
      protocol: {
        name: aiAgentProtocolConfig?.name ?? "AI agent",
        logo: aiAgentProtocolConfig?.logoUrl ?? "/logo.png",
        apy: aprPct ?? 0,
        key: "yield-ai" as const,
      },
      tokenIn: usdc,
      tokenOut: usdc,
      tokenInOptions: AI_AGENT_DEPOSIT_TOKENS,
      priceUSD: walletUsdcPriceUsd,
      yieldAiSafeAddress: safeAddr ?? undefined,
    };
  }, [
    isHyperionLpStrategy,
    isDeltaNeutralStrategy,
    safeAddr,
    aiAgentProtocolConfig?.logoUrl,
    aiAgentProtocolConfig?.name,
    hyperionProtocolConfig?.logoUrl,
    aprPct,
    walletUsdcPriceUsd,
    decibelProtocolConfig?.logoUrl,
  ]);

  const performanceLoading =
    historyLoading ||
    historyFetching ||
    safesLoading ||
    safeTokensLoading ||
    echelonLoading;

  if (safesError) {
    return (
      <div className="py-4 text-red-500">
        {safesError instanceof Error ? safesError.message : "Failed to load AI agent safes."}
      </div>
    );
  }
  if (safesLoading && safeAddresses.length === 0) {
    return (
      <div className="py-4 text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading AI agent wallets...
      </div>
    );
  }

  // Show loading when switching safes
  if (safeAddr && safeTokensLoading && tokens.length === 0) {
    return (
      <div className="py-4 text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading safe assets for {safeAddr.slice(0, 6)}…{safeAddr.slice(-4)}...
      </div>
    );
  }
  if (safeAddresses.length === 0) {
    return (
      <div className="py-4 text-muted-foreground">
        No safe found. Create a safe to see assets here.
      </div>
    );
  }

  return (
    <div className="space-y-4 text-base">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3 gap-y-2">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-muted-foreground">
              {safeAddr ? (
                <>
                  Safe {safeAddr.slice(0, 6)}...{safeAddr.slice(-4)}
                </>
              ) : (
                <>Safe —</>
              )}
            </span>
            {normalizedSafes.length > 1 ? (
              <Select value={safeAddr ?? ""} onValueChange={setSelectedSafeAddr}>
                <SelectTrigger className="h-7 w-[240px]">
                  <SelectValue placeholder="Select safe" />
                </SelectTrigger>
                <SelectContent>
                  {normalizedSafes.map((s) => {
                    const strategy = strategiesMap.get(s);
                    const strategyLabel = strategy?.activeStrategyId
                      ? AI_AGENT_STRATEGIES[strategy.activeStrategyId]?.label || 'Unknown'
                      : 'Stablecoin compound'; // default
                    return (
                      <SelectItem key={s} value={s}>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {strategyLabel}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {s.slice(0, 6)}…{s.slice(-4)}
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            ) : null}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(safeAddr ?? "")
                      .then(() =>
                        toast({
                          title: "Copied",
                          description: "Safe address copied to clipboard",
                        })
                      )
                      .catch(() =>
                        toast({
                          title: "Copy failed",
                          variant: "destructive",
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
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-7 gap-1.5 px-2 text-xs",
                    isPaused && "border-amber-500/50 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 hover:text-amber-700"
                  )}
                  disabled={isPauseToggling}
                  onClick={handleTogglePause}
                  aria-label={isPaused ? "Resume agent" : "Pause agent"}
                >
                  {isPauseToggling ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : isPaused ? (
                    <PlayCircle className="h-3.5 w-3.5" />
                  ) : (
                    <PauseCircle className="h-3.5 w-3.5" />
                  )}
                  {isPaused ? "Paused" : "Pause"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {isPaused
                    ? "Resume agent rebalancing"
                    : "Pause agent — stops rebalancing, withdrawals still work"}
                </p>
              </TooltipContent>
            </Tooltip>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={cn(
                  "text-xs font-medium",
                  AI_AGENT_STRATEGY_BADGE_CLASS[activeStrategyId]
                )}
              >
                AI agent: {AI_AGENT_STRATEGIES[activeStrategyId].label}
              </Badge>
              <p className="flex items-center gap-1 text-sm font-normal text-muted-foreground">
                {AI_AGENT_STRATEGIES[activeStrategyId].tagline}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 shrink-0 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[300px] text-xs">
                    {AI_AGENT_STRATEGIES[activeStrategyId].tooltip}
                  </TooltipContent>
                </Tooltip>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="default" onClick={() => setShowDepositModal(true)}>
              {isHyperionLpStrategy ? "Deposit" : "Deposit USDC to AI agent"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 px-2"
                  aria-label="AI agent settings"
                  title="AI agent settings"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isDeltaNeutralStrategy && (
                  <DropdownMenuItem
                    onSelect={() => {
                      // Mirror the visibility derivation in the render block so
                      // toggling from a loading state still flips the perceived
                      // show/hide correctly.
                      const hasAnyTrade = Boolean(deltaNeutral?.recordExists);
                      const defaultShow = deltaNeutralLoading ? false : !hasAnyTrade;
                      const current = onboardingOverride ?? defaultShow;
                      setOnboardingOverride(!current);
                    }}
                  >
                    Decibel delta-neutral setup
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={openLimitsDialog}>
                  AI agent swap limits…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowHistoryModal(true)}
              className="h-9 px-2"
              aria-label="Open deposit history"
            >
              <History className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {isDeltaNeutralStrategy && (() => {
        // Wait for the delta-neutral state to actually load before deciding
        // the default visibility. Otherwise `deltaNeutral?.recordExists` is
        // undefined during the first paint, `hasAnyTrade` reads false, and
        // we briefly render the onboarding card — then hide it the moment
        // the data resolves with `recordExists: true`. The user perceives
        // this as the settings "collapsing on their own".
        const hasAnyTrade = Boolean(deltaNeutral?.recordExists);
        const defaultShow = deltaNeutralLoading ? false : !hasAnyTrade;
        const showOnboarding = onboardingOverride ?? defaultShow;
        if (!showOnboarding) return null;
        // The user explicitly opened the settings panel (via the gear button)
        // when override is true. In that case skip the compact "Ready" banner
        // and render the full step list with its green check marks — they
        // came in to look at the steps, not at a one-line summary.
        const openedViaGear = onboardingOverride === true;
        return (
          <DecibelOnboardingCard
            ownerAddress={walletAddress}
            safeAddress={safeAddr ?? undefined}
            safeBalance={safeUsdcBalance}
            hasOpenTrade={Boolean(deltaNeutral?.isOpen)}
            tradingSubaccount={
              deltaNeutral?.recordExists
                ? deltaNeutral.decibelSubaccount
                : selectedDecibelSubaccount || undefined
            }
            onDepositClick={() => setShowDepositModal(true)}
            forceExpanded={openedViaGear}
          />
        );
      })()}

      {activeStrategyId === "hyperion_lp" && safeAddr ? (
        <HyperionLpStrategyView safeAddress={safeAddr} />
      ) : null}

      {/* "Closed · View history" placeholder block removed: the History
          icon-button in the card header (next to Settings) opens the same modal,
          so the standalone block was duplicate UI. Keep the modal mounting below
          unchanged. */}

      {isDeltaNeutralStrategy && (
        <Dialog
          open={showHistoryModal}
          onOpenChange={(open) => { if (!open) setShowHistoryModal(false); }}
        >
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Delta-neutral history</DialogTitle>
              <DialogDescription>
                All delta-neutral deals for this safe: strategy_journal cycles (spot &amp; LP-hedge,
                exact on-chain records) plus legacy V1 deals reconstructed from executor
                record_open / record_close calls.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                {deltaNeutral?.isOpen ? (
                  <Badge className="bg-green-500/10 text-green-700 border-green-500/30">Currently open</Badge>
                ) : deltaNeutral?.recordExists ? (
                  <Badge variant="secondary">No open deal</Badge>
                ) : (
                  <Badge variant="outline">No on-chain record</Badge>
                )}
                {deltaNeutralHistory ? (
                  <Badge variant="outline" className="text-xs">
                    {deltaNeutralHistory.totalOpens} open{deltaNeutralHistory.totalOpens === 1 ? "" : "s"}
                    {" · "}
                    {deltaNeutralHistory.totalCloses} close{deltaNeutralHistory.totalCloses === 1 ? "" : "s"}
                    {" · "}
                    {deltaNeutralHistory.uniqueMarkets.length} market
                    {deltaNeutralHistory.uniqueMarkets.length === 1 ? "" : "s"}
                  </Badge>
                ) : deltaNeutralHistoryLoading ? (
                  <Badge variant="outline" className="text-xs flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading history…
                  </Badge>
                ) : null}
              </div>
              {(() => {
                if (deltaNeutralHistoryError) {
                  return (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
                      History scan failed:{" "}
                      {deltaNeutralHistoryError instanceof Error
                        ? deltaNeutralHistoryError.message
                        : "unknown error"}
                      . The current snapshot is shown below.
                    </div>
                  );
                }
                if (!deltaNeutralHistory) return null;
                const deals = deltaNeutralHistory.deals;
                const journalCycles = deltaNeutralHistory.journalCycles ?? [];
                if (deals.length === 0 && journalCycles.length === 0) {
                  return (
                    <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      No on-chain record_open / record_close transactions found for this safe yet.
                    </div>
                  );
                }
                // Compact "4m / 2h 10m / 2d 9h" duration for a deal's open→close span.
                const fmtDuration = (ms: number): string => {
                  const m = Math.max(0, Math.round(ms / 60000));
                  if (m < 60) return `${m}m`;
                  const h = Math.floor(m / 60);
                  if (h < 48) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
                  const days = Math.floor(h / 24);
                  return h % 24 ? `${days}d ${h % 24}h` : `${days}d`;
                };
                // One flat list: journal cycles (current system, exact on-chain close proceeds)
                // + V1 deals (proceeds resolved from the indexer swap scan), newest first.
                type HistoryRowVm = {
                  key: string;
                  label: string;
                  assetLabel: string;
                  isLp: boolean;
                  openedSec: number;
                  closedSec: number | null;
                  inUsd: number;
                  outUsd: number | null;
                  openTxVersion: string | null;
                  closeTxVersion: string | null;
                  swapTxVersion: string | null;
                };
                const journalAssetLabel = (spotMetadata: string, strategyId: string): string => {
                  const label = spotAssetLabel(spotMetadata);
                  if (!label.startsWith("0x")) return label;
                  const sid = strategyId.toLowerCase();
                  return sid.includes("btc") ? "WBTC" : sid.includes("apt") ? "APT" : label.slice(0, 8);
                };
                const historyRows: HistoryRowVm[] = [
                  ...journalCycles.map((c): HistoryRowVm => {
                    const outRaw = Number(c.usdcReceivedOnClose) / 1e6;
                    return {
                      key: `journal-${c.cycleId}`,
                      label: `C#${c.cycleId}`,
                      assetLabel: journalAssetLabel(c.spotMetadata, c.strategyId),
                      isLp: c.isLp,
                      openedSec: Number(c.openedAt) || 0,
                      closedSec: c.isOpen ? null : Number(c.closedAt) || null,
                      // Cumulative spot/LP-side USDC (open + top-ups) — notional-open alone
                      // shows phantom profit on topped-up cycles.
                      inUsd: Number(c.usdcInTotal) / 1e6,
                      outUsd: !c.isOpen && outRaw > 0 ? outRaw : null,
                      openTxVersion: c.openTxVersion,
                      closeTxVersion: c.closeTxVersion,
                      swapTxVersion: null,
                    };
                  }),
                  ...deals.map((d): HistoryRowVm => {
                    const outRaw =
                      d.closeSwapUsdcOutBaseUnits != null
                        ? Number(d.closeSwapUsdcOutBaseUnits) / 1e6
                        : null;
                    return {
                      key: `deal-${d.index}-${d.open.txVersion}`,
                      label: `#${d.index + 1}`,
                      assetLabel: spotAssetLabel(d.spotAssetMetadata),
                      isLp: false,
                      openedSec: Math.floor(new Date(d.open.timestamp).getTime() / 1000),
                      closedSec: d.close
                        ? Math.floor(new Date(d.close.timestamp).getTime() / 1000)
                        : null,
                      inUsd: Number(d.open.usdcSwappedIn ?? "0") / 1e6,
                      outUsd: outRaw != null && outRaw > 0 ? outRaw : null,
                      openTxVersion: d.open.txVersion,
                      closeTxVersion: d.close?.txVersion ?? null,
                      swapTxVersion: d.closeSwapTxVersion,
                    };
                  }),
                ].sort((a, b) => b.openedSec - a.openedSec);

                return (
                  <div className="space-y-3">
                    {currentOpenDeal ? (
                      <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-medium uppercase tracking-wide text-green-700 dark:text-green-400">
                            Current position
                          </span>
                          <Badge className="bg-green-500/10 text-green-700 border-green-500/30 text-[10px]">
                            Open
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            #{currentOpenDeal.index + 1}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            {spotAssetLabel(currentOpenDeal.spotAssetMetadata)}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Open {formatUnixSecondsLabel(
                            String(
                              Math.floor(new Date(currentOpenDeal.open.timestamp).getTime() / 1000)
                            )
                          )}
                        </div>
                        <div className="grid gap-1 sm:grid-cols-2 text-xs">
                          <div>
                            <span className="text-muted-foreground">USDC swapped in: </span>
                            <span className="font-medium">
                              {(Number(currentOpenDeal.open.usdcSwappedIn ?? "0") / 1e6).toLocaleString(undefined, {
                                maximumFractionDigits: 2,
                              })}{" "}
                              USDC
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Filled short size (raw): </span>
                            <span className="font-mono">{currentOpenDeal.open.filledShortSize ?? "0"}</span>
                          </div>
                          <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
                            <span className="text-muted-foreground">Record tx:</span>
                            <a
                              href={aptosMainnetTxnExplorerUrl(currentOpenDeal.open.txVersion) ?? "#"}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-xs underline hover:text-foreground"
                            >
                              {currentOpenDeal.open.txVersion}
                            </a>
                            {currentOpenDeal.open.decibelTxVersion &&
                            currentOpenDeal.open.decibelTxVersion !== "0" ? (
                              <>
                                <span className="text-muted-foreground">· Decibel tx:</span>
                                <a
                                  href={
                                    aptosMainnetTxnExplorerUrl(currentOpenDeal.open.decibelTxVersion) ?? "#"
                                  }
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-mono text-xs underline hover:text-foreground"
                                >
                                  {currentOpenDeal.open.decibelTxVersion}
                                </a>
                              </>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {historyRows.length > 0 ? (
                      <div className="rounded-md border bg-muted/20 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Deals ({historyRows.length})
                          </span>
                          {deltaNeutralHistory.truncated ? (
                            <span className="text-[10px] text-muted-foreground">
                              older deals may exist beyond scan window
                            </span>
                          ) : null}
                        </div>
                        <div className="max-h-72 overflow-y-auto pr-1">
                          {historyRows.map((r) => {
                            const isStillOpen = r.closedSec == null;
                            const pnl =
                              r.outUsd != null && Number.isFinite(r.inUsd)
                                ? r.outUsd - r.inUsd
                                : null;
                            const pct = pnl != null && r.inUsd > 0 ? (pnl / r.inUsd) * 100 : null;
                            const txLink = (label: string, version: string) => (
                              <a
                                href={aptosMainnetTxnExplorerUrl(version) ?? "#"}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                              >
                                {label}
                              </a>
                            );
                            return (
                              <div
                                key={r.key}
                                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-border/40 py-1.5 text-[11px] last:border-b-0"
                              >
                                <Badge variant="outline" className="text-[10px]">
                                  {r.label}
                                </Badge>
                                <Badge variant="outline" className="text-[10px]">
                                  {r.assetLabel}
                                </Badge>
                                {r.isLp ? (
                                  <Badge className="border-violet-500/30 bg-violet-500/10 text-[10px] text-violet-600 dark:text-violet-400">
                                    LP
                                  </Badge>
                                ) : null}
                                <span className="text-muted-foreground">
                                  {formatUnixSecondsLabel(String(r.openedSec))}
                                </span>
                                {isStillOpen ? (
                                  <Badge className="bg-green-500/10 text-green-700 border-green-500/30 text-[10px]">
                                    open
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground">
                                    · {fmtDuration(((r.closedSec ?? r.openedSec) - r.openedSec) * 1000)}
                                  </span>
                                )}
                                <span className="tabular-nums font-medium">
                                  {Number.isFinite(r.inUsd) ? formatCurrency(r.inUsd, 2) : "—"} in
                                </span>
                                {!isStillOpen &&
                                  (r.outUsd != null ? (
                                    <>
                                      <span className="tabular-nums text-muted-foreground">
                                        → {formatCurrency(r.outUsd, 2)} out
                                      </span>
                                      {pnl != null ? (
                                        <span
                                          className={cn(
                                            "tabular-nums font-medium",
                                            pnl >= 0
                                              ? "text-emerald-600 dark:text-emerald-400"
                                              : "text-rose-600 dark:text-rose-400"
                                          )}
                                        >
                                          {pnl >= 0 ? "+" : ""}
                                          {formatCurrency(pnl, 2)}
                                          {pct != null
                                            ? ` (${pnl >= 0 ? "+" : ""}${pct.toFixed(1)}%)`
                                            : ""}
                                        </span>
                                      ) : null}
                                    </>
                                  ) : (
                                    <span className="text-muted-foreground/70">out —</span>
                                  ))}
                                <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
                                  {r.openTxVersion ? txLink("open", r.openTxVersion) : null}
                                  {r.closeTxVersion ? <>· {txLink("close", r.closeTxVersion)}</> : null}
                                  {r.swapTxVersion ? <>· {txLink("swap", r.swapTxVersion)}</> : null}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="text-[10px] text-muted-foreground/80">
                          PnL is the spot/LP-leg round trip (USDC in at open → USDC out at close;
                          LP cycles include fees claimed at close). Decibel margin, funding and
                          perp PnL settle on the subaccount and are not included. C# rows are
                          journal cycles (exact on-chain proceeds); # rows are V1 deals.
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })()}
          {deltaNeutralLoading || decibelPositionsLoading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading delta-neutral state…
            </div>
          ) : deltaNeutralError ? (
            <div className="text-sm text-destructive">
              {deltaNeutralError instanceof Error ? deltaNeutralError.message : "Failed to load state"}
            </div>
          ) : !deltaNeutral ? null : !deltaNeutral.isOpen ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Last position was closed on-chain. Open a new one from the executor block below when enabled.
              </p>
              {(() => {
                // Closed-state strategy recap: aggregate realized perp PnL / funding / fees
                // from Decibel trade_history in [openedAt, closedAt+2min]. The spot-leg USDC
                // output is resolved best-effort by scanning indexer fungible_asset_activities
                // for the safe's vault swap right after `closeDecibelTxVersion`.
                const ledger = decibelLedger ?? null;
                const hasLedger = ledger != null;
                const signed = (n: number) => `${n >= 0 ? "+" : ""}${formatCurrency(n, 2)}`;
                const pnlColor = (n: number | null | undefined) =>
                  n == null
                    ? "text-muted-foreground"
                    : n > 0.005
                      ? "text-green-600 dark:text-green-400"
                      : n < -0.005
                        ? "text-destructive"
                        : "text-muted-foreground";

                const perpPriceRealized = hasLedger ? ledger!.realizedPnlUsd : null;
                const fundingRealized = hasLedger ? ledger!.realizedFundingEarnedUsd : null;
                const feesUsd = hasLedger ? ledger!.feesUsd : null;
                const perpNet =
                  perpPriceRealized != null && fundingRealized != null && feesUsd != null
                    ? perpPriceRealized + fundingRealized - feesUsd
                    : null;
                const entryUsdcIn = Number(deltaNeutral.usdcSwappedIn) / 1e6;
                const closeOutUsdc =
                  deltaNeutral.closeSwapStatus === "resolved" &&
                  deltaNeutral.closeSwapUsdcOutBaseUnits != null
                    ? Number(deltaNeutral.closeSwapUsdcOutBaseUnits) / 1e6
                    : null;
                const spotNet =
                  closeOutUsdc != null && Number.isFinite(entryUsdcIn)
                    ? closeOutUsdc - entryUsdcIn
                    : null;
                const strategyNet =
                  perpNet != null && spotNet != null ? perpNet + spotNet : null;
                const closeSwapTxUrl = deltaNeutral.closeSwapTxVersion
                  ? aptosMainnetTxnExplorerUrl(deltaNeutral.closeSwapTxVersion)
                  : null;

                if (!showClosedStrategyRecap) {
                  return (
                    <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 p-3">
                      <div className="text-xs text-muted-foreground">
                        Strategy recap is hidden by default.
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setShowClosedStrategyRecap(true);
                          setShowClosedStrategyRecapDetails(false);
                        }}
                        className="h-8"
                      >
                        Show strategy recap
                      </Button>
                    </div>
                  );
                }

                return (
                  <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Strategy recap (closed)
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setShowClosedStrategyRecap(false);
                          setShowClosedStrategyRecapDetails(false);
                        }}
                        className="h-7 px-2"
                      >
                        Hide
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setShowClosedStrategyRecapDetails((v) => !v)}
                        className="h-7 px-2"
                      >
                        {showClosedStrategyRecapDetails ? "Hide details" : "Show details"}
                      </Button>
                      {hasLedger ? (
                        <span className="text-[11px] text-muted-foreground">
                          {ledger!.tradeCount} trade{ledger!.tradeCount === 1 ? "" : "s"} aggregated
                        </span>
                      ) : null}
                    </div>

                    <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                      <div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          Perp price PnL
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help text-muted-foreground/70">ⓘ</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[240px] text-xs">
                              <p>
                                Sum of <code>realized_pnl_amount</code> on all Decibel trades
                                for this market between open and close.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <div className={`font-medium ${pnlColor(perpPriceRealized)}`}>
                          {perpPriceRealized != null ? signed(perpPriceRealized) : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          Funding (cumulative)
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help text-muted-foreground/70">ⓘ</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[240px] text-xs">
                              <p>
                                Sum of <code>realized_funding_amount</code> (sign-flipped) across
                                all close events in the window. Settled when position closed.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <div className={`font-medium ${pnlColor(fundingRealized)}`}>
                          {fundingRealized != null ? signed(fundingRealized) : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          Perp fees
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help text-muted-foreground/70">ⓘ</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[220px] text-xs">
                              <p>
                                Sum of Decibel <code>fee_amount</code> (taker/maker) across
                                trades in the window.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <div
                          className={`font-medium ${
                            feesUsd != null && feesUsd > 0.005 ? "text-destructive" : "text-muted-foreground"
                          }`}
                        >
                          {feesUsd != null ? `−${formatCurrency(feesUsd, 2)}` : "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          Perp net
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help text-muted-foreground/70">ⓘ</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[240px] text-xs">
                              <p>
                                price PnL + funding − fees. Perp-leg only — see "Strategy net"
                                below for the full strategy PnL when the spot close-swap is
                                resolved.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <div className={`font-semibold ${pnlColor(perpNet)}`}>
                          {perpNet != null ? signed(perpNet) : "—"}
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-border/60 grid gap-2 sm:grid-cols-3 text-xs">
                      <div>
                        <div className="text-muted-foreground">Spot entry cost (recorded)</div>
                        <div className="font-medium">
                          {Number.isFinite(entryUsdcIn) ? formatCurrency(entryUsdcIn, 2) : "—"} USDC in
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground flex items-center gap-1">
                          Spot close output
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help text-muted-foreground/70">ⓘ</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[280px] text-xs">
                              <p>{deltaNeutral.closeSwapNote}</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        {closeOutUsdc != null ? (
                          <div className="font-medium">
                            {formatCurrency(closeOutUsdc, 2)} USDC out
                            {closeSwapTxUrl ? (
                              <>
                                {" · "}
                                <a
                                  href={closeSwapTxUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[11px] underline text-muted-foreground hover:text-foreground"
                                >
                                  swap tx
                                </a>
                              </>
                            ) : null}
                            <div className="text-[10px] text-muted-foreground">estimated · indexer-resolved</div>
                          </div>
                        ) : (
                          <div className="text-muted-foreground italic">
                            not available
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-muted-foreground flex items-center gap-1">
                          Strategy net
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help text-muted-foreground/70">ⓘ</span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[260px] text-xs">
                              <p>
                                Perp net + (spot close output − spot entry cost). Shown only when
                                the close swap was resolved from indexer activities.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        {strategyNet != null ? (
                          <div className={`font-semibold ${pnlColor(strategyNet)}`}>
                            {signed(strategyNet)}
                          </div>
                        ) : (
                          <div className="text-muted-foreground italic">—</div>
                        )}
                      </div>
                    </div>

                    <div className="text-[11px] text-muted-foreground">
                      Full strategy PnL = Perp net + (spot_close_usdc_out − spot_entry_cost).
                      For a sized DN the spot leg roughly cancels perp price PnL, so the real
                      carry is funding minus fees and swap costs.
                    </div>
                  </div>
                );
              })()}
              {showClosedStrategyRecapDetails ? (
              <>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Decibel subaccount (snapshot)
                  </div>
                  <div className="font-mono text-xs break-all">{deltaNeutral.decibelSubaccount}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Perp market (snapshot)
                  </div>
                  <div className="font-mono text-xs break-all">{deltaNeutral.perpMarket}</div>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Opened / closed (on-chain)
                  </div>
                  <div>
                    {formatUnixSecondsLabel(deltaNeutral.openedAt)} → {formatUnixSecondsLabel(deltaNeutral.closedAt)}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Aptos tx versions (registry)
                  </div>
                  <div className="flex flex-col gap-1 text-xs">
                    {(() => {
                      const openUrl = aptosMainnetTxnExplorerUrl(deltaNeutral.decibelTxVersion);
                      const closeUrl = aptosMainnetTxnExplorerUrl(deltaNeutral.closeDecibelTxVersion);
                      return (
                        <>
                          <span className="flex flex-wrap items-center gap-1">
                            Open:{" "}
                            <span className="font-mono break-all">{deltaNeutral.decibelTxVersion}</span>
                            {openUrl ? (
                              <a
                                href={openUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-primary hover:underline shrink-0"
                              >
                                Explorer <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : null}
                          </span>
                          <span className="flex flex-wrap items-center gap-1">
                            Close:{" "}
                            <span className="font-mono break-all">{deltaNeutral.closeDecibelTxVersion}</span>
                            {closeUrl ? (
                              <a
                                href={closeUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-primary hover:underline shrink-0"
                              >
                                Explorer <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : null}
                          </span>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Recorded short (on-chain → est. {spotAssetLabel(deltaNeutral.spotAssetMetadata)})
                  </div>
                  <div>
                    {deltaNeutral.filledShortSize}
                    {filledShortHumanOnChain != null
                      ? ` (~${formatNumber(filledShortHumanOnChain, 8)} ${spotAssetLabel(deltaNeutral.spotAssetMetadata)})`
                      : ""}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    USDC swapped in (recorded)
                  </div>
                  <div>
                    {(Number(deltaNeutral.usdcSwappedIn) / 1e6).toLocaleString(undefined, {
                      maximumFractionDigits: 6,
                    })}{" "}
                    USDC
                  </div>
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Spot hedge metadata + balances
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  {isDecibelBtcSpotMetadata(deltaNeutral.spotAssetMetadata) ||
                  isApt(deltaNeutral.spotAssetMetadata) ? (
                    <Badge variant="outline">{spotAssetLabel(deltaNeutral.spotAssetMetadata)}</Badge>
                  ) : (
                    <span className="font-mono text-xs break-all">{deltaNeutral.spotAssetMetadata}</span>
                  )}
                  <span className="text-muted-foreground">
                    Indexer FA on safe:{" "}
                    <span className="font-medium text-foreground">
                      {deltaNeutral.spotBalanceHumanApprox != null
                        ? `~${deltaNeutral.spotBalanceHumanApprox} (≈8dp)`
                        : "0"}
                    </span>{" "}
                    <span className="font-mono text-xs">({deltaNeutral.spotBalanceBaseUnits} base units)</span>
                  </span>
                </div>
                {deltaNeutralSpotToken ? (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Panora safe list:{" "}
                    <span className="font-medium text-foreground">
                      {formatNumber(
                        parseFloat(deltaNeutralSpotToken.amount || "0") /
                          Math.pow(10, deltaNeutralSpotToken.decimals ?? 8),
                        8
                      )}{" "}
                      {deltaNeutralSpotToken.symbol || "—"}
                    </span>
                    {deltaNeutralSpotToken.value != null &&
                    Number.isFinite(parseFloat(deltaNeutralSpotToken.value)) ? (
                      <span> · ~{formatCurrency(parseFloat(deltaNeutralSpotToken.value), 2)} USD</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div
                className={
                  deltaNeutral.spotHedgeInference === "closed_spot_still_on_safe"
                    ? "rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-900 dark:text-amber-100"
                    : "rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
                }
              >
                <div className="font-medium text-foreground mb-0.5">Close / swap hint (indexer + registry)</div>
                <div>{deltaNeutral.spotHedgeInferenceNote}</div>
              </div>
              </>
              ) : null}
              {SHOW_EXECUTOR_TRADE_BLOCK && deltaNeutralResidualSwapVisible ? (
                <div className="flex flex-col gap-2 pt-1 border-t">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-fit"
                    disabled={!deltaNeutralResidualSwapUsable || swapResidualSubmitting}
                    onClick={() => setSwapResidualOpen(true)}
                  >
                    Convert residual spot to USDC
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              {(() => {
                // Source of truth for "now":
                //   - mark price: Decibel /prices (authoritative for perp PnL), fallback Panora
                //     spot, then perp entry_price.
                //   - spot amount from token list.
                //   - perp row from Decibel API.
                const decibelMarkPx =
                  decibelMarketPrice && typeof decibelMarketPrice.markPx === "number"
                    ? decibelMarketPrice.markPx
                    : null;
                const spotPriceHuman = deltaNeutralSpotToken?.price
                  ? parseFloat(deltaNeutralSpotToken.price)
                  : null;
                const entryPxPerp = deltaNeutralPerpRow?.entry_price
                  ? Number(deltaNeutralPerpRow.entry_price)
                  : null;
                const markPx =
                  decibelMarkPx != null && decibelMarkPx > 0
                    ? decibelMarkPx
                    : Number.isFinite(spotPriceHuman) && (spotPriceHuman as number) > 0
                      ? (spotPriceHuman as number)
                      : Number.isFinite(entryPxPerp) && (entryPxPerp as number) > 0
                        ? (entryPxPerp as number)
                        : null;
                const markSource: "decibel" | "panora" | "entry" | null =
                  decibelMarkPx != null && decibelMarkPx > 0
                    ? "decibel"
                    : Number.isFinite(spotPriceHuman) && (spotPriceHuman as number) > 0
                      ? "panora"
                      : Number.isFinite(entryPxPerp) && (entryPxPerp as number) > 0
                        ? "entry"
                        : null;

                const spotHuman = deltaNeutralSpotToken
                  ? parseFloat(deltaNeutralSpotToken.amount || "0") /
                    Math.pow(10, deltaNeutralSpotToken.decimals ?? 8)
                  : 0;
                const shortSizeAbs = deltaNeutralPerpRow
                  ? Math.abs(Number(deltaNeutralPerpRow.size) || 0)
                  : 0;

                const longNotionalUsd = markPx != null ? spotHuman * markPx : null;
                const shortNotionalUsd = markPx != null ? shortSizeAbs * markPx : null;
                const netDeltaUsd =
                  longNotionalUsd != null && shortNotionalUsd != null
                    ? longNotionalUsd - shortNotionalUsd
                    : null;

                // PnL since open. Price legs mostly cancel for a properly sized DN; funding is the carry.
                const perpPricePnlUsd =
                  deltaNeutralPerpRow &&
                  markPx != null &&
                  Number.isFinite(Number(deltaNeutralPerpRow.entry_price))
                    ? Number(deltaNeutralPerpRow.size) *
                      (markPx - Number(deltaNeutralPerpRow.entry_price))
                    : null;
                const usdcSwappedInUsd = Number(deltaNeutral.usdcSwappedIn) / 1e6;
                const spotPricePnlUsd =
                  longNotionalUsd != null && Number.isFinite(usdcSwappedInUsd)
                    ? longNotionalUsd - usdcSwappedInUsd
                    : null;

                // Decibel stores `unrealized_funding` as user's debt; shorts earn when rate > 0.
                // Display = negated value, matches DecibelPositions.tsx convention.
                const unrealizedFundingRaw =
                  typeof deltaNeutralPerpRow?.unrealized_funding === "number"
                    ? deltaNeutralPerpRow.unrealized_funding
                    : null;
                const fundingUnrealizedUsd =
                  unrealizedFundingRaw != null ? -unrealizedFundingRaw : null;

                // Realized funding already settled at past CloseShort trades since openedAt
                // (Decibel settles funding on position-close; mid-epoch epochs don't show up
                // in this aggregate while the current short is still open).
                const fundingRealizedUsd =
                  decibelLedger && Number.isFinite(decibelLedger.realizedFundingEarnedUsd)
                    ? decibelLedger.realizedFundingEarnedUsd
                    : 0;

                const fundingTotalUsd =
                  fundingUnrealizedUsd != null
                    ? fundingRealizedUsd + fundingUnrealizedUsd
                    : null;

                const totalPnlAvailable =
                  perpPricePnlUsd != null &&
                  spotPricePnlUsd != null &&
                  fundingTotalUsd != null;
                const totalPnlUsd =
                  (perpPricePnlUsd ?? 0) +
                  (spotPricePnlUsd ?? 0) +
                  (fundingTotalUsd ?? 0);

                const pnlColor = (n: number | null | undefined) =>
                  n == null
                    ? "text-muted-foreground"
                    : n > 0.005
                      ? "text-green-600 dark:text-green-400"
                      : n < -0.005
                        ? "text-destructive"
                        : "text-muted-foreground";

                // Treat |net delta| < $0.25 as effectively neutral (dust overhedge buffer).
                const netDeltaColor =
                  netDeltaUsd == null
                    ? "text-muted-foreground"
                    : Math.abs(netDeltaUsd) < 0.25
                      ? "text-muted-foreground"
                      : netDeltaUsd > 0
                        ? "text-green-600 dark:text-green-400"
                        : "text-destructive";

                const signed = (n: number) => `${n >= 0 ? "+" : ""}${formatCurrency(n, 2)}`;

                return (
                  <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Position summary
                      </span>
                      {markPx != null ? (
                        <span className="text-[11px] text-muted-foreground">
                          mark ≈ {formatCurrency(markPx, 2)} / unit
                          {markSource === "decibel"
                            ? " · Decibel"
                            : markSource === "panora"
                              ? " · Panora spot (fallback)"
                              : markSource === "entry"
                                ? " · entry price (fallback)"
                                : ""}
                        </span>
                      ) : null}
                    </div>

                    {(() => {
                      const totalNotionalUsd =
                        longNotionalUsd != null && shortNotionalUsd != null
                          ? longNotionalUsd + shortNotionalUsd
                          : null;
                      // "At open" amounts: the exact USDC that landed in each
                      // leg at position-open time. usdcSwappedIn is on-chain
                      // (record_open), shortAtOpenUsd is reconstructed from the
                      // recorded fill size × entry price.
                      const spotAtOpenUsd = Number(deltaNeutral.usdcSwappedIn) / 1e6;
                      const shortAtOpenUsd =
                        Number.isFinite(shortSizeAbs) && entryPxPerp != null
                          ? shortSizeAbs * entryPxPerp
                          : null;
                      const totalAtOpenUsd =
                        Number.isFinite(spotAtOpenUsd) && shortAtOpenUsd != null
                          ? spotAtOpenUsd + shortAtOpenUsd
                          : null;
                      return (
                        <>
                          <div className="rounded-md bg-background/60 border border-border/40 p-3 flex items-baseline justify-between flex-wrap gap-2">
                            <div className="text-sm font-medium text-muted-foreground">
                              Total notional (spot + perp)
                            </div>
                            <div className="flex flex-col items-end">
                              <div className="text-2xl font-semibold tabular-nums">
                                {totalNotionalUsd != null ? formatCurrency(totalNotionalUsd, 2) : "—"}
                              </div>
                              {totalAtOpenUsd != null ? (
                                <div className="text-xs text-muted-foreground tabular-nums">
                                  invested: {formatCurrency(totalAtOpenUsd, 2)}
                                </div>
                              ) : null}
                            </div>
                          </div>
                          <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                            <div>
                              <div className="text-xs text-muted-foreground">Spot long (safe)</div>
                              <div className="text-xl font-semibold tabular-nums">
                                {longNotionalUsd != null ? formatCurrency(longNotionalUsd, 2) : "—"}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {formatNumber(spotHuman, 8)}{" "}
                                {deltaNeutralSpotToken?.symbol ?? "spot"}
                              </div>
                              {Number.isFinite(spotAtOpenUsd) && spotAtOpenUsd > 0 ? (
                                <div className="text-xs text-muted-foreground tabular-nums">
                                  invested: {formatCurrency(spotAtOpenUsd, 2)} USDC
                                </div>
                              ) : null}
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">Perp short (Decibel)</div>
                              <div className="text-xl font-semibold tabular-nums">
                                {shortNotionalUsd != null ? formatCurrency(shortNotionalUsd, 2) : "—"}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {formatNumber(shortSizeAbs, 8)}
                                {entryPxPerp != null
                                  ? ` · entry ~${formatCurrency(entryPxPerp, 2)}`
                                  : ""}
                              </div>
                              {shortAtOpenUsd != null ? (
                                <div className="text-xs text-muted-foreground tabular-nums">
                                  invested: {formatCurrency(shortAtOpenUsd, 2)} USDC
                                </div>
                              ) : null}
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground flex items-center gap-1">
                                Net delta (long − short)
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="cursor-help text-muted-foreground/70">ⓘ</span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-[240px] text-xs">
                                    <p>
                                      USD difference between spot leg and short perp at current mark.
                                      Target ≈ $0. Small residual reflects the 0.5%+$0.01 input buffer
                                      used on swap (overhedge).
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                              <div className={`text-xl font-semibold tabular-nums ${netDeltaColor}`}>
                                {netDeltaUsd != null ? signed(netDeltaUsd) : "—"}
                              </div>
                              <div className="text-xs text-muted-foreground">target ≈ $0</div>
                            </div>
                          </div>
                        </>
                      );
                    })()}

                    <div className="pt-2 border-t border-border/60 space-y-1.5">
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        PnL breakdown (unrealized)
                      </div>
                      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
                        <div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            Perp price
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help text-muted-foreground/70">ⓘ</span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[240px] text-xs">
                                <p>size × (mark − entry). Short gains when price falls.</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <div className={`font-medium ${pnlColor(perpPricePnlUsd)}`}>
                            {perpPricePnlUsd != null ? signed(perpPricePnlUsd) : "—"}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            Spot price
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help text-muted-foreground/70">ⓘ</span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[240px] text-xs">
                                <p>spot_now_usd − usdc_swapped_in. Includes entry swap fee/slippage.</p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <div className={`font-medium ${pnlColor(spotPricePnlUsd)}`}>
                            {spotPricePnlUsd != null ? signed(spotPricePnlUsd) : "—"}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            Funding
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help text-muted-foreground/70">ⓘ</span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[280px] text-xs">
                                <p className="mb-1">
                                  Funding earned by this short since open (sign-flipped from
                                  Decibel&apos;s user-debt convention). Shorts earn when rate &gt; 0.
                                </p>
                                <p>
                                  Realized (settled at past close-events on this market since open):{" "}
                                  <span className="font-medium">{signed(fundingRealizedUsd)}</span>
                                  <br />
                                  Unrealized (current open short, not yet settled):{" "}
                                  <span className="font-medium">
                                    {fundingUnrealizedUsd != null
                                      ? signed(fundingUnrealizedUsd)
                                      : "—"}
                                  </span>
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <div className={`font-medium ${pnlColor(fundingTotalUsd)}`}>
                            {fundingTotalUsd != null ? signed(fundingTotalUsd) : "—"}
                          </div>
                          {Math.abs(fundingRealizedUsd) > 0.005 &&
                          fundingUnrealizedUsd != null ? (
                            <div className="text-[10px] text-muted-foreground">
                              realized {signed(fundingRealizedUsd)} · unrealized{" "}
                              {signed(fundingUnrealizedUsd)}
                            </div>
                          ) : null}
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Total</div>
                          <div
                            className={`font-semibold ${pnlColor(
                              totalPnlAvailable ? totalPnlUsd : null
                            )}`}
                          >
                            {totalPnlAvailable ? signed(totalPnlUsd) : "—"}
                          </div>
                        </div>
                      </div>
                      <div className="text-[11px] text-muted-foreground pt-1">
                        In a sized delta-neutral, price PnL on spot and perp approximately cancel;
                        strategy net ≈ funding minus entry/exit costs.
                      </div>
                    </div>
                  </div>
                );
              })()}
              <Collapsible
                open={showDeltaNeutralDetails}
                onOpenChange={setShowDeltaNeutralDetails}
              >
                <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                  {showDeltaNeutralDetails ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  {showDeltaNeutralDetails ? "Hide technical details" : "Show technical details"}
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 pt-3">
                  <div className="rounded-md bg-background/60 border border-border/40 p-3 flex items-baseline justify-between flex-wrap gap-2">
                    <div className="text-sm font-medium text-muted-foreground">
                      USDC invested (entry cost)
                    </div>
                    <div className="text-lg font-semibold tabular-nums">
                      {(Number(deltaNeutral.usdcSwappedIn) / 1e6).toLocaleString(undefined, {
                        maximumFractionDigits: 6,
                      })}{" "}
                      USDC
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Decibel subaccount</div>
                      <div className="font-mono text-xs break-all">{deltaNeutral.decibelSubaccount}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Perp market</div>
                      <div className="font-mono text-xs break-all">{deltaNeutral.perpMarket}</div>
                    </div>
                  </div>
                  {(() => {
                    // Opening transactions for the current position. Two are
                    // persisted on-chain: the Decibel open anchor (stored in
                    // the record) and the executor record_open tx (resolved
                    // from history). The spot-swap tx is not recorded on-chain
                    // by the V1 contract, so it is intentionally not listed.
                    const decibelTx = deltaNeutral.decibelTxVersion;
                    const recordTx = currentOpenDeal?.open.txVersion ?? null;
                    if (
                      (!decibelTx || decibelTx === "0") &&
                      !recordTx
                    ) {
                      return null;
                    }
                    return (
                      <div>
                        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          Opening transactions
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          {decibelTx && decibelTx !== "0" ? (
                            <span className="flex items-center gap-1">
                              <span className="text-muted-foreground">Decibel short:</span>
                              <a
                                href={aptosMainnetTxnExplorerUrl(decibelTx) ?? "#"}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono underline hover:text-foreground inline-flex items-center gap-0.5"
                              >
                                {decibelTx}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </span>
                          ) : null}
                          {recordTx ? (
                            <span className="flex items-center gap-1">
                              <span className="text-muted-foreground">On-chain record:</span>
                              <a
                                href={aptosMainnetTxnExplorerUrl(recordTx) ?? "#"}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono underline hover:text-foreground inline-flex items-center gap-0.5"
                              >
                                {recordTx}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })()}
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Daily swap limit
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                      {vaultFaSwapLimits?.exists ? (
                        <span className="tabular-nums">
                          {formatCurrency(Number(BigInt(vaultFaSwapLimits.spentTodayUsdc)) / 1e6, 2)}{" "}
                          spent of{" "}
                          {formatCurrency(Number(BigInt(vaultFaSwapLimits.maxDailyUsdc)) / 1e6, 2)} today
                          <span className="text-muted-foreground">
                            {" "}· {formatCurrency(Number(BigInt(vaultFaSwapLimits.maxPerTxUsdc)) / 1e6, 2)} per tx
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Not configured.</span>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={openLimitsDialog}
                      >
                        Edit limits
                      </Button>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Recorded short (on-chain units → est. {spotAssetLabel(deltaNeutral.spotAssetMetadata)})
                    </div>
                    <div>
                      {deltaNeutral.filledShortSize}
                      {filledShortHumanOnChain != null
                        ? ` (~${formatNumber(filledShortHumanOnChain, 8)} ${spotAssetLabel(deltaNeutral.spotAssetMetadata)})`
                        : ""}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Spot hedge in safe</div>
                    <div className="flex flex-wrap items-center gap-2">
                      {isDecibelBtcSpotMetadata(deltaNeutral.spotAssetMetadata) ||
                      isApt(deltaNeutral.spotAssetMetadata) ? (
                        <Badge variant="outline">{spotAssetLabel(deltaNeutral.spotAssetMetadata)}</Badge>
                      ) : (
                        <span className="font-mono text-xs break-all">{deltaNeutral.spotAssetMetadata}</span>
                      )}
                      {deltaNeutralSpotToken ? (
                        <span className="space-x-1">
                          <span>
                            Balance:{" "}
                            <span className="font-medium">
                              {formatNumber(
                                parseFloat(deltaNeutralSpotToken.amount || "0") /
                                  Math.pow(10, deltaNeutralSpotToken.decimals ?? 8),
                                8
                              )}{" "}
                              {deltaNeutralSpotToken.symbol || "—"}
                            </span>
                          </span>
                          {deltaNeutralSpotToken.value != null &&
                          Number.isFinite(parseFloat(deltaNeutralSpotToken.value)) ? (
                            <span className="text-muted-foreground">
                              · ~{formatCurrency(parseFloat(deltaNeutralSpotToken.value), 2)} (Panora USD)
                            </span>
                          ) : null}
                          {deltaNeutralSpotToken.price != null &&
                          Number.isFinite(parseFloat(deltaNeutralSpotToken.price)) ? (
                            <span className="text-muted-foreground">
                              · ~{formatCurrency(parseFloat(deltaNeutralSpotToken.price), 2)} / unit
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">No matching token in safe list (may still be on-chain).</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Live Decibel short</div>
                    {deltaNeutralPerpRow ? (
                      <div>
                        Size:{" "}
                        <span className="font-medium">
                          {formatNumber(Math.abs(Number(deltaNeutralPerpRow.size)), 8)} (short)
                        </span>
                        {deltaNeutralPerpRow.entry_price ? (
                          <span className="text-muted-foreground">
                            {" "}
                            · entry ~{formatNumber(deltaNeutralPerpRow.entry_price, 2)}
                          </span>
                        ) : null}
                        {deltaNeutralPerpRow.entry_price &&
                        Number.isFinite(Number(deltaNeutralPerpRow.size)) &&
                        Number(deltaNeutralPerpRow.size) !== 0 ? (
                          <span className="text-muted-foreground">
                            {" "}
                            · est. notional ~{" "}
                            {formatCurrency(
                              Math.abs(Number(deltaNeutralPerpRow.size)) * Number(deltaNeutralPerpRow.entry_price),
                              2
                            )}{" "}
                            (size × entry, indicative)
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <div className="text-amber-700 dark:text-amber-500 text-xs">
                        On-chain shows open, but no matching short in Decibel API for this subaccount/market. Check Decibel
                        app or refresh later.
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!deltaNeutralPerpRow || closeDeltaNeutralSubmitting}
                  onClick={() => setCloseDeltaNeutralOpen(true)}
                  className="border-red-500/30 text-red-600 hover:bg-red-500/5 hover:text-red-700 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
                >
                  Close delta-neutral
                </Button>
                {!deltaNeutralPerpRow ? (
                  <span className="text-xs text-muted-foreground self-center">
                    Close is disabled until Decibel shows the short (API sync).
                  </span>
                ) : null}
              </div>
            </div>
          )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {showDeltaNeutralCard && deltaNeutral?.isOpen && (
        <div className="rounded-lg border bg-card p-3 sm:p-4 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="font-medium">Decibel delta-neutral</div>
              <div className="text-sm text-muted-foreground">
                Perp short + spot hedge inside your safe.
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-start sm:justify-end gap-2">
              <Badge className="bg-green-500/10 text-green-700 border-green-500/30 shrink-0">
                Open
              </Badge>
              {openPositionFundingApr24h != null ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      className={cn(
                        "cursor-help select-none tabular-nums shrink-0",
                        openPositionFundingApr24h >= 0
                          ? "bg-green-500/10 text-green-700 border-green-500/30"
                          : "bg-destructive/10 text-destructive border-destructive/30"
                      )}
                    >
                      Funding: {openPositionFundingApr24h >= 0 ? "+" : ""}
                      {openPositionFundingApr24h.toFixed(2)}% APR
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[260px] text-xs">
                    <p className="font-medium mb-1">Funding APR (24h)</p>
                    <p className="text-muted-foreground">
                      Average annualized funding rate over the last 24 hours for the current market.
                      Positive values mean shorts earn funding; negative values mean shorts pay.
                    </p>
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    className="cursor-help select-none shrink-0 bg-green-500/10 text-green-700 border-green-500/30"
                  >
                    AMPs
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[260px] text-xs">
                  <p className="font-medium mb-1">AMPs</p>
                  <p className="text-muted-foreground">
                    Decibel trading points that may be used for future incentives/token distribution.
                    Points are typically updated once per day.
                  </p>
                </TooltipContent>
              </Tooltip>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!deltaNeutralPerpRow || closeDeltaNeutralSubmitting}
                className="border-red-500/30 text-red-600 hover:bg-red-500/5 hover:text-red-700 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
                onClick={() => {
                  setCloseDeltaNeutralForceRequested(false);
                  setCloseDeltaNeutralOpen(true);
                }}
              >
                Close position
              </Button>
            </div>
          </div>
          {!deltaNeutralLoading && !decibelPositionsLoading && deltaNeutral && !deltaNeutralPerpRow ? (
            <div className="text-xs text-muted-foreground">
              Close is disabled until Decibel shows the short (API sync).
            </div>
          ) : null}
          {deltaNeutralLoading || decibelPositionsLoading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading delta-neutral state…
            </div>
          ) : !deltaNeutral ? null : (
            <div className="space-y-3 text-sm">
              {(() => {
                const decibelMarkPx =
                  decibelMarketPrice && typeof decibelMarketPrice.markPx === "number"
                    ? decibelMarketPrice.markPx
                    : null;
                const spotPriceHuman = deltaNeutralSpotToken?.price
                  ? parseFloat(deltaNeutralSpotToken.price)
                  : null;
                const entryPxPerp = deltaNeutralPerpRow?.entry_price
                  ? Number(deltaNeutralPerpRow.entry_price)
                  : null;
                const markPx =
                  decibelMarkPx != null && decibelMarkPx > 0
                    ? decibelMarkPx
                    : Number.isFinite(spotPriceHuman) && (spotPriceHuman as number) > 0
                      ? (spotPriceHuman as number)
                      : Number.isFinite(entryPxPerp) && (entryPxPerp as number) > 0
                        ? (entryPxPerp as number)
                        : null;
                const markSource: "decibel" | "panora" | "entry" | null =
                  decibelMarkPx != null && decibelMarkPx > 0
                    ? "decibel"
                    : Number.isFinite(spotPriceHuman) && (spotPriceHuman as number) > 0
                      ? "panora"
                      : Number.isFinite(entryPxPerp) && (entryPxPerp as number) > 0
                        ? "entry"
                        : null;

                const spotHuman = deltaNeutralSpotToken
                  ? parseFloat(deltaNeutralSpotToken.amount || "0") /
                    Math.pow(10, deltaNeutralSpotToken.decimals ?? 8)
                  : 0;
                const shortSizeAbs = deltaNeutralPerpRow
                  ? Math.abs(Number(deltaNeutralPerpRow.size) || 0)
                  : 0;

                const longNotionalUsd = markPx != null ? spotHuman * markPx : null;
                const shortNotionalUsd = markPx != null ? shortSizeAbs * markPx : null;
                const netDeltaUsd =
                  longNotionalUsd != null && shortNotionalUsd != null
                    ? longNotionalUsd - shortNotionalUsd
                    : null;

                const perpPricePnlUsd =
                  deltaNeutralPerpRow &&
                  markPx != null &&
                  Number.isFinite(Number(deltaNeutralPerpRow.entry_price))
                    ? Number(deltaNeutralPerpRow.size) *
                      (markPx - Number(deltaNeutralPerpRow.entry_price))
                    : null;
                const usdcSwappedInUsd = Number(deltaNeutral.usdcSwappedIn) / 1e6;
                const spotPricePnlUsd =
                  longNotionalUsd != null && Number.isFinite(usdcSwappedInUsd)
                    ? longNotionalUsd - usdcSwappedInUsd
                    : null;

                const unrealizedFundingRaw =
                  typeof deltaNeutralPerpRow?.unrealized_funding === "number"
                    ? deltaNeutralPerpRow.unrealized_funding
                    : null;
                const fundingUnrealizedUsd =
                  unrealizedFundingRaw != null ? -unrealizedFundingRaw : null;

                const fundingRealizedUsd =
                  decibelLedger && Number.isFinite(decibelLedger.realizedFundingEarnedUsd)
                    ? decibelLedger.realizedFundingEarnedUsd
                    : 0;

                const fundingTotalUsd =
                  fundingUnrealizedUsd != null
                    ? fundingRealizedUsd + fundingUnrealizedUsd
                    : null;

                const totalPnlAvailable =
                  perpPricePnlUsd != null &&
                  spotPricePnlUsd != null &&
                  fundingTotalUsd != null;
                const totalPnlUsd =
                  (perpPricePnlUsd ?? 0) +
                  (spotPricePnlUsd ?? 0) +
                  (fundingTotalUsd ?? 0);

                const pnlColor = (n: number | null | undefined) =>
                  n == null
                    ? "text-muted-foreground"
                    : n > 0.005
                      ? "text-green-600 dark:text-green-400"
                      : n < -0.005
                        ? "text-destructive"
                        : "text-muted-foreground";

                const netDeltaColor =
                  netDeltaUsd == null
                    ? "text-muted-foreground"
                    : Math.abs(netDeltaUsd) < 0.25
                      ? "text-muted-foreground"
                      : netDeltaUsd > 0
                        ? "text-green-600 dark:text-green-400"
                        : "text-destructive";

                const signed = (n: number) => `${n >= 0 ? "+" : ""}${formatCurrency(n, 2)}`;

                const totalNotionalUsd =
                  longNotionalUsd != null && shortNotionalUsd != null
                    ? longNotionalUsd + shortNotionalUsd
                    : null;

                const openedAtSec = Number(deltaNeutral.openedAt || "0");
                const nowSec = Math.floor(Date.now() / 1000);
                const elapsedSec = openedAtSec > 0 ? Math.max(0, nowSec - openedAtSec) : 0;
                const elapsedDays = Math.floor(elapsedSec / 86400);
                const elapsedHours = Math.floor((elapsedSec % 86400) / 3600);
                const durationLabel =
                  openedAtSec > 0 ? `Open for ${elapsedDays}d ${elapsedHours}h` : null;

                return (
                  <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Position summary
                      </span>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        {durationLabel ? (
                          <span className="text-[11px] text-muted-foreground">
                            {durationLabel}
                          </span>
                        ) : null}
                        {deltaNeutral.decibelSubaccount ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline max-w-[200px] truncate"
                                onClick={() => {
                                  navigator.clipboard
                                    .writeText(deltaNeutral.decibelSubaccount)
                                    .then(() =>
                                      toast({
                                        title: "Copied",
                                        description: "Decibel subaccount copied to clipboard",
                                      })
                                    )
                                    .catch(() =>
                                      toast({
                                        title: "Copy failed",
                                        variant: "destructive",
                                      })
                                    );
                                }}
                              >
                                Decibel: {deltaNeutral.decibelSubaccount.slice(0, 6)}…{deltaNeutral.decibelSubaccount.slice(-4)}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                              <p>Copy Decibel subaccount</p>
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                      </div>
                    </div>

                    {(() => {
                      // Invested amounts (on-chain at open): used as baseline.
                      const spotAtOpenUsd = Number.isFinite(usdcSwappedInUsd) ? usdcSwappedInUsd : null;
                      const shortAtOpenUsd =
                        Number.isFinite(shortSizeAbs) && entryPxPerp != null
                          ? shortSizeAbs * entryPxPerp
                          : null;
                      const totalAtOpenUsd =
                        spotAtOpenUsd != null && shortAtOpenUsd != null
                          ? spotAtOpenUsd + shortAtOpenUsd
                          : null;

                      // Conservative close-cost estimates (no network calls — see
                      // strategy-registry-and-dn-v2.md). Replaced at close-time with
                      // Hyperion quote + Decibel taker preview.
                      // - slippage: 50 bps of spot leg (Hyperion 20 bps INPUT_BUFFER
                      //   + ~30 bps typical price impact on $50–$5k notionals).
                      // - exit fee: 5 bps Hyperion pool fee (feeTier=1) on spot
                      //   leg + Decibel Tier-0 taker fee 3.4 bps + builder fee
                      //   (configurable; only applies when approved on-chain) on perp leg
                      //   (per docs.decibel.trade/for-traders/fees, accurate for <$10M monthly volume).
                      const slippageEstUsd =
                        longNotionalUsd != null ? longNotionalUsd * 0.005 : null;
                      const builderRequiredBps =
                        recordSubaccountBuilderApproval.requiredBps != null
                          ? recordSubaccountBuilderApproval.requiredBps
                          : 0;
                      const builderAppliedBps = recordSubaccountBuilderApproval.meetsRequiredFee
                        ? builderRequiredBps
                        : 0;
                      const builderFeeRate = builderAppliedBps / 10_000;
                      const exitFeeEstUsd =
                        longNotionalUsd != null && shortNotionalUsd != null
                          ? longNotionalUsd * 0.0005 + shortNotionalUsd * (0.00034 + builderFeeRate)
                          : null;

                      // "Position value now" = invested + every PnL component
                      // (spot price + perp price + funding). This is the only
                      // metric that lets the user judge the position vs invested
                      // baseline — the previous `totalNotionalUsd` was just
                      // `2 × spot × markPx`, which double-counts the spot price
                      // move and ignores both perp PnL and accrued funding.
                      const positionValueNowUsd =
                        totalAtOpenUsd != null && totalPnlAvailable
                          ? totalAtOpenUsd + totalPnlUsd
                          : null;
                      const positionDeltaVsInvestedUsd = totalPnlAvailable ? totalPnlUsd : null;
                      const estProceedsUsd =
                        totalAtOpenUsd != null && totalPnlAvailable
                          ? totalAtOpenUsd + totalPnlUsd - (slippageEstUsd ?? 0) - (exitFeeEstUsd ?? 0)
                          : null;

                      const spotSymbol = deltaNeutralSpotToken?.symbol ?? "spot";
                      const fundingApr = openPositionFundingApr24h;
                      // Waterfall steps: invested → +spot PnL → +perp PnL →
                      // +funding → −slippage → −exit fee → est. proceeds.
                      // Each delta-row carries enough per-leg context (token
                      // amount, entry price, funding APR) to replace the
                      // removed 3-tile per-leg grid.
                      const waterfallSteps: Array<{
                        label: string;
                        value: number | null;
                        kind: "start" | "delta" | "end";
                        note?: string;
                      }> = [
                        {
                          label: "Invested",
                          value: totalAtOpenUsd,
                          kind: "start",
                          note:
                            spotAtOpenUsd != null && shortAtOpenUsd != null
                              ? `${formatCurrency(spotAtOpenUsd, 2)} spot + ${formatCurrency(shortAtOpenUsd, 2)} perp`
                              : undefined,
                        },
                        {
                          label: "Spot PnL",
                          value: spotPricePnlUsd,
                          kind: "delta",
                          note: `${formatNumber(spotHuman, 8)} ${spotSymbol}`,
                        },
                        {
                          label: "Perp PnL",
                          value: perpPricePnlUsd,
                          kind: "delta",
                          note:
                            entryPxPerp != null
                              ? `${formatNumber(shortSizeAbs, 8)} short · entry ~${formatCurrency(entryPxPerp, 2)}`
                              : `${formatNumber(shortSizeAbs, 8)} short`,
                        },
                        {
                          label: "Funding",
                          value: fundingTotalUsd,
                          kind: "delta",
                          note:
                            fundingApr != null
                              ? `${fundingApr >= 0 ? "+" : ""}${fundingApr.toFixed(2)}% 24h APR`
                              : undefined,
                        },
                        {
                          label: "Slippage (est.)",
                          value: slippageEstUsd != null ? -slippageEstUsd : null,
                          kind: "delta",
                          note: "0.5% on spot close swap",
                        },
                        {
                          label: "Exit fee (est.)",
                          value: exitFeeEstUsd != null ? -exitFeeEstUsd : null,
                          kind: "delta",
                          note: `Hyperion 5 bps + Decibel taker 3.4 bps + builder ${builderAppliedBps} bps${
                            builderAppliedBps > 0 ? "" : " (not approved)"
                          }`,
                        },
                        { label: "Est. proceeds", value: estProceedsUsd, kind: "end" },
                      ];

                      // Right after opening, Decibel's API has not indexed the
                      // short yet (`deltaNeutralPerpRow` is null) so the KPIs
                      // resolve to null. Show a "Syncing…" spinner instead of a
                      // bare "—" so a freshly opened position does not look
                      // broken/empty.
                      //
                      // But a missing perp row is ALSO the stale-state case:
                      // the Decibel short was already closed while the on-chain
                      // record stayed open (e.g. the close swap failed on the
                      // daily limit). There "Syncing…" would spin forever and
                      // mislead. So only treat a missing perp row as syncing
                      // within a short grace window after open — past that it
                      // is stale and the "Force close (recovery)" block below
                      // is the correct explanation.
                      const KPI_SYNC_GRACE_SEC = 15 * 60;
                      const recentlyOpened =
                        elapsedSec > 0 && elapsedSec < KPI_SYNC_GRACE_SEC;
                      const kpiSyncing =
                        Boolean(deltaNeutral.isOpen) &&
                        (decibelPositionsLoading ||
                          (!deltaNeutralPerpRow && recentlyOpened));
                      const kpiPlaceholder = kpiSyncing ? (
                        <span className="inline-flex items-center gap-1.5 text-base font-normal text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Syncing with Decibel…
                        </span>
                      ) : (
                        "—"
                      );

                      return (
                        <>
                          {/* Two top KPIs: position value now and est. proceeds at close. */}
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div className="rounded-md bg-background/60 border border-border/40 p-3 flex flex-col gap-1">
                              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                Position value now
                              </div>
                              <div className="text-2xl font-semibold tabular-nums">
                                {positionValueNowUsd != null
                                  ? formatCurrency(positionValueNowUsd, 2)
                                  : kpiPlaceholder}
                              </div>
                              {positionDeltaVsInvestedUsd != null && totalAtOpenUsd != null ? (
                                <div className="text-[11px] text-muted-foreground tabular-nums">
                                  <span className={pnlColor(positionDeltaVsInvestedUsd)}>
                                    {signed(positionDeltaVsInvestedUsd)}
                                  </span>{" "}
                                  vs {formatCurrency(totalAtOpenUsd, 2)} invested
                                </div>
                              ) : null}
                            </div>
                            <div className="rounded-md bg-background/60 border border-border/40 p-3 flex flex-col gap-1">
                              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                If you close now
                              </div>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="text-2xl font-semibold tabular-nums cursor-help">
                                    {estProceedsUsd != null
                                      ? `~${formatCurrency(estProceedsUsd, 2)}`
                                      : kpiPlaceholder}
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="max-w-[280px] text-xs">
                                  <p className="mb-1">
                                    Estimated USDC you&apos;d get across safe + Decibel subaccount
                                    if you closed now: invested + total PnL − slippage − exit fees.
                                  </p>
                                  <p className="text-muted-foreground">
                                    Spot half lands in your safe; perp half stays on the Decibel
                                    subaccount until withdrawn. Actual proceeds depend on close-time
                                    liquidity.
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                              <div className="text-[11px] text-muted-foreground">
                                after slippage &amp; fees
                              </div>
                            </div>
                          </div>

                          {/* Phase 2: two-pane Decibel chart (price + funding APR).
                              Controlled so the Funding row in the breakdown below
                              can open it programmatically. The wrapping div
                              hosts the ref since Radix Collapsible doesn't
                              guarantee a DOM-node ref forward. */}
                          {deltaNeutral.perpMarket ? (
                            <div ref={openPositionChartRef} className="scroll-mt-4">
                            <Collapsible
                              open={openPositionChartOpen}
                              onOpenChange={setOpenPositionChartOpen}
                              className="pt-2 border-t border-border/60"
                            >
                              <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                                <ChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />
                                <span>
                                  Price chart{executorMarketName ? ` · ${executorMarketName.replace("-", "/")}` : ""}
                                  <span className="text-muted-foreground/70"> · price + funding APR</span>
                                </span>
                              </CollapsibleTrigger>
                              <CollapsibleContent className="pt-3">
                                {(() => {
                                  // Range from open time minus a small leading
                                  // window so the user sees a few candles BEFORE
                                  // entry. Cap at 7 days for very long positions.
                                  // Round to a 5-minute boundary so the prop is
                                  // stable across re-renders (otherwise Date.now()
                                  // drift causes DecibelChart to re-init and flash
                                  // "Loading…").
                                  const fiveMinMs = 5 * 60_000;
                                  const openedAtMs =
                                    Number(deltaNeutral.openedAt || "0") * 1000 ||
                                    Date.now() - 24 * 3600_000;
                                  const leadMs = 6 * 3600_000;
                                  const sevenDaysMs = 7 * 24 * 3600_000;
                                  const rawStart = Math.max(
                                    openedAtMs - leadMs,
                                    Date.now() - sevenDaysMs
                                  );
                                  const startMs = Math.floor(rawStart / fiveMinMs) * fiveMinMs;
                                  const entryLines =
                                    Number.isFinite(entryPxPerp) && (entryPxPerp as number) > 0
                                      ? [entryPxPerp as number]
                                      : [];
                                  return (
                                    <DeltaNeutralPriceFundingChart
                                      marketAddr={deltaNeutral.perpMarket}
                                      marketName={executorMarketName ?? `${executorAsset}/USD`}
                                      interval="15m"
                                      startTime={startMs}
                                      entryPrices={entryLines}
                                      className="h-[400px]"
                                    />
                                  );
                                })()}
                              </CollapsibleContent>
                            </Collapsible>
                            </div>
                          ) : null}

                          {/* Collapsed-by-default waterfall: invested → est. proceeds.
                              Phase 2 will swap the text rows for a TradingView-style
                              chart while keeping the same data shape. */}
                          <Collapsible className="pt-2 border-t border-border/60">
                            <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                              <ChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />
                              <span>Breakdown · invested → est. proceeds</span>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="pt-3">
                              <div className="space-y-1.5">
                                {waterfallSteps.map((step) => {
                                  const isAnchor = step.kind !== "delta";
                                  const isMissing = step.value == null;
                                  const valueClass = isAnchor
                                    ? "font-semibold text-foreground"
                                    : pnlColor(step.value);
                                  // Funding row links to the chart pane below
                                  // — clicking opens the Price chart collapsible
                                  // and scrolls the user to it.
                                  const isFundingStep =
                                    step.label === "Funding" && Boolean(deltaNeutral.perpMarket);
                                  return (
                                    <div
                                      key={step.label}
                                      onClick={isFundingStep ? handleScrollToFundingChart : undefined}
                                      onKeyDown={
                                        isFundingStep
                                          ? (e) => {
                                              if (e.key === "Enter" || e.key === " ") {
                                                e.preventDefault();
                                                handleScrollToFundingChart();
                                              }
                                            }
                                          : undefined
                                      }
                                      role={isFundingStep ? "button" : undefined}
                                      tabIndex={isFundingStep ? 0 : undefined}
                                      aria-label={
                                        isFundingStep ? "Show funding history in chart" : undefined
                                      }
                                      className={cn(
                                        "flex items-baseline justify-between gap-2 py-1",
                                        isAnchor && "border-y border-border/40 bg-muted/30 -mx-1 px-2",
                                        isFundingStep &&
                                          "cursor-pointer rounded -mx-1 px-1 hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
                                      )}
                                    >
                                      <div className="flex items-baseline gap-2 min-w-0">
                                        <span
                                          className={cn(
                                            "text-xs",
                                            isAnchor ? "font-medium text-foreground" : "text-muted-foreground"
                                          )}
                                        >
                                          {step.label}
                                        </span>
                                        {step.note ? (
                                          <span className="text-[10px] text-muted-foreground/70 truncate">
                                            {step.note}
                                          </span>
                                        ) : null}
                                        {isFundingStep ? (
                                          <span
                                            className="text-[10px] text-muted-foreground/60 shrink-0"
                                            aria-hidden
                                          >
                                            ↗ chart
                                          </span>
                                        ) : null}
                                      </div>
                                      <span className={cn("text-sm tabular-nums", valueClass)}>
                                        {isMissing
                                          ? "—"
                                          : isAnchor
                                            ? formatCurrency(step.value as number, 2)
                                            : signed(step.value as number)}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                              <div className="text-[11px] text-muted-foreground pt-2">
                                In a sized delta-neutral, price PnL on spot and perp approximately
                                cancel; strategy net ≈ funding minus entry/exit costs. Slippage
                                and exit fees are conservative estimates — actuals shown in the
                                close-position confirmation.
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        </>
                      );
                    })()}
                  </div>
                );
              })()}
              {!deltaNeutralPerpRow ? (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={closeDeltaNeutralSubmitting}
                    className="border-destructive/40 text-destructive hover:bg-destructive/5"
                    onClick={() => {
                      setCloseDeltaNeutralForceRequested(true);
                      setCloseDeltaNeutralOpen(true);
                    }}
                  >
                    Force close (recovery)
                  </Button>
                  <span className="text-xs text-muted-foreground self-center">
                    No Decibel short — use recovery to clear stale state.
                  </span>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {isDeltaNeutralStrategy && (dnPositions.length > 0 || deltaNeutralCyclesFetching) && (
        <div className="rounded-lg border bg-card p-3 sm:p-4 space-y-3">
          <div className="flex items-center gap-2 font-medium">
            Delta-neutral positions
            {deltaNeutralCyclesFetching && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </div>
          {dnPositions.length === 0 && deltaNeutralCyclesFetching && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading positions…
            </div>
          )}
          {(() => {
            const withVal = dnPositions.filter((p) => p.deployedUsd != null && p.totalValueUsd != null);
            if (withVal.length === 0) return null;
            const dep = withVal.reduce((s, p) => s + (p.deployedUsd ?? 0), 0);
            const pnl = withVal.reduce((s, p) => {
              if (p.pnlPriceUsd == null) return s;
              return (
                s +
                p.pnlPriceUsd +
                (p.perpFundingUsd ?? 0) +
                (p.lpLeg?.claimableFeesUsd ?? 0) +
                (p.lpLeg?.claimedFeesUsd ?? 0) +
                (p.lpLeg?.claimableRewardsUsd ?? 0) +
                (p.lpLeg?.claimedRewardsUsd ?? 0)
              );
            }, 0);
            // Value = deposited + PnL (all-in economic value), so deposited -> value delta IS the PnL.
            const val = dep + pnl;
            const pct = dep > 0 ? (pnl / dep) * 100 : null;
            return (
              <div className="flex items-center gap-x-4 gap-y-1 flex-wrap rounded-md border bg-muted/20 px-3 py-2 text-sm">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs text-muted-foreground">Deposited</span>
                  <span className="font-medium">{formatCurrency(dep, 2)}</span>
                </div>
                <span className="text-muted-foreground/50">→</span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs text-muted-foreground">Value</span>
                  <span className="font-semibold">{formatCurrency(val, 2)}</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs text-muted-foreground">PnL</span>
                  <span
                    className={cn(
                      "font-medium",
                      pnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                    )}
                  >
                    {pnl >= 0 ? "+" : ""}
                    {formatCurrency(pnl, 2)}
                    {pct != null && (
                      <span className="text-xs">
                        {" "}
                        ({pct >= 0 ? "+" : ""}
                        {formatNumber(pct, 2)}%)
                      </span>
                    )}
                  </span>
                </div>
              </div>
            );
          })()}
          <div className="space-y-2">
            {dnPositions.map((p) => {
              const closing = p.source === "journal" && closingCycleId === p.cycleId;
              const ageH =
                p.openedAt > 0
                  ? Math.max(0, Math.floor((Date.now() / 1000 - p.openedAt) / 3600))
                  : null;
              const ageLabel =
                ageH == null ? null : ageH < 24 ? `${ageH}h` : `${Math.floor(ageH / 24)}d ${ageH % 24}h`;
              const logoUrl =
                p.asset === "BTC"
                  ? configuredBtcSpotAsset.logoUrl
                  : "https://assets.panora.exchange/tokens/aptos/APT.svg";
              const totalUsd = p.totalValueUsd != null ? p.totalValueUsd : null;
              // Derived USD metrics shared by the collapsed hero + expanded details.
              // Short size: prefer the LIVE Decibel position — the journal-recorded size can lag
              // by a lot when a rehedge order landed but its record_action tx failed, which made
              // the hedge gauge scream "Rehedge needed" while the cron (live-based) correctly
              // saw the drift in-band.
              const effectiveShortHuman = p.liveShortSizeHuman ?? p.shortSizeHuman;
              const depositedUsd = p.deployedUsd;
              // Total economic PnL (price + funding + claimable/claimed fees + rewards) — matches the
              // header PnL chip. Value = deposited + this, so the deposited -> value delta IS the PnL.
              // (Principal mark-to-market alone excludes accrued fees/funding and looked contradictory:
              // value below deposited while PnL was positive.)
              const pnlTotalUsd =
                p.pnlPriceUsd != null
                  ? p.pnlPriceUsd +
                    (p.perpFundingUsd ?? 0) +
                    (p.lpLeg?.claimableFeesUsd ?? 0) +
                    (p.lpLeg?.claimedFeesUsd ?? 0) +
                    (p.lpLeg?.claimableRewardsUsd ?? 0) +
                    (p.lpLeg?.claimedRewardsUsd ?? 0)
                  : null;
              const valueUsd =
                depositedUsd != null && pnlTotalUsd != null ? depositedUsd + pnlTotalUsd : p.totalValueUsd;
              // Gross position APR: LP fees/farm on LP value + funding on short notional, over deployed.
              const lpValForApr = p.spotValueUsd ?? p.lpLeg?.valueUsd ?? 0;
              const marginForApr = p.perpMarginUsd ?? 0;
              const totalCapForApr = lpValForApr + marginForApr;
              const shortNotionalForApr = (effectiveShortHuman ?? 0) * (p.markPx ?? 0);
              const grossAprPct =
                totalCapForApr > 0
                  ? ((lpValForApr * ((p.lpLeg?.rangeAprPct ?? 0) / 100) +
                      shortNotionalForApr * ((p.fundingAprPct ?? 0) / 100)) /
                      totalCapForApr) *
                    100
                  : null;
              // Realized APR is meaningful only after the young-window noise settles (~1d).
              const realizedAprShown =
                p.realizedAprPct != null && (p.realizedAgeDays ?? 0) >= 1 ? p.realizedAprPct : null;
              const marketId = normalizeAddress(p.marketAddr);
              const isHighlighted = highlightedDnMarket === marketId;
              return (
                <Collapsible
                  key={p.key}
                  id={`dn-position-${marketId}`}
                  className={cn(
                    "rounded-md border bg-muted/20 transition-shadow",
                    isHighlighted && "ring-2 ring-primary ring-offset-1"
                  )}
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap px-3 py-2.5">
                    {/* Collapsed: icon + market + total value (+ PnL, funding). Details on expand. */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Image
                        src={logoUrl}
                        alt={p.asset}
                        width={28}
                        height={28}
                        className="h-7 w-7 rounded-full object-contain shrink-0"
                        unoptimized
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-medium">{p.marketName}</span>
                          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                            Open
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {p.source === "journal" ? `#${p.cycleId}` : "legacy"}
                          </span>
                          {p.lpLeg && (
                            <>
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                                  p.lpLeg.inRange
                                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                )}
                              >
                                LP {p.lpLeg.inRange ? "in range" : "out of range"}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                ±
                                {(
                                  (Math.pow(1.0001, (p.lpLeg.tickUpper - p.lpLeg.tickLower) / 2) - 1) * 100 || 0
                                ).toFixed(0)}
                                % · {formatNumber(p.lpLeg.aptHuman, p.lpLeg.aptHuman >= 1 ? 2 : 5)} {p.asset} +{" "}
                                {p.lpLeg.usdcHuman.toFixed(2)} USDC
                              </span>
                              {p.lpLeg.rangeAprPct != null && (
                                <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                                  ~{formatNumber(p.lpLeg.rangeAprPct, 0)}% LP APR
                                </span>
                              )}
                            </>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-baseline gap-x-2 gap-y-0.5 flex-wrap text-sm">
                          {depositedUsd != null && (
                            <span className="text-xs text-muted-foreground">
                              in {formatCurrency(depositedUsd, 2)}{" "}
                              <span className="text-muted-foreground/50">→</span>
                            </span>
                          )}
                          <span className="font-semibold">
                            {valueUsd != null
                              ? formatCurrency(valueUsd, 2)
                              : totalUsd != null
                                ? formatCurrency(totalUsd, 2)
                                : Number.isFinite(p.notionalUsd)
                                  ? formatCurrency(p.notionalUsd, 2)
                                  : "—"}
                          </span>
                          {p.pnlPriceUsd != null &&
                            (() => {
                              // PnL = price (LP value Δ + perp uPnL) + funding + LP fees + rewards,
                              // where fees/rewards = claimable (pending) + claimed (already collected),
                              // so PnL stays stable when fees are claimed (unclaimed → claimed).
                              const price = p.pnlPriceUsd ?? 0;
                              const funding = p.perpFundingUsd ?? 0;
                              const fees = (p.lpLeg?.claimableFeesUsd ?? 0) + (p.lpLeg?.claimedFeesUsd ?? 0);
                              const rewards =
                                (p.lpLeg?.claimableRewardsUsd ?? 0) + (p.lpLeg?.claimedRewardsUsd ?? 0);
                              const total = price + funding + fees + rewards;
                              return (
                                <TooltipProvider delayDuration={150}>
                                  <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span
                                      className={cn(
                                        "text-xs cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2",
                                        total >= 0
                                          ? "text-emerald-600 dark:text-emerald-400"
                                          : "text-rose-600 dark:text-rose-400"
                                      )}
                                    >
                                      {total >= 0 ? "+" : ""}
                                      {formatCurrency(total, 2)} PnL
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-[260px] text-xs">
                                    <div className="mb-1 font-medium">Net PnL (mark-to-market)</div>
                                    <div className="space-y-0.5">
                                      <div className="flex justify-between gap-4">
                                        <span className="text-muted-foreground">Price (LP value Δ + perp)</span>
                                        <span>{price >= 0 ? "+" : ""}{formatCurrency(price, 2)}</span>
                                      </div>
                                      <div className="flex justify-between gap-4">
                                        <span className="text-muted-foreground">Funding accrued</span>
                                        <span>{funding >= 0 ? "+" : ""}{formatCurrency(funding, 2)}</span>
                                      </div>
                                      {p.lpLeg && (
                                        <div className="flex justify-between gap-4">
                                          <span className="text-muted-foreground">
                                            LP fees{(p.lpLeg.claimedFeesUsd ?? 0) > 0 ? " (earned)" : " (claimable)"}
                                          </span>
                                          <span>+{formatCurrency(fees, 2)}</span>
                                        </div>
                                      )}
                                      {p.lpLeg && rewards > 0 && (
                                        <div className="flex justify-between gap-4">
                                          <span className="text-muted-foreground">
                                            Rewards{(p.lpLeg.claimedRewardsUsd ?? 0) > 0 ? " (earned)" : " (claimable)"}
                                          </span>
                                          <span>+{formatCurrency(rewards, 2)}</span>
                                        </div>
                                      )}
                                    </div>
                                    <div className="mt-1 text-muted-foreground/70">
                                      Fees/rewards = claimable + claimed (mark-to-market); excludes gas &amp; rehedge
                                      costs.
                                    </div>
                                  </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              );
                            })()}
                          {(realizedAprShown != null || grossAprPct != null) && (
                            <span className="text-xs whitespace-nowrap">
                              {realizedAprShown != null ? (
                                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                  ~{formatNumber(realizedAprShown, 0)}% APR
                                </span>
                              ) : (
                                <span className="text-muted-foreground">
                                  ~{formatNumber(grossAprPct as number, 0)}% APR{" "}
                                  <span className="text-muted-foreground/60">gross</span>
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                        <ChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />
                        Details
                      </CollapsibleTrigger>
                      {/* Top-up modal. Spot-DN adds via the spot path; LP-DN adds via the LP
                          top-up path (private beta — hidden for non-beta wallets, server-enforced too). */}
                      {p.source === "journal" && p.cycleId && (!p.lpLeg || isLpDnBetaUser) && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setAddSizeUsd("");
                            setAddTarget({ cycleId: p.cycleId!, asset: p.asset, isLp: Boolean(p.lpLeg) });
                          }}
                        >
                          Add
                        </Button>
                      )}
                      {p.source === "journal" && p.lpLeg && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={rehedgingCycleId === p.cycleId || !selectedDecibelSubaccount}
                          onClick={() => handleRehedgeCycle({ cycleId: p.cycleId!, asset: p.asset })}
                        >
                          {rehedgingCycleId === p.cycleId ? "Rehedging…" : "Rehedge"}
                        </Button>
                      )}
                      {p.source === "journal" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={closing || !selectedDecibelSubaccount}
                          className="border-destructive/40 text-destructive hover:bg-destructive/5"
                          onClick={() => setCloseCyclePromptId(p.cycleId!)}
                        >
                          {closing ? "Closing…" : "Close"}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={closeDeltaNeutralSubmitting}
                          className="border-destructive/40 text-destructive hover:bg-destructive/5"
                          onClick={() => setCloseDeltaNeutralOpen(true)}
                        >
                          Close
                        </Button>
                      )}
                    </div>
                  </div>
                  <CollapsibleContent className="px-3 pb-3 space-y-3">
                    {/* Hedge balance (LP-DN): net APT delta of LIVE LP vs LIVE short + a balance
                        gauge. Uses effectiveShortHuman (live first) — the journal-recorded size
                        can lag a failed record_action and made this gauge falsely scream
                        "Rehedge needed" while the (live-based) cron correctly saw in-band. */}
                    {p.lpLeg && effectiveShortHuman != null && p.lpLeg.aptHuman > 0
                      ? (() => {
                          const lpApt = p.lpLeg.aptHuman;
                          const netApt = lpApt - (effectiveShortHuman ?? 0); // + under-hedged, − over-hedged
                          const netUsd = netApt * (p.markPx ?? 0);
                          const band = 0.15; // rehedge band (kept at 15%)
                          const frac = netApt / lpApt;
                          const absFrac = Math.abs(frac);
                          // 3-zone: balanced < band/2, drifting band/2..band, rehedge > band.
                          const zone = absFrac > band ? "rehedge" : absFrac > band / 2 ? "drifting" : "balanced";
                          const zoneLabel =
                            zone === "balanced" ? "Balanced" : zone === "drifting" ? "Drifting" : "Rehedge needed";
                          const zoneText =
                            zone === "balanced"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : zone === "drifting"
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-rose-600 dark:text-rose-400";
                          const zoneMarker =
                            zone === "balanced"
                              ? "bg-emerald-500"
                              : zone === "drifting"
                                ? "bg-amber-500"
                                : "bg-rose-500";
                          const pos = 50 + Math.max(-50, Math.min(50, (frac / (band * 2)) * 50));
                          // Blended position APR on total deployed capital (LP + margin): LP fees/farm
                          // on the LP value + funding on the short notional. GROSS — excludes
                          // rehedge/gamma/gas, assumes in-range. Diluted below the LP APR by the margin.
                          const positionAprPct = grossAprPct;
                          return (
                            <div className="space-y-1 pt-1 border-t border-border/40">
                              {(positionAprPct != null || realizedAprShown != null) && (
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-muted-foreground">Position APR</span>
                                  <span>
                                    {realizedAprShown != null && (
                                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                        {formatNumber(realizedAprShown, 1)}% realized
                                      </span>
                                    )}
                                    {realizedAprShown != null && positionAprPct != null && (
                                      <span className="text-muted-foreground/50"> · </span>
                                    )}
                                    {positionAprPct != null && (
                                      <span className="text-muted-foreground">
                                        {formatNumber(positionAprPct, 1)}% gross
                                      </span>
                                    )}
                                  </span>
                                </div>
                              )}
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">Hedge balance</span>
                                <span className={cn("font-medium", zoneText)}>
                                  {zoneLabel} · Δ {netApt >= 0 ? "+" : ""}
                                  {formatNumber(netApt, 2)} {p.asset} ({formatCurrency(netUsd, 2)} ·{" "}
                                  {frac >= 0 ? "+" : ""}
                                  {formatNumber(frac * 100, 0)}%)
                                </span>
                              </div>
                              <div className="relative h-2 overflow-hidden rounded-full bg-muted/60">
                                {/* amber drifting band (±15%) */}
                                <div className="absolute inset-y-0 bg-amber-500/15" style={{ left: "25%", right: "25%" }} />
                                {/* green balanced band (±7.5%) */}
                                <div className="absolute inset-y-0 bg-emerald-500/25" style={{ left: "37.5%", right: "37.5%" }} />
                                <div className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: "50%" }} />
                                <div
                                  className={cn(
                                    "absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm",
                                    zoneMarker
                                  )}
                                  style={{ left: `${pos}%` }}
                                />
                              </div>
                              <div className="flex justify-between text-[10px] text-muted-foreground/70">
                                <span>over-hedged</span>
                                <span>balanced</span>
                                <span>under-hedged</span>
                              </div>
                            </div>
                          );
                        })()
                      : null}
                    {/* Composition in USD: where the deposited capital sits + the short hedge. */}
                    {p.lpLeg && depositedUsd != null && depositedUsd > 0 && (
                      <div className="space-y-1 pt-1 border-t border-border/40">
                        <div className="text-[10px] text-muted-foreground">
                          Where the {formatCurrency(depositedUsd, 2)} sits
                        </div>
                        {(() => {
                          const lp = p.spotValueUsd ?? p.lpLeg.valueUsd ?? 0;
                          const margin = p.perpMarginUsd ?? 0;
                          const tot = lp + margin || 1;
                          return (
                            <div className="flex h-5 overflow-hidden rounded text-[10px] font-medium">
                              <div
                                className="flex items-center justify-center bg-sky-500/15 text-sky-700 dark:text-sky-300"
                                style={{ width: `${(lp / tot) * 100}%` }}
                              >
                                LP {formatCurrency(lp, 2)}
                              </div>
                              <div
                                className="flex items-center justify-center border-l-2 border-background bg-violet-500/15 text-violet-700 dark:text-violet-300"
                                style={{ width: `${(margin / tot) * 100}%` }}
                              >
                                Margin {formatCurrency(margin, 2)}
                              </div>
                            </div>
                          );
                        })()}
                        <div className="text-[11px] text-muted-foreground">
                          Short <span className="text-foreground">{formatCurrency(shortNotionalForApr, 2)}</span>{" "}
                          hedges the {p.asset} in the LP · net Δ{" "}
                          <span className="text-foreground">
                            {formatCurrency((p.lpLeg.aptHuman - (effectiveShortHuman ?? 0)) * (p.markPx ?? 0), 2)}
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs pt-1 border-t border-border/40">
                      {/* LP / spot leg */}
                      <div className="text-muted-foreground">
                        {p.lpLeg ? "LP" : "Spot"}:{" "}
                        <span className="text-foreground">
                          {/* LP cycles: show the LIVE LP APT (drifts with price), not base_exposure
                              at open — must match the header composition + the Hedge balance Δ. */}
                          {p.lpLeg
                            ? formatNumber(p.lpLeg.aptHuman, 4)
                            : p.spotHuman != null
                              ? formatNumber(p.spotHuman, 4)
                              : "—"}{" "}
                          {p.asset}
                        </span>
                      </div>
                      {p.spotValueUsd != null && (
                        <div className="text-muted-foreground">
                          {p.lpLeg ? "LP value" : "Spot value"}:{" "}
                          <span className="text-foreground">{formatCurrency(p.spotValueUsd, 2)}</span>
                        </div>
                      )}
                      {p.lpLeg?.rangeAprPct != null && (
                        <div className="text-muted-foreground">
                          LP APR:{" "}
                          <span className="font-medium text-emerald-600 dark:text-emerald-400">
                            {formatNumber(p.lpLeg.rangeAprPct, 1)}%
                          </span>
                          {p.lpLeg.feeAprPct != null ? (
                            <span className="text-muted-foreground/70"> (fee {formatNumber(p.lpLeg.feeAprPct, 1)}%)</span>
                          ) : null}
                        </div>
                      )}
                      {p.lpLeg?.claimableFeesUsd != null && (
                        <div className="text-muted-foreground">
                          Claimable:{" "}
                          <span className="text-foreground">{formatCurrency(p.lpLeg.claimableFeesUsd, 2)} fees</span>
                          {p.lpLeg.rewardCount ? (
                            <span className="text-muted-foreground/70">
                              {" "}
                              + {p.lpLeg.rewardCount} reward{p.lpLeg.rewardCount > 1 ? "s" : ""}
                            </span>
                          ) : null}
                        </div>
                      )}
                      {/* Short / perp leg (live size, falls back to the journal record) */}
                      <div className="text-muted-foreground">
                        Short:{" "}
                        <span className="text-foreground">
                          {effectiveShortHuman != null ? formatNumber(effectiveShortHuman, 4) : "—"} {p.asset}
                        </span>
                        <span
                          title="This Decibel short also earns Decibel AMPs (points) as a bonus."
                          className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-violet-500/10 px-1.5 py-0 text-[9px] font-medium text-violet-600 dark:text-violet-400 align-middle"
                        >
                          ⚡ AMPs
                        </span>
                      </div>
                      {p.perpEntryPx != null && (
                        <div className="text-muted-foreground">
                          Entry: <span className="text-foreground">{formatNumber(p.perpEntryPx, 2)}</span>
                        </div>
                      )}
                      {p.markPx != null && (
                        <div className="text-muted-foreground">
                          Mark: <span className="text-foreground">{formatNumber(p.markPx, 2)}</span>
                        </div>
                      )}
                      {p.perpMarginUsd != null && (
                        <div className="text-muted-foreground">
                          Perp margin: <span className="text-foreground">{formatCurrency(p.perpMarginUsd, 2)}</span>
                        </div>
                      )}
                      {p.fundingAprPct != null && (
                        <div className="text-muted-foreground">
                          Funding APR:{" "}
                          <span
                            className={cn(
                              "font-medium",
                              p.fundingAprPct >= 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-rose-600 dark:text-rose-400"
                            )}
                          >
                            {p.fundingAprPct >= 0 ? "+" : ""}
                            {formatNumber(p.fundingAprPct, 1)}%
                          </span>
                        </div>
                      )}
                      {p.perpUPnlUsd != null && (
                        <div className="text-muted-foreground">
                          Perp uPnL: <span className="text-foreground">{formatCurrency(p.perpUPnlUsd, 2)}</span>
                        </div>
                      )}
                      {/* Totals */}
                      <div className="text-muted-foreground">
                        Deployed:{" "}
                        <span className="text-foreground">{formatCurrency(p.deployedUsd ?? p.notionalUsd, 2)}</span>
                        {p.lpLeg && p.perpMarginUsd != null && p.deployedUsd != null ? (
                          <span className="text-muted-foreground/70">
                            {" "}
                            (LP {formatCurrency(p.deployedUsd - p.perpMarginUsd, 2)} + margin{" "}
                            {formatCurrency(p.perpMarginUsd, 2)})
                          </span>
                        ) : null}
                      </div>
                      {p.estCloseUsd != null && (
                        <div className="text-muted-foreground">
                          If closed now: <span className="text-foreground">≈ {formatCurrency(p.estCloseUsd, 2)}</span>
                        </div>
                      )}
                      {ageLabel && (
                        <div className="text-muted-foreground">
                          Age: <span className="text-foreground">{ageLabel}</span>
                        </div>
                      )}
                    </div>
                    {p.marketAddr ? (
                      <DeltaNeutralPriceFundingChart
                        marketAddr={p.marketAddr}
                        marketName={p.marketName}
                        interval="1h"
                        className="h-[300px]"
                        rangeLowerPrice={
                          p.lpLeg && p.lpLeg.tickLower !== p.lpLeg.tickUpper
                            ? Math.pow(1.0001, p.lpLeg.tickLower) * 100
                            : undefined
                        }
                        rangeUpperPrice={
                          p.lpLeg && p.lpLeg.tickLower !== p.lpLeg.tickUpper
                            ? Math.pow(1.0001, p.lpLeg.tickUpper) * 100
                            : undefined
                        }
                        entryPrices={p.lpLeg && p.perpEntryPx != null ? [p.perpEntryPx] : []}
                      />
                    ) : null}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        </div>
      )}

      {isDeltaNeutralStrategy && (
        <>

          <div className="rounded-lg border bg-card p-3 sm:p-4 space-y-3">
            <div>
              <div className="font-medium">Create delta-neutral position</div>
              <div className="text-sm text-muted-foreground">
                {canCreateAnyDn
                  ? "Open a Decibel short and hedge spot inside your safe (executor-signed)."
                  : "Both markets already run a position — top one up with the Add button on its card, or close one first."}
              </div>
              {canCreateAnyDn ? (
                <div className="text-xs text-muted-foreground mt-1">
                  Multiple positions allowed — one per market (e.g. BTC and APT at the same time).
                </div>
              ) : null}
            </div>

            {canCreateAnyDn ? (<>
            {/* Hedge variant: hold spot, or a Hyperion LP long leg (APT/USDC or WBTC/USDC). */}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="inline-flex rounded-full border bg-muted/30 p-0.5 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setDnHedgeMode("spot")}
                  className={cn(
                    "rounded-full px-3 py-1 transition-colors",
                    dnHedgeMode === "spot" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Spot hedge
                </button>
                {/* LP-hedge DN is in private beta — hidden for wallets outside the allowlist.
                    Server-side enforces this too (fail-closed); this is UX only. */}
                {isLpDnBetaUser && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setDnHedgeMode("lp");
                        setLpPoolKey("apt_usdc");
                        setExecutorAsset("APT");
                      }}
                      className={cn(
                        "rounded-full px-3 py-1 transition-colors",
                        dnHedgeMode === "lp" && lpPoolKey === "apt_usdc"
                          ? "bg-background shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      LP APT/USDC
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDnHedgeMode("lp");
                        setLpPoolKey("wbtc_usdc");
                        setExecutorAsset("BTC");
                      }}
                      className={cn(
                        "rounded-full px-3 py-1 transition-colors",
                        dnHedgeMode === "lp" && lpPoolKey === "wbtc_usdc"
                          ? "bg-background shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      LP WBTC/USDC
                    </button>
                  </>
                )}
              </div>
              {dnHedgeMode === "lp" ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Range ±</span>
                  <Input
                    type="number"
                    min="1"
                    max="95"
                    step="1"
                    value={lpRangePct}
                    onChange={(e) => setLpRangePct(e.target.value)}
                    disabled={executorSubmitting}
                    className="h-8 w-16 text-center tabular-nums"
                  />
                  <span className="text-muted-foreground">%</span>
                </div>
              ) : null}
            </div>
            {dnHedgeMode === "lp" ? (
              <div className="text-xs text-muted-foreground">
                Opens a Hyperion {lpPoolKey === "wbtc_usdc" ? "WBTC/USDC" : "APT/USDC"} LP from your safe
                USDC and shorts the {lpPoolKey === "wbtc_usdc" ? "BTC" : "APT"} leg on Decibel (1x). Earns
                LP fees; rehedge as the LP&apos;s base leg drifts. Margin (~
                {formatNumber(lpHedgeWorstCaseMarginMultiple(Number(lpRangePct)) / 2, 2)}× size at ±
                {lpRangePct}%) must be pre-funded in the Decibel subaccount — see the exact amount below.
              </div>
            ) : null}

            {/* Decision-time chart: candles + funding APR for the selected
                market. Collapsed by default to keep the form compact —
                the user can expand it when reviewing funding history. */}
            {executorMarketAddr ? (
              <Collapsible className="border-t border-border/40 -mx-1 px-1 pt-2">
                <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                  <ChevronRight className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-90" />
                  <span>
                    {executorMarketName
                      ? `${executorMarketName.replace("-", "/")} chart`
                      : `${executorAsset}/USD chart`}
                    <span className="text-muted-foreground/70"> · price + funding APR</span>
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                  <DeltaNeutralPriceFundingChart
                    marketAddr={executorMarketAddr}
                    marketName={executorMarketName ?? `${executorAsset}/USD`}
                    interval="1h"
                    className="h-[360px]"
                  />
                </CollapsibleContent>
              </Collapsible>
            ) : null}

            {(() => {
              const sizeNum = Number(executorSizeUsd);
              const isOverMax =
                Number.isFinite(sizeNum) &&
                Number.isFinite(maxSizeUsd) &&
                maxSizeUsd > 0 &&
                sizeNum - maxSizeUsd > 1e-9;
              const assetLogoUrl =
                executorAsset === "BTC"
                  ? configuredBtcSpotAsset.logoUrl
                  : "https://assets.panora.exchange/tokens/aptos/APT.svg";
              const handleHalf = () => {
                // Mark dirty so the auto-fill-to-MAX effect does not
                // immediately overwrite the value back to maxSizeUsd.
                setExecutorSizeDirty(true);
                const half = Math.max(0, Math.floor((maxSizeUsd / 2) * 100) / 100);
                setExecutorSizeUsd(String(half));
              };
              const handleMax = () => {
                setExecutorSizeDirty(true);
                const m = Math.max(0, Math.floor(maxSizeUsd * 100) / 100);
                setExecutorSizeUsd(String(m));
              };
              const builderFeeBlocking =
                Boolean(selectedDecibelSubaccount) &&
                !selectedSubaccountBuilderApproval.isLoading &&
                selectedSubaccountBuilderApproval.requiredBps != null &&
                !selectedSubaccountBuilderApproval.meetsRequiredFee;
              const safeUsdcEmpty = safeUsdcBalance <= 1e-9;
              const requiredSpotHedgeUsdc = deltaNeutralOpenPreview?.bufferedUsdcInUsd ?? null;
              const spotHedgeInsufficient =
                requiredSpotHedgeUsdc != null &&
                !isSpotHedgeFundingAcceptableUsd(safeUsdcBalance, requiredSpotHedgeUsdc);
              const spotPreviewBlocking = deltaNeutralOpenPreview?.severity === "block";
              // Only one open cycle per market. Top-ups live on the position card's Add button —
              // this form only ever OPENS a new position, so a busy asset just blocks the button.
              const assetCycleOpen = busyAssets.has(executorAsset);
              const baseDisabled =
                executorSubmitting ||
                subaccountReadinessLoading ||
                !selectedDecibelSubaccount ||
                !selectedDecibelSubaccountReady ||
                !safeAddr ||
                safeUsdcEmpty ||
                builderFeeBlocking;
              const openDisabled =
                baseDisabled ||
                assetCycleOpen ||
                spotHedgeInsufficient ||
                spotPreviewBlocking;
              const lpMode = dnHedgeMode === "lp";
              const lpRangeNum = Number(lpRangePct);
              const lpRangeValid = Number.isFinite(lpRangeNum) && lpRangeNum >= 1 && lpRangeNum <= 95;
              // LP mode skips the spot-hedge funding/preview gates (they don't apply); it needs the
              // full size in safe USDC (the zap) and a valid range. The pool is set by the toggle.
              const lpDisabled = baseDisabled || !lpRangeValid || safeUsdcBalance + 1e-9 < sizeNum;
              // One DN per asset: opening a new DN (spot or LP) on an asset that already has any DN
              // open would stack shorts on the shared subaccount. Exempt "Add" (grows the existing one).
              const selectedDnAsset: "APT" | "BTC" = lpMode
                ? lpPoolKey === "wbtc_usdc"
                  ? "BTC"
                  : "APT"
                : executorAsset;
              const sameAssetLp = lpDnAssets.has(selectedDnAsset);
              const sameAssetSpot = spotDnAssets.has(selectedDnAsset);
              const dnCollision = sameAssetLp || sameAssetSpot;
              const actionDisabled = (lpMode ? lpDisabled : openDisabled) || dnCollision;
              const openButton = (
                <Button
                  type="button"
                  variant="default"
                  className="w-full lg:w-auto lg:h-[68px] lg:px-6"
                  onClick={() => handleExecutorOpenDeltaNeutral()}
                  disabled={actionDisabled}
                >
                  {executorSubmitting
                    ? "Submitting…"
                    : lpMode
                      ? `Open ${lpPoolKey === "wbtc_usdc" ? "WBTC" : "APT"}/USDC LP-DN`
                      : `Open ${executorAsset} delta-neutral`}
                </Button>
              );
              const openButtonTooltip = dnCollision
                ? legacyBusyAssets.has(selectedDnAsset)
                  ? `A legacy delta-neutral position on ${selectedDnAsset} is open. Close it before opening a new one.`
                  : `A ${sameAssetLp ? "LP" : "spot"} delta-neutral on ${selectedDnAsset} is already open — top it up with "Add" on its position card, or close it first.`
                : builderFeeBlocking
                ? "Approve the builder fee for this subaccount in the setup card before opening positions."
                : safeUsdcEmpty
                  ? "Deposit USDC to the AI agent safe before opening a delta-neutral position."
                  : spotHedgeInsufficient
                    ? `Spot hedge needs ${(requiredSpotHedgeUsdc ?? 0).toFixed(6)} USDC, but the safe has ${safeUsdcBalance.toFixed(6)} USDC.`
                : spotPreviewBlocking
                  ? "Spot execution cost is too high right now. Try a smaller size or another asset."
                  : null;
              const openButtonWithTooltip = openButtonTooltip ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex w-full lg:w-auto">{openButton}</span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[260px]">
                    <p>{openButtonTooltip}</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                openButton
              );
              return (
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
                  <div
                    role="presentation"
                    onClick={() => executorAmountInputRef.current?.focus()}
                    className={cn(
                      "min-w-0 flex-1 cursor-text rounded-2xl border px-2.5 py-2 sm:px-4 sm:py-3 transition-[color,box-shadow,border-color,background-color]",
                      isOverMax
                        ? "border-red-500 hover:border-red-400 hover:bg-red-500/[0.04] focus-within:border-red-500 focus-within:ring-1 focus-within:ring-red-500/12"
                        : "border-input hover:border-foreground/20 hover:bg-muted/25 focus-within:border-foreground/14 focus-within:ring-1 focus-within:ring-foreground/6"
                    )}
                  >
                    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                      <Select value={executorAsset} onValueChange={(v) => setExecutorAsset(v as "BTC" | "APT")}>
                        <SelectTrigger
                          onClick={(e) => e.stopPropagation()}
                          className="h-10 sm:h-12 w-auto shrink-0 gap-2 rounded-full border-0 bg-muted/40 px-2 hover:bg-muted/60 focus:ring-0 focus:ring-offset-0 [&>svg]:opacity-70"
                        >
                          <div className="flex items-center gap-2">
                            <Image
                              src={assetLogoUrl}
                              alt={executorAsset}
                              width={24}
                              height={24}
                              className="h-6 w-6 rounded-full object-contain"
                              unoptimized
                            />
                            <span className="font-medium">{executorAsset}</span>
                          </div>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="BTC" disabled={busyAssets.has("BTC")}>
                            BTC{busyAssets.has("BTC") ? " (open)" : ""}
                          </SelectItem>
                          <SelectItem value="APT" disabled={busyAssets.has("APT")}>
                            APT{busyAssets.has("APT") ? " (open)" : ""}
                          </SelectItem>
                        </SelectContent>
                      </Select>

                      <div className="flex min-w-0 w-full flex-1 items-center gap-2">
                        <Input
                          ref={executorAmountInputRef}
                          type="number"
                          min="0"
                          step="any"
                          placeholder="0.00"
                          inputMode="decimal"
                          value={executorSizeUsd}
                          onChange={(e) => {
                            setExecutorSizeDirty(true);
                            setExecutorSizeUsd(e.target.value);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          disabled={executorSubmitting}
                          className={cn(
                            // Use flex sizing to prevent the number field from collapsing
                            // between the asset selector and the right-side controls on narrow widths.
                            // Right-aligned so the amount visually pairs with the "USDC" label next to
                            // it, not with the asset selector on the left (the size is in USDC, not BTC/APT).
                            "h-auto min-w-0 flex-1 w-0 overflow-x-auto rounded-none border-0 bg-transparent px-0 py-0 text-right text-2xl sm:text-3xl font-medium leading-none tabular-nums shadow-none dark:bg-transparent",
                            "focus-visible:border-transparent focus-visible:ring-0 focus-visible:ring-offset-0",
                            "aria-invalid:border-transparent aria-invalid:ring-0 dark:aria-invalid:ring-0"
                          )}
                        />
                        <span className="shrink-0 text-sm sm:text-base text-muted-foreground font-medium">USDC</span>
                      </div>

                      <div
                        className="flex w-full shrink-0 flex-row items-center justify-between gap-2 sm:w-auto sm:flex-col sm:items-end sm:justify-start sm:gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex shrink-0 flex-row items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={handleHalf}
                            disabled={executorSubmitting || !(maxSizeUsd > 0)}
                            className="h-auto min-w-[2.5rem] sm:min-w-[3rem] shrink-0 px-1 sm:px-2 py-1 text-[10px] sm:text-xs font-normal uppercase leading-none tracking-wide text-foreground border border-transparent hover:border-border hover:bg-muted/35"
                          >
                            Half
                          </Button>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={handleMax}
                                disabled={executorSubmitting || !(maxSizeUsd > 0)}
                                className="h-auto min-w-[2.5rem] sm:min-w-[3rem] shrink-0 px-1 sm:px-2 py-1 text-[10px] sm:text-xs font-normal uppercase leading-none tracking-wide text-foreground border border-transparent hover:border-border hover:bg-muted/35"
                              >
                                Max
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[240px] text-xs">
                              <p>
                                MAX keeps a ~2.5% reserve of the safe&apos;s USDC for Decibel
                                lot rounding, the Hyperion pool fee and price drift between
                                quote and swap — so it sits below your full balance.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <div className="text-[10px] sm:text-xs text-muted-foreground tabular-nums">
                          Max: {Number.isFinite(maxSizeUsd) ? formatCurrency(maxSizeUsd, 2) : "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex w-full lg:w-auto lg:items-stretch">
                    {openButtonWithTooltip}
                  </div>
                </div>
              );
            })()}
            {(() => {
              const sizeNum = Number(executorSizeUsd);
              if (!isDeltaNeutralStrategy || deltaNeutral?.isOpen || !Number.isFinite(sizeNum) || sizeNum <= 0) {
                return null;
              }
              // LP-hedge preview replaces the spot execution preview in LP mode.
              if (dnHedgeMode === "lp") {
                const half = sizeNum / 2;
                const lpPool = YIELD_AI_HYPERION_POOLS[lpPoolKey];
                const assetSym = lpPool.symbolA;
                const aptPrice = lpPoolApr
                  ? Math.pow(1.0001, lpPoolApr.currentTick) * 10 ** (lpPool.decimalsA - lpPool.decimalsB)
                  : null;
                const aptLeg = aptPrice && aptPrice > 0 ? half / aptPrice : null;
                // Worst-case pre-fund: margin needed if price falls all the way to the range's
                // lower bound (see lpHedgeWorstCaseMarginMultiple) — not a flat fraction of size.
                const marginMultiple = lpHedgeWorstCaseMarginMultiple(Number(lpRangePct));
                const reserve = half * marginMultiple;
                return (
                  <div className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-2 text-xs space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-foreground">LP-hedge preview</span>
                      {lpRangeApr ? (
                        <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                          ≈ {formatNumber(lpRangeApr.total, 1)}% APR
                          <span className="ml-1 font-normal text-muted-foreground">
                            (fee {formatNumber(lpRangeApr.fee * lpRangeApr.ratio, 1)}% + farm{" "}
                            {formatNumber(lpRangeApr.farm, 1)}% · ±{lpRangePct}%)
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">estimating APR…</span>
                      )}
                    </div>
                    <div className="text-muted-foreground">
                      LP ≈ {formatCurrency(half, 2)} {assetSym} + {formatCurrency(half, 2)} USDC (~50/50). Short ≈{" "}
                      {aptLeg != null
                        ? `${formatNumber(aptLeg, aptLeg >= 1 ? 2 : 5)} ${assetSym}`
                        : formatCurrency(half, 2)}{" "}
                      ({formatCurrency(half, 2)}) on Decibel, 1×.
                    </div>
                    <div className="text-muted-foreground">
                      Margin ≈ {formatCurrency(half, 2)} now; pre-fund ~{formatCurrency(reserve, 2)} (
                      {formatNumber(marginMultiple, 2)}×) to cover the worst case if price falls to the
                      bottom of the ±{lpRangePct}% range. Earns LP fees; funding applies to the short.
                    </div>
                  </div>
                );
              }
              if (deltaNeutralOpenPreviewLoading && !deltaNeutralOpenPreview) {
                return (
                  <div className="rounded-md border border-border bg-muted/20 p-2 text-xs text-muted-foreground">
                    Checking spot execution...
                  </div>
                );
              }
              if (deltaNeutralOpenPreviewError && !deltaNeutralOpenPreview) {
                return (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
                    Spot execution preview unavailable. The executor will quote again before submitting.
                  </div>
                );
              }
              const preview = deltaNeutralOpenPreview;
              if (!preview) return null;
              const severityLabel =
                preview.severity === "block"
                  ? "Too high"
                  : preview.severity === "warning"
                    ? "Warning"
                    : "OK";
              const priceDecimals = preview.asset === "BTC" ? 2 : 4;
              const spreadAbsPct = Math.abs(preview.spreadPct);
              const spreadDirection = preview.spreadPct >= 0 ? "above" : "below";
              const entryCostUsd = preview.estimatedEntryCostUsd;
              const entryCostIsPositive = entryCostUsd >= 0;
              const safeUsdcEmpty = safeUsdcBalance <= 1e-9;
              const spotHedgeShortfallUsd = Math.max(0, preview.bufferedUsdcInUsd - safeUsdcBalance);
              const spotHedgeShortfallTolerated =
                spotHedgeShortfallUsd > 0 &&
                isSpotHedgeFundingAcceptableUsd(safeUsdcBalance, preview.bufferedUsdcInUsd);
              const spotHedgeInsufficient =
                !spotHedgeShortfallTolerated &&
                safeUsdcBalance + 1e-9 < preview.bufferedUsdcInUsd;
              const effectiveSeverity =
                safeUsdcEmpty || spotHedgeInsufficient
                  ? "block"
                  : spotHedgeShortfallTolerated
                    ? "warning"
                    : preview.severity;
              const effectiveSeverityLabel = safeUsdcEmpty
                ? "No USDC"
                : spotHedgeInsufficient
                  ? "Insufficient"
                  : spotHedgeShortfallTolerated
                    ? "Slight under-hedge"
                  : severityLabel;
              return (
                <div
                  className={cn(
                    "rounded-md border p-2 text-xs",
                    effectiveSeverity === "block"
                      ? "border-destructive/30 bg-destructive/5 text-destructive"
                      : effectiveSeverity === "warning"
                        ? "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400"
                        : "border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                  )}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">Spot execution preview</span>
                        <Badge
                          variant={effectiveSeverity === "block" ? "destructive" : "outline"}
                          className={cn(
                            "h-5 rounded-sm px-1.5 py-0 text-[10px]",
                            effectiveSeverity === "ok" &&
                              "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                            effectiveSeverity === "warning" &&
                              "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                          )}
                        >
                          {effectiveSeverityLabel}
                        </Badge>
                        {deltaNeutralOpenPreviewLoading ? (
                          <span className="text-muted-foreground">updating...</span>
                        ) : null}
                      </div>
                      <div>
                        {preview.spotAssetLabel} via Hyperion is{" "}
                        <span className="font-medium tabular-nums">
                          {spreadAbsPct.toFixed(2)}%
                        </span>{" "}
                        {spreadDirection} Decibel mark.
                      </div>
                      <div className="text-muted-foreground">
                        {formatNumber(preview.targetSpotHuman, preview.asset === "BTC" ? 8 : 4)}{" "}
                        {preview.spotAssetLabel} target, includes {(preview.inputBufferBps / 100).toFixed(2)}% buffer.
                      </div>
                      {spotHedgeInsufficient ? (
                        <div className="font-medium">
                          Needs {formatCurrency(preview.bufferedUsdcInUsd, 6)} safe USDC; available{" "}
                          {formatCurrency(safeUsdcBalance, 6)}.
                        </div>
                      ) : spotHedgeShortfallTolerated ? (
                        <div className="font-medium">
                          Safe is short by {formatCurrency(spotHedgeShortfallUsd, 6)}; executor will use available USDC
                          and accept a small under-hedge.
                        </div>
                      ) : preview.severity === "block" ? (
                        <div className="font-medium">Reduce size or switch asset before opening.</div>
                      ) : null}
                    </div>
                    <div className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-1 text-right tabular-nums sm:min-w-[260px]">
                      <span className="text-muted-foreground">Decibel mark</span>
                      <span className="font-medium text-foreground">
                        {formatCurrency(preview.decibelMark, priceDecimals)}
                      </span>
                      <span className="text-muted-foreground">Hyperion spot</span>
                      <span className="font-medium text-foreground">
                        {preview.bufferedEffectivePrice != null
                          ? formatCurrency(preview.bufferedEffectivePrice, priceDecimals)
                          : "-"}
                      </span>
                      <span className="text-muted-foreground">Est. entry cost</span>
                      <span
                        className={cn(
                          "font-semibold",
                          entryCostIsPositive ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
                        )}
                      >
                        {entryCostIsPositive ? "-" : "+"}
                        {formatCurrency(Math.abs(entryCostUsd), 2)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}
            {selectedDecibelSubaccount &&
            !selectedSubaccountBuilderApproval.isLoading &&
            selectedSubaccountBuilderApproval.requiredBps != null &&
            !selectedSubaccountBuilderApproval.meetsRequiredFee ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
                Builder fee not approved for this subaccount. Approve it in the
                setup card above (one-time owner signature) to enable opening positions.
              </div>
            ) : null}
            {(() => {
              const sizeNum = Number(executorSizeUsd);
              if (!Number.isFinite(sizeNum) || sizeNum <= 0) return null;
              if (dnHedgeMode === "lp") return null; // LP preview shows its own split/notional
              const totalNotional = sizeNum * 2;
              const overMax = Number.isFinite(maxSizeUsd) && maxSizeUsd > 0 && sizeNum - maxSizeUsd > 1e-9;
              return (
                <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                  <span>
                    Total position notional:{" "}
                    <span className="font-medium text-foreground">
                      {formatCurrency(totalNotional, 2)}
                    </span>
                    <span className="ml-1 text-muted-foreground/80">
                      ({formatCurrency(sizeNum, 2)} spot + {formatCurrency(sizeNum, 2)} perp short)
                    </span>
                  </span>
                  {overMax ? (
                    <span className="text-destructive">
                      · exceeds max {formatCurrency(maxSizeUsd, 2)} USDC
                    </span>
                  ) : null}
                </div>
              );
            })()}
            </>) : null}
            {/* Flex-wrap (not a rigid 3-col grid): the middle pane is squeezed
                by the sidebar + Tools rail on mid widths, where a fixed
                lg:grid-cols-3 made the "Deposit USDC to Decibel" button
                overflow its cell. Items stack on narrow, wrap gracefully on
                wide. The subaccount/margin row stays visible even when the create
                form is collapsed — Decibel margin top-ups matter for open positions too. */}
            <div className="flex flex-col gap-2 xl:flex-row xl:flex-wrap xl:items-center">
              <Select
                value={selectedDecibelSubaccount}
                onValueChange={setSelectedDecibelSubaccount}
                disabled={subaccountReadinessLoading || readyDecibelSubaccounts.length === 0}
              >
                <SelectTrigger className="h-10 w-full xl:w-auto xl:min-w-[220px] xl:flex-1">
                  <SelectValue
                    placeholder={
                      subaccountReadinessLoading
                        ? "Checking subaccounts..."
                        : readyDecibelSubaccounts.length === 0
                          ? "No delegated + approved subaccounts"
                          : "Decibel subaccount"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {readyDecibelSubaccounts
                    .map((s) => (
                      <SelectItem key={s.subaccount_address} value={s.subaccount_address}>
                        {s.is_primary ? "Primary · " : ""}
                        {s.subaccount_address.slice(0, 8)}…{s.subaccount_address.slice(-6)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <div className="flex h-10 items-center gap-2 rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground min-w-0 w-full xl:w-auto">
                <span className="truncate">Available to trade:</span>
                <span className="font-medium text-foreground tabular-nums shrink-0">
                  {availableToTradeUsdc != null ? formatCurrency(availableToTradeUsdc, 2) : "—"}
                </span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="default"
                    className="h-10 w-full shrink-0 xl:w-auto"
                    onClick={() => setDecibelTopUpOpen(true)}
                    disabled={!selectedDecibelSubaccount}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Deposit USDC to Decibel
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Deposit USDC from your wallet to your Decibel margin</p>
                </TooltipContent>
              </Tooltip>
              <div className="flex h-10 items-center gap-2 rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground min-w-0 w-full xl:w-auto">
                <span className="truncate">Funding (24h):</span>
                {executorFundingApr24h != null ? (
                  <span
                    className={cn(
                      "font-medium tabular-nums shrink-0",
                      executorFundingApr24h > 0
                        ? "text-green-600 dark:text-green-400"
                        : executorFundingApr24h < 0
                          ? "text-destructive"
                          : "text-foreground",
                    )}
                  >
                    {executorFundingApr24h > 0 ? "+" : ""}
                    {executorFundingApr24h.toFixed(2)}% APR
                  </span>
                ) : (
                  <span className="font-medium text-foreground">—</span>
                )}
              </div>
            </div>
            {!safeAddr && (
              <div className="text-xs text-muted-foreground">
                Create a safe first.
              </div>
            )}
          </div>

          {executorHedgeHint && (
            <div className="rounded-lg border bg-card p-3 sm:p-4 space-y-2">
              <div className="font-medium">Spot delta hedge</div>
              <p className="text-sm text-muted-foreground">
                Optional: buy spot (~{formatNumber(executorHedgeHint.sizeUsd, 2)} USDC notional) to offset this{" "}
                {executorHedgeHint.asset} short.
              </p>
              {executorHedgeUsdcOk ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const toFa =
                      executorHedgeHint.asset === "APT" ? HEDGE_FA.APT : HEDGE_FA.WBTC;
                    setHedgeSwapPrefill({
                      fromFaAddress: HEDGE_FA.USDC,
                      toFaAddress: toFa,
                      amount: formatUsdcAmountForSwap(executorHedgeHint.sizeUsd),
                    });
                    setHedgeSwapOpen(true);
                  }}
                >
                  Open swap (USDC → {executorHedgeHint.asset === "APT" ? "APT" : "WBTC"})
                </Button>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Add USDC to your wallet to hedge this short.
                </p>
              )}
              <div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setExecutorHedgeHint(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <ScrollArea>
        {(() => {
          const visibleEchelonRows = echelonModalRows.filter(
            (row) => Number.isFinite(row.valueUsd) && row.valueUsd >= MIN_VISIBLE_USD
          );
          if (visibleEchelonRows.length === 0) return null;
          return (
          <div className="px-3 sm:px-4 pt-1 pb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Echelon
          </div>
          );
        })()}
        {echelonModalRows
          .filter((row) => Number.isFinite(row.valueUsd) && row.valueUsd >= MIN_VISIBLE_USD)
          .map((row) => {
            const marketKey = normalizeAddress(row.marketObj);
            const aprRow = echelonAprByMarketObj.get(marketKey);
            const aprPct = row.positionType === "borrow" ? aprRow?.borrowApr ?? 0 : aprRow?.supplyApr ?? 0;
            const rewardsApr =
              row.positionType === "borrow" ? aprRow?.borrowRewardsApr ?? 0 : aprRow?.supplyRewardsApr ?? 0;
            const baseAprRaw =
              row.positionType === "borrow" ? aprRow?.borrowBaseApr ?? 0 : aprRow?.supplyBaseApr ?? 0;
            const baseApr =
              baseAprRaw > 0 ? baseAprRaw : Math.max(0, aprPct - rewardsApr);
            return (
          <div key={row.id} className="border-b last:border-b-0">
            <div className="p-3 sm:p-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="flex gap-3 min-w-0 flex-1">
                <div className="flex shrink-0 items-center -space-x-1">
                  <div className="w-8 h-8 relative shrink-0 rounded-full bg-muted flex items-center justify-center overflow-hidden ring-2 ring-background">
                    <Image
                      src="/protocol_ico/echelon.png"
                      alt="Echelon"
                      width={32}
                      height={32}
                      className="object-contain"
                      unoptimized
                    />
                  </div>
                  {row.tokenLogoUrl ? (
                    <div className="w-8 h-8 relative shrink-0 rounded-full bg-muted flex items-center justify-center overflow-hidden ring-2 ring-background">
                      <Image
                        src={row.tokenLogoUrl}
                        alt={row.symbol}
                        width={32}
                        height={32}
                        className="object-contain"
                        unoptimized
                      />
                    </div>
                  ) : null}
                </div>
                <div className="min-w-0 flex flex-1 flex-col justify-center gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold leading-tight">{row.symbol}</span>
                      <Badge
                        variant="outline"
                        className={
                          row.positionType === "borrow"
                            ? "bg-orange-500/10 text-orange-700 border-orange-500/20 text-xs font-normal px-2 py-0.5 h-5"
                            : "bg-green-500/10 text-green-600 border-green-500/20 text-xs font-normal px-2 py-0.5 h-5"
                        }
                      >
                        {row.positionType === "borrow" ? "Borrow" : "Supply"}
                      </Badge>
                    </div>
                    <div className="text-right shrink-0 sm:hidden">
                      <div className="flex items-center justify-end gap-2">
                        {aprPct > 0 && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="outline"
                                  className="cursor-help bg-blue-500/10 text-blue-600 border-blue-500/20 px-2 py-0.5 text-[10px] font-normal leading-none h-5"
                                >
                                  APR: {formatNumber(aprPct, 2)}%
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="space-y-1 text-xs">
                                  <p className="font-medium">APR breakdown</p>
                                  <p>Base: {formatNumber(baseApr, 2)}%</p>
                                  <p>Rewards: {formatNumber(rewardsApr, 2)}%</p>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        <div className="text-lg font-bold leading-tight">
                          {formatCurrency(row.valueUsd, 2)}
                        </div>
                      </div>
                      <div className="text-base font-semibold leading-tight text-muted-foreground">
                        {row.amountLabel}
                      </div>
                    </div>
                  </div>
                  {row.canEmergencyWithdraw && (
                    <div className="sm:hidden">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          isExecutingEchelonWithdrawToSafe ||
                          !echelonAdapterAddress ||
                          Boolean(echelonAdapterLoadError)
                        }
                        onClick={() => {
                          setSelectedEchelonWithdrawRow(row);
                          setShowEchelonWithdrawConfirm(true);
                        }}
                        className="h-auto min-h-9 w-full whitespace-normal px-2 py-2 text-center text-[11px] leading-snug"
                      >
                        {isExecutingEchelonWithdrawToSafe
                          ? "Withdrawing…"
                          : "Withdraw to AI agent wallet"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              <div className="hidden shrink-0 sm:flex flex-col items-end gap-2">
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    {aprPct > 0 && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge
                              variant="outline"
                              className="cursor-help bg-blue-500/10 text-blue-600 border-blue-500/20 px-2 py-0.5 text-[10px] font-normal leading-none h-5"
                            >
                              APR: {formatNumber(aprPct, 2)}%
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="space-y-1 text-xs">
                              <p className="font-medium">APR breakdown</p>
                              <p>Base: {formatNumber(baseApr, 2)}%</p>
                              <p>Rewards: {formatNumber(rewardsApr, 2)}%</p>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    <div className="text-lg font-bold leading-tight">
                      {formatCurrency(row.valueUsd, 2)}
                    </div>
                  </div>
                  <div className="text-base font-semibold leading-tight text-muted-foreground">
                    {row.amountLabel}
                  </div>
                </div>
                {row.canEmergencyWithdraw && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      isExecutingEchelonWithdrawToSafe ||
                      !echelonAdapterAddress ||
                      Boolean(echelonAdapterLoadError)
                    }
                    onClick={() => {
                      setSelectedEchelonWithdrawRow(row);
                      setShowEchelonWithdrawConfirm(true);
                    }}
                    className="h-auto max-w-[11rem] whitespace-normal px-2 py-2 text-center text-xs leading-tight"
                  >
                    {isExecutingEchelonWithdrawToSafe
                      ? "Withdrawing…"
                      : "Withdraw to AI agent wallet"}
                  </Button>
                )}
              </div>
            </div>
          </div>
            );
          })}
        {tokens.length === 0 &&
        echelonModalRows.filter((row) => Number.isFinite(row.valueUsd) && row.valueUsd >= MIN_VISIBLE_USD).length === 0 &&
        echelonRewardsValueUsdEffective === 0 ? (
          <div className="py-4 text-muted-foreground">No assets in this safe.</div>
        ) : (
          <>
            {tokens.length > 0 && (
              <div
                className={
                  echelonModalRows.some(
                    (row) => Number.isFinite(row.valueUsd) && row.valueUsd >= MIN_VISIBLE_USD
                  )
                    ? "px-3 sm:px-4 pt-3 pb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide border-t border-border"
                    : "px-3 sm:px-4 pt-1 pb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide"
                }
              >
                AI agent wallet (safe)
              </div>
            )}
            {tokens
              .filter((token) => {
                // Hide spot legs of open DN positions — shown inside the position, not the wallet.
                if (isDnSpotLegToken(token.address)) return false;
                const value = token.value ? parseFloat(token.value) : 0;
                return Number.isFinite(value) && value >= MIN_VISIBLE_USD;
              })
              .map((token) => {
            const value = token.value ? parseFloat(token.value) : 0;
            const amount =
              parseFloat(token.amount) / Math.pow(10, token.decimals);
            const price = token.price ? parseFloat(token.price) : 0;
            const isUsdc =
              token.symbol === "USDC" ||
              normalizeAddress(token.address) === normalizeAddress(USDC_FA_METADATA_MAINNET);
            const isUsd1 =
              token.symbol === "USD1" ||
              normalizeAddress(token.address) === normalizeAddress(USD1_FA_METADATA_MAINNET);
            const isAptToken =
              token.address === APTOS_COIN_TYPE ||
              normalizeAddress(token.address) === normalizeAddress(APT_FA_METADATA_MAINNET);
            const showAptConvert =
              isAptToken && !aptIsActiveHedge && safeAptBaseUnits > STALE_APT_DUST_BASE_UNITS;
            const isWbtcToken =
              normalizeAddress(token.address) === normalizeAddress(WBTC_FA_METADATA_MAINNET);
            const showWbtcConvert =
              isWbtcToken && !wbtcIsActiveHedge && safeWbtcBaseUnits > STALE_BTC_DUST_BASE_UNITS;
            const isXbtcToken =
              normalizeAddress(token.address) === normalizeAddress(XBTC_FA_METADATA_MAINNET);
            const showXbtcConvert =
              isXbtcToken && !xbtcIsActiveHedge && safeXbtcBaseUnits > STALE_BTC_DUST_BASE_UNITS;
            const isBtcWithdrawToken = isWbtcToken || isXbtcToken;
            // ELON / thAPT: not swappable yet — offer plain withdraw to wallet.
            const isWithdrawOnlyToken =
              token.symbol === "ELON" ||
              token.symbol === "thAPT" ||
              normalizeAddress(token.address) === normalizeAddress(ELON_FA_METADATA_MAINNET) ||
              normalizeAddress(token.address) === normalizeAddress(THAPT_FA_METADATA_MAINNET);
            return (
              <div
                key={token.address}
                className="p-3 sm:p-4 border-b last:border-b-0 flex justify-between items-center gap-3"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-8 h-8 relative shrink-0 rounded-full bg-muted flex items-center justify-center text-sm font-semibold">
                    {token.logoUrl ? (
                      <Image
                        src={token.logoUrl}
                        alt={token.symbol}
                        width={32}
                        height={32}
                        className="object-contain rounded-full"
                        unoptimized
                      />
                    ) : (
                      <span>{token.symbol.slice(0, 1)}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{token.symbol}</span>
                    </div>
                    {price > 0 && (
                      <div className="text-sm text-muted-foreground">
                        {formatCurrency(price, 4)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="shrink-0 flex items-start gap-3">
                  <div className="text-right">
                    <div className="text-lg sm:text-lg font-bold tabular-nums leading-tight">
                      {formatCurrency(value, 2)}
                    </div>
                    <div className="text-sm sm:text-base text-muted-foreground font-semibold tabular-nums leading-tight">
                      {formatNumber(amount, 4)}
                    </div>
                  </div>
                  {isUsd1 && (
                    <div className="flex flex-wrap gap-2 mt-2 justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-10"
                        disabled={!safeAddr || isConvertingUsd1ToUsdc}
                        onClick={() => {
                          setUsd1ConvertAmountBaseUnits(String(token.amount));
                          setShowUsd1ConvertConfirm(true);
                        }}
                      >
                        {isConvertingUsd1ToUsdc ? "Converting…" : "Convert to USDC"}
                      </Button>
                    </div>
                  )}
                  {showAptConvert && (
                    <div className="flex flex-wrap gap-2 mt-2 justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-10"
                        disabled={!safeAddr || convertStaleAptSubmitting}
                        onClick={() => setConvertStaleAptOpen(true)}
                      >
                        {convertStaleAptSubmitting ? "Converting…" : "Convert to USDC"}
                      </Button>
                    </div>
                  )}
                  {(showWbtcConvert || showXbtcConvert) && (
                    <div className="flex flex-wrap gap-2 mt-2 justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-10"
                        disabled={!safeAddr || convertStaleXbtcSubmitting}
                        onClick={() => {
                          setSelectedStaleBtc({
                            metadata: showWbtcConvert ? WBTC_FA_METADATA_MAINNET : XBTC_FA_METADATA_MAINNET,
                            label: showWbtcConvert ? "WBTC" : "xBTC",
                            baseUnits: showWbtcConvert ? safeWbtcBaseUnits : safeXbtcBaseUnits,
                          });
                          setConvertStaleXbtcOpen(true);
                        }}
                      >
                        {convertStaleXbtcSubmitting ? "Converting…" : "Convert to USDC"}
                      </Button>
                    </div>
                  )}
                  {(isUsdc || isBtcWithdrawToken || isWithdrawOnlyToken) && (
                    <div className="flex flex-wrap gap-2 mt-2 justify-end">
                      {/* Per-token Deposit + History removed — both duplicate the
                          header "Deposit to safe" + History icon-button. Withdraw
                          stays here because it's the single-token quick action. */}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-10"
                        onClick={() => {
                          setSelectedWithdrawToken(token);
                          setShowWithdrawModal(true);
                        }}
                      >
                        Withdraw
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          </>
        )}
      </ScrollArea>

      <div className="pt-6 pb-6 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xl">Total assets in safe:</span>
          <span className="text-xl text-primary font-bold">
            {formatCurrency(totalValue, 2)}
          </span>
        </div>
        {hasAnyRewards && (
          <div className="flex justify-end">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="text-sm text-muted-foreground flex items-center gap-1 justify-end cursor-help">
                    <span>💰</span>
                    <span>including rewards {includingRewardsLabel}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="bg-popover text-popover-foreground border-border max-w-sm">
                  <div className="text-xs font-semibold mb-1">Rewards breakdown</div>
                  <div className="text-[11px] text-muted-foreground mb-2">
                    Rewards are not part of the safe token balances. They come from protocol incentives accrued while this
                    safe supplied liquidity (e.g. Echelon) and may remain claimable even if the safe currently holds only spot.
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {echelonRewardRows
                      .filter(
                        (r) =>
                          Number.isFinite(r.usdValue) &&
                          r.usdValue > 0 &&
                          Number.isFinite(r.amount) &&
                          r.amount > 0
                      )
                      .map((reward, idx) => (
                        <div key={`echelon-${reward.symbol}-${idx}`} className="flex items-center gap-2">
                          {reward.logoUrl ? (
                            <img
                              src={reward.logoUrl}
                              alt={reward.symbol}
                              className="w-3 h-3 rounded-full"
                            />
                          ) : null}
                          <span>{reward.symbol}</span>
                          <span>{formatNumber(reward.amount, 6)}</span>
                          <span className="text-muted-foreground">{formatCurrency(reward.usdValue, 2)}</span>
                        </div>
                      ))}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}

        {/* Hyperion LP safes: PnL hidden for now (per-position APR shown instead). */}
        {!isDeltaNeutralStrategy && activeStrategyId !== 'hyperion_lp' && (
          <PnlSummaryRow
            className="pt-3 mt-2 border-t border-border"
            pnlUsd={pnlUsd}
            aprPct={aprPct}
            holdingDays={holdingDays}
            isLoading={performanceLoading}
          />
        )}
      </div>

      {/* Top-up ("Add") modal, opened from a journal position card. Funded from SAFE USDC —
          the Decibel balance only backs the short's margin, so maxSizeUsd (safe budget) caps it. */}
      {(() => {
        const addSizeNum = Number(addSizeUsd);
        const addMax = Number.isFinite(maxSizeUsd) ? Math.max(0, Math.floor(maxSizeUsd * 100) / 100) : 0;
        const addOverMax = Number.isFinite(addSizeNum) && addSizeNum - addMax > 1e-9;
        const addTooSmall = !Number.isFinite(addSizeNum) || addSizeNum < 10;
        const addSubmitDisabled =
          executorSubmitting ||
          !selectedDecibelSubaccount ||
          !selectedDecibelSubaccountReady ||
          addTooSmall ||
          addOverMax;
        return (
          <Dialog
            open={addTarget != null}
            onOpenChange={(o) => {
              if (!o && !executorSubmitting) {
                setAddTarget(null);
                setAddSizeUsd("");
              }
            }}
          >
            <DialogContent className="sm:max-w-[440px]">
              <DialogHeader>
                <DialogTitle>
                  Add to {addTarget?.asset} {addTarget?.isLp ? "LP-DN" : "delta-neutral"} position
                </DialogTitle>
                <DialogDescription>
                  {addTarget?.isLp
                    ? "Adds USDC into the cycle's own LP range and grows the Decibel short to match."
                    : "Buys spot with safe USDC and grows the Decibel short by the same notional."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={addSizeUsd}
                    onChange={(e) => setAddSizeUsd(e.target.value)}
                    disabled={executorSubmitting}
                    className={cn(
                      "text-right text-lg tabular-nums",
                      addOverMax && "border-red-500 focus-visible:ring-red-500/20"
                    )}
                  />
                  <span className="shrink-0 text-sm font-medium text-muted-foreground">USDC</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={executorSubmitting || !(addMax > 0)}
                    onClick={() => setAddSizeUsd(String(addMax))}
                  >
                    Max
                  </Button>
                </div>
                <div className="rounded-md border bg-muted/30 p-2.5 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Safe USDC (funds the add)</span>
                    <span className="font-medium tabular-nums">{formatCurrency(safeUsdcBalance, 2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max add (~2.5% fee/rounding reserve)</span>
                    <span className="font-medium tabular-nums">{formatCurrency(addMax, 2)}</span>
                  </div>
                  {addTarget?.isLp ? (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Decibel margin available</span>
                      <span className="font-medium tabular-nums">
                        {availableToTradeUsdc != null ? formatCurrency(availableToTradeUsdc, 2) : "—"}
                      </span>
                    </div>
                  ) : null}
                </div>
                {addMax < 10 ? (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
                    Minimum add is 10 USDC, but the safe only covers {formatCurrency(addMax, 2)}.
                    Deposit USDC to the AI agent safe first — the Decibel balance can&apos;t fund
                    this side of the position.
                  </div>
                ) : addTarget?.isLp ? (
                  <div className="text-xs text-muted-foreground">
                    If the subaccount lacks free margin, the LP still grows and the position runs
                    under-hedged until you top up Decibel margin.
                  </div>
                ) : null}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={executorSubmitting}
                  onClick={() => {
                    setAddTarget(null);
                    setAddSizeUsd("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={addSubmitDisabled}
                  onClick={() => {
                    if (!addTarget) return;
                    if (addTarget.isLp) void handleExecutorAddLpDeltaNeutral(addTarget.cycleId, addSizeNum);
                    else void handleExecutorAddDeltaNeutral(addTarget.cycleId, addTarget.asset, addSizeNum);
                  }}
                >
                  {executorSubmitting ? "Adding…" : "Add"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        );
      })()}

      {(() => {
        const row = closeCyclePromptId
          ? dnPositions.find((p) => p.source === "journal" && p.cycleId === closeCyclePromptId)
          : null;
        const isClosing = !!closingCycleId;
        return (
          <AlertDialog
            open={!!row}
            onOpenChange={(o) => {
              if (!o && !isClosing) setCloseCyclePromptId(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Close {row?.marketName ?? "position"}?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm">
                    <span className="block">
                      This closes the Decibel short and sells the spot leg back to USDC.
                    </span>
                    {row &&
                      (() => {
                        // Mirror the card's "Net PnL" tooltip exactly (price + funding + fees +
                        // rewards) so this dialog never shows a smaller number than what's
                        // already visible on the card above it. Fees/rewards = claimable + claimed
                        // (mark-to-market, matches the tooltip — see delta-neutral-cycles route).
                        const fees =
                          (row.lpLeg?.claimableFeesUsd ?? 0) + (row.lpLeg?.claimedFeesUsd ?? 0);
                        const rewards =
                          (row.lpLeg?.claimableRewardsUsd ?? 0) + (row.lpLeg?.claimedRewardsUsd ?? 0);
                        // Decibel taker fee on the close trade: back it out of the two existing
                        // estimates (estCloseUsd already nets it, totalValueUsd doesn't) rather
                        // than duplicating the bps math here.
                        const takerFeeUsd =
                          row.totalValueUsd != null && row.estCloseUsd != null
                            ? Math.max(0, row.totalValueUsd - row.estCloseUsd)
                            : 0;
                        const estValueReturned =
                          row.totalValueUsd != null
                            ? row.totalValueUsd + fees + rewards - takerFeeUsd
                            : null;
                        const netPnl =
                          row.pnlPriceUsd != null
                            ? row.pnlPriceUsd + (row.perpFundingUsd ?? 0) + fees + rewards - takerFeeUsd
                            : null;
                        const pct =
                          netPnl != null && row.deployedUsd != null && row.deployedUsd > 0
                            ? (netPnl / row.deployedUsd) * 100
                            : null;
                        return (
                          <div className="rounded-md border bg-muted/30 p-3 space-y-1 text-xs">
                            {estValueReturned != null && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Est. value returned</span>
                                <span className="font-medium">≈ {formatCurrency(estValueReturned, 2)}</span>
                              </div>
                            )}
                            {netPnl != null && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">PnL vs deployed</span>
                                <span
                                  className={
                                    netPnl >= 0
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : "text-rose-600 dark:text-rose-400"
                                  }
                                >
                                  {netPnl >= 0 ? "+" : ""}
                                  {formatCurrency(netPnl, 2)}
                                  {pct != null ? ` (${netPnl >= 0 ? "+" : ""}${pct.toFixed(2)}%)` : ""}
                                </span>
                              </div>
                            )}
                            {row.spotValueUsd != null && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">
                                  {row.lpLeg ? "LP value" : "Spot sells for (quote)"}
                                </span>
                                <span>{formatCurrency(row.spotValueUsd, 2)}</span>
                              </div>
                            )}
                            {row.perpUPnlUsd != null && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Perp uPnL</span>
                                <span>{formatCurrency(row.perpUPnlUsd, 2)}</span>
                              </div>
                            )}
                            {row.perpFundingUsd != null && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Funding earned</span>
                                <span className="text-emerald-600 dark:text-emerald-400">
                                  {row.perpFundingUsd >= 0 ? "+" : ""}
                                  {formatCurrency(row.perpFundingUsd, 2)}
                                </span>
                              </div>
                            )}
                            {row.lpLeg && fees > 0 && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">LP fees</span>
                                <span className="text-emerald-600 dark:text-emerald-400">
                                  +{formatCurrency(fees, 2)}
                                </span>
                              </div>
                            )}
                            {row.lpLeg && rewards > 0 && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Rewards</span>
                                <span className="text-emerald-600 dark:text-emerald-400">
                                  +{formatCurrency(rewards, 2)}
                                </span>
                              </div>
                            )}
                            {takerFeeUsd > 0 && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Decibel close fee</span>
                                <span className="text-rose-600 dark:text-rose-400">
                                  -{formatCurrency(takerFeeUsd, 2)}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    <span className="block text-muted-foreground text-xs">
                      Final amounts may differ slightly due to slippage and fees.
                    </span>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isClosing}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={isClosing}
                  onClick={(e) => {
                    e.preventDefault();
                    if (row) {
                      void handleCloseCycle({ cycleId: row.cycleId!, marketName: row.marketName });
                      setCloseCyclePromptId(null);
                    }
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isClosing ? "Closing…" : "Close position"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        );
      })()}

      <DepositModal
        isOpen={showDepositModal}
        onClose={() => setShowDepositModal(false)}
        {...depositModalConfig}
      />

      <YieldAIWithdrawModal
        isOpen={showWithdrawModal}
        onClose={() => {
          setShowWithdrawModal(false);
          setSelectedWithdrawToken(null);
        }}
        token={selectedWithdrawToken}
        safeAddress={safeAddr ?? undefined}
      />

      <DecibelDepositModal
        isOpen={decibelTopUpOpen && Boolean(selectedDecibelSubaccount)}
        onClose={() => {
          setDecibelTopUpOpen(false);
          if (selectedDecibelSubaccount) {
            queryClient.invalidateQueries({
              queryKey: queryKeys.protocols.decibel.accountBalance(selectedDecibelSubaccount),
            });
          }
        }}
        subaccountAddr={selectedDecibelSubaccount}
      />

      {/* Owner-editable FA-swap limits (vault::set_fa_swap_limits). */}
      <Dialog open={showLimitsDialog} onOpenChange={setShowLimitsDialog}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>AI agent swap limits</DialogTitle>
            <DialogDescription>
              Caps how much USDC notional the agent can swap per transaction and
              per UTC day. Updating them is an owner-signed transaction.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">
                Max per transaction (USDC)
              </div>
              <Input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                placeholder="0.00"
                value={limitPerTxInput}
                onChange={(e) => setLimitPerTxInput(e.target.value)}
                disabled={limitsSubmitting}
              />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">
                Max per day (USDC)
              </div>
              <Input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                placeholder="0.00"
                value={limitDailyInput}
                onChange={(e) => setLimitDailyInput(e.target.value)}
                disabled={limitsSubmitting}
              />
            </div>
            {vaultFaSwapLimits?.exists ? (
              <p className="text-[11px] text-muted-foreground">
                Current on-chain:{" "}
                {formatCurrency(Number(BigInt(vaultFaSwapLimits.maxPerTxUsdc)) / 1e6, 2)} per tx ·{" "}
                {formatCurrency(Number(BigInt(vaultFaSwapLimits.maxDailyUsdc)) / 1e6, 2)} per day.
                Spent today: {formatCurrency(Number(BigInt(vaultFaSwapLimits.spentTodayUsdc)) / 1e6, 2)}.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowLimitsDialog(false)}
              disabled={limitsSubmitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSetFaSwapLimits} disabled={limitsSubmitting}>
              {limitsSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating…
                </>
              ) : (
                "Save limits"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!isDeltaNeutralStrategy && (
        <YieldAiHistoryModal
          isOpen={showHistoryModal}
          onClose={() => setShowHistoryModal(false)}
          safeAddress={safeAddr ?? undefined}
          history={depositHistory}
          operations={
            stablecoinOpsError
              ? []
              : stablecoinOpsLoading
                ? undefined
                : stablecoinOps?.operations ?? []
          }
          currentValueUsd={Number.isFinite(totalValue) ? totalValue : null}
          feeAprPct={hyperionFeeAprPct}
        />
      )}

      <AlertDialog
        open={closeDeltaNeutralOpen}
        onOpenChange={(open) => {
          if (closeDeltaNeutralSubmitting) return;
          setCloseDeltaNeutralOpen(open);
          if (!open) {
            setCloseDeltaNeutralResult(null);
            setCloseDeltaNeutralForceRequested(false);
            setCloseDeltaNeutralForceMode(false);
          }
        }}
      >
        <AlertDialogContent>
          {(() => {
            const inProgress = closeDeltaNeutralSubmitting;
            const result = closeDeltaNeutralResult;
            const showSteps = inProgress || result != null;

            if (!showSteps) {
              const forceRequested = closeDeltaNeutralForceRequested;
              // Daily-limit pre-check derived from the on-chain
              // VaultFaSwapConfig resource (see vaultFaSwapLimits.ts). Block
              // the confirm action when remaining = 0, and show a warning
              // when very little is left so users can size or skip.
              const dailyLimitInfo = (() => {
                if (!vaultFaSwapLimits?.exists) return null;
                const max = BigInt(vaultFaSwapLimits.maxDailyUsdc);
                const spent = BigInt(vaultFaSwapLimits.spentTodayUsdc);
                const remaining = BigInt(vaultFaSwapLimits.remainingUsdc);
                const exhausted = remaining === 0n;
                const lowThreshold = max / 10n; // < 10% left
                const lowWarn = !exhausted && remaining < lowThreshold;
                const secs = vaultFaSwapLimits.secondsUntilRollover;
                const hh = Math.floor(secs / 3600);
                const mm = Math.floor((secs % 3600) / 60);
                const rollover = `${hh}h ${mm}m`;
                const usdFromBaseUnits = (b: bigint) =>
                  (Number(b) / 1_000_000).toLocaleString("en-US", {
                    style: "currency",
                    currency: "USD",
                  });
                return {
                  exhausted,
                  lowWarn,
                  remainingText: usdFromBaseUnits(remaining),
                  spentText: usdFromBaseUnits(spent),
                  maxText: usdFromBaseUnits(max),
                  rollover,
                };
              })();
              return (
                <>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {forceRequested
                        ? "Force-close delta-neutral (recovery)?"
                        : "Close delta-neutral position?"}
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-2 text-sm text-muted-foreground">
                        {forceRequested ? (
                          <>
                            <p>
                              No active Decibel short was found for this market — the open order
                              likely didn't fill while the on-chain record was already created.
                            </p>
                            <p>
                              This will <span className="font-medium text-foreground">skip the
                              Decibel close</span>, swap any stale{" "}
                              <span className="font-medium text-foreground">
                                {deltaNeutralSpotToken?.symbol ?? executorAsset}
                              </span>{" "}
                              in the safe back to USDC, and clear the on-chain delta-neutral
                              record. Use only when Decibel shows no open position.
                            </p>
                          </>
                        ) : (
                          <p>
                            This will submit executor transactions to close your{" "}
                            <span className="font-medium text-foreground">
                              {deltaNeutralSpotToken?.symbol ?? executorAsset} delta-neutral position
                            </span>
                            : close the Decibel short at market, swap spot from your safe back toward USDC, then update the
                            on-chain delta-neutral record. Slippage and pool limits apply; amounts are not guaranteed.
                          </p>
                        )}
                        {deltaNeutralClosePreviewLoading && !deltaNeutralClosePreview ? (
                          <div className="rounded-md border border-border bg-muted/20 p-2 text-xs text-muted-foreground">
                            Checking Hyperion exit price...
                          </div>
                        ) : deltaNeutralClosePreviewError && !deltaNeutralClosePreview ? (
                          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-400">
                            Close preview unavailable. The executor will still submit with on-chain limits.
                          </div>
                        ) : deltaNeutralClosePreview ? (() => {
                          const preview = deltaNeutralClosePreview;
                          const severityLabel =
                            preview.severity === "block"
                              ? "High cost"
                              : preview.severity === "warning"
                                ? "Warning"
                                : "OK";
                          const priceDecimals =
                            preview.spotAssetLabel.toUpperCase().includes("BTC") ? 2 : 4;
                          const spreadPct = preview.spreadPct ?? 0;
                          const spreadDirection = spreadPct >= 0 ? "above" : "below";
                          const spotExitCostUsd = preview.estimatedSpotExitCostUsd;
                          const spotExitCostIsPositive = (spotExitCostUsd ?? 0) >= 0;
                          return (
                            <div
                              className={cn(
                                "rounded-md border p-2 text-xs",
                                preview.severity === "block"
                                  ? "border-destructive/30 bg-destructive/5 text-destructive"
                                  : preview.severity === "warning"
                                    ? "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400"
                                    : "border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
                              )}
                            >
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0 space-y-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-medium text-foreground">Spot exit preview</span>
                                    <Badge
                                      variant={preview.severity === "block" ? "destructive" : "outline"}
                                      className={cn(
                                        "h-5 rounded-sm px-1.5 py-0 text-[10px]",
                                        preview.severity === "ok" &&
                                          "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                                        preview.severity === "warning" &&
                                          "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                      )}
                                    >
                                      {severityLabel}
                                    </Badge>
                                    {deltaNeutralClosePreviewLoading ? (
                                      <span className="text-muted-foreground">updating...</span>
                                    ) : null}
                                  </div>
                                  {preview.hasSpotBalance && preview.hyperionEffectivePrice != null ? (
                                    <>
                                      <div>
                                        Hyperion sell price is{" "}
                                        <span className="font-medium tabular-nums">
                                          {Math.abs(spreadPct).toFixed(2)}%
                                        </span>{" "}
                                        {spreadDirection} Decibel mark.
                                      </div>
                                      <div className="text-muted-foreground">
                                        {formatNumber(preview.spotBalanceHuman, preview.spotAssetLabel.toUpperCase().includes("BTC") ? 8 : 4)}{" "}
                                        {preview.spotAssetLabel}{" -> "}
                                        {preview.quoteUsdcOutUsd != null
                                          ? formatCurrency(preview.quoteUsdcOutUsd, 2)
                                          : "-"}{" "}
                                        quoted out.
                                      </div>
                                      {preview.severity === "block" ? (
                                        <div className="font-medium">
                                          Exit cost is elevated; closing remains available for risk reduction.
                                        </div>
                                      ) : null}
                                    </>
                                  ) : (
                                    <div>No spot balance found in the safe for this hedge asset.</div>
                                  )}
                                </div>
                                <div className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-1 text-right tabular-nums sm:min-w-[260px]">
                                  <span className="text-muted-foreground">Decibel mark</span>
                                  <span className="font-medium text-foreground">
                                    {formatCurrency(preview.decibelMark, priceDecimals)}
                                  </span>
                                  <span className="text-muted-foreground">Hyperion exit</span>
                                  <span className="font-medium text-foreground">
                                    {preview.hyperionEffectivePrice != null
                                      ? formatCurrency(preview.hyperionEffectivePrice, priceDecimals)
                                      : "-"}
                                  </span>
                                  <span className="text-muted-foreground">Spot exit cost</span>
                                  <span
                                    className={cn(
                                      "font-semibold",
                                      spotExitCostIsPositive ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"
                                    )}
                                  >
                                    {spotExitCostUsd == null
                                      ? "-"
                                      : `${spotExitCostIsPositive ? "-" : "+"}${formatCurrency(Math.abs(spotExitCostUsd), 2)}`}
                                  </span>
                                  {!forceRequested ? (
                                    <>
                                      <span className="text-muted-foreground">Decibel fee est.</span>
                                      <span className="font-medium text-foreground">
                                        {preview.estimatedDecibelCloseFeeUsd != null
                                          ? formatCurrency(preview.estimatedDecibelCloseFeeUsd, 2)
                                          : "-"}
                                      </span>
                                    </>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        })() : null}
                        {dailyLimitInfo?.exhausted ? (
                          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
                            <div className="font-medium">Daily swap limit exhausted</div>
                            <div className="text-destructive/80">
                              Spent {dailyLimitInfo.spentText} of {dailyLimitInfo.maxText} today.
                              The limit resets in {dailyLimitInfo.rollover} (UTC midnight).
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setCloseDeltaNeutralOpen(false);
                                openLimitsDialog();
                              }}
                              className="mt-1 font-medium underline underline-offset-2 hover:opacity-80"
                            >
                              Change limits
                            </button>
                          </div>
                        ) : dailyLimitInfo?.lowWarn ? (
                          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700 dark:text-amber-300">
                            <div className="font-medium">Daily limit nearly used</div>
                            <div className="text-amber-700/80 dark:text-amber-300/80">
                              {dailyLimitInfo.remainingText} left of {dailyLimitInfo.maxText} today
                              — close may abort if the swap notional exceeds this.
                              Resets in {dailyLimitInfo.rollover}.
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setCloseDeltaNeutralOpen(false);
                                openLimitsDialog();
                              }}
                              className="mt-1 font-medium underline underline-offset-2 hover:opacity-80"
                            >
                              Change limits
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel
                      onClick={() => setCloseDeltaNeutralForceRequested(false)}
                    >
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      disabled={dailyLimitInfo?.exhausted}
                      onClick={(e) => {
                        e.preventDefault();
                        if (dailyLimitInfo?.exhausted) return;
                        void handleExecutorCloseDeltaNeutral({ force: forceRequested });
                      }}
                    >
                      {forceRequested ? "Confirm recovery" : "Confirm close"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </>
              );
            }

            type StepStatus = "loading" | "completed" | "skipped" | "error" | "pending";
            type Step = {
              key: "decibel" | "swap" | "record";
              label: string;
              hint?: string;
              status: StepStatus;
              hash?: string | null;
              note?: string | null;
            };

            const force = closeDeltaNeutralForceMode;
            let steps: Step[];
            if (inProgress) {
              steps = [
                {
                  key: "decibel",
                  label: force ? "Skipping Decibel close (no active short)" : "Closing Decibel short",
                  status: force ? "skipped" : "loading",
                },
                { key: "swap", label: "Swapping spot on Hyperion → USDC", status: "loading" },
                { key: "record", label: "Recording close on-chain", status: "loading" },
              ];
            } else if (result?.success) {
              const swapStatus: StepStatus = result.swapTxHash
                ? "completed"
                : result.swapSkippedReason
                  ? "skipped"
                  : "completed";
              steps = [
                {
                  key: "decibel",
                  label: force
                    ? "Decibel close skipped (no active short)"
                    : "Decibel short closed",
                  status: force ? "skipped" : "completed",
                  hash: result.closeTxHash,
                },
                {
                  key: "swap",
                  label: result.swapTxHash
                    ? "Spot swapped on Hyperion → USDC"
                    : "Spot swap on Hyperion",
                  status: swapStatus,
                  hash: result.swapTxHash,
                  note: result.swapSkippedReason,
                },
                {
                  key: "record",
                  label: "On-chain record updated",
                  status: "completed",
                  hash: result.recordCloseTxHash,
                },
              ];
            } else {
              steps = [
                {
                  key: "decibel",
                  label: force ? "Decibel close skipped" : "Closing Decibel short",
                  status: force ? "skipped" : "error",
                },
                { key: "swap", label: "Swapping spot on Hyperion → USDC", status: "pending" },
                { key: "record", label: "Recording close on-chain", status: "pending" },
              ];
            }

            const stepIcon = (s: StepStatus) => {
              switch (s) {
                case "loading":
                  return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
                case "completed":
                  return <Check className="h-4 w-4 text-green-600" />;
                case "skipped":
                  return <Check className="h-4 w-4 text-muted-foreground" />;
                case "error":
                  return <XCircle className="h-4 w-4 text-destructive" />;
                case "pending":
                  return (
                    <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/40 bg-background" />
                  );
              }
            };

            return (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {inProgress
                      ? force
                        ? "Recovering delta-neutral state…"
                        : "Closing delta-neutral position…"
                      : result?.success
                        ? force
                          ? "Delta-neutral state cleared"
                          : "Delta-neutral closed"
                        : "Close failed"}
                  </AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="text-sm text-muted-foreground">
                      {inProgress
                        ? "Executor is submitting transactions. Don't close this dialog."
                        : result?.success
                          ? force
                            ? "Stale spot swapped to USDC and on-chain record cleared. You can now open a new position."
                            : "All steps completed. Tx links below."
                          : "One of the executor steps failed. See details below."}
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="space-y-3 py-1">
                  {steps.map((step) => {
                    const url = aptosTxnHashExplorerUrl(step.hash);
                    return (
                      <div key={step.key} className="flex items-start gap-3">
                        <div className="pt-0.5">{stepIcon(step.status)}</div>
                        <div className="min-w-0 flex-1">
                          <div
                            className={cn(
                              "text-sm",
                              step.status === "completed" || step.status === "skipped"
                                ? "text-foreground"
                                : step.status === "error"
                                  ? "text-destructive font-medium"
                                  : step.status === "pending"
                                    ? "text-muted-foreground"
                                    : "text-foreground",
                            )}
                          >
                            {step.label}
                            {step.status === "skipped" ? (
                              <span className="ml-2 text-xs text-muted-foreground">(skipped)</span>
                            ) : null}
                          </div>
                          {url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-0.5 font-mono break-all"
                            >
                              {step.hash!.slice(0, 10)}…{step.hash!.slice(-6)}
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                          ) : null}
                          {step.note ? (
                            <div className="text-[11px] text-muted-foreground mt-0.5">{step.note}</div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}

                  {!inProgress && !result?.success && result?.dailyLimit ? (() => {
                    const dl = result.dailyLimit;
                    const usd = (raw: string | null) =>
                      raw == null
                        ? null
                        : (Number(BigInt(raw)) / 1_000_000).toLocaleString("en-US", {
                            style: "currency",
                            currency: "USD",
                          });
                    const secs = dl.secondsUntilRollover ?? 0;
                    const hh = Math.floor(secs / 3600);
                    const mm = Math.floor((secs % 3600) / 60);
                    return (
                      <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                        <div className="font-medium">
                          {dl.code === "DAILY_LIMIT_EXHAUSTED"
                            ? "Daily swap limit already used up"
                            : "Daily swap limit exceeded by this close"}
                        </div>
                        <div className="text-destructive/80">
                          {dl.spentTodayUsdc != null && dl.maxDailyUsdc != null ? (
                            <>Spent {usd(dl.spentTodayUsdc)} of {usd(dl.maxDailyUsdc)} today.</>
                          ) : null}{" "}
                          {dl.remainingUsdc != null ? (
                            <>Remaining today: {usd(dl.remainingUsdc)}.</>
                          ) : null}{" "}
                          {secs > 0 ? <>Resets in {hh}h {mm}m (UTC midnight).</> : null}
                        </div>
                      </div>
                    );
                  })() : !inProgress && !result?.success && result?.error ? (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                      {result.error}
                    </div>
                  ) : null}
                </div>

                <AlertDialogFooter>
                  <Button
                    type="button"
                    variant={result?.success ? "default" : "outline"}
                    disabled={inProgress}
                    onClick={() => {
                      setCloseDeltaNeutralOpen(false);
                      setCloseDeltaNeutralResult(null);
                      setCloseDeltaNeutralForceRequested(false);
                      setCloseDeltaNeutralForceMode(false);
                      forceRefreshDeltaNeutralState();
                    }}
                  >
                    Done
                  </Button>
                </AlertDialogFooter>
              </>
            );
          })()}
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={openDeltaNeutralModalOpen}
        onOpenChange={(open) => {
          if (executorSubmitting) return;
          setOpenDeltaNeutralModalOpen(open);
          if (!open) setOpenDeltaNeutralResult(null);
        }}
      >
        <AlertDialogContent>
          {(() => {
            const inProgress = executorSubmitting;
            const result = openDeltaNeutralResult;

            type StepStatus = "loading" | "completed" | "error" | "pending";
            type Step = {
              key: "decibel" | "swap" | "record";
              label: string;
              status: StepStatus;
              hash?: string | null;
            };

            // LP-hedge runs LP-first (open LP → short → record cycle); spot runs short → swap → record.
            const lpFlow = dnHedgeMode === "lp";
            let steps: Step[];
            if (inProgress) {
              steps = lpFlow
                ? [
                    { key: "swap", label: "Opening Hyperion LP", status: "loading" },
                    { key: "decibel", label: "Opening Decibel short", status: "loading" },
                    { key: "record", label: "Recording cycle on-chain", status: "loading" },
                  ]
                : [
                    { key: "decibel", label: "Opening Decibel short", status: "loading" },
                    { key: "swap", label: "Swapping USDC → spot on Hyperion (safe)", status: "loading" },
                    { key: "record", label: "Recording open on-chain", status: "loading" },
                  ];
            } else if (result?.success) {
              steps = lpFlow
                ? [
                    { key: "swap", label: "Hyperion LP opened", status: "completed", hash: result.openTxHash },
                    { key: "decibel", label: "Decibel short opened", status: "completed", hash: result.swapTxHash },
                    { key: "record", label: "Cycle recorded on-chain", status: "completed", hash: result.recordOpenTxHash },
                  ]
                : [
                    { key: "decibel", label: "Decibel short opened", status: "completed", hash: result.openTxHash },
                    { key: "swap", label: "USDC → spot swapped on Hyperion", status: "completed", hash: result.swapTxHash },
                    { key: "record", label: "On-chain record created", status: "completed", hash: result.recordOpenTxHash },
                  ];
            } else {
              steps = lpFlow
                ? [
                    { key: "swap", label: "Opening Hyperion LP", status: "error" },
                    { key: "decibel", label: "Opening Decibel short", status: "pending" },
                    { key: "record", label: "Recording cycle on-chain", status: "pending" },
                  ]
                : [
                    { key: "decibel", label: "Opening Decibel short", status: "error" },
                    { key: "swap", label: "Swapping USDC → spot on Hyperion (safe)", status: "pending" },
                    { key: "record", label: "Recording open on-chain", status: "pending" },
                  ];
            }

            const stepIcon = (s: StepStatus) => {
              switch (s) {
                case "loading":
                  return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
                case "completed":
                  return <Check className="h-4 w-4 text-green-600" />;
                case "error":
                  return <XCircle className="h-4 w-4 text-destructive" />;
                case "pending":
                  return (
                    <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/40 bg-background" />
                  );
              }
            };

            return (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {inProgress
                      ? "Opening delta-neutral position…"
                      : result?.success
                        ? "Delta-neutral opened"
                        : "Open failed"}
                  </AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="text-sm text-muted-foreground">
                      {inProgress
                        ? "Executor is submitting transactions. Don't close this dialog."
                        : result?.success
                          ? "All steps completed. Tx links below."
                          : "One of the executor steps failed. Position may be in a partial state — check Decibel and your safe before retrying."}
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="space-y-3 py-1">
                  {steps.map((step) => {
                    const url = aptosTxnHashExplorerUrl(step.hash);
                    return (
                      <div key={step.key} className="flex items-start gap-3">
                        <div className="pt-0.5">{stepIcon(step.status)}</div>
                        <div className="min-w-0 flex-1">
                          <div
                            className={cn(
                              "text-sm",
                              step.status === "completed"
                                ? "text-foreground"
                                : step.status === "error"
                                  ? "text-destructive font-medium"
                                  : step.status === "pending"
                                    ? "text-muted-foreground"
                                    : "text-foreground",
                            )}
                          >
                            {step.label}
                          </div>
                          {url ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-0.5 font-mono break-all"
                            >
                              {step.hash!.slice(0, 10)}…{step.hash!.slice(-6)}
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </a>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}

                  {!inProgress && !result?.success && result?.error ? (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive break-words">
                      {result.error}
                    </div>
                  ) : null}
                </div>

                <AlertDialogFooter>
                  <Button
                    type="button"
                    variant={result?.success ? "default" : "outline"}
                    disabled={inProgress}
                    onClick={() => {
                      setOpenDeltaNeutralModalOpen(false);
                      setOpenDeltaNeutralResult(null);
                      forceRefreshDeltaNeutralState();
                    }}
                  >
                    Done
                  </Button>
                </AlertDialogFooter>
              </>
            );
          })()}
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={convertStaleAptOpen}
        onOpenChange={(open) => {
          if (convertStaleAptSubmitting) return;
          setConvertStaleAptOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Convert stale APT to USDC?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Submits an executor <span className="font-mono">vault::execute_swap_fa_to_fa</span> for the
                  full APT balance ({(Number(safeAptBaseUnits) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 4 })} APT)
                  on this safe at fee tier 1 (0.05%). Minimum USDC out is zero — slippage is not quote-optimized.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={convertStaleAptSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={convertStaleAptSubmitting}
              onClick={(e) => {
                e.preventDefault();
                void handleConvertStaleApt();
              }}
            >
              {convertStaleAptSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin inline" />
                  Submitting…
                </>
              ) : (
                "Confirm swap"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={convertStaleXbtcOpen}
        onOpenChange={(open) => {
          if (convertStaleXbtcSubmitting) return;
          setConvertStaleXbtcOpen(open);
          if (!open) setSelectedStaleBtc(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Convert stale {selectedStaleBtc?.label ?? "xBTC"} to USDC?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Submits an executor <span className="font-mono">vault::execute_swap_fa_to_fa</span> for the
                  full {selectedStaleBtc?.label ?? "xBTC"} balance ({(Number(selectedStaleBtc?.baseUnits ?? safeXbtcBaseUnits) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 })} {selectedStaleBtc?.label ?? "xBTC"})
                  on this safe at fee tier 1 (0.05%). Minimum USDC out is zero — slippage is not quote-optimized.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={convertStaleXbtcSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={convertStaleXbtcSubmitting}
              onClick={(e) => {
                e.preventDefault();
                void handleConvertStaleXbtc();
              }}
            >
              {convertStaleXbtcSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin inline" />
                  Submitting…
                </>
              ) : (
                "Confirm swap"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={swapResidualOpen}
        onOpenChange={(open) => {
          if (swapResidualSubmitting) return;
          setSwapResidualOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Convert residual spot to USDC?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  Submits a single executor <span className="font-mono">vault::execute_swap_fa_to_fa</span> for the
                  recorded spot metadata on this safe, using the <strong>full balance</strong> reported by the Aptos
                  indexer (same as automated close). Minimum USDC out is zero; pool route and limits match the
                  delta-neutral close path—slippage is not quote-optimized.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={swapResidualSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={swapResidualSubmitting}
              onClick={(e) => {
                e.preventDefault();
                void handleExecutorSwapDeltaNeutralResidual();
              }}
            >
              {swapResidualSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin inline" />
                  Submitting…
                </>
              ) : (
                "Confirm swap"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {selectedEchelonWithdrawRow && (
        <YieldAiEchelonWithdrawModal
          key={selectedEchelonWithdrawRow.id}
          isOpen={showEchelonWithdrawConfirm}
          onClose={() => {
            if (isExecutingEchelonWithdrawToSafe) return;
            closeEchelonWithdrawDialog();
          }}
          row={selectedEchelonWithdrawRow}
          isPaused={isPaused}
          adapterReady={Boolean(echelonAdapterAddress)}
          adapterError={echelonAdapterLoadError}
          isLoading={isExecutingEchelonWithdrawToSafe}
          onConfirm={(amountBaseUnits, isFull) => {
            void handleEchelonWithdrawConfirm(amountBaseUnits, isFull);
          }}
        />
      )}

      <AlertDialog open={showUsd1ConvertConfirm} onOpenChange={setShowUsd1ConvertConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Convert USD1 to USDC</AlertDialogTitle>
            <AlertDialogDescription>
              This will submit an on-chain swap signed by the Yield AI executor. It converts your USD1 held in the AI
              agent wallet (safe) into USDC so you can withdraw USDC to your wallet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isConvertingUsd1ToUsdc}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isConvertingUsd1ToUsdc || !safeAddr || usd1ConvertAmountBaseUnits === "0"}
              onClick={(event) => {
                event.preventDefault();
                void handleUsd1ConvertConfirm();
              }}
            >
              {isConvertingUsd1ToUsdc ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Converting...
                </>
              ) : (
                "Convert"
              )}
            </AlertDialogAction>
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
        variantTitle="Hedge short (spot)"
        variantDescription="Swap USDC for the base asset to approximate a delta-neutral hedge (Panora gasless swap)."
      />
    </div>
  );
}
