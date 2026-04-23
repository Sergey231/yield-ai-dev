"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useWalletData } from "@/contexts/WalletContext";
import Image from "next/image";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Token } from "@/lib/types/token";
import {
  MOAR_ADAPTER_ADDRESS_MAINNET,
  USDC_FA_METADATA_MAINNET,
  XBTC_FA_METADATA_MAINNET,
  USD1_FA_METADATA_MAINNET,
} from "@/lib/constants/yieldAiVault";
import { formatCurrency, formatNumber } from "@/lib/utils/numberFormat";
import { useToast } from "@/components/ui/use-toast";
import { normalizeAddress } from "@/lib/utils/addressNormalization";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Copy, ExternalLink, History, Loader2 } from "lucide-react";
import { DepositModal } from "@/components/ui/deposit-modal";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import { YieldAIWithdrawModal } from "@/components/ui/yield-ai-withdraw-modal";
import { YieldAiHistoryModal } from "@/components/ui/yield-ai-history-modal";
import {
  useMoarPositions,
  useMoarPools,
  useMoarRewards,
  type MoarPosition,
} from "@/lib/query/hooks/protocols/moar";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import {
  useYieldAiDepositHistory,
  useYieldAiSafes,
  useYieldAiSafeTokens,
  useDeltaNeutralState,
} from "@/lib/query/hooks/protocols/yield-ai";
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
  buildVaultExecuteWithdrawFullAsOwnerPayload,
  buildVaultExecuteWithdrawAllEchelonFaAsOwnerPayload,
} from "@/lib/protocols/yield-ai/vaultDeposit";
import {
  HEDGE_FA,
  formatUsdcAmountForSwap,
  hasEnoughUsdcForHedge,
} from "@/lib/protocols/decibel/hedgePrefill";
import { SwapModal, type SwapModalPrefill } from "@/components/ui/swap-modal";
import { PnlSummaryRow } from "@/components/ui/pnl-summary-row";

const USDC_LOGO_APTOS = "https://assets.panora.exchange/tokens/aptos/USDC.svg";
const MIN_VISIBLE_USD = 0.0001;

function envFlag(raw: string | undefined, defaultValue = false): boolean {
  if (raw == null) return defaultValue;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return defaultValue;
}

