"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { useYieldAiSafeTokens } from "@/lib/query/hooks/protocols/yield-ai";
import { useHyperionLpPositions } from "@/lib/query/hooks/protocols/yield-ai/useHyperionLpPositions";
import { YIELD_AI_HYPERION_POOLS } from "@/lib/constants/yieldAiVault";
import { PositionBadge } from "@/shared/ProtocolCard/types";
import { useEchelonProtocolCardModel } from "@/lib/query/hooks/protocols/echelon/useEchelonProtocolCardModel";
import { mapYieldAiSafeTokensToProtocolPositions } from "./mapYieldAiSafeTokensToProtocolPositions";
import { mapEchelonProtocolPositionsToAiAgent } from "./mapEchelonToProtocolPositionsAiAgent";
import { mapDeltaNeutralToProtocolPosition } from "./mapDeltaNeutralToProtocolPositions";
import { useDeltaNeutralState } from "@/lib/query/hooks/protocols/yield-ai/useDeltaNeutralState";
import { normalizeAddress } from "@/lib/utils/addressNormalization";
import type { ProtocolPosition } from "@/shared/ProtocolCard/types";

export interface SafePositionsData {
  safeAddress: string;
  positions: ProtocolPosition[];
  /** Stable signature for cheap equality checks. */
  positionsSignature: string;
  totalValue: number;
  rewardsUsd: number;
  isLoading: boolean;
  isFetching: boolean;
  hasError: boolean;
  /** Reflects whether this safe currently has any non-zero state worth showing. */
  hasAnyActivity: boolean;
}

interface SafePositionsCardProps {
  safeAddress: string;
  refreshKey?: number;
  onData: (data: SafePositionsData) => void;
}

/**
 * Headless data-collector for a single Yield AI safe. Fetches per-safe data
 * (Echelon, delta-neutral, raw safe tokens), maps to `ProtocolPosition[]`, and
 * reports up via `onData`. The parent merges results across safes and renders a
 * single ProtocolCard.
 */
