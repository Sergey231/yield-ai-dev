"use client";

import { useEffect, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { useCollapsible } from "@/contexts/CollapsibleContext";
import { ManagePositionsButton } from "../ManagePositionsButton";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import { formatNumber } from "@/lib/utils/numberFormat";
import { usePortfolioAmountsPrivacy } from "@/contexts/PortfolioAmountsPrivacyContext";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { normalizeAddress } from "@/lib/utils/addressNormalization";
import { useDecibelUserPositions } from "@/lib/query/hooks/protocols/decibel/useDecibelUserPositions";
import {
  useDecibelAccountOverview,
  useDecibelAmps,
  useDecibelMarkets,
  useDecibelPredepositorBalance,
  useDecibelPrices,
  useDecibelVaultPerformance,
} from "@/lib/query/hooks/protocols/decibel/useDecibelPortfolioData";


interface PositionsListProps {
  address?: string;
  onPositionsValueChange?: (value: number) => void;
  onMainnetValueChange?: (value: number) => void;
  refreshKey?: number;
  onPositionsCheckComplete?: () => void;
  showManageButton?: boolean;
}

export function PositionsList({
  address,
  onPositionsValueChange,
  onMainnetValueChange,
  refreshKey,
  onPositionsCheckComplete,
  showManageButton = true,
}: PositionsListProps) {
  const { formatUsd } = usePortfolioAmountsPrivacy();
  const { isExpanded, toggleSection } = useCollapsible();
  const protocol = getProtocolByName("Decibel");
  const onValueRef = useRef(onPositionsValueChange);
  const onMainnetRef = useRef(onMainnetValueChange);
  const onCompleteRef = useRef(onPositionsCheckComplete);
  const lastRefreshKeyRef = useRef(refreshKey);
  onValueRef.current = onPositionsValueChange;
  onMainnetRef.current = onMainnetValueChange;
  onCompleteRef.current = onPositionsCheckComplete;

  const overviewQuery = useDecibelAccountOverview(address);
  const positionsQuery = useDecibelUserPositions(address);
  const marketsQuery = useDecibelMarkets();
  const pricesQuery = useDecibelPrices(undefined, { enabled: Boolean(address) });
  const preDepositQuery = useDecibelPredepositorBalance(address);
  const vaultsQuery = useDecibelVaultPerformance(address);
  const ampsQuery = useDecibelAmps(address);

  useEffect(() => {
    if (!address) {
      onMainnetRef.current?.(0);
      onCompleteRef.current?.();
      return;
    }
    if (refreshKey == null) return;
    if (lastRefreshKeyRef.current === refreshKey) return;
    lastRefreshKeyRef.current = refreshKey;
    void overviewQuery.refetch();
    void positionsQuery.refetch();
    void marketsQuery.refetch();
    void pricesQuery.refetch();
    void preDepositQuery.refetch();
    void vaultsQuery.refetch();
    void ampsQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey explicitly drives a manual refresh
  }, [refreshKey]);

  const pricesMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const item of pricesQuery.data ?? []) {
      const addr = item.market;
      if (addr != null) {
        const mark = item.mark_px ?? item.mid_px;
        if (typeof mark === "number") map[normalizeAddress(String(addr))] = mark;
      }
    }
    return map;
  }, [pricesQuery.data]);

  const marketNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of marketsQuery.data?.data ?? []) {
      if (m.market_addr != null && m.market_name != null) {
        map[normalizeAddress(String(m.market_addr))] = String(m.market_name);
      }
    }
    return map;
  }, [marketsQuery.data]);

  const positions = useMemo(
    () =>
      (positionsQuery.data ?? [])
        .filter((p) => !p.is_deleted)
        .map((p) => {
          const notional = Math.abs(Number(p.size) || 0) * Number(p.entry_price || 0);
          const lev = Number(p.user_leverage) || 1;
          const marginUsd = lev > 0 ? notional / lev : notional;
          const size = Number(p.size) || 0;
          const entry = Number(p.entry_price) || 0;
          const fundingDisplay = -(Number(p.unrealized_funding) || 0);
          const markPx = pricesMap[normalizeAddress(String(p.market))] ?? entry;
          const pricePnl = size * (markPx - entry);
          const pnl = pricePnl + fundingDisplay;
          return { market: p.market, marginUsd, pnl, user: String(p.user ?? "") };
        }),
    [positionsQuery.data, pricesMap],
  );

  const vaults = useMemo(
    () =>
      (vaultsQuery.data ?? [])
        .map((v) => ({
          name: v.vault?.name ?? "Vault",
          current_value_of_shares: v.current_value_of_shares,
        }))
        .filter((v) => (v.current_value_of_shares ?? 0) > 0),
    [vaultsQuery.data],
  );

  const equity = overviewQuery.data?.perp_equity_balance != null ? Number(overviewQuery.data.perp_equity_balance) : 0;
  const availableToTrade =
    overviewQuery.data?.usdc_cross_withdrawable_balance != null
      ? Number(overviewQuery.data.usdc_cross_withdrawable_balance)
      : null;
  const preDepositSumUsdc = preDepositQuery.data ?? 0;
  const ampsData = ampsQuery.data ?? null;
  const totalAmps = ampsData?.total_amps ?? null;
  const isLoading =
    overviewQuery.isLoading ||
    positionsQuery.isLoading ||
    marketsQuery.isLoading ||
    pricesQuery.isLoading ||
    preDepositQuery.isLoading;

  useEffect(() => {
    onMainnetRef.current?.(preDepositSumUsdc ?? 0);
  }, [preDepositSumUsdc]);

  useEffect(() => {
    if (!address) return;
    if (!isLoading) onCompleteRef.current?.();
  }, [address, isLoading]);

  // Bubble the latest aggregate total up to the parent whenever any of its
  // components change. Without this, splitting the fetches into critical +
  // background batches would leave the sidebar total stuck at "without
  // vaults" forever (or update twice with a flicker if we wrote into
  // onValueRef from each .then individually).
  useEffect(() => {
    const vaultsSum = vaults.reduce(
      (sum, v) => sum + (v.current_value_of_shares ?? 0),
      0
    );
    const total = (equity ?? 0) + vaultsSum + (preDepositSumUsdc ?? 0);
    onValueRef.current?.(total);
  }, [equity, vaults, preDepositSumUsdc]);

  const vaultsTotal = vaults.reduce(
    (sum: number, v: { current_value_of_shares?: number }) => sum + (v.current_value_of_shares ?? 0),
    0
  );
  const displayValue = (equity != null ? equity : 0) + vaultsTotal + (preDepositSumUsdc ?? 0);
  const hasAnything =
    positions.length > 0 || vaults.length > 0 || displayValue > 0 ||
    (preDepositSumUsdc != null && preDepositSumUsdc > 0);

  /** Format market for sidebar: "BTC-USDC" -> "BTC/USDC", "BTC-USD" -> "BTC/USD" */
  const formatPairForSidebar = (marketAddr: string) => {
    const name = marketNames[normalizeAddress(marketAddr)] ?? marketAddr;
    if (name.startsWith("0x")) return `${name.slice(0, 8)}…`;
    return name.replace("-", "/");
  };

  if (!address) {
    return null;
  }
  if (isLoading) {
    return null;
  }
  if (!hasAnything) {
    return null;
  }

  return (
    <Card className="w-full">
      <CardHeader
        className="py-2 cursor-pointer hover:bg-accent/50 transition-colors"
        onClick={() => toggleSection("decibel")}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            {protocol?.logoUrl && (
              <div className="w-5 h-5 relative">
                <Image
                  src={protocol.logoUrl}
                  alt="Decibel"
                  width={20}
                  height={20}
                  className="object-contain"
                />
              </div>
            )}
            <CardTitle className="text-lg">Decibel</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-lg whitespace-nowrap">
              {isLoading ? "..." : formatUsd(displayValue)}
            </div>
            <ChevronDown
              className={cn(
                "h-5 w-5 transition-transform",
                isExpanded("decibel") ? "transform rotate-0" : "transform -rotate-90"
              )}
            />
          </div>
        </div>
      </CardHeader>
      {isExpanded("decibel") && (
        <CardContent className="px-3 pt-0 pb-3">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : (
            <>
              {(preDepositSumUsdc != null && preDepositSumUsdc > 0) && (
                <div className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Pre-deposit</span>
                  </div>
                  <span className="text-sm font-medium shrink-0 ml-2">
                    {formatUsd(preDepositSumUsdc ?? 0, 2)}
                  </span>
                </div>
              )}
              {availableToTrade != null && (
                <div className="flex items-center justify-between py-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Available to trade</span>
                  </div>
                  <span className="text-sm font-medium shrink-0 ml-2">
                    {formatUsd(availableToTrade, 2)}
                  </span>
                </div>
              )}
              {/* AMPs from Decibel points leaderboard */}
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-muted-foreground">AMPs</span>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex text-muted-foreground cursor-help" onClick={(e) => e.stopPropagation()}>
                          <Info className="h-3.5 w-3.5" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[260px]">
                        <p className="font-medium mb-1.5">Points breakdown</p>
                        <ul className="text-sm text-muted-foreground space-y-0.5">
                          <li>- Trading: {formatNumber(ampsData?.trading_amps ?? 0, 2)} AMP</li>
                          <li>- Referrals: {formatNumber(ampsData?.referral_amps ?? 0, 2)} AMP</li>
                          <li>- Vaults: {formatNumber(ampsData?.vault_amps ?? 0, 2)} AMP</li>
                          <li>- Streak: {formatNumber(ampsData?.streak_amps ?? 0, 2)} AMP</li>
                          {(ampsData?.bonus_amps ?? 0) > 0 && (
                            <li>- Bonus: {formatNumber(ampsData?.bonus_amps ?? 0, 2)} AMP</li>
                          )}
                        </ul>
                        {ampsData?.rank != null && (
                          <p className="text-xs text-muted-foreground mt-1.5">Rank #{formatNumber(ampsData.rank, 0)}</p>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <span className={cn("text-sm font-medium shrink-0 ml-2", totalAmps == null && "text-muted-foreground")}>
                  {totalAmps != null ? formatNumber(totalAmps, 2) : "—"}
                </span>
              </div>
              {positions.length > 0 && (
                <div className="space-y-2 mt-1">
                  <div className="flex items-center gap-2 py-0.5">
                    <span className="text-sm font-medium text-muted-foreground">Positions</span>
                  </div>
                  {positions.map((p, i) => (
                    <div
                      key={`${p.market}-${i}`}
                      className="flex items-center justify-between gap-2 py-0.5"
                    >
                      <span className="text-sm font-medium truncate min-w-0">
                        {formatPairForSidebar(p.market)}
                      </span>
                      <div className="text-sm shrink-0 ml-2 text-right flex items-center justify-end gap-1.5">
                        <span className={p.pnl < 0 ? "text-destructive" : p.pnl > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}>
                          ({p.pnl > 0 ? "+" : ""}{formatUsd(p.pnl, 2)})
                        </span>
                        <span className="font-medium">
                          {formatUsd(p.marginUsd, 2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {!isLoading && vaults.length > 0 && (
            <div className="mt-4 pt-4 space-y-2">
              <h4 className="text-sm font-medium mb-2 text-muted-foreground flex items-center gap-2">
                Vaults
              </h4>
              {vaults.map((v, i) => (
                <div key={i} className="flex items-center justify-between py-1">
                  <div className="text-sm font-medium truncate min-w-0">{v.name}</div>
                  <div className="text-sm font-medium shrink-0 ml-2">
                    {formatUsd(v.current_value_of_shares ?? 0, 2)}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex justify-center w-full">
            {showManageButton && protocol && <ManagePositionsButton protocol={protocol} />}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
