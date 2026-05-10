"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import { ProtocolCard } from "@/shared/ProtocolCard";
import { ProtocolCardPosition } from "@/shared/ProtocolCard/ProtocolCardPosition/ProtocolCardPosition";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { useJupiterPositions } from "@/lib/query/hooks/protocols/jupiter/useJupiterPositions";
import { computeJupiterTotalValue, mapJupiterToProtocolPositions } from "@/components/protocols/jupiter/mapJupiterToProtocolPositions";
import { isLikelySolanaAddress } from "@/lib/kamino/kvaultVaultAddress";
import { useJupiterBorrow } from "@/lib/query/hooks/protocols/jupiter/useJupiterBorrow";
import { PositionBadge, type ProtocolPosition } from "@/shared/ProtocolCard/types";
import { formatNumber } from "@/lib/utils/numberFormat";
import { Loader2 } from "lucide-react";

interface PositionsListProps {
  address?: string;
  onPositionsValueChange?: (value: number) => void;
  showManageButton?: boolean;
  onPositionsCheckComplete?: () => void;
}

export function PositionsList({
  address,
  onPositionsValueChange,
  showManageButton = true,
  onPositionsCheckComplete,
}: PositionsListProps) {
  const protocol = getProtocolByName("Jupiter");
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const onValueRef = useRef(onPositionsValueChange);
  onValueRef.current = onPositionsValueChange;
  const onCheckCompleteRef = useRef(onPositionsCheckComplete);
  onCheckCompleteRef.current = onPositionsCheckComplete;
  const hasCompletedCheckRef = useRef<string | null>(null);

  const mockEnabled =
    process.env.NEXT_PUBLIC_KAMINO_REWARDS_MOCK === "1" ||
    process.env.NEXT_PUBLIC_KAMINO_REWARDS_MOCK === "true";

  const effectiveAddress = useMemo(() => {
    const base = (address ?? "").trim();
    if (!mockEnabled) return base;
    const raw = (
      searchParams?.get("jupiterAddress") ||
      searchParams?.get("address") ||
      searchParams?.get("solanaAddress") ||
      ""
    ).trim();
    if (raw && isLikelySolanaAddress(raw)) return raw;
    return base;
  }, [address, mockEnabled, searchParams]);

  const { data: positions = [], isLoading, isError, isFetched, isFetching } =
    useJupiterPositions(effectiveAddress);
  const {
    data: borrowPositions = [],
    isLoading: isBorrowLoading,
    isError: isBorrowError,
    isFetched: isBorrowFetched,
    isFetching: isBorrowFetching,
  } = useJupiterBorrow(effectiveAddress, { enabled: Boolean(effectiveAddress) });

  const supplyTotalValue = useMemo(() => computeJupiterTotalValue(positions), [positions]);
  const protocolPositions = useMemo(() => {
    const mapped = mapJupiterToProtocolPositions(positions);
    return [...mapped].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  }, [positions]);

  const borrowPairs = useMemo((): Array<{ sortKey: number; rows: ProtocolPosition[] }> => {
    const list = Array.isArray(borrowPositions) ? borrowPositions : [];
    const out: Array<{ sortKey: number; rows: ProtocolPosition[] }> = [];
    for (const p of list) {
      const supplyUsd = typeof p.supplyUsd === "number" && Number.isFinite(p.supplyUsd) ? p.supplyUsd : 0;
      const borrowUsd = typeof p.borrowUsd === "number" && Number.isFinite(p.borrowUsd) ? p.borrowUsd : 0;
      // Show only positions that actually have a borrow.
      if (!(borrowUsd > 0)) continue;
      const supplySymbol = p.supplyToken?.symbol || "Supply";
      const borrowSymbol = p.borrowToken?.symbol || "Borrow";
      const idBase = `${p.vaultId ?? "v"}:${p.nftId ?? "n"}`;
      const supplyAprPct = typeof p.supplyAprPct === "number" && Number.isFinite(p.supplyAprPct) ? p.supplyAprPct : 0;
      const borrowAprPct = typeof p.borrowAprPct === "number" && Number.isFinite(p.borrowAprPct) ? p.borrowAprPct : 0;
      const supplyPrice = typeof p.supplyToken?.priceUsd === "number" && Number.isFinite(p.supplyToken.priceUsd) ? p.supplyToken.priceUsd : undefined;
      const borrowPrice = typeof p.borrowToken?.priceUsd === "number" && Number.isFinite(p.borrowToken.priceUsd) ? p.borrowToken.priceUsd : undefined;
      const supplyAmount = Number(p.supplyAmount);
      const borrowAmount = Number(p.borrowAmount);
      const supplyRow: ProtocolPosition = {
        id: `jup-borrow-supply-${idBase}`,
        label: supplySymbol,
        value: supplyUsd,
        logoUrl: p.supplyToken?.logoUrl,
        badge: PositionBadge.Supply,
        apr: supplyAprPct.toFixed(2),
        price: supplyPrice,
        subLabel: Number.isFinite(supplyAmount) && supplyAmount > 0 ? formatNumber(supplyAmount, 4) : undefined,
      };
      const borrowRow: ProtocolPosition = {
        id: `jup-borrow-debt-${idBase}`,
        label: borrowSymbol,
        value: borrowUsd,
        logoUrl: p.borrowToken?.logoUrl,
        badge: PositionBadge.Borrow,
        apr: borrowAprPct.toFixed(2),
        price: borrowPrice,
        subLabel: Number.isFinite(borrowAmount) && borrowAmount > 0 ? formatNumber(borrowAmount, 4) : undefined,
      };
      out.push({ sortKey: supplyUsd, rows: [supplyRow, borrowRow] });
    }
    return out;
  }, [borrowPositions]);

  const totalValue = useMemo(() => {
    // Sidebar header should match Manage Positions: include net value of borrow positions (collateral - debt).
    const list = Array.isArray(borrowPositions) ? borrowPositions : [];
    const borrowNet = list.reduce((sum, p) => {
      const supplyUsd = typeof p.supplyUsd === "number" && Number.isFinite(p.supplyUsd) ? p.supplyUsd : 0;
      const borrowUsd = typeof p.borrowUsd === "number" && Number.isFinite(p.borrowUsd) ? p.borrowUsd : 0;
      // Only count positions that actually have a borrow.
      if (!(borrowUsd > 0)) return sum;
      return sum + (supplyUsd - borrowUsd);
    }, 0);
    return supplyTotalValue + borrowNet;
  }, [borrowPositions, supplyTotalValue]);

  const combinedPositions = useMemo(() => {
    // Sort by the Supply leg, but keep Borrow immediately after Supply.
    type Block = { sortKey: number; rows: ProtocolPosition[] };
    const blocks: Block[] = [];
    for (const pair of borrowPairs) blocks.push(pair);
    for (const pos of protocolPositions) blocks.push({ sortKey: pos.value ?? 0, rows: [pos] });
    blocks.sort((a, b) => (b.sortKey ?? 0) - (a.sortKey ?? 0));
    return blocks.flatMap((b) => b.rows);
  }, [borrowPairs, protocolPositions]);
  const cacheKey = useMemo(() => `proto_has_positions:jupiter`, []);
  const [lastKnownHasPositions, setLastKnownHasPositions] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setLastKnownHasPositions(window.localStorage.getItem(cacheKey) === "1");
    } catch {
      // ignore
    }
  }, [cacheKey]);

  useEffect(() => {
    // IMPORTANT (Sidebar Total Assets):
    // `effectiveAddress` can temporarily become empty while the Solana adapter is
    // connecting/disconnecting or when `protocolsAddress` is gated. In that transient
    // state we must NOT push `0` upwards, otherwise Sidebar "Total Assets" flickers
    // and looks like Solana Wallet overwrote protocol totals.
    if (!effectiveAddress) return;
    onValueRef.current?.(totalValue);
  }, [effectiveAddress, totalValue]);

  useEffect(() => {
    if (!effectiveAddress) return;
    const handleRefresh: EventListener = (evt) => {
      const event = evt as CustomEvent<{ protocol?: string }>;
      if (event?.detail?.protocol !== "jupiter") return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.jupiter.userPositions(effectiveAddress),
      });
    };
    window.addEventListener("refreshPositions", handleRefresh);
    return () => window.removeEventListener("refreshPositions", handleRefresh);
  }, [effectiveAddress, queryClient]);

  useEffect(() => {
    if (!effectiveAddress) {
      onCheckCompleteRef.current?.();
      return;
    }
    // Mark protocol check completion as soon as we have *any* fetched data for this address.
    // Background refetching should not keep the sidebar "checking" spinner running.
    if (!isFetched) return;
    if (hasCompletedCheckRef.current === effectiveAddress) return;
    hasCompletedCheckRef.current = effectiveAddress;
    onCheckCompleteRef.current?.();
  }, [effectiveAddress, isFetched]);

  useEffect(() => {
    if (!effectiveAddress) return;
    if (!isFetched || isFetching) return;
    // Remember if this protocol had ANY positions (supply or borrow) to avoid flicker.
    const hasPositions = positions.length > 0 || borrowPairs.length > 0;
    setLastKnownHasPositions(hasPositions);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(cacheKey, hasPositions ? "1" : "0");
    } catch {
      // ignore
    }
  }, [cacheKey, effectiveAddress, isFetched, isFetching, positions.length, borrowPairs.length]);

  if (!protocol || !effectiveAddress) return null;
  const hasAnyData = protocolPositions.length > 0 || borrowPairs.length > 0;
  // Borrow can be loaded separately; treat it as data too.
  const effectiveLoading = isLoading || ((isFetching || isBorrowFetching) && !hasAnyData);
  // Sidebar UX: show skeleton only when this protocol previously had positions.
  if (effectiveLoading && !hasAnyData && !lastKnownHasPositions) return null;
  if (!effectiveLoading && (isError || !hasAnyData)) return null;

  const borrowExtraContent =
    borrowPairs.length === 0 && !isBorrowError && (isBorrowLoading || isBorrowFetching) ? (
      <div className="pt-2 border-t border-gray-200 flex items-center justify-center gap-2 text-muted-foreground">
        <span>Loading borrow positions...</span>
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    ) : null;

  return (
    <ProtocolCard
      protocol={protocol}
      totalValue={totalValue}
      positions={combinedPositions}
      isLoading={effectiveLoading}
      showManageButton={showManageButton}
      extraContent={borrowExtraContent}
    />
  );
}

