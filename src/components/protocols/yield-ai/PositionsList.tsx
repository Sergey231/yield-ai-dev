"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import { ProtocolCard } from "@/shared/ProtocolCard";
import { formatCurrency } from "@/lib/utils/numberFormat";
import { queryKeys } from "@/lib/query/queryKeys";
import { useYieldAiSafes } from "@/lib/query/hooks/protocols/yield-ai";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";
import { SafePositionsCard, type SafePositionsData } from "./SafePositionsCard";

const MIN_VISIBLE_USD = 0.0001;

interface PositionsListProps {
  address?: string;
  onPositionsValueChange?: (value: number) => void;
  refreshKey?: number;
  onPositionsCheckComplete?: () => void;
  showManageButton?: boolean;
}

export function PositionsList({
  address,
  onPositionsValueChange,
  refreshKey,
  onPositionsCheckComplete,
  showManageButton = true,
}: PositionsListProps) {
  const { account } = useWallet();
  const queryClient = useQueryClient();
  const walletAddress = address || account?.address?.toString();
  const onValueRef = useRef(onPositionsValueChange);
  const onCompleteRef = useRef(onPositionsCheckComplete);
  onValueRef.current = onPositionsValueChange;
  onCompleteRef.current = onPositionsCheckComplete;

  const { data: safeAddresses = [] } = useYieldAiSafes(walletAddress);

  const normalizedSafes = useMemo(
    () => Array.from(new Set(safeAddresses.map((s) => toCanonicalAddress(s)))),
    [safeAddresses]
  );

  const [dataBySafe, setDataBySafe] = useState<Record<string, SafePositionsData>>({});

  // Drop entries for safes that disappeared from the list. Important: only
  // produce a NEW state ref when something actually changed — otherwise this
  // gratuitously triggers downstream useEffects (`aggregated`, completion
  // signal) and can cascade through the Sidebar.
  useEffect(() => {
    setDataBySafe((prev) => {
      const prevKeys = Object.keys(prev);
      const nextSet = new Set(normalizedSafes);
      const stillFits =
        prevKeys.length === normalizedSafes.length &&
        prevKeys.every((k) => nextSet.has(k));
      if (stillFits) return prev;
      const next: Record<string, SafePositionsData> = {};
      for (const s of normalizedSafes) {
        if (prev[s]) next[s] = prev[s];
      }
      return next;
    });
  }, [normalizedSafes]);

  // Aggregated values across all safes.
  const aggregated = useMemo(() => {
    const allPositions = normalizedSafes.flatMap((s) => dataBySafe[s]?.positions ?? []);
    const sortedPositions = allPositions
      .filter((p) => Number.isFinite(p.value) && p.value >= MIN_VISIBLE_USD)
      .sort((a, b) => b.value - a.value);
    const totalValue = normalizedSafes.reduce((sum, s) => sum + (dataBySafe[s]?.totalValue ?? 0), 0);
    const totalRewardsUsdNum = normalizedSafes.reduce(
      (sum, s) => sum + (dataBySafe[s]?.rewardsUsd ?? 0),
      0
    );
    // Treat a safe with no row yet as still loading/fetching so multi-safe
    // wallets do not briefly see an empty "settled" aggregate before children mount.
    const isLoading = normalizedSafes.some((s) => {
      const row = dataBySafe[s];
      return row == null || row.isLoading;
    });
    const isFetching = normalizedSafes.some((s) => {
      const row = dataBySafe[s];
      return row == null || row.isFetching;
    });
    const hasAnyActivity = normalizedSafes.some((s) => dataBySafe[s]?.hasAnyActivity);
    const hasError = normalizedSafes.some((s) => dataBySafe[s]?.hasError);
    return {
      positions: sortedPositions,
      totalValue,
      totalRewardsUsdNum,
      isLoading,
      isFetching,
      hasAnyActivity,
      hasError,
    };
  }, [normalizedSafes, dataBySafe]);

  // Bubble up the aggregated total value to Sidebar.
  useEffect(() => {
    onValueRef.current?.(aggregated.totalValue);
  }, [aggregated.totalValue]);

  // Fire onPositionsCheckComplete whenever we are in a "settled" state.
  // Sidebar's removal handler is idempotent (returns the same array reference
  // when the protocol name is already absent), so re-firing is a no-op render-
  // wise. We must re-fire on every settled render because the parent can put
  // the protocol back into the spinner list mid-life (e.g. when
  // `shouldCheckAptosProtocols` flips from false→true after `aptosHasTxQuery`
  // resolves for a derived Aptos wallet — Sidebar then re-seeds
  // `checkingAptosProtocols` with all names, and without re-firing we'd be
  // stuck until the 30s safety valve).
  useEffect(() => {
    if (normalizedSafes.length === 0) {
      onCompleteRef.current?.();
      return;
    }
    const allChildrenSettled = normalizedSafes.every((s) => {
      const row = dataBySafe[s];
      return row != null && !row.isFetching;
    });
    if (allChildrenSettled) {
      onCompleteRef.current?.();
    }
  }, [normalizedSafes, dataBySafe]);

  // refreshKey: invalidate the safes-list query so safes are reloaded.
  useEffect(() => {
    if (refreshKey != null && walletAddress) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.yieldAi.safes(walletAddress),
      });
    }
  }, [refreshKey, walletAddress, queryClient]);

  const handleSafeData = useMemo(
    () => (data: SafePositionsData) => {
      setDataBySafe((prev) => {
        const existing = prev[data.safeAddress];
        // Cheap stable equality check to avoid render/update loops.
        if (
          existing &&
          existing.positionsSignature === data.positionsSignature &&
          existing.totalValue === data.totalValue &&
          existing.rewardsUsd === data.rewardsUsd &&
          existing.isLoading === data.isLoading &&
          existing.isFetching === data.isFetching &&
          existing.hasError === data.hasError &&
          existing.hasAnyActivity === data.hasAnyActivity
        ) {
          return prev;
        }
        return { ...prev, [data.safeAddress]: data };
      });
    },
    []
  );

  const protocol = getProtocolByName("AI agent");
  if (!protocol) return null;
  if (!walletAddress) return null;
  if (normalizedSafes.length === 0) return null;
  if (aggregated.hasError) {
    // Still keep the data collectors mounted so a future refresh can recover.
    return (
      <>
        {normalizedSafes.map((safe) => (
          <SafePositionsCard
            key={safe}
            safeAddress={safe}
            refreshKey={refreshKey}
            onData={handleSafeData}
          />
        ))}
      </>
    );
  }

  // No activity across any safe — hide the card entirely.
  if (!aggregated.isLoading && !aggregated.hasAnyActivity) {
    return (
      <>
        {normalizedSafes.map((safe) => (
          <SafePositionsCard
            key={safe}
            safeAddress={safe}
            refreshKey={refreshKey}
            onData={handleSafeData}
          />
        ))}
      </>
    );
  }

  if (
    !aggregated.isLoading &&
    aggregated.positions.length === 0 &&
    aggregated.totalRewardsUsdNum === 0
  ) {
    return (
      <>
        {normalizedSafes.map((safe) => (
          <SafePositionsCard
            key={safe}
            safeAddress={safe}
            refreshKey={refreshKey}
            onData={handleSafeData}
          />
        ))}
      </>
    );
  }

  const totalRewardsUsd =
    aggregated.totalRewardsUsdNum > 0
      ? aggregated.totalRewardsUsdNum < 1
        ? "<$1"
        : formatCurrency(aggregated.totalRewardsUsdNum, 2)
      : undefined;

  const showInitialSkeleton =
    aggregated.isLoading && aggregated.positions.length === 0 && !aggregated.hasAnyActivity;

  return (
    <>
      {normalizedSafes.map((safe) => (
        <SafePositionsCard
          key={safe}
          safeAddress={safe}
          refreshKey={refreshKey}
          onData={handleSafeData}
        />
      ))}
      <ProtocolCard
        protocol={protocol}
        totalValue={aggregated.totalValue}
        totalRewardsUsd={totalRewardsUsd}
        positions={aggregated.positions}
        isLoading={showInitialSkeleton}
        showManageButton={showManageButton}
      />
    </>
  );
}
