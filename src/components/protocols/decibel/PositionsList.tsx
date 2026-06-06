"use client";

import { useState, useEffect, useRef } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { normalizeAddress } from "@/lib/utils/addressNormalization";


interface PositionsListProps {
  address?: string;
  onPositionsValueChange?: (value: number) => void;
  onMainnetValueChange?: (value: number) => void;
  refreshKey?: number;
  onPositionsCheckComplete?: () => void;
  showManageButton?: boolean;
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

export function PositionsList({
  address,
  onPositionsValueChange,
  onMainnetValueChange,
  refreshKey,
  onPositionsCheckComplete,
  showManageButton = true,
}: PositionsListProps) {
  const { formatUsd } = usePortfolioAmountsPrivacy();
  const [equity, setEquity] = useState<number | null>(null);
  const [positions, setPositions] = useState<{ market: string; marginUsd: number; pnl: number; user: string }[]>([]);
  const [marketNames, setMarketNames] = useState<Record<string, string>>({});
  const [availableToTrade, setAvailableToTrade] = useState<number | null>(null);
  const [vaults, setVaults] = useState<{ name: string; current_value_of_shares?: number }[]>([]);
  const [preDepositSumUsdc, setPreDepositSumUsdc] = useState<number | null>(null);
  const [totalAmps, setTotalAmps] = useState<number | null>(null);
  const [ampsData, setAmpsData] = useState<DecibelAmpsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { isExpanded, toggleSection } = useCollapsible();
  const protocol = getProtocolByName("Decibel");
  const onValueRef = useRef(onPositionsValueChange);
  const onMainnetRef = useRef(onMainnetValueChange);
  const onCompleteRef = useRef(onPositionsCheckComplete);
  onValueRef.current = onPositionsValueChange;
  onMainnetRef.current = onMainnetValueChange;
  onCompleteRef.current = onPositionsCheckComplete;

  // Fetch mainnet pre-deposit separately so Total Assets gets it even when testnet APIs fail
  useEffect(() => {
    if (!address) {
      onMainnetRef.current?.(0);
      return;
    }
    let cancelled = false;
    fetch(`/api/protocols/decibel/predepositorBalance?address=${encodeURIComponent(address)}`)
      .then((r) => r.json())
      .then((data: { success?: boolean; data?: { sumUsdc?: number } }) => {
        if (cancelled) return;
        const sum = data?.success && typeof data?.data?.sumUsdc === 'number' ? data.data.sumUsdc : 0;
        setPreDepositSumUsdc(sum);
        onMainnetRef.current?.(sum);
      })
      .catch(() => {
        if (!cancelled) {
          setPreDepositSumUsdc(null);
          onMainnetRef.current?.(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [address, refreshKey]);

  // Split the original Promise.all into two groups so the sidebar Decibel
  // section renders without waiting on the slowest upstream calls:
  //
  //   Critical (~7s on this wallet):
  //     accountOverview, userPositions, markets, predepositorBalance, prices
  //   Background (load and patch in as they arrive):
  //     accountVaultPerformance (~21s, vault rows)
  //     amps (~1.7s, AMPs badge)
  //
  // isLoading flips false after the critical batch — the user sees equity,
  // open positions and pre-deposit immediately. Vault rows and AMPs slot
  // in when their fetches resolve.
  useEffect(() => {
    if (!address) {
      onCompleteRef.current?.();
      return;
    }
    let cancelled = false;
    setIsLoading(true);

    // ---- Critical group ----
    Promise.all([
      fetch(`/api/protocols/decibel/accountOverview?address=${encodeURIComponent(address)}`).then((r) =>
        r.json()
      ),
      fetch(`/api/protocols/decibel/userPositions?address=${encodeURIComponent(address)}`).then((r) =>
        r.json()
      ),
      fetch("/api/protocols/decibel/markets").then((r) => r.json()),
      fetch(`/api/protocols/decibel/predepositorBalance?address=${encodeURIComponent(address)}`).then((r) =>
        r.json()
      ),
      fetch("/api/protocols/decibel/prices").then((r) => r.json()),
    ])
      .then(([overviewRes, positionsRes, marketsRes, predepositRes, pricesRes]) => {
        if (cancelled) return;
        const eq =
          overviewRes?.success && overviewRes?.data?.perp_equity_balance != null
            ? Number(overviewRes.data.perp_equity_balance)
            : 0;
        const avail =
          overviewRes?.success && overviewRes?.data?.usdc_cross_withdrawable_balance != null
            ? Number(overviewRes.data.usdc_cross_withdrawable_balance)
            : null;
        const pricesMap: Record<string, number> = {};
        if (pricesRes?.success && Array.isArray(pricesRes?.data)) {
          for (const item of pricesRes.data as { market?: string; mark_px?: number; mid_px?: number }[]) {
            const addr = item.market;
            if (addr != null) {
              const mark = item.mark_px ?? item.mid_px;
              if (typeof mark === "number") pricesMap[normalizeAddress(String(addr))] = mark;
            }
          }
        }
        const posList = positionsRes?.success && Array.isArray(positionsRes?.data)
          ? (positionsRes.data as {
              market: string;
              size?: number;
              entry_price?: number;
              user_leverage?: number;
              unrealized_funding?: number;
              is_deleted?: boolean;
            }[])
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
                return { market: p.market, marginUsd, pnl, user: String((p as { user?: string }).user ?? '') };
              })
          : [];

        const map: Record<string, string> = {};
        if (marketsRes?.success && Array.isArray(marketsRes?.data)) {
          for (const m of marketsRes.data as { market_addr?: string; market_name?: string }[]) {
            if (m.market_addr != null && m.market_name != null) {
              map[normalizeAddress(String(m.market_addr))] = String(m.market_name);
            }
          }
        }
        const preDeposit = predepositRes?.success && typeof predepositRes?.data?.sumUsdc === 'number'
          ? predepositRes.data.sumUsdc
          : 0;
        setEquity(eq);
        setPositions(posList);
        setMarketNames(map);
        setAvailableToTrade(avail);
        setPreDepositSumUsdc(preDeposit);
        onMainnetRef.current?.(preDeposit);
        // Note: do not call onValueRef here. A dedicated effect below
        // bubbles up totalValue whenever equity / vaults / preDeposit
        // change, so the parent sidebar receives the freshest figure
        // including the (still-loading) vault rows.
      })
      .catch(() => {
        if (!cancelled) {
          setEquity(0);
          setPositions([]);
          setMarketNames({});
          setAvailableToTrade(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
          onCompleteRef.current?.();
        }
      });

    // ---- Background: vault performance (slowest endpoint, ~21s) ----
    fetch(`/api/protocols/decibel/accountVaultPerformance?address=${encodeURIComponent(address)}`)
      .then((r) => r.json())
      .then((vaultsRes) => {
        if (cancelled) return;
        const vaultList = vaultsRes?.success && Array.isArray(vaultsRes?.data)
          ? (vaultsRes.data as { vault?: { name?: string }; current_value_of_shares?: number }[])
              .map((v) => ({
                name: v.vault?.name ?? "Vault",
                current_value_of_shares: v.current_value_of_shares,
              }))
              .filter((v) => (v.current_value_of_shares ?? 0) > 0)
          : [];
        setVaults(vaultList);
      })
      .catch(() => {
        if (!cancelled) setVaults([]);
      });

    // ---- Background: AMPs (reward score badge) ----
    fetch(`/api/protocols/decibel/amps?owner=${encodeURIComponent(address)}`)
      .then((r) => r.json())
      .then((ampsRes) => {
        if (cancelled) return;
        const amps = ampsRes?.success && typeof ampsRes?.data?.total_amps === "number"
          ? ampsRes.data.total_amps
          : null;
        setTotalAmps(amps);
        setAmpsData(amps != null ? (ampsRes.data as DecibelAmpsData) : null);
      })
      .catch(() => {
        if (!cancelled) {
          setTotalAmps(null);
          setAmpsData(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [address, refreshKey]);

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