/** Toggle Decibel delegation + executor test UI (client-side flag). */
const SHOW_EXECUTOR_TRADE_BLOCK = envFlag(process.env.NEXT_PUBLIC_SHOW_EXECUTOR_TRADE_BLOCK, false);

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
  const { account, signAndSubmitTransaction } = useWallet();
  const { tokens: walletTokens } = useWalletData();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedWithdrawToken, setSelectedWithdrawToken] = useState<Token | null>(null);
  const [showMoarWithdrawConfirm, setShowMoarWithdrawConfirm] = useState(false);
  const [selectedMoarWithdrawPosition, setSelectedMoarWithdrawPosition] = useState<MoarPosition | null>(null);
  const [isExecutingMoarWithdrawToSafe, setIsExecutingMoarWithdrawToSafe] = useState(false);
  const [showEchelonWithdrawConfirm, setShowEchelonWithdrawConfirm] = useState(false);
  const [selectedEchelonWithdrawRow, setSelectedEchelonWithdrawRow] = useState<EchelonModalRow | null>(
    null
  );
  const [isExecutingEchelonWithdrawToSafe, setIsExecutingEchelonWithdrawToSafe] = useState(false);
  const [echelonAdapterAddress, setEchelonAdapterAddress] = useState<string | null>(null);
  const [echelonAdapterLoadError, setEchelonAdapterLoadError] = useState<string | null>(null);
  const [decibelSubaccounts, setDecibelSubaccounts] = useState<string[]>([]);
  const [selectedDecibelSubaccount, setSelectedDecibelSubaccount] = useState<string>("");
  const [delegationStatusLoading, setDelegationStatusLoading] = useState(false);
  const [delegateSubmitting, setDelegateSubmitting] = useState(false);
  const [executorAddress, setExecutorAddress] = useState<string | null>(null);
  const [isDelegatedToExecutor, setIsDelegatedToExecutor] = useState(false);
  const [delegationStatusError, setDelegationStatusError] = useState<string | null>(null);
  const [delegationDetails, setDelegationDetails] = useState<
    { delegatedAccount: string; permissionType: string; expirationTimeS: number | null; isExpired: boolean }[]
  >([]);
  const [executorAsset] = useState<"BTC">("BTC");
  const [executorSizeUsd, setExecutorSizeUsd] = useState<string>("10");
  const [executorSubmitting, setExecutorSubmitting] = useState(false);
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
  const [swapResidualOpen, setSwapResidualOpen] = useState(false);
  const [swapResidualSubmitting, setSwapResidualSubmitting] = useState(false);

  const executorHedgeUsdcOk = useMemo(() => {
    if (!executorHedgeHint) return false;
    return hasEnoughUsdcForHedge(walletTokens, executorHedgeHint.sizeUsd);
  }, [executorHedgeHint, walletTokens]);
  const walletAddress = account?.address?.toString();
  const {
    data: safeAddresses = [],
    isLoading: safesLoading,
    error: safesError,
  } = useYieldAiSafes(walletAddress, { refetchOnMount: "always" });

  const safeAddr = safeAddresses[0];

  const {
    data: tokens = [],
    isLoading: safeTokensLoading,
  } = useYieldAiSafeTokens(safeAddr, {
    enabled: Boolean(safeAddr),
    refetchOnMount: "always",
  });

  const {
    data: deltaNeutral,
    isLoading: deltaNeutralLoading,
    error: deltaNeutralError,
  } = useDeltaNeutralState(safeAddr);
  const { data: decibelPositions = [], isLoading: decibelPositionsLoading } = useDecibelUserPositions(walletAddress);

  const { data: moarPositions = [], isLoading: moarPositionsLoading } = useMoarPositions(safeAddr, {
    refetchOnMount: "always",
    enabled: Boolean(safeAddr),
  });
  const { data: rewardsResponse, isLoading: moarRewardsLoading } = useMoarRewards(safeAddr, {
    refetchOnMount: "always",
    enabled: Boolean(safeAddr),
  });
  const { data: poolsResponse } = useMoarPools();

  const {
    modalRows: echelonModalRows,
    totalValue: echelonTotalValue,
    rewardsValueUsd: echelonRewardsValueUsd,
    isLoading: echelonLoading,
    echelonRewardRows,
  } = useEchelonProtocolCardModel(safeAddr, {
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

  const poolsAPR = (() => {
    if (!poolsResponse?.data) return {} as Record<number, { totalAPR: number; interestRateComponent: number; farmingAPY: number }>;
    const map: Record<number, { totalAPR: number; interestRateComponent: number; farmingAPY: number }> = {};
    (poolsResponse.data as { poolId?: number; totalAPY?: number; interestRateComponent?: number; farmingAPY?: number }[]).forEach(
      (pool) => {
        if (pool.poolId !== undefined) {
          map[pool.poolId] = {
            totalAPR: pool.totalAPY ?? 0,
            interestRateComponent: pool.interestRateComponent ?? 0,
            farmingAPY: pool.farmingAPY ?? 0,
          };
        }
      }
    );
    return map;
  })();

  const reloadSafeData = useCallback(async () => {
    // Managed positions uses cached data from sidebar when available.
    // This method keeps the existing refreshPositions event wiring intact by invalidating queries.
    if (!walletAddress) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.safes(walletAddress) });
    if (safeAddr) {
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.safeTokens(safeAddr) });
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.deltaNeutralState(safeAddr) });
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.moar.userPositions(safeAddr) });
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.moar.rewards(safeAddr) });
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.echelon.userPositions(safeAddr) });
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.echelon.rewards(safeAddr) });
    }
    if (walletAddress) {
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.decibel.userPositions(walletAddress) });
    }
  }, [queryClient, walletAddress, safeAddr]);

  const loadDecibelSubaccounts = useCallback(async () => {
    const walletAddress = account?.address?.toString();
    if (!walletAddress) {
      setDecibelSubaccounts([]);
      setSelectedDecibelSubaccount("");
      return;
    }
    try {
      const response = await fetch(
        `/api/protocols/decibel/subaccounts?address=${encodeURIComponent(walletAddress)}`
      );
      const json = await response.json();
      const data: Array<{ subaccount_address?: string; is_primary?: boolean }> = Array.isArray(json?.data)
        ? json.data
        : [];
      const addresses = data
        .map((item) => item?.subaccount_address)
        .filter((value: unknown): value is string => typeof value === "string")
        .map((value: string) => toCanonicalAddress(value));
      const primaryAddressRaw = data.find((item) => item?.is_primary)?.subaccount_address;
      const primaryAddress =
        typeof primaryAddressRaw === "string" ? toCanonicalAddress(primaryAddressRaw) : "";
      setDecibelSubaccounts(addresses);
      setSelectedDecibelSubaccount((prev) => {
        if (prev && addresses.some((it) => areAddressesEqual(it, prev))) {
          return toCanonicalAddress(prev);
        }
        if (primaryAddress && addresses.some((it) => areAddressesEqual(it, primaryAddress))) {
          return primaryAddress;
        }
        return addresses[0] ?? "";
      });
    } catch {
      setDecibelSubaccounts([]);
      setSelectedDecibelSubaccount("");
    }
  }, [account?.address]);

  const loadDelegationStatus = async (subaccount: string) => {
    if (!subaccount) {
      setDelegationStatusError(null);
      setIsDelegatedToExecutor(false);
      setExecutorAddress(null);
      setDelegationDetails([]);
      return;
    }
    try {
      setDelegationStatusLoading(true);
      setDelegationStatusError(null);
      const response = await fetch(
        `/api/protocols/decibel/delegations?subaccount=${encodeURIComponent(subaccount)}`
      );
      const json = await response.json();
      if (!response.ok || !json?.success) {
        throw new Error(json?.error || "Failed to load delegation status");
      }
      setIsDelegatedToExecutor(Boolean(json?.isDelegatedToExecutor));
      setExecutorAddress(typeof json?.executorAddress === "string" ? json.executorAddress : null);
      setDelegationDetails(Array.isArray(json?.data) ? json.data : []);
    } catch (err) {
      setIsDelegatedToExecutor(false);
      setExecutorAddress(null);
      setDelegationDetails([]);
      setDelegationStatusError(
        err instanceof Error ? err.message : "Failed to load delegation status"
      );
    } finally {
      setDelegationStatusLoading(false);
    }
  };

  const handleDelegate = async () => {
    if (!account?.address) {
      toast({
        title: "Wallet not connected",
        description: "Connect your wallet to delegate trading.",
        variant: "destructive",
      });
      return;
    }
    if (!selectedDecibelSubaccount) {
      toast({
        title: "Subaccount required",
        description: "Select a Decibel subaccount first.",
        variant: "destructive",
      });
      return;
    }
    if (!executorAddress) {
      toast({
        title: "Executor is not configured",
        description: "Try refreshing delegation status and try again.",
        variant: "destructive",
      });
      return;
    }
    if (!signAndSubmitTransaction) {
      toast({
        title: "Unsupported wallet",
        description: "Current wallet cannot sign and submit transactions.",
        variant: "destructive",
      });
      return;
    }

    try {
      setDelegateSubmitting(true);
      const payload = buildDelegateTradingPayload({
        subaccountAddr: selectedDecibelSubaccount,
        accountToDelegateTo: executorAddress,
        expirationTimestampSecs: null,
      });
      const result = await signAndSubmitTransaction({
        data: {
          function: payload.function as `${string}::${string}::${string}`,
          typeArguments: payload.typeArguments,
          functionArguments: payload.functionArguments as (string | number | null)[],
        },
        options: { maxGasAmount: 20000 },
      });
      const txHash = typeof result?.hash === "string" ? result.hash : "";
      toast({
        title: "Delegation submitted",
        description: txHash
          ? `Transaction ${txHash.slice(0, 6)}...${txHash.slice(-4)}`
          : "Transaction submitted successfully.",
      });
      await loadDelegationStatus(selectedDecibelSubaccount);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delegate trading";
      toast({ title: "Delegation failed", description: msg, variant: "destructive" });
    } finally {
      setDelegateSubmitting(false);
    }
  };

  const handleExecutorOpenShort = async () => {
    if (!account?.address) {
      toast({
        title: "Wallet not connected",
        description: "Connect your wallet to continue.",
        variant: "destructive",
      });
      return;
    }
    if (!selectedDecibelSubaccount) {
      toast({
        title: "Subaccount required",
        description: "Select a Decibel subaccount first.",
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
      const response = await fetch("/api/protocols/decibel/executor-open-short", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: account.address.toString(),
          subaccount: selectedDecibelSubaccount,
          asset: executorAsset,
          sizeUsd,
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
        description: "Select a Decibel subaccount first.",
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
      const response = await fetch("/api/protocols/decibel/executor-open-delta-neutral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: account.address.toString(),
          subaccount: selectedDecibelSubaccount,
          safeAddress: safeAddr,
          asset: "BTC",
          sizeUsd,
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.success) {
        throw new Error(json?.error || "Failed to open delta-neutral via executor");
      }
      const openHash = json?.data?.openTxHash as string | undefined;
      const swapHash = json?.data?.swapTxHash as string | undefined;
      const filledShortSize = json?.data?.filledShortSize as string | undefined;

      setExecutorHedgeHint(null);
      toast({
        title: "Delta-neutral opened",
        description:
          `BTC short + safe swap submitted.` +
          (filledShortSize ? ` filledShortSize=${filledShortSize}` : "") +
          (openHash ? ` open:${openHash.slice(0, 6)}...${openHash.slice(-4)}` : "") +
          (swapHash ? ` swap:${swapHash.slice(0, 6)}...${swapHash.slice(-4)}` : ""),
      });
      if (safeAddr) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.deltaNeutralState(safeAddr) });
      }
      if (walletAddress) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.protocols.decibel.userPositions(walletAddress) });
      }
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "decibel" } }));
        window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "yield-ai" } }));
      }, 1500);
    } catch (err) {
      toast({
        title: "Delta-neutral open failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setExecutorSubmitting(false);
    }
  };

  const handleExecutorCloseDeltaNeutral = async () => {
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
      const response = await fetch("/api/protocols/decibel/executor-close-delta-neutral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: account.address.toString(),
          subaccount: deltaNeutral.decibelSubaccount,
          safeAddress: safeAddr,
          asset: "BTC",
        }),
      });
      const json = await response.json();
      if (!response.ok || !json?.success) {
        throw new Error(json?.error || "Failed to close delta-neutral via executor");
      }
      setCloseDeltaNeutralOpen(false);
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
      toast({
        title: "Delta-neutral close failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCloseDeltaNeutralSubmitting(false);
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
      const response = await fetch("/api/protocols/decibel/executor-swap-delta-neutral-residual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: account.address.toString(),
          subaccount: deltaNeutral.decibelSubaccount,
          safeAddress: safeAddr,
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
    return tokens.find((t) => normalizeAddress(t.address) === sm) ?? null;
  }, [deltaNeutral, tokens]);

  const filledShortHumanOnChain = useMemo(() => {
    if (!deltaNeutral?.filledShortSize) return null;
    try {
      const n = decibelChainUnitsToHumanBase(BigInt(deltaNeutral.filledShortSize), 8);
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

  /** Executor swap uses indexer amount; button disabled when indexer is zero. */
  const deltaNeutralResidualSwapUsable = deltaNeutralIndexerSpotBase > BigInt(0);

  const deltaNeutralResidualSwapVisible = Boolean(
    deltaNeutral?.recordExists &&
      !deltaNeutral.isOpen &&
      (deltaNeutralResidualSwapUsable || deltaNeutralSpotTokenHuman > 0)
  );

  // No initial fetch here: safe and token data are via useQuery (cached).

  useEffect(() => {
    if (!SHOW_EXECUTOR_TRADE_BLOCK) return;
    void loadDecibelSubaccounts();
  }, [loadDecibelSubaccounts]);

  useEffect(() => {
    if (!SHOW_EXECUTOR_TRADE_BLOCK) return;
    if (!selectedDecibelSubaccount) return;
    void loadDelegationStatus(selectedDecibelSubaccount);
  }, [selectedDecibelSubaccount]);

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

  const getMoarTokenAddress = (symbol: string) => {
    if (symbol === "APT") return "0x1::aptos_coin::AptosCoin";
    if (symbol === "USDC") return "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b";
    return symbol;
  };

  const handleMoarWithdrawConfirm = async () => {
    if (!selectedMoarWithdrawPosition) return;
    if (!safeAddr) return;
    if (!signAndSubmitTransaction) {
      toast({
        title: "Unsupported wallet",
        description: "Current wallet cannot sign and submit transactions.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsExecutingMoarWithdrawToSafe(true);
      const metadataAddress = getMoarTokenAddress(selectedMoarWithdrawPosition.assetInfo.symbol);
      if (metadataAddress.includes("::")) {
        throw new Error("This asset is not supported for adapter-to-safe withdraw");
      }

      const payload = buildVaultExecuteWithdrawFullAsOwnerPayload({
        safeAddress: safeAddr,
        adapterAddress: MOAR_ADAPTER_ADDRESS_MAINNET,
        metadata: metadataAddress,
      });

      const result = await signAndSubmitTransaction({
        data: {
          function: payload.function as `${string}::${string}::${string}`,
          typeArguments: payload.typeArguments,
          functionArguments: payload.functionArguments,
        },
        options: { maxGasAmount: 50000 },
      });

      if (!result?.hash) {
        throw new Error("Transaction was submitted without hash");
      }

      setShowMoarWithdrawConfirm(false);
      setSelectedMoarWithdrawPosition(null);
      if (safeAddr) {
        queryClient.invalidateQueries({ queryKey: queryKeys.protocols.moar.userPositions(safeAddr) });
        queryClient.invalidateQueries({ queryKey: queryKeys.protocols.moar.rewards(safeAddr) });
      }
      toast({
        title: "Withdraw to safe submitted",
        description: "Position is being moved from protocol adapter to AI agent safe.",
      });
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "yield-ai" } }));
      }, 2000);
    } catch (err) {
      console.error("Moar execute_withdraw_full_as_owner failed:", err);
      toast({
        title: "Withdraw Failed",
        description: err instanceof Error ? err.message : "Withdraw failed. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsExecutingMoarWithdrawToSafe(false);
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

  const handleEchelonWithdrawConfirm = async () => {
    if (!selectedEchelonWithdrawRow || !safeAddr || !echelonAdapterAddress) return;
    if (!signAndSubmitTransaction) {
      toast({
        title: "Unsupported wallet",
        description: "Current wallet cannot sign and submit transactions.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsExecutingEchelonWithdrawToSafe(true);
      const marketObj = toCanonicalAddress(selectedEchelonWithdrawRow.marketObj);
      const payload = buildVaultExecuteWithdrawAllEchelonFaAsOwnerPayload({
        safeAddress: toCanonicalAddress(safeAddr),
        adapterAddress: toCanonicalAddress(echelonAdapterAddress),
        marketObj,
      });

      const result = await signAndSubmitTransaction({
        data: {
          function: payload.function as `${string}::${string}::${string}`,
          typeArguments: payload.typeArguments,
          functionArguments: payload.functionArguments,
        },
        options: { maxGasAmount: 50000 },
      });

      if (!result?.hash) {
        throw new Error("Transaction was submitted without hash");
      }

      setShowEchelonWithdrawConfirm(false);
      setSelectedEchelonWithdrawRow(null);
      if (safeAddr) {
        queryClient.invalidateQueries({ queryKey: queryKeys.protocols.echelon.userPositions(safeAddr) });
        queryClient.invalidateQueries({ queryKey: queryKeys.protocols.echelon.rewards(safeAddr) });
        queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.safeTokens(safeAddr) });
      }
      toast({
        title: "Echelon exit submitted",
        description: "Full position is being withdrawn from Echelon into your AI agent safe.",
      });
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "yield-ai" } }));
      }, 2000);
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
  };

  const handleUsd1ConvertConfirm = async () => {
    if (!safeAddr) return;
    if (isConvertingUsd1ToUsdc) return;
    try {
      setIsConvertingUsd1ToUsdc(true);
      const res = await fetch("/api/protocols/yield-ai/swap/usd1-to-usdc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          safeAddress: safeAddr,
          amountInBaseUnits: usd1ConvertAmountBaseUnits,
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

  const rewardsData = rewardsResponse?.data ?? [];
  const totalRewardsValue = rewardsResponse?.totalUsd ?? 0;
  const combinedRewardsValue = totalRewardsValue + echelonRewardsValueUsd;
  const REWARDS_SHOW_EPS = 1e-8;
  const hasAnyRewards =
    totalRewardsValue > REWARDS_SHOW_EPS || echelonRewardsValueUsd > REWARDS_SHOW_EPS;
  const includingRewardsLabel =
    combinedRewardsValue > 0 && combinedRewardsValue < 1
      ? "<$1"
      : formatCurrency(combinedRewardsValue, 2);

  const moarPositionsValue = moarPositions.reduce(
    (sum, p) => sum + parseFloat(p.value || "0"),
    0
  );
  const totalValue =
    tokens.reduce((sum, t) => sum + (t.value ? parseFloat(t.value) : 0), 0) +
    moarPositionsValue +
    totalRewardsValue +
    echelonTotalValue;

  const { data: depositHistory, isLoading: historyLoading, isFetching: historyFetching } = useYieldAiDepositHistory(
    safeAddr,
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

  const aiAgentProtocolConfig = useMemo(() => getProtocolByName("AI agent"), []);
  const walletUsdcPriceUsd = useMemo(() => {
    const usdc = walletTokens?.find(
      (t) =>
        normalizeAddress(t.address) === normalizeAddress(USDC_FA_METADATA_MAINNET) ||
        t.symbol === "USDC"
    );
    return usdc?.price ? parseFloat(usdc.price) : 1;
  }, [walletTokens]);

  const performanceLoading =
    historyLoading ||
    historyFetching ||
    safesLoading ||
    safeTokensLoading ||
    moarPositionsLoading ||
    moarRewardsLoading ||
    echelonLoading;

  if (safesError) {
    return (
      <div className="py-4 text-red-500">
        {safesError instanceof Error ? safesError.message : "Failed to load AI agent safes."}
      </div>
    );
  }
  if (safesLoading && safeAddresses.length === 0) {
    return <div className="py-4 text-muted-foreground">Loading safe assets...</div>;
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
        <div className="flex flex-wrap items-center justify-between gap-3 gap-y-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="text-sm font-medium text-muted-foreground">
              Safe {safeAddresses[0].slice(0, 6)}...{safeAddresses[0].slice(-4)}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(safeAddresses[0])
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
          </div>
          {!tokens.some(
            (t) =>
              t.symbol === "USDC" ||
              normalizeAddress(t.address) === normalizeAddress(USDC_FA_METADATA_MAINNET)
          ) && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="default" onClick={() => setShowDepositModal(true)}>
                Deposit USDC
              </Button>
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
          )}
        </div>
        <p className="text-sm font-normal text-muted-foreground">
          AI agent rebalances positions every hour
        </p>
      </div>

      {safeAddr && (
        <div className="rounded-lg border bg-card p-3 sm:p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-medium">Decibel delta-neutral</div>
              <div className="text-sm text-muted-foreground">
                On-chain record plus Decibel perp and spot hedge in your safe (BTC / xBTC).
              </div>
            </div>
            {deltaNeutral?.isOpen ? (
              <Badge className="bg-green-500/10 text-green-700 border-green-500/30 shrink-0">Open</Badge>
            ) : deltaNeutral?.recordExists ? (
              <Badge variant="secondary" className="shrink-0">
                Closed
              </Badge>
            ) : null}
          </div>
          {deltaNeutralLoading || decibelPositionsLoading ? (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading delta-neutral state…
            </div>
          ) : deltaNeutralError ? (
            <div className="text-sm text-destructive">
              {deltaNeutralError instanceof Error ? deltaNeutralError.message : "Failed to load state"}
            </div>
          ) : !deltaNeutral?.recordExists ? (
            <div className="text-sm text-muted-foreground">No delta-neutral vault record for this safe.</div>
          ) : !deltaNeutral.isOpen ? (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Last position was closed on-chain. Open a new one from the executor block below when enabled.
              </p>
              {(() => {
                // Closed-state strategy recap: aggregate realized perp PnL / funding / fees
                // from Decibel trade_history in [openedAt, closedAt+2min]. We cannot recover
                // the spot close-swap USDC output from the current registry shape, so the
                // "strategy net" shown here is perp-side only (price + funding − fees).
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

                return (
                  <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Strategy recap (closed)
                      </span>
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
                                price PnL + funding − fees. Spot leg not included (close-swap
                                output is not stored on-chain).
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <div className={`font-semibold ${pnlColor(perpNet)}`}>
                          {perpNet != null ? signed(perpNet) : "—"}
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-border/60 grid gap-2 sm:grid-cols-2 text-xs">
                      <div>
                        <div className="text-muted-foreground">Spot entry cost (recorded)</div>
                        <div className="font-medium">
                          {Number.isFinite(entryUsdcIn) ? formatCurrency(entryUsdcIn, 2) : "—"} USDC in
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Spot close output</div>
                        <div className="text-muted-foreground italic">
                          not recorded on-chain · infer from safe USDC delta or close tx
                        </div>
                      </div>
                    </div>

                    <div className="text-[11px] text-muted-foreground">
                      Full strategy PnL ≈ Perp net + (spot_close_usdc_out − spot_entry_cost).
                      For a sized DN the spot leg roughly cancels perp price PnL, so the real
                      carry is funding minus fees and swap costs.
                    </div>
                  </div>
                );
              })()}
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
                    Recorded short (on-chain → est. BTC)
                  </div>
                  <div>
                    {deltaNeutral.filledShortSize}
                    {filledShortHumanOnChain != null
                      ? ` (~${formatNumber(filledShortHumanOnChain, 8)} BTC)`
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
                  {normalizeAddress(deltaNeutral.spotAssetMetadata) === normalizeAddress(XBTC_FA_METADATA_MAINNET) ? (
                    <Badge variant="outline">xBTC</Badge>
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
                  {!deltaNeutralResidualSwapUsable && deltaNeutralSpotTokenHuman > 0 ? (
                    <p className="text-xs text-amber-700 dark:text-amber-500 max-w-prose">
                      Safe list shows spot, but the route balance is zero—refresh this page so the indexer-backed
                      amount matches; the executor swaps the indexer-reported balance only.
                    </p>
                  ) : null}
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

                    <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
                      <div>
                        <div className="text-xs text-muted-foreground">Spot long (safe)</div>
                        <div className="font-semibold">
                          {longNotionalUsd != null ? formatCurrency(longNotionalUsd, 2) : "—"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatNumber(spotHuman, 8)}{" "}
                          {deltaNeutralSpotToken?.symbol ?? "spot"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Perp short (Decibel)</div>
                        <div className="font-semibold">
                          {shortNotionalUsd != null ? formatCurrency(shortNotionalUsd, 2) : "—"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatNumber(shortSizeAbs, 8)}
                          {entryPxPerp != null
                            ? ` · entry ~${formatCurrency(entryPxPerp, 2)}`
                            : ""}
                        </div>
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
                        <div className={`font-semibold ${netDeltaColor}`}>
                          {netDeltaUsd != null ? signed(netDeltaUsd) : "—"}
                        </div>
                        <div className="text-xs text-muted-foreground">target ≈ $0</div>
                      </div>
                    </div>

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
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Recorded short (on-chain units → est. BTC)
                  </div>
                  <div>
                    {deltaNeutral.filledShortSize}
                    {filledShortHumanOnChain != null
                      ? ` (~${formatNumber(filledShortHumanOnChain, 8)} BTC)`
                      : ""}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">USDC swapped in (recorded)</div>
                  <div>
                    {(Number(deltaNeutral.usdcSwappedIn) / 1e6).toLocaleString(undefined, {
                      maximumFractionDigits: 6,
                    })}{" "}
                    USDC
                  </div>
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Spot hedge in safe</div>
                <div className="flex flex-wrap items-center gap-2">
                  {normalizeAddress(deltaNeutral.spotAssetMetadata) === normalizeAddress(XBTC_FA_METADATA_MAINNET) ? (
                    <Badge variant="outline">xBTC</Badge>
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
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={!deltaNeutralPerpRow || closeDeltaNeutralSubmitting}
                  onClick={() => setCloseDeltaNeutralOpen(true)}
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
      )}

      {SHOW_EXECUTOR_TRADE_BLOCK && (
        <>
          <div className="rounded-lg border bg-card p-3 sm:p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">Decibel Delegation</div>
                <div className="text-sm text-muted-foreground">
                  Delegate selected subaccount to executor for AI trading.
                </div>
              </div>
              <Badge
                variant="outline"
                className={
                  isDelegatedToExecutor
                    ? "bg-green-500/10 text-green-600 border-green-500/20"
                    : "bg-muted text-muted-foreground"
                }
              >
                {delegationStatusLoading
                  ? "Checking..."
                  : isDelegatedToExecutor
                    ? "Delegated"
                    : "Not delegated"}
              </Badge>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select
                value={selectedDecibelSubaccount}
                onValueChange={setSelectedDecibelSubaccount}
                disabled={decibelSubaccounts.length === 0 || delegateSubmitting}
              >
                <SelectTrigger className="w-full sm:w-[380px]">
                  <SelectValue placeholder="Select Decibel subaccount" />
                </SelectTrigger>
                <SelectContent>
                  {decibelSubaccounts.map((sub) => (
                    <SelectItem key={sub} value={sub}>
                      {sub.slice(0, 8)}...{sub.slice(-6)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="default"
                  onClick={handleDelegate}
                  disabled={
                    delegateSubmitting ||
                    !account?.address ||
                    !selectedDecibelSubaccount ||
                    !executorAddress
                  }
                >
                  {delegateSubmitting ? "Delegating..." : "Delegate"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (selectedDecibelSubaccount) {
                      void loadDelegationStatus(selectedDecibelSubaccount);
                    }
                  }}
                  disabled={delegationStatusLoading || !selectedDecibelSubaccount}
                >
                  Refresh status
                </Button>
              </div>
            </div>

            {executorAddress && (
              <div className="text-xs text-muted-foreground">
                Executor: {executorAddress.slice(0, 8)}...{executorAddress.slice(-6)}
              </div>
            )}
            {delegationDetails.length > 0 && (
              <div className="text-xs text-muted-foreground space-y-1">
                <div className="font-medium text-foreground/80">Active permissions</div>
                <div className="space-y-0.5">
                  {delegationDetails.map((d, idx) => (
                    <div key={`${d.delegatedAccount}-${d.permissionType}-${idx}`} className="flex flex-wrap gap-2">
                      <span className="font-mono">
                        {d.delegatedAccount.slice(0, 8)}...{d.delegatedAccount.slice(-6)}
                      </span>
                      <span className={d.permissionType.toLowerCase().includes("perp") ? "text-green-600" : ""}>
                        {d.permissionType}
                      </span>
                      {d.isExpired && <span className="text-destructive">expired</span>}
                    </div>
                  ))}
                </div>
                {!delegationDetails.some((d) => d.permissionType.toLowerCase().includes("perp")) && (
                  <div className="text-destructive">
                    Perps permission is missing. Re-delegate and then refresh status (Decibel API may lag indexing).
                  </div>
                )}
              </div>
            )}
            {decibelSubaccounts.length === 0 && (
              <div className="text-xs text-muted-foreground">
                No Decibel subaccounts found for this wallet.
              </div>
            )}
            {delegationStatusError && (
              <div className="text-xs text-destructive">{delegationStatusError}</div>
            )}
          </div>

          <div className="rounded-lg border bg-card p-3 sm:p-4 space-y-3">
            <div>
              <div className="font-medium">Executor Trade</div>
              <div className="text-sm text-muted-foreground">
                Test mode: executor opens Decibel BTC short without wallet popup.
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="flex items-center h-10 rounded-md border bg-muted/30 px-3 text-sm text-muted-foreground">
                BTC
              </div>
              <Input
                type="number"
                min="0"
                step="any"
                placeholder="Size USD"
                value={executorSizeUsd}
                onChange={(e) => setExecutorSizeUsd(e.target.value)}
                disabled={executorSubmitting}
              />
              <Button
                variant="default"
                onClick={handleExecutorOpenShort}
                disabled={
                  executorSubmitting ||
                  !selectedDecibelSubaccount
                }
              >
                {executorSubmitting ? "Submitting..." : "Open short 1x"}
              </Button>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={handleExecutorOpenDeltaNeutral}
                disabled={executorSubmitting || !selectedDecibelSubaccount || !safeAddr}
              >
                {executorSubmitting ? "Submitting..." : "Open delta-neutral (BTC → xBTC in safe)"}
              </Button>
              {!safeAddr && (
                <div className="text-xs text-muted-foreground self-center">
                  Create a safe first.
                </div>
              )}
            </div>
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
        {moarPositions.length > 0 && (
          <div className="px-3 sm:px-4 pt-1 pb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Moar Market
          </div>
        )}
        {moarPositions
          .filter((position) => {
            const v = parseFloat(position.value || "0");
            return Number.isFinite(v) && v >= MIN_VISIBLE_USD;
          })
          .map((position) => {
          const value = parseFloat(position.value || "0");
          const valueIsFinite = Number.isFinite(value);
          const decimals = position.assetInfo?.decimals ?? 8;
          const amount = parseFloat(position.balance || "0") / Math.pow(10, decimals);
          const poolAPR = poolsAPR[position.poolId];
          const positionRewards = rewardsData.filter(
            (reward: { farming_identifier?: string }) =>
              reward.farming_identifier &&
              reward.farming_identifier === position.poolId.toString()
          );
          return (
            <div key={`moar-${position.poolId}`} className="border-b last:border-b-0">
              <div className="p-3 sm:p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="flex gap-3 min-w-0 flex-1">
                  <div className="flex shrink-0 flex-col items-center gap-1.5">
                    <div className="flex items-center -space-x-1">
                      <div className="w-8 h-8 relative shrink-0 rounded-full bg-muted flex items-center justify-center overflow-hidden ring-2 ring-background">
                        <Image
                          src="/protocol_ico/moar-market-logo-primary.png"
                          alt="MOAR"
                          width={32}
                          height={32}
                          className="object-contain"
                          unoptimized
                        />
                      </div>
                      {position.assetInfo?.logoUrl && (
                        <div className="w-8 h-8 relative shrink-0 rounded-full bg-muted flex items-center justify-center overflow-hidden ring-2 ring-background">
                          <Image
                            src={position.assetInfo.logoUrl}
                            alt={position.assetInfo.symbol}
                            width={32}
                            height={32}
                            className="object-contain"
                            unoptimized
                          />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="min-w-0 flex flex-1 flex-col justify-center gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold leading-tight pt-0.5 truncate">
                          {position.assetInfo?.symbol ?? "—"}
                        </span>
                        <Badge
                          variant="outline"
                          className="bg-green-500/10 text-green-600 border-green-500/20 px-2 py-0.5 text-xs font-normal h-5"
                        >
                          Supply
                        </Badge>
                      </div>
                      <div className="text-right shrink-0 sm:hidden">
                        {poolAPR && poolAPR.totalAPR > 0 && (
                          <div className="flex justify-end mb-1">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge
                                    variant="outline"
                                    className="cursor-help bg-blue-500/10 text-blue-600 border-blue-500/20 px-2 py-0.5 text-[10px] font-normal leading-none h-5"
                                  >
                                    APR: {formatNumber(poolAPR.totalAPR, 2)}%
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <div className="space-y-1 text-xs">
                                    <p className="font-medium">APR breakdown</p>
                                    <p>
                                      Interest: {formatNumber(poolAPR.interestRateComponent, 2)}%
                                    </p>
                                    <p>Farming: {formatNumber(poolAPR.farmingAPY, 2)}%</p>
                                    <p className="font-semibold">
                                      Total: {formatNumber(poolAPR.totalAPR, 2)}%
                                    </p>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        )}
                        <div className="text-lg font-bold leading-tight">
                          {valueIsFinite ? formatCurrency(value, 2) : "—"}
                        </div>
                        <div className="text-base font-semibold leading-tight text-muted-foreground">
                          {formatNumber(amount, 4)}
                        </div>
                      </div>
                    </div>
                    {amount > 0 && (
                      <div className="sm:hidden">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isExecutingMoarWithdrawToSafe}
                          onClick={() => {
                            setSelectedMoarWithdrawPosition(position);
                            setShowMoarWithdrawConfirm(true);
                          }}
                          className="h-auto min-h-9 w-full whitespace-normal px-2 py-2 text-center text-[11px] leading-snug"
                        >
                          {isExecutingMoarWithdrawToSafe
                            ? "Withdrawing…"
                            : "Withdraw to AI agent wallet"}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="hidden shrink-0 sm:flex flex-col items-end gap-2">
                  <div className="text-right">
                    <div className="flex items-center justify-end gap-2 mb-1">
                      {poolAPR && poolAPR.totalAPR > 0 && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="outline"
                                className="cursor-help bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs font-normal px-2 py-0.5 h-5"
                              >
                                APR: {formatNumber(poolAPR.totalAPR, 2)}%
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="space-y-1 text-xs">
                                <p className="font-medium">APR breakdown</p>
                                <p>
                                  Interest: {formatNumber(poolAPR.interestRateComponent, 2)}%
                                </p>
                                <p>Farming: {formatNumber(poolAPR.farmingAPY, 2)}%</p>
                                <p className="font-semibold">
                                  Total: {formatNumber(poolAPR.totalAPR, 2)}%
                                </p>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      <div className="text-lg font-bold leading-tight">
                        {valueIsFinite ? formatCurrency(value, 2) : "—"}
                      </div>
                    </div>
                    <div className="text-base font-semibold leading-tight text-muted-foreground">
                      {formatNumber(amount, 4)}
                    </div>
                  </div>
                  {amount > 0 && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isExecutingMoarWithdrawToSafe}
                      onClick={() => {
                        setSelectedMoarWithdrawPosition(position);
                        setShowMoarWithdrawConfirm(true);
                      }}
                      className="h-auto max-w-[11rem] whitespace-normal px-2 py-2 text-center text-xs leading-tight"
                    >
                      {isExecutingMoarWithdrawToSafe
                        ? "Withdrawing…"
                        : "Withdraw to AI agent wallet"}
                    </Button>
                  )}
                </div>
              </div>
              {positionRewards.length > 0 && (
                <div className="px-3 sm:px-4 pb-3 pt-0 border-t border-border">
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    💰 Supply Rewards
                  </div>
                  <div className="space-y-1">
                    {positionRewards.map((reward: { logoUrl?: string | null; symbol?: string; usdValue?: number; amount?: number; token_info?: { symbol?: string } }, rewardIdx: number) => (
                      <TooltipProvider key={rewardIdx}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center justify-between text-xs cursor-help">
                              <div className="flex items-center gap-1">
                                {reward.logoUrl && (
                                  <Image
                                    src={reward.logoUrl}
                                    alt={reward.symbol ?? "?"}
                                    width={12}
                                    height={12}
                                    className="object-contain"
                                    unoptimized
                                  />
                                )}
                                <span className="text-muted-foreground">
                                  {reward.symbol ?? "Unknown"}
                                </span>
                              </div>
                              <div className="text-right">
                                <div className="font-medium">
                                  {formatCurrency(reward.usdValue ?? 0)}
                                </div>
                              </div>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="bg-popover text-popover-foreground border-border">
                            <div className="text-xs">
                              <div className="text-muted-foreground">
                                {formatNumber(reward.amount ?? 0, 6)}{" "}
                                {reward.token_info?.symbol ?? reward.symbol ?? "Unknown"}
                              </div>
                              <div className="text-muted-foreground">
                                {formatCurrency(reward.usdValue ?? 0)}
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {(() => {
          const visibleEchelonRows = echelonModalRows.filter(
            (row) => Number.isFinite(row.valueUsd) && row.valueUsd >= MIN_VISIBLE_USD
          );
          if (visibleEchelonRows.length === 0) return null;
          return (
          <div
            className={
              moarPositions.length > 0
                ? "px-3 sm:px-4 pt-3 pb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide border-t border-border"
                : "px-3 sm:px-4 pt-1 pb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide"
            }
          >
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
        moarPositions.length === 0 &&
        echelonModalRows.filter((row) => Number.isFinite(row.valueUsd) && row.valueUsd >= MIN_VISIBLE_USD).length === 0 &&
        echelonRewardsValueUsd === 0 ? (
          <div className="py-4 text-muted-foreground">No assets in this safe.</div>
        ) : (
          <>
            {tokens.length > 0 && (
              <div
                className={
                  moarPositions.length > 0 || echelonModalRows.length > 0
                    ? "px-3 sm:px-4 pt-3 pb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide border-t border-border"
                    : "px-3 sm:px-4 pt-1 pb-2 text-xs font-medium text-muted-foreground uppercase tracking-wide"
                }
              >
                AI agent wallet (safe)
              </div>
            )}
            {tokens
              .filter((token) => {
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
            return (
              <div
                key={token.address}
                className="p-3 sm:p-4 border-b last:border-b-0 flex justify-between items-center gap-3"
              >
                <div className="flex items-center gap-3 min-w-0">
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
                      {isUsdc && (
                        <Badge
                          variant="outline"
                          className="bg-green-500/10 text-green-600 border-green-500/20 text-xs font-normal px-2 py-0.5 h-5"
                        >
                          AGENT WALLET
                        </Badge>
                      )}
                    </div>
                    {price > 0 && (
                      <div className="text-sm text-muted-foreground">
                        {formatCurrency(price, 4)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-bold">{formatCurrency(value, 2)}</div>
                  <div className="text-base text-muted-foreground font-semibold">
                    {formatNumber(amount, 4)}
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
                  {isUsdc && (
                    <div className="flex flex-wrap gap-2 mt-2 justify-end">
                      <Button
                        size="sm"
                        variant="default"
                        className="h-10"
                        onClick={() => setShowDepositModal(true)}
                      >
                        Deposit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-10 px-3"
                        onClick={() => setShowHistoryModal(true)}
                        aria-label="Open deposit history"
                      >
                        <History className="h-4 w-4" />
                      </Button>
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
                <TooltipContent className="bg-popover text-popover-foreground border-border max-w-xs">
                  <div className="text-xs font-semibold mb-1">Rewards breakdown:</div>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {rewardsData.map(
                      (
                        reward: {
                          logoUrl?: string | null;
                          symbol?: string;
                          amount?: number;
                          usdValue?: number;
                        },
                        idx: number
                      ) => (
                        <div key={`moar-${idx}`} className="flex items-center gap-2">
                          {reward.logoUrl && (
                            <img
                              src={reward.logoUrl}
                              alt={reward.symbol ?? ""}
                              className="w-3 h-3 rounded-full"
                            />
                          )}
                          <span>{reward.symbol}</span>
                          <span>{formatNumber(reward.amount ?? 0, 6)}</span>
                          <span className="text-muted-foreground">
                            {formatCurrency(reward.usdValue ?? 0)}
                          </span>
                        </div>
                      )
                    )}
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

        <PnlSummaryRow
          className="pt-3 mt-2 border-t border-border"
          pnlUsd={pnlUsd}
          aprPct={aprPct}
          holdingDays={holdingDays}
          isLoading={performanceLoading}
        />
      </div>

      <DepositModal
        isOpen={showDepositModal}
        onClose={() => setShowDepositModal(false)}
        protocol={{
          name: aiAgentProtocolConfig?.name ?? "AI agent",
          logo: aiAgentProtocolConfig?.logoUrl ?? "/logo.png",
          apy: aprPct ?? 0,
          key: "yield-ai",
        }}
        tokenIn={{
          symbol: "USDC",
          logo: USDC_LOGO_APTOS,
          decimals: 6,
          address: USDC_FA_METADATA_MAINNET,
        }}
        tokenOut={{
          symbol: "USDC",
          logo: USDC_LOGO_APTOS,
          decimals: 6,
          address: USDC_FA_METADATA_MAINNET,
        }}
        priceUSD={walletUsdcPriceUsd}
        yieldAiSafeAddress={safeAddresses[0]}
      />

      <YieldAIWithdrawModal
        isOpen={showWithdrawModal}
        onClose={() => {
          setShowWithdrawModal(false);
          setSelectedWithdrawToken(null);
        }}
        token={selectedWithdrawToken}
        safeAddress={safeAddresses[0]}
      />

      <YieldAiHistoryModal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        safeAddress={safeAddresses[0]}
        history={depositHistory}
        currentValueUsd={Number.isFinite(totalValue) ? totalValue : null}
      />

      <AlertDialog
        open={closeDeltaNeutralOpen}
        onOpenChange={(open) => {
          if (closeDeltaNeutralSubmitting) return;
          setCloseDeltaNeutralOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close delta-neutral position?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  This will submit executor transactions: close the Decibel BTC short at market, swap spot from your
                  safe back toward USDC, then update the on-chain delta-neutral record. Slippage and pool limits apply;
                  amounts are not guaranteed.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={closeDeltaNeutralSubmitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={closeDeltaNeutralSubmitting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void handleExecutorCloseDeltaNeutral();
              }}
            >
              {closeDeltaNeutralSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin inline" />
                  Closing…
                </>
              ) : (
                "Confirm close"
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

      {selectedMoarWithdrawPosition && (
        <AlertDialog
          open={showMoarWithdrawConfirm}
          onOpenChange={(open) => {
            if (isExecutingMoarWithdrawToSafe) return;
            setShowMoarWithdrawConfirm(open);
            if (!open) setSelectedMoarWithdrawPosition(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Withdraw to AI agent safe?</AlertDialogTitle>
              <AlertDialogDescription>
                This action executes a full withdraw from the Moar adapter back to your AI agent safe.
                After this transaction succeeds, use Withdraw in the AI agent wallet section to send funds to your wallet.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isExecutingMoarWithdrawToSafe}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isExecutingMoarWithdrawToSafe}
                onClick={(event) => {
                  event.preventDefault();
                  void handleMoarWithdrawConfirm();
                }}
              >
                {isExecutingMoarWithdrawToSafe ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Withdrawing...
                  </>
                ) : (
                  "Confirm"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {selectedEchelonWithdrawRow && (
        <AlertDialog
          open={showEchelonWithdrawConfirm}
          onOpenChange={(open) => {
            if (isExecutingEchelonWithdrawToSafe) return;
            setShowEchelonWithdrawConfirm(open);
            if (!open) setSelectedEchelonWithdrawRow(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Withdraw to AI agent safe?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>
                    This action executes a full withdraw from Echelon on this market back to your AI agent safe.
                    After this transaction succeeds, use Withdraw in the AI agent wallet section to send funds to
                    your wallet.
                  </p>
                  {echelonAdapterLoadError ? (
                    <p className="text-destructive text-xs">
                      Echelon adapter address could not be loaded: {echelonAdapterLoadError}
                    </p>
                  ) : null}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isExecutingEchelonWithdrawToSafe}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={
                  isExecutingEchelonWithdrawToSafe ||
                  !echelonAdapterAddress ||
                  Boolean(echelonAdapterLoadError)
                }
                onClick={(event) => {
                  event.preventDefault();
                  void handleEchelonWithdrawConfirm();
                }}
              >
                {isExecutingEchelonWithdrawToSafe ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Withdrawing...
                  </>
                ) : (
                  "Confirm"
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
