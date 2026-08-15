"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ExternalLink } from "lucide-react";
import Image from "next/image";
import { useSolanaPortfolio } from "@/hooks/useSolanaPortfolio";
import type { Token } from "@/lib/types/token";
import { JupiterDepositModal } from "@/components/ui/jupiter-deposit-modal";
import { JupiterWithdrawModal } from "@/components/ui/jupiter-withdraw-modal";
import { formatCurrency, formatNumber } from "@/lib/utils/numberFormat";
import { getPreferredJupiterTokenIcon } from "@/lib/services/solana/jupiterTokenIcons";
import { getSolanaRpcEndpoint } from "@/lib/solana/kaminoKvVaultTx";
import { extractKvaultVaultAddress, isLikelySolanaAddress } from "@/lib/kamino/kvaultVaultAddress";
import { useToast } from "@/components/ui/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { useKaminoPositions } from "@/lib/query/hooks/protocols/kamino/useKaminoPositions";
import { useKaminoRewards } from "@/lib/query/hooks/protocols/kamino/useKaminoRewards";
import type { KaminoClaimTarget } from "@/lib/kamino/kaminoClaimTypes";
import { buildKaminoClaimTargets } from "@/lib/kamino/buildKaminoClaimTargets";
import {
  computeKaminoRewardsUsd,
  filterMeaningfulKaminoRewardRows,
  formatKaminoRewardUsd,
  hasVisibleKaminoRewards,
} from "@/lib/kamino/kaminoRewardUsd";
import { resolveKaminoViewerAddress } from "@/lib/kamino/kaminoTestAddress";
import { KaminoClaimRewardsModal } from "@/components/ui/kamino-claim-rewards-modal";
import { useSearchParams } from "next/navigation";
import {
  isYieldAiNativeAppNow,
  signAndSubmitSolanaTransaction,
} from "@/lib/mobile/nativeBridge";
import { useNativeWalletStore } from "@/lib/stores/nativeWalletStore";
import {
  LendingProtocolCard,
  type LendingProtocolCardRow,
  type LendingProtocolCardSection,
  type LendingProtocolCardTile,
} from "@/shared/ProtocolCard";

const KAMINO_LEND_URL = "https://kamino.com/lend";
const KAMINO_LOCAL_ICON = "/protocol_ico/kamino.png";

function fingerprintRows(rows: KaminoPosition[]): string {
  const parts = rows.map((r) => {
    const source = String(r.source ?? "");
    const vault = String(r.vaultAddress ?? "");
    const farm = String(r.farmPubkey ?? "");
    const market = String(r.marketPubkey ?? "");
    const usd = String(r.netUsdAmount ?? "");
    const tok = String(r.netTokenAmount ?? "");
    const shares =
      r.position && typeof r.position === "object"
        ? `${String((r.position as any).totalShares ?? "")}:${String((r.position as any).unstakedShares ?? "")}:${String((r.position as any).stakedShares ?? "")}`
        : "";
    return [source, vault, farm, market, usd, tok, shares].join("|");
  });
  return `${rows.length}:${parts.join("~")}`;
}

type KaminoPosition = {
  source?: "kamino-lend" | "kamino-earn" | "kamino-farm" | string;
  marketName?: string;
  marketPubkey?: string;
  obligation?: unknown;
  position?: unknown;
  farmPubkey?: string;
  tokenMint?: string;
  tokenSymbol?: string;
  tokenLogoUrl?: string;
  netTokenAmount?: string;
  netUsdAmount?: string;
  /** Set by API when farm pubkey maps to a kVault (Steakhouse, etc.). */
  vaultAddress?: string;
  vaultName?: string;
};

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getDeep(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const p of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[p];
  }
  return current;
}