export function SafePositionsCard({ safeAddress, refreshKey, onData }: SafePositionsCardProps) {
  const queryClient = useQueryClient();
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  const lastSentRef = useRef<{
    positionsSignature: string;
    totalValue: number;
    rewardsUsd: number;
    isLoading: boolean;
    isFetching: boolean;
    hasError: boolean;
    hasAnyActivity: boolean;
  } | null>(null);

  // Always refetch on mount for the sidebar's data collectors. The global
  // default is `refetchOnMount: false` (to avoid duplicate concurrent
  // requests across Sidebar / Portfolio / MobileTabs), but for these
  // per-safe queries that turns into "stale empty data lingers in cache"
  // when the sidebar remounts after the user already had positions —
  // most visibly: USD1+Echelon supply not rendering until the user hits
  // refresh. React Query's in-flight dedup still collapses concurrent
  // mounts into a single network request.
  const { data: safeTokens = [], isLoading: safeTokensLoading, isFetching: safeTokensFetching } =
    useYieldAiSafeTokens(safeAddress, {
      refetchOnMount: "always",
    });

  const { data: deltaNeutralState } = useDeltaNeutralState(safeAddress, {
    refetchOnMount: "always",
  });

  const [marketNames, setMarketNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!deltaNeutralState?.recordExists || !deltaNeutralState.isOpen) return;
    let cancelled = false;
    fetch("/api/protocols/decibel/markets")
      .then((r) => r.json())
      .then((data: { success?: boolean; data?: { market_addr?: string; market_name?: string }[] }) => {
        if (cancelled || !data?.success || !Array.isArray(data.data)) return;
        const map: Record<string, string> = {};
        for (const m of data.data) {
          if (m.market_addr && m.market_name) {
            map[normalizeAddress(String(m.market_addr))] = String(m.market_name);
          }
        }
        setMarketNames(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [deltaNeutralState?.recordExists, deltaNeutralState?.isOpen]);

  const {
    protocolPositions: echelonProtocolPositions,
    totalValue: echelonTotalValue,
    rewardsValueUsd: echelonRewardsValueUsd,
    isLoading: echelonLoading,
    isFetching: echelonFetching,
  } = useEchelonProtocolCardModel(safeAddress, {
    refetchOnMount: "always",
  });

  const dnSpotMetaCanonical = useMemo(() => {
    if (!deltaNeutralState?.recordExists || !deltaNeutralState.isOpen) return null;
    if (!deltaNeutralState.spotAssetMetadata) return null;
    return normalizeAddress(deltaNeutralState.spotAssetMetadata);
  }, [deltaNeutralState?.recordExists, deltaNeutralState?.isOpen, deltaNeutralState?.spotAssetMetadata]);

  const filteredSafeTokens = useMemo(() => {
    if (!dnSpotMetaCanonical) return safeTokens;
    return safeTokens.filter((t) => normalizeAddress(t.address ?? "") !== dnSpotMetaCanonical);
  }, [safeTokens, dnSpotMetaCanonical]);

  const tokenProtocolPositions = useMemo(
    () => mapYieldAiSafeTokensToProtocolPositions(filteredSafeTokens),
    [filteredSafeTokens]
  );

  const echelonAiPositions = useMemo(
    () => mapEchelonProtocolPositionsToAiAgent(echelonProtocolPositions),
    [echelonProtocolPositions]
  );

  const dnPositions = useMemo(() => {
    if (!deltaNeutralState || !dnSpotMetaCanonical) return [];
    const spotToken = safeTokens.find(
      (t) => normalizeAddress(t.address ?? "") === dnSpotMetaCanonical
    );
    const spotLegValueUsd = spotToken?.value ? parseFloat(spotToken.value) : 0;
    return mapDeltaNeutralToProtocolPosition(deltaNeutralState, {
      spotLegValueUsd: Number.isFinite(spotLegValueUsd) ? spotLegValueUsd : 0,
      spotLogoUrl: spotToken?.logoUrl ?? undefined,
      marketNames,
    });
  }, [deltaNeutralState, dnSpotMetaCanonical, safeTokens, marketNames]);

  const safeSlice = useMemo(
    () => `${safeAddress.slice(0, 6)}…${safeAddress.slice(-4)}`,
    [safeAddress]
  );

  // Hyperion LP positions held inside the safe → compact rows (pair + $value +
  // Active/Inactive badge). The positions route no-ops for non-Hyperion safes.
  const { data: hyperionLpPositions = [] } = useHyperionLpPositions(safeAddress);
  const hyperionLpPositionsList = useMemo<ProtocolPosition[]>(() => {
    const logoBySymbol: Record<string, string | undefined> = {};
    for (const t of safeTokens) if (t.symbol) logoBySymbol[t.symbol] = t.logoUrl ?? undefined;
    return hyperionLpPositions
      .filter((p) => !p.closed)
      .map((p) => {
        const cfg = Object.values(YIELD_AI_HYPERION_POOLS).find(
          (c) =>
            (normalizeAddress(c.tokenA) === normalizeAddress(p.tokenA) &&
              normalizeAddress(c.tokenB) === normalizeAddress(p.tokenB)) ||
            (normalizeAddress(c.tokenA) === normalizeAddress(p.tokenB) &&
              normalizeAddress(c.tokenB) === normalizeAddress(p.tokenA))
        );
        const symbolA = cfg?.symbolA ?? "?";
        const symbolB = cfg?.symbolB ?? "USDC";
        return {
          id: `hyperion-${p.position}`,
          label: `${symbolA}/${symbolB}`,
          value: p.valueUsd ?? 0,
          logoUrl: logoBySymbol[symbolA],
          logoUrl2: logoBySymbol[symbolB],
          badge: p.active ? PositionBadge.Active : PositionBadge.Inactive,
          subLabel: "Hyperion LP",
        } satisfies ProtocolPosition;
      });
  }, [hyperionLpPositions, safeTokens]);
  const hyperionLpValue = useMemo(
    () => hyperionLpPositionsList.reduce((s, p) => s + (Number.isFinite(p.value) ? p.value : 0), 0),
    [hyperionLpPositionsList]
  );

  const tagged = useMemo(() => {
    const all = [...echelonAiPositions, ...dnPositions, ...hyperionLpPositionsList, ...tokenProtocolPositions];
    return all.map((p) => ({
      ...p,
      id: `${safeAddress}::${p.id ?? p.label}`,
    }));
  }, [echelonAiPositions, dnPositions, hyperionLpPositionsList, tokenProtocolPositions, safeAddress]);

  const positionsSignature = useMemo(() => {
    return tagged
      .map((p) => {
        const id = String(p.id ?? "");
        const v = Number.isFinite(p.value) ? p.value.toFixed(8) : "nan";
        const b = String((p as unknown as { badge?: unknown }).badge ?? "");
        const label = String(p.label ?? "");
        const sub = String((p as unknown as { subLabel?: unknown }).subLabel ?? "");
        return `${id}|${v}|${b}|${label}|${sub}`;
      })
      .join(";");
  }, [tagged]);

  const tokensValue = useMemo(
    () =>
      safeTokens.reduce((sum, t) => {
        const n = t?.value ? parseFloat(t.value) : 0;
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0),
    [safeTokens]
  );

  const combinedRewardsUsd = echelonRewardsValueUsd;
  const totalValueRaw = tokensValue + echelonTotalValue + hyperionLpValue;
  const totalValue = Number.isFinite(totalValueRaw) ? totalValueRaw : 0;

  const isLoading = safeTokensLoading || echelonLoading;
  const isFetching = safeTokensFetching || echelonFetching;
  const hasError = false;
  const echelonHasActivity =
    echelonProtocolPositions.length > 0 || echelonRewardsValueUsd > 0;
  const hasAnyActivity =
    safeTokens.length > 0 ||
    combinedRewardsUsd > 0 ||
    echelonHasActivity ||
    dnPositions.length > 0 ||
    hyperionLpPositionsList.length > 0;

  useEffect(() => {
    if (refreshKey != null) {
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.safeTokens(safeAddress) });
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.hyperionLpPositions(safeAddress) });
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.echelon.userPositions(safeAddress) });
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.echelon.rewards(safeAddress) });
    }
  }, [refreshKey, safeAddress, queryClient]);

  useEffect(() => {
    const handleRefresh: EventListener = (evt) => {
      const event = evt as CustomEvent<{ protocol?: string }>;
      const protocol = event?.detail?.protocol;
      if (protocol === "echelon") {
        queryClient.invalidateQueries({ queryKey: queryKeys.protocols.echelon.userPositions(safeAddress) });
        queryClient.invalidateQueries({ queryKey: queryKeys.protocols.echelon.rewards(safeAddress) });
      }
      if (protocol === "yield-ai") {
        queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.safeTokens(safeAddress) });
        queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.hyperionLpPositions(safeAddress) });
      }
    };
    window.addEventListener("refreshPositions", handleRefresh);
    return () => window.removeEventListener("refreshPositions", handleRefresh);
  }, [safeAddress, queryClient]);

  const taggedRef = useRef<ProtocolPosition[]>(tagged);
  taggedRef.current = tagged;

  useEffect(() => {
    const prev = lastSentRef.current;
    if (
      prev &&
      prev.positionsSignature === positionsSignature &&
      prev.totalValue === totalValue &&
      prev.rewardsUsd === combinedRewardsUsd &&
      prev.isLoading === isLoading &&
      prev.isFetching === isFetching &&
      prev.hasError === hasError &&
      prev.hasAnyActivity === hasAnyActivity
    ) {
      return;
    }

    lastSentRef.current = {
      positionsSignature,
      totalValue,
      rewardsUsd: combinedRewardsUsd,
      isLoading,
      isFetching,
      hasError,
      hasAnyActivity,
    };

    onDataRef.current({
      safeAddress,
      positions: taggedRef.current,
      positionsSignature,
      totalValue,
      rewardsUsd: combinedRewardsUsd,
      isLoading,
      isFetching,
      hasError,
      hasAnyActivity,
    });
  }, [
    safeAddress,
    positionsSignature,
    totalValue,
    combinedRewardsUsd,
    isLoading,
    isFetching,
    hasError,
    hasAnyActivity,
  ]);

  void safeSlice;

  return null;
}