function pickFirstNumber(obj: unknown, paths: string[], fallback = 0): number {
  for (const path of paths) {
    const value = getDeep(obj, path);
    const n = toNumber(value, NaN);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function shortKey(value?: string): string {
  if (!value) return "Unknown";
  if (value.length <= 10) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function isExternalUrl(value?: string): boolean {
  if (!value) return false;
  return /^https?:\/\//i.test(value);
}

function extractUnderlyingMintSymbol(position: unknown): { mint?: string; symbol?: string } {
  if (!position || typeof position !== "object") return {};
  const o = position as Record<string, unknown>;
  const fromState = getDeep(position, "state.tokenMint");
  const mintRaw =
    (typeof o.tokenMint === "string" && o.tokenMint.trim()) ||
    (typeof fromState === "string" && fromState.trim()) ||
    (typeof getDeep(position, "vault.tokenMint") === "string" && String(getDeep(position, "vault.tokenMint")).trim()) ||
    undefined;
  const symRaw =
    (typeof o.tokenSymbol === "string" && o.tokenSymbol.trim()) ||
    (typeof getDeep(position, "state.tokenSymbol") === "string" && String(getDeep(position, "state.tokenSymbol")).trim()) ||
    (typeof o.symbol === "string" && o.symbol.trim()) ||
    undefined;
  return { mint: mintRaw || undefined, symbol: symRaw || undefined };
}

function walletUiAmountForMint(tokens: Token[], mint: string | undefined): number {
  const m = (mint ?? "").trim();
  if (!m) return 0;
  const token = tokens.find((t) => (t.address ?? "").trim() === m);
  if (!token) return 0;
  const rawAmount = Number(token.amount);
  const decimals = Number(token.decimals);
  if (!Number.isFinite(rawAmount) || !Number.isFinite(decimals) || decimals < 0) return 0;
  return rawAmount / Math.pow(10, decimals);
}

function parseEarnShares(position: unknown): { total: number; unstaked: number; staked: number } {
  if (!position || typeof position !== "object") {
    return { total: 0, unstaked: 0, staked: 0 };
  }
  const o = position as Record<string, unknown>;
  return {
    total: toNumber(o.totalShares, 0),
    unstaked: toNumber(o.unstakedShares, 0),
    staked: toNumber(o.stakedShares, 0),
  };
}

function toBase58Address(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof (value as { toBase58?: () => string }).toBase58 === "function") {
    try {
      return (value as { toBase58: () => string }).toBase58();
    } catch {
      // noop
    }
  }
  return "";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = (error.message || "").trim();
    if (message.length > 0) return message;
    return "Unknown error";
  }
  if (typeof error === "string") return error;
  return "Unknown error";
}

function KaminoLogo({
  alt,
  externalLogoUrl,
  fallbackLogoUrl,
  symbol,
}: {
  alt: string;
  externalLogoUrl?: string;
  fallbackLogoUrl?: string;
  symbol?: string;
}) {
  const [stage, setStage] = useState<"primary" | "fallback" | "badge">("primary");
  const sym = (symbol || "").trim().toUpperCase();
  const fallbackText = (sym || alt || "TOKEN").trim().slice(0, 4).toUpperCase();
  const primary = (externalLogoUrl || "").trim();
  const fallback = (fallbackLogoUrl || "").trim();
  const src = stage === "primary" ? (primary || null) : stage === "fallback" ? (fallback || null) : null;
  if (!src) {
    return (
      <div className="w-8 h-8 rounded-full bg-slate-500/20 text-slate-200/90 flex items-center justify-center text-[10px] font-semibold">
        {fallbackText}
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt={alt}
      width={32}
      height={32}
      className="object-contain"
      unoptimized={isExternalUrl(src)}
      onError={() => {
        if (stage === "primary" && fallback) setStage("fallback");
        else setStage("badge");
      }}
    />
  );
}

type NormalizedKaminoRow =
  | {
      kind: "farm";
      id: string;
      label: string;
      fallbackLogoUrl: string;
      valueUsd: number;
      amount: number;
      price?: number;
      typeLabel: string;
      typeColor: string;
    }
  | {
      kind: "lend";
      id: string;
      label: string;
      fallbackLogoUrl: string;
      valueUsd: number;
      amount: number;
      aprPct?: number;
      /** Deposit used as collateral for an active borrow on the same obligation. */
      isCollateral?: boolean;
      typeLabel: string;
      typeColor: string;
    }
  | {
      kind: "borrow";
      id: string;
      label: string;
      fallbackLogoUrl: string;
      valueUsd: number;
      amount: number;
      aprPct?: number;
      typeLabel: string;
      typeColor: string;
    }
  | {
      kind: "earn";
      id: string;
      label: string;
      fallbackLogoUrl: string;
      underlyingLogoUrl?: string;
      valueUsd: number;
      amount: number;
      price?: number;
      aprPct?: number;
      typeLabel: string;
      typeColor: string;
      vaultAddress?: string;
      shares: { total: number; unstaked: number; staked: number };
      underlyingMint?: string;
      underlyingSymbol?: string;
    };

function extractKaminoBorrowRows(
  obligation: unknown
): Array<{ reserve: string; valueUsd: number; symbol?: string; logoUrl?: string; aprPct?: number }> {
  if (!obligation || typeof obligation !== "object") return [];
  const state = (obligation as { state?: unknown }).state as { borrows?: unknown } | undefined;
  const borrows = Array.isArray(state?.borrows) ? (state!.borrows as any[]) : [];
  return borrows
    .map((b) => {
      const reserve = String(b?.borrowReserve ?? "").trim();
      const v = typeof b?.marketValueUsd === "number" ? b.marketValueUsd : NaN;
      const symbol = typeof b?.tokenSymbol === "string" ? String(b.tokenSymbol).trim() : "";
      const logoUrl = typeof b?.tokenLogoUrl === "string" ? String(b.tokenLogoUrl).trim() : "";
      const aprPct = pickFirstNumber(b, ["borrowApyPct", "borrowAprPct", "aprPct", "apyPct", "apy"], 0);
      return {
        reserve,
        valueUsd: Number.isFinite(v) ? v : 0,
        symbol: symbol || undefined,
        logoUrl: logoUrl || undefined,
        aprPct: aprPct > 0 ? aprPct : undefined,
      };
    })
    .filter((x) => x.reserve && x.valueUsd > 0);
}

function normalizeKaminoPositionRows(row: KaminoPosition, idx: number): NormalizedKaminoRow[] {
  if (row.source === "kamino-farm") {
    const symbol = (row.tokenSymbol || "").trim() || shortKey(row.tokenMint);
    const fallbackLogoUrl = getPreferredJupiterTokenIcon(row.tokenSymbol, row.tokenLogoUrl) ?? "";
    const valueUsd = toNumber(row.netUsdAmount, 0);
    const amount = toNumber(row.netTokenAmount, 0);
    const price = amount > 0 ? valueUsd / amount : undefined;
    const vaultResolved =
      row.vaultAddress && isLikelySolanaAddress(row.vaultAddress) ? row.vaultAddress.trim() : undefined;
    if (vaultResolved) {
      const label =
        (row.vaultName && row.vaultName.trim()) ||
        (symbol ? `Kamino Farm (${symbol})` : `Kamino Farm (${shortKey(row.farmPubkey)})`);
      const mint = (row.tokenMint ?? "").trim() || undefined;
      return [{
        kind: "earn",
        id: `kamino-farm-${row.farmPubkey}-${idx}`,
        label,
        fallbackLogoUrl,
        valueUsd,
        amount,
        price,
        typeLabel: "Supply",
        typeColor: "bg-green-500/10 text-green-600 border-green-500/20",
        vaultAddress: vaultResolved,
        shares: { total: 0, unstaked: 0, staked: 0 },
        underlyingMint: mint,
        underlyingSymbol: symbol,
      }];
    }
    return [{
      kind: "farm",
      id: `kamino-farm-${row.farmPubkey}-${idx}`,
      label: `Kamino Farm (${symbol})`,
      fallbackLogoUrl,
      valueUsd,
      amount,
      price,
      typeLabel: "Supply",
      typeColor: "bg-green-500/10 text-green-600 border-green-500/20",
    }];
  }

  if (row.source === "kamino-lend") {
    const out: NormalizedKaminoRow[] = [];
    const borrowRowsForObligation = extractKaminoBorrowRows(row.obligation);
    const hasActiveBorrow = borrowRowsForObligation.length > 0;
    const state = (row.obligation as { state?: unknown } | undefined)?.state as
      | { deposits?: unknown }
      | undefined;
    const deposits = Array.isArray((state as any)?.deposits) ? ((state as any).deposits as any[]) : [];
    const depositRows = deposits
      .map((d) => {
        const v = typeof d?.marketValueUsd === "number" ? d.marketValueUsd : NaN;
        const sym = typeof d?.tokenSymbol === "string" ? String(d.tokenSymbol).trim() : "";
        const logo = typeof d?.tokenLogoUrl === "string" ? String(d.tokenLogoUrl).trim() : "";
        const reserve = String(d?.depositReserve ?? "").trim();
        const aprPct = pickFirstNumber(d, ["supplyApyPct", "depositApyPct", "depositApy", "aprPct", "apyPct", "apy"], 0);
        return {
          reserve,
          valueUsd: Number.isFinite(v) ? v : 0,
          symbol: sym || undefined,
          logoUrl: logo || undefined,
          aprPct: aprPct > 0 ? aprPct : undefined,
        };
      })
      .filter((x) => x.reserve && x.valueUsd > 0);

    if (depositRows.length > 0) {
      for (const d of depositRows) {
        const sym = (d.symbol || "").trim();
        const local = sym ? `/token_ico/${sym.toLowerCase()}.png` : "";
        const icon = local || d.logoUrl || "";
        out.push({
          kind: "lend",
          id: `kamino-deposit-${d.reserve}-${idx}`,
          label: sym || "Kamino Supply",
          fallbackLogoUrl: icon,
          valueUsd: d.valueUsd,
          amount: 0,
          aprPct: typeof d.aprPct === "number" && Number.isFinite(d.aprPct) && d.aprPct > 0 ? d.aprPct : undefined,
          isCollateral: hasActiveBorrow,
          typeLabel: "Supply",
          typeColor: "bg-green-500/10 text-green-600 border-green-500/20",
        });
      }
    } else {
      const valueUsd = pickFirstNumber(row.obligation, [
        "refreshedStats.userTotalDeposit",
        "obligationStats.userTotalDeposit",
        "userTotalDeposit",
        "depositedValueUsd",
        "totalDepositUsd",
      ]);
      out.push({
        kind: "lend",
        id: `kamino-lend-${row.marketPubkey}-${idx}`,
        label: row.marketName || `Kamino Lend (${shortKey(row.marketPubkey)})`,
        fallbackLogoUrl: "",
        valueUsd,
        amount: 0,
        isCollateral: hasActiveBorrow,
        typeLabel: "Supply",
        typeColor: "bg-green-500/10 text-green-600 border-green-500/20",
      });
    }

    for (const b of borrowRowsForObligation) {
      const sym = (b.symbol || "").trim();
      const local = sym ? `/token_ico/${sym.toLowerCase()}.png` : "";
      const icon = local || b.logoUrl || "";
      out.push({
        kind: "borrow",
        id: `kamino-borrow-${b.reserve}-${idx}`,
        label: sym || "Kamino Borrow",
        fallbackLogoUrl: icon,
        // Negative so totals become (supply - borrow) without special casing.
        valueUsd: -Math.abs(b.valueUsd),
        amount: 0,
        aprPct: typeof b.aprPct === "number" && Number.isFinite(b.aprPct) && b.aprPct > 0 ? b.aprPct : undefined,
        typeLabel: "Borrow",
        typeColor: "bg-pink-500/10 text-pink-600 border-pink-500/20",
      });
    }

    return out;
  }

  const valueUsd = pickFirstNumber(row.position, [
    "totalUsdValue",
    "totalValueUsd",
    "positionUsdValue",
    "usdValue",
    "valueUsd",
  ]);
  const label = String(
    getDeep(row.position, "name") ??
      getDeep(row.position, "vaultName") ??
      getDeep(row.position, "symbol") ??
      "Kamino Earn"
  );
  const mergedForVault =
    row.position && typeof row.position === "object"
      ? { ...(row as Record<string, unknown>), ...(row.position as Record<string, unknown>) }
      : (row as Record<string, unknown>);
  const vaultAddress =
    extractKvaultVaultAddress(row.position) ?? extractKvaultVaultAddress(mergedForVault);
  const shares = parseEarnShares(row.position);
  const { mint: uMint, symbol: uSym } = extractUnderlyingMintSymbol(row.position);
  const earnIcon = uSym ? `/token_ico/${uSym.toLowerCase()}.png` : "";
  const tokenLogoUrl = String(getDeep(row.position, "tokenLogoUrl") ?? "").trim();
  const fallbackLogoUrl = earnIcon || "";
  const underlyingLogoUrl = tokenLogoUrl || getPreferredJupiterTokenIcon(uSym, tokenLogoUrl) || "";
  const amount = toNumber(getDeep(row.position, "underlyingTokenAmount"), 0);
  const price = pickFirstNumber(row.position, ["underlyingTokenPriceUsd", "tokenPriceUsd", "priceUsd"], 0);
  const aprPct = pickFirstNumber(row.position, ["aprPct", "depositApy", "apyPct", "apy"], 0);
  return [{
    kind: "earn",
    id: vaultAddress ? `kamino-earn-${vaultAddress}` : `kamino-earn-${idx}`,
    label,
    fallbackLogoUrl,
    underlyingLogoUrl,
    valueUsd,
    amount: amount > 0 ? amount : 0,
    price: price > 0 ? price : undefined,
    aprPct: aprPct > 0 ? aprPct : undefined,
    typeLabel: "Supply",
    typeColor: "bg-green-500/10 text-green-600 border-green-500/20",
    vaultAddress,
    shares,
    underlyingMint: uMint,
    underlyingSymbol: uSym,
  }];
}

export function KaminoPositions() {
  const {
    address: solanaAddress,
    protocolsAddress: solanaProtocolsAddress,
    tokens: solanaTokens,
    refresh: refreshSolana,
  } = useSolanaPortfolio();
  const { toast } = useToast();
  const { publicKey, signTransaction, wallet: solanaWallet, connecting: solanaConnecting } = useSolanaWallet();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  const [positions, setPositions] = useState<KaminoPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rewards, setRewards] = useState<
    Array<{ tokenMint: string; tokenSymbol?: string; tokenLogoUrl?: string; amount: string; usdValue?: number }>
  >([]);
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const lastFingerprintRef = useRef<string>("0:");
  const refreshTimeoutRef = useRef<number | null>(null);

  // IMPORTANT: signer address must match the wallet adapter used to sign.
  // Prefer adapter publicKey/signTransaction because some wallets can leave hook values stale.
  const adapterPublicKey = (solanaWallet?.adapter?.publicKey as PublicKey | null) ?? null;
  const adapterAddress = toBase58Address(adapterPublicKey);
  const hookAddress = toBase58Address(publicKey);
  const injectedSolanaAddress = useNativeWalletStore((s) => s.solanaAddress);
  const trimmedInjectedSolanaAddress = (injectedSolanaAddress ?? "").trim();
  const effectiveSignerAddress = adapterAddress || hookAddress || trimmedInjectedSolanaAddress || "";

  const adapterSignTransaction =
    typeof (solanaWallet?.adapter as { signTransaction?: unknown } | undefined)?.signTransaction === "function"
      ? ((solanaWallet?.adapter as {
          signTransaction: (t: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>;
        }).signTransaction.bind(solanaWallet?.adapter) as (t: VersionedTransaction) => Promise<VersionedTransaction>)
      : undefined;
  const activeSignTransaction = adapterSignTransaction ?? signTransaction;
  // In the WebView native flow we don't need a wallet adapter signer:
  // signing+submitting is handled via the native bridge.
  const canUseNativeSubmit = useMemo(
    () => isYieldAiNativeAppNow() && !!trimmedInjectedSolanaAddress,
    [trimmedInjectedSolanaAddress],
  );
  const canSubmitTx = !!activeSignTransaction || canUseNativeSubmit;
  const positionsOwnerAddress = useMemo(
    () => resolveKaminoViewerAddress(searchParams, solanaProtocolsAddress),
    [searchParams, solanaProtocolsAddress]
  );

  const kaminoPositionsQuery = useKaminoPositions(positionsOwnerAddress, { refetchOnMount: "always" });
  const kaminoRewardsQuery = useKaminoRewards(positionsOwnerAddress, { refetchOnMount: "always" });

  const [earnModal, setEarnModal] = useState<"deposit" | "withdraw" | null>(null);
  const [earnTarget, setEarnTarget] = useState<Extract<NormalizedKaminoRow, { kind: "earn" }> | null>(null);
  const [earnAmount, setEarnAmount] = useState("");
  const [earnSubmitting, setEarnSubmitting] = useState(false);
  const [showClaimModal, setShowClaimModal] = useState(false);

  useEffect(() => {
    if (!positionsOwnerAddress) {
      setPositions([]);
      lastFingerprintRef.current = "0:";
      return;
    }
    const rows = Array.isArray(kaminoPositionsQuery.data) ? (kaminoPositionsQuery.data as KaminoPosition[]) : [];
    const filtered = rows.filter((r) => r.source !== "kamino-farm");
    setPositions(filtered);
    lastFingerprintRef.current = fingerprintRows(filtered);
  }, [positionsOwnerAddress, kaminoPositionsQuery.data]);

  useEffect(() => {
    if (!positionsOwnerAddress) {
      setRewards([]);
      return;
    }
    const list = Array.isArray(kaminoRewardsQuery.data?.rewards) ? kaminoRewardsQuery.data.rewards : [];
    setRewards(list);
  }, [positionsOwnerAddress, kaminoRewardsQuery.data]);

  useEffect(() => {
    if (!positionsOwnerAddress) {
      setLoading(false);
      setRewardsLoading(false);
      setError(null);
      return;
    }
    if (refreshTimeoutRef.current != null) {
      setLoading(true);
      setRewardsLoading(true);
      setError(null);
      return;
    }
    setLoading(kaminoPositionsQuery.isFetching);
    setRewardsLoading(kaminoRewardsQuery.isFetching);
    setError(kaminoPositionsQuery.isError ? "Failed to load Kamino positions" : null);
  }, [
    positionsOwnerAddress,
    kaminoPositionsQuery.isFetching,
    kaminoPositionsQuery.isError,
    kaminoRewardsQuery.isFetching,
  ]);

  const schedulePositionsRefresh = useCallback(
    (delayMs: number) => {
      if (typeof window === "undefined") return;
      if (refreshTimeoutRef.current != null) {
        window.clearTimeout(refreshTimeoutRef.current);
      }
      // Immediately show "something is happening"
      setLoading(true);
      setError(null);
      refreshTimeoutRef.current = window.setTimeout(async () => {
        try {
          await refreshSolana();
          queryClient.invalidateQueries({
            queryKey: queryKeys.protocols.kamino.userPositions(positionsOwnerAddress),
          });
          queryClient.invalidateQueries({
            queryKey: queryKeys.protocols.kamino.rewards(positionsOwnerAddress),
          });
          window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "kamino" } }));
        } finally {
          refreshTimeoutRef.current = null;
        }
      }, delayMs);
    },
    [positionsOwnerAddress, queryClient, refreshSolana]
  );

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current != null) {
        window.clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleRefresh: EventListener = (evt) => {
      const event = evt as CustomEvent<{ protocol?: string; data?: KaminoPosition[] }>;
      if (event?.detail?.protocol === "kamino") {
        if (Array.isArray(event.detail.data)) {
          setPositions(event.detail.data);
          lastFingerprintRef.current = fingerprintRows(event.detail.data);
        } else {
          queryClient.invalidateQueries({
            queryKey: queryKeys.protocols.kamino.userPositions(positionsOwnerAddress),
          });
        }
        queryClient.invalidateQueries({
          queryKey: queryKeys.protocols.kamino.rewards(positionsOwnerAddress),
        });
      }
    };
    window.addEventListener("refreshPositions", handleRefresh);
    return () => window.removeEventListener("refreshPositions", handleRefresh);
  }, [positionsOwnerAddress, queryClient]);

  const normalized = useMemo(() => positions.flatMap(normalizeKaminoPositionRows), [positions]);

  // De-dupe kVault positions: the same vault can appear as:
  // - `kamino-earn` (has shares for withdraw)
  // - `kamino-farm` aggregated (has value/amount/price)
  // Merge them so the card and withdraw modal are both correct.
  const merged = useMemo(() => {
    const out: NormalizedKaminoRow[] = [];
    const byVault = new Map<string, Extract<NormalizedKaminoRow, { kind: "earn" }>>();

    const mergeEarn = (
      a: Extract<NormalizedKaminoRow, { kind: "earn" }>,
      b: Extract<NormalizedKaminoRow, { kind: "earn" }>
    ): Extract<NormalizedKaminoRow, { kind: "earn" }> => {
      const pickLabel = (x: string, y: string) => {
        const nx = (x || "").trim();
        const ny = (y || "").trim();
        if (!nx) return ny;
        if (!ny) return nx;
        // Prefer non-generic, non "Kamino Farm" label when possible.
        const xScore = nx.toLowerCase().includes("kamino earn") ? 0 : nx.toLowerCase().includes("kamino farm") ? 1 : 2;
        const yScore = ny.toLowerCase().includes("kamino earn") ? 0 : ny.toLowerCase().includes("kamino farm") ? 1 : 2;
        if (xScore !== yScore) return xScore > yScore ? nx : ny;
        return nx.length >= ny.length ? nx : ny;
      };

      return {
        kind: "earn",
        id: a.vaultAddress ? `kamino-earn-${a.vaultAddress}` : a.id,
        label: pickLabel(a.label, b.label),
        fallbackLogoUrl: a.fallbackLogoUrl || b.fallbackLogoUrl,
        valueUsd: Math.max(a.valueUsd || 0, b.valueUsd || 0),
        amount: Math.max(a.amount || 0, b.amount || 0),
        price: (a.price ?? 0) > 0 ? a.price : b.price,
        typeLabel: a.typeLabel,
        typeColor: a.typeColor,
        vaultAddress: a.vaultAddress || b.vaultAddress,
        shares: {
          total: Math.max(a.shares?.total || 0, b.shares?.total || 0),
          unstaked: Math.max(a.shares?.unstaked || 0, b.shares?.unstaked || 0),
          staked: Math.max(a.shares?.staked || 0, b.shares?.staked || 0),
        },
        underlyingMint: a.underlyingMint || b.underlyingMint,
        underlyingSymbol: a.underlyingSymbol || b.underlyingSymbol,
        aprPct:
          (a.aprPct ?? 0) > 0 || (b.aprPct ?? 0) > 0
            ? Math.max(a.aprPct ?? 0, b.aprPct ?? 0)
            : undefined,
      };
    };

    for (const row of normalized) {
      if (row.kind !== "earn" || !row.vaultAddress) {
        out.push(row);
        continue;
      }
      const key = row.vaultAddress.trim();
      const prev = byVault.get(key);
      if (!prev) {
        byVault.set(key, row);
      } else {
        byVault.set(key, mergeEarn(prev, row));
      }
    }

    out.push(...byVault.values());
    return out;
  }, [normalized]);

  const sorted = useMemo(() => [...merged].sort((a, b) => b.valueUsd - a.valueUsd), [merged]);
  const totalValue = useMemo(() => sorted.reduce((sum, p) => sum + p.valueUsd, 0), [sorted]);
  const totalRewardsUsd = useMemo(() => computeKaminoRewardsUsd(rewards), [rewards]);
  const showRewards = useMemo(() => hasVisibleKaminoRewards(rewards), [rewards]);
  const visibleRewards = useMemo(() => filterMeaningfulKaminoRewardRows(rewards), [rewards]);

  const claimTargets = useMemo((): KaminoClaimTarget[] => {
    const earnVaultAddresses = sorted
      .filter((r): r is Extract<NormalizedKaminoRow, { kind: "earn" }> => r.kind === "earn" && !!r.vaultAddress)
      .map((r) => r.vaultAddress!.trim())
      .filter(Boolean);

    return buildKaminoClaimTargets({
      apiTargets: kaminoRewardsQuery.data?.claimTargets ?? [],
      earnVaultAddresses,
      totalRewardsUsd,
    });
  }, [kaminoRewardsQuery.data?.claimTargets, sorted, totalRewardsUsd]);

  const openClaimModal = useCallback(() => {
    setShowClaimModal(true);
  }, []);

  const calculateHealthFactor = useCallback(() => {
    const lend = positions.find((p) => p.source === "kamino-lend");
    const stats = lend?.obligation as any;
    const liqLimit = Number(stats?.refreshedStats?.borrowLiquidationLimit);
    const borrow = Number(stats?.refreshedStats?.userTotalBorrow);
    const userDeposit = Number(stats?.refreshedStats?.userTotalDeposit);
    if (!Number.isFinite(liqLimit) || !Number.isFinite(borrow) || borrow <= 0) return null;
    const healthFactor = liqLimit / borrow;
    return {
      healthFactor,
      accountMargin: Number.isFinite(userDeposit) ? userDeposit : 0,
      totalLiabilities: borrow,
      isLiquidatable: healthFactor < 1,
    };
  }, [positions]);

  const openEarnDeposit = useCallback((row: Extract<NormalizedKaminoRow, { kind: "earn" }>) => {
    void refreshSolana();
    setEarnTarget(row);
    setEarnModal("deposit");
  }, [refreshSolana]);

  const openEarnWithdraw = useCallback((row: Extract<NormalizedKaminoRow, { kind: "earn" }>) => {
    void refreshSolana();
    setEarnTarget(row);
    setEarnModal("withdraw");
  }, [refreshSolana]);

  const closeEarnModal = useCallback(() => {
    setEarnModal(null);
    setEarnTarget(null);
    setEarnSubmitting(false);
  }, []);

  const kaminoDepositModalToken = useMemo(() => {
    if (!earnTarget || earnTarget.kind !== "earn") return null;
    const sym = earnTarget.underlyingSymbol || "Token";
    const available = walletUiAmountForMint(solanaTokens, earnTarget.underlyingMint);
    return {
      symbol: sym,
      logoUrl:
        (getPreferredJupiterTokenIcon(sym, earnTarget.fallbackLogoUrl || undefined) ??
          earnTarget.fallbackLogoUrl) ||
        undefined,
      availableAmount: available,
      apy: earnTarget.aprPct ?? 0,
      priceUsd: earnTarget.price ?? 0,
    };
  }, [earnTarget, solanaTokens]);

  const kaminoWithdrawModalToken = useMemo(() => {
    if (!earnTarget || earnTarget.kind !== "earn") return null;
    const sym = earnTarget.underlyingSymbol || "Token";
    // Underlying token price (USD per 1 token); SDK withdraw uses token UI amount, not vault shares.
    const priceUsd =
      earnTarget.price && earnTarget.price > 0
        ? earnTarget.price
        : earnTarget.amount > 0 && earnTarget.valueUsd > 0
          ? earnTarget.valueUsd / earnTarget.amount
          : 0;
    const suppliedAmount =
      earnTarget.amount > 0
        ? earnTarget.amount
        : priceUsd > 0 && earnTarget.valueUsd > 0
          ? earnTarget.valueUsd / priceUsd
          : 0;
    return {
      symbol: sym,
      logoUrl:
        (getPreferredJupiterTokenIcon(sym, earnTarget.fallbackLogoUrl || undefined) ??
          earnTarget.fallbackLogoUrl) ||
        undefined,
      suppliedAmount,
      ...(priceUsd > 0 ? { priceUsd } : {}),
    };
  }, [earnTarget]);

  const runEarnTransaction = useCallback(
    async (mode: "deposit" | "withdraw", amountUi: number) => {
      if (!earnTarget?.vaultAddress || !effectiveSignerAddress) {
        toast({
          variant: "destructive",
          title: "Wallet required",
          description: "Connect a Solana wallet that matches your portfolio address.",
        });
        return;
      }
      const nativeFlowActive = isYieldAiNativeAppNow() && !!trimmedInjectedSolanaAddress;
      if (!activeSignTransaction && !nativeFlowActive) {
        toast({
          variant: "destructive",
          title: "Wallet cannot sign",
          description: solanaConnecting ? "Connecting wallet…" : "This wallet cannot sign transactions.",
        });
        return;
      }
      const connection = new Connection(getSolanaRpcEndpoint(), "confirmed");
      if (!Number.isFinite(amountUi) || amountUi <= 0) {
        toast({ variant: "destructive", title: "Invalid amount", description: "Enter a positive number." });
        return;
      }

      setEarnSubmitting(true);
      try {
        const txResp = await fetch("/api/protocols/kamino/earnTx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vaultAddress: earnTarget.vaultAddress,
            signer: effectiveSignerAddress,
            amountUi,
            mode,
          }),
        });
        const txData = await txResp.json().catch(() => null);
        if (!txResp.ok || !txData?.success || !txData?.data?.transaction) {
          throw new Error(txData?.error || `Transaction prepare failed: ${txResp.status}`);
        }

        let sig: string;
        if (nativeFlowActive) {
          sig = await signAndSubmitSolanaTransaction(String(txData.data.transaction));
        } else {
          const serialized = (() => {
            const decoded = atob(String(txData.data.transaction));
            return Uint8Array.from(decoded, (c) => c.charCodeAt(0));
          })();
          const txForWallet = (() => {
            try {
              return VersionedTransaction.deserialize(serialized);
            } catch {
              return Transaction.from(serialized);
            }
          })();

          const signed = await activeSignTransaction!(txForWallet as any);
          const sendResp = await fetch("/api/solana/sendRaw", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              txBase64: Buffer.from((signed as any).serialize()).toString("base64"),
            }),
          });
          const sendJson = await sendResp.json().catch(() => null);
          if (!sendResp.ok || !sendJson?.success || !sendJson?.data?.signature) {
            throw new Error(sendJson?.error || `Send failed: ${sendResp.status}`);
          }
          sig = String(sendJson.data.signature);
        }
        const symbol = String(
          (mode === "deposit" ? kaminoDepositModalToken?.symbol : kaminoWithdrawModalToken?.symbol) || ""
        ).trim() || "Token";
        toast({
          title: mode === "deposit" ? "Deposit submitted" : "Withdraw submitted",
          description:
            mode === "deposit"
              ? `Deposited ${amountUi} ${symbol}.`
              : `Withdrew ${amountUi} ${symbol}.`,
          action: (
            <ToastAction
              altText="View on Solscan"
              onClick={() => window.open(`https://solscan.io/tx/${sig}`, "_blank")}
            >
              View on Solscan
            </ToastAction>
          ),
        });

        closeEarnModal();
        // Refresh UI immediately (show loading), then refetch after Kamino API catches up.
        schedulePositionsRefresh(10000);
      } catch (e) {
        toast({
          variant: "destructive",
          title: mode === "deposit" ? "Deposit failed" : "Withdraw failed",
          description: getErrorMessage(e),
        });
      } finally {
        setEarnSubmitting(false);
      }
    },
    [
      earnTarget,
      effectiveSignerAddress,
      activeSignTransaction,
      toast,
      closeEarnModal,
      refreshSolana,
      solanaConnecting,
      schedulePositionsRefresh,
      trimmedInjectedSolanaAddress,
      kaminoDepositModalToken?.symbol,
      kaminoWithdrawModalToken?.symbol,
    ]
  );

  type KaminoLendingRow = LendingProtocolCardRow & {
    _kind: NormalizedKaminoRow["kind"];
    _row: NormalizedKaminoRow;
  };

  const { tiles, sections } = useMemo(() => {
    const supplyRows: KaminoLendingRow[] = [];
    const borrowRows: KaminoLendingRow[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const row = sorted[i]!;
      const isBorrow = row.kind === "borrow";
      const positionType: "supply" | "borrow" = isBorrow ? "borrow" : "supply";
      const valueUsd = isBorrow ? Math.abs(row.valueUsd) : row.valueUsd;
      const logoUrl =
        row.kind === "earn"
          ? (getPreferredJupiterTokenIcon(row.underlyingSymbol, row.fallbackLogoUrl || undefined) ??
              row.fallbackLogoUrl ??
              "") ||
            undefined
          : (row.fallbackLogoUrl || undefined);

      const base: KaminoLendingRow = {
        id: row.id || `kamino-${row.kind}-${i}`,
        symbol: row.kind === "earn" ? (row.underlyingSymbol || row.label) : row.label,
        tokenLogoUrl: logoUrl,
        value: formatCurrency(valueUsd, 2),
        amountLabel: row.amount > 0 ? formatNumber(row.amount, 6) : undefined,
        priceLabel: "price" in row && typeof row.price === "number" && Number.isFinite(row.price) ? formatCurrency(row.price, 4) : undefined,
        aprLabel:
          "aprPct" in row && typeof row.aprPct === "number" && Number.isFinite(row.aprPct)
            ? `${formatNumber(row.aprPct, 2)}%`
            : undefined,
        isCollateral: row.kind === "lend" && Boolean(row.isCollateral),
        positionType,
        _kind: row.kind,
        _row: row,
      };

      if (positionType === "borrow") borrowRows.push(base);
      else supplyRows.push(base);
    }

    const health = calculateHealthFactor();

    const tilesLocal: LendingProtocolCardTile[] = [
      {
        id: "total-assets",
        title: "Total Assets",
        titleShort: "Assets",
        icon: "wallet",
        value: formatCurrency(totalValue, 2),
      },
      ...(showRewards
        ? [
            {
              id: "rewards" as const,
              title: "Rewards",
              icon: "gift" as const,
              value: formatKaminoRewardUsd(totalRewardsUsd),
              action: { label: "Claim", onClick: openClaimModal, disabled: false },
            },
          ]
        : []),
      ...(health && Number.isFinite(health.healthFactor)
        ? [
            {
              id: "health",
              title: "Health Factor",
              titleShort: "Health",
              icon: "health" as const,
              tone:
                health.healthFactor >= 1.5
                  ? ("success" as const)
                  : health.healthFactor >= 1.2
                    ? ("warning" as const)
                    : ("danger" as const),
              value: health.healthFactor.toFixed(2),
              subRows: [
                {
                  label: "Collateral:",
                  labelShort: "Coll.",
                  value: formatCurrency(health.accountMargin, 2),
                },
                {
                  label: "Liabilities:",
                  labelShort: "Debt",
                  value: formatCurrency(health.totalLiabilities, 2),
                },
              ],
            },
          ]
        : []),
    ];

    const sectionsLocal: Array<LendingProtocolCardSection<KaminoLendingRow>> = [
      {
        id: "supply",
        title: `Your Supplies (${supplyRows.length})`,
        titleShort: `Supplies (${supplyRows.length})`,
        rows: supplyRows,
        defaultOpen: true,
      },
      ...(borrowRows.length > 0
        ? [
            {
              id: "borrow" as const,
              title: `Your Borrows (${borrowRows.length})`,
              titleShort: `Borrows (${borrowRows.length})`,
              rows: borrowRows,
              defaultOpen: true,
            },
          ]
        : []),
    ];

    return { tiles: tilesLocal, sections: sectionsLocal };
  }, [sorted, totalValue, totalRewardsUsd, showRewards, openClaimModal, calculateHealthFactor]);

  // Don't block the page while refreshing; only show a full-page loader on the initial empty load.
  // IMPORTANT: all hooks must be called before these early returns.
  if (sorted.length === 0 && loading) {
    return <div className="py-4 text-muted-foreground">Loading positions...</div>;
  }
  if (error) {
    return <div className="py-4 text-red-500">{error}</div>;
  }
  if (sorted.length === 0 && !loading) {
    return <div className="py-4 text-muted-foreground">No positions on Kamino.</div>;
  }

  const depositSymbol = kaminoDepositModalToken?.symbol ?? "Token";

  return (
    <div className="w-full min-w-0 max-w-full space-y-4 text-base">
      {loading && sorted.length > 0 ? (
        <div className="text-muted-foreground text-sm">Refreshing Kamino positions…</div>
      ) : null}
      {kaminoDepositModalToken ? (
        <JupiterDepositModal
          isOpen={earnModal === "deposit"}
          onClose={closeEarnModal}
          onConfirm={(amountUi) => void runEarnTransaction("deposit", amountUi)}
          isLoading={earnSubmitting}
          title="Deposit to Kamino"
          description={`Enter amount to deposit ${depositSymbol}`}
          protocol={{ name: "Kamino", logoUrl: "/protocol_ico/kamino.png" }}
          token={kaminoDepositModalToken}
        />
      ) : null}

      {kaminoWithdrawModalToken ? (
        <JupiterWithdrawModal
          isOpen={earnModal === "withdraw"}
          onClose={closeEarnModal}
          onConfirm={(amountUi) => void runEarnTransaction("withdraw", amountUi)}
          isLoading={earnSubmitting}
          protocol={{ name: "Kamino", logoUrl: "/protocol_ico/kamino.png" }}
          token={kaminoWithdrawModalToken}
        />
      ) : null}

      <LendingProtocolCard<KaminoLendingRow>
        headerVariant="minimal"
        tiles={tiles}
        sections={sections}
        onDeposit={(row) => {
          if (row.isCollateral) {
            window.open(KAMINO_LEND_URL, "_blank");
            return;
          }
          if (row._kind === "earn" && row._row.kind === "earn" && row._row.vaultAddress) {
            openEarnDeposit(row._row);
            return;
          }
          window.open(KAMINO_LEND_URL, "_blank");
        }}
        onWithdraw={(row) => {
          if (row.isCollateral) {
            window.open(KAMINO_LEND_URL, "_blank");
            return;
          }
          if (row._kind === "earn" && row._row.kind === "earn" && row._row.vaultAddress) {
            openEarnWithdraw(row._row);
            return;
          }
          window.open(KAMINO_LEND_URL, "_blank");
        }}
        withdrawDisabled={earnSubmitting}
      />

      <div className="pt-4">
        {rewardsLoading && rewards.length === 0 ? (
          <div className="text-muted-foreground text-right">Loading rewards...</div>
        ) : showRewards ? (
          <div className="text-right">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex w-fit text-gray-500 cursor-help">
                    🎁 Rewards: {formatKaminoRewardUsd(totalRewardsUsd)}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <div className="space-y-1 text-xs max-h-48 overflow-auto">
                    {visibleRewards.map((r) => {
                      const sym = (r.tokenSymbol || "").trim();
                      const local = sym ? `/token_ico/${sym.toLowerCase()}.png` : "";
                      const icon = local || (r.tokenLogoUrl || "").trim();
                      const amountNum = Number(r.amount);
                      return (
                        <div key={r.tokenMint} className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            {icon ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={icon} alt={sym} className="w-4 h-4 rounded-full object-contain" />
                            ) : (
                              <div className="w-4 h-4 rounded-full bg-slate-500/20" />
                            )}
                            <span>{sym || `${r.tokenMint.slice(0, 4)}...${r.tokenMint.slice(-4)}`}</span>
                          </div>
                          <span className="font-semibold">
                            {Number.isFinite(amountNum) ? formatNumber(amountNum, 6) : r.amount}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        ) : null}
      </div>

      <KaminoClaimRewardsModal
        isOpen={showClaimModal}
        onClose={() => setShowClaimModal(false)}
        rewards={rewards}
        claimTargets={claimTargets}
        signerAddress={effectiveSignerAddress || positionsOwnerAddress}
        onClaimComplete={() => schedulePositionsRefresh(2500)}
      />

      <div className="flex items-center justify-between pt-6 pb-6">
        <span className="text-xl">Total assets in Kamino:</span>
        <span className="text-xl text-primary font-bold">{formatCurrency(totalValue, 2)}</span>
      </div>
    </div>
  );
}
