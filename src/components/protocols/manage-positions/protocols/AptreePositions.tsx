"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import Image from "next/image";
import { ExternalLink } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { DepositModal } from "@/components/ui/deposit-modal";
import { formatCurrency, formatNumber } from "@/lib/utils/numberFormat";
import { useQueryClient } from "@tanstack/react-query";
import { useAptreeDepositHistory, useAptreePools, useAptreePositions } from "@/lib/query/hooks/protocols/aptree";
import { queryKeys } from "@/lib/query/queryKeys";
import { History } from "lucide-react";
import { AptreeHistoryModal } from "@/components/ui/aptree-history-modal";
import { PnlSummaryRow } from "@/components/ui/pnl-summary-row";

interface AptreePosition {
  poolId: number;
  assetName: string;
  balance: string;
  value: string;
  displayPrice?: number;
  displayAmount?: string;
  type: "deposit";
  assetInfo?: {
    symbol?: string;
    logoUrl?: string;
    decimals?: number;
    name?: string;
  };
}

function sortByValueDesc(items: AptreePosition[]): AptreePosition[] {
  return [...items].sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
}

const APTREE_EARN_URL = "https://www.aptree.io/earn";
const USDT_FA_ADDRESS = "0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b";

export function AptreePositions() {
  const { account } = useWallet();
  const queryClient = useQueryClient();
  const walletAddress = account?.address?.toString();
  const { data: positions = [], isLoading: positionsLoading, error: positionsError } = useAptreePositions(walletAddress, {
    refetchOnMount: "always",
  });
  const { data: pools = [], isLoading: poolsLoading } = useAptreePools({ refetchOnMount: "always" });
  const aprPct = useMemo(() => {
    const firstPool = pools?.[0];
    const aprRaw = Number(firstPool?.apr);
    return Number.isFinite(aprRaw) ? aprRaw * 100 : null;
  }, [pools]);

  const [showDepositModal, setShowDepositModal] = useState(false);
  const [selectedDepositPosition, setSelectedDepositPosition] = useState<AptreePosition | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  const handleDepositClick = (position: AptreePosition) => {
    setSelectedDepositPosition(position);
    setShowDepositModal(true);
  };

  useEffect(() => {
    const handleRefresh: EventListener = (evt) => {
      const event = evt as CustomEvent<{ protocol: string; data?: AptreePosition[] }>;
      if (event?.detail?.protocol === "aptree") {
        if (walletAddress) {
          queryClient.invalidateQueries({ queryKey: queryKeys.protocols.aptree.userPositions(walletAddress) });
        }
        queryClient.invalidateQueries({ queryKey: queryKeys.protocols.aptree.pools() });
      }
    };
    window.addEventListener("refreshPositions", handleRefresh);
    return () => window.removeEventListener("refreshPositions", handleRefresh);
  }, [queryClient, walletAddress]);

  const sortedPositions = useMemo(() => sortByValueDesc(positions), [positions]);
  const totalValue = useMemo(
    () => sortedPositions.reduce((sum, p) => sum + Number(p.value || 0), 0),
    [sortedPositions]
  );

  const { data: depositHistory, isLoading: historyLoading, isFetching: historyFetching } = useAptreeDepositHistory(
    walletAddress,
    { assetId: USDT_FA_ADDRESS, currentValue: Number.isFinite(totalValue) ? totalValue : null },
    { enabled: Boolean(walletAddress) }
  );

  const holdingDays = depositHistory?.pnlStats?.holdingDays ?? 0;
  const pnlRaw = depositHistory?.pnlStats?.pnl ?? null;
  const aprRaw = depositHistory?.pnlStats?.apr ?? null;
  const pnlUsd = pnlRaw != null ? parseFloat(pnlRaw) : null;
  const aprPctFromHistory = holdingDays >= 7 && aprRaw != null ? parseFloat(aprRaw) : null;
  const performanceLoading = historyLoading || historyFetching || positionsLoading || poolsLoading;

  if ((positionsLoading || poolsLoading) && sortedPositions.length === 0) {
    return <div className="py-4 text-muted-foreground">Loading positions...</div>;
  }
  if (positionsError) {
    return (
      <div className="py-4 text-red-500">
        {positionsError instanceof Error ? positionsError.message : "Failed to load APTree positions"}
      </div>
    );
  }
  if (sortedPositions.length === 0) {
    return <div className="py-4 text-muted-foreground">No positions on APTree.</div>;
  }

  return (
    <div className="space-y-4 text-base">
      <ScrollArea>
        {sortedPositions.map((position, index) => {
          const decimals = position.assetInfo?.decimals ?? 6;
          const amountFromBalance = Number(position.balance || 0) / Math.pow(10, decimals);
          const value = Number(position.value || 0);
          const amount = Number(position.displayAmount || amountFromBalance);
          const price = Number.isFinite(Number(position.displayPrice))
            ? Number(position.displayPrice)
            : amount > 0
              ? value / amount
              : 0;
          const symbol = position.assetInfo?.symbol || position.assetName || "USDT";
          const logoUrl =
            position.assetInfo?.logoUrl || "https://assets.panora.exchange/tokens/aptos/USDT.svg";
          return (
            <div key={`${position.poolId}-${index}`} className="p-3 sm:p-4 border-b last:border-b-0">
              {/* Desktop Layout (match Moar structure) */}
              <div className="hidden sm:flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 relative">
                    <Image src={logoUrl} alt={symbol} width={32} height={32} className="object-contain" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="text-lg font-semibold">{symbol}</div>
                      <Badge
                        variant="outline"
                        className="bg-green-500/10 text-green-600 border-green-500/20 text-xs font-normal px-2 py-0.5 h-5"
                      >
                        Supply
                      </Badge>
                    </div>
                    <div className="text-base text-muted-foreground mt-0.5">{formatCurrency(price, 4)}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 mb-1">
                    {aprPct != null && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge
                              variant="outline"
                              className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs font-normal px-2 py-0.5 h-5 cursor-help"
                            >
                              APR: {formatNumber(aprPct, 2)}%
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs space-y-1">
                              <div className="font-semibold">APR Breakdown</div>
                              <div className="flex justify-between gap-3">
                                <span>APTree Earn APR:</span>
                                <span>{formatNumber(aprPct, 2)}%</span>
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    <div className="text-lg font-bold text-right w-24">{formatCurrency(value, 2)}</div>
                  </div>
                  <div className="text-base text-muted-foreground font-semibold">{formatNumber(amount, 4)}</div>
                  <div className="flex gap-2 mt-2 justify-end">
                    <Button
                      onClick={() => handleDepositClick(position)}
                      size="sm"
                      variant="default"
                      className="h-10"
                    >
                      Deposit
                    </Button>
                    {amount > 0 && (
                      <Button
                        onClick={() => window.open(APTREE_EARN_URL, "_blank")}
                        size="sm"
                        variant="outline"
                        className="h-10"
                      >
                        Withdraw
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    )}
                    <Button
                      onClick={() => setShowHistoryModal(true)}
                      size="sm"
                      variant="outline"
                      className="h-10 px-3"
                      aria-label="Open deposit history"
                    >
                      <History className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {/* Mobile Layout (match Moar structure) */}
              <div className="block sm:hidden space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 relative">
                      <Image src={logoUrl} alt={symbol} width={32} height={32} className="object-contain" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="text-base font-semibold">{symbol}</div>
                        <Badge
                          variant="outline"
                          className="bg-green-500/10 text-green-600 border-green-500/20 text-xs font-normal px-1.5 py-0.5 h-4"
                        >
                          Supply
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground">{formatCurrency(price, 4)}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center justify-end gap-2 mb-1">
                      {aprPct != null && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="outline"
                                className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs font-normal px-1.5 py-0.5 h-4 cursor-help"
                              >
                                APR: {formatNumber(aprPct, 2)}%
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-xs space-y-1">
                                <div className="font-semibold">APR Breakdown</div>
                                <div className="flex justify-between gap-3">
                                  <span>APTree Earn APR:</span>
                                  <span>{formatNumber(aprPct, 2)}%</span>
                                </div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      <div className="text-base font-semibold text-right w-24">{formatCurrency(value, 2)}</div>
                    </div>
                    <div className="text-sm text-muted-foreground">{formatNumber(amount, 4)}</div>
                    <div className="flex gap-2 mt-2 justify-end">
                      <Button
                        onClick={() => handleDepositClick(position)}
                        size="sm"
                        variant="default"
                        className="h-10"
                      >
                        Deposit
                      </Button>
                      {amount > 0 && (
                        <Button
                          onClick={() => window.open(APTREE_EARN_URL, "_blank")}
                          size="sm"
                          variant="outline"
                          className="h-10"
                        >
                          Withdraw
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      )}
                      <Button
                        onClick={() => setShowHistoryModal(true)}
                        size="sm"
                        variant="outline"
                        className="h-10 px-3"
                        aria-label="Open deposit history"
                      >
                        <History className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </ScrollArea>
      <div className="pt-6 pb-6 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xl">Total assets in APTree:</span>
          <span className="text-xl text-primary font-bold">{formatCurrency(totalValue, 2)}</span>
        </div>
        <PnlSummaryRow
          className="pt-3 mt-2 border-t border-border"
          pnlUsd={pnlUsd}
          aprPct={aprPctFromHistory}
          holdingDays={holdingDays}
          isLoading={performanceLoading}
        />
      </div>

      {selectedDepositPosition && (
        <DepositModal
          isOpen={showDepositModal}
          onClose={() => {
            setShowDepositModal(false);
            setSelectedDepositPosition(null);
          }}
          protocol={{
            name: "APTree",
            logo: "/protocol_ico/aptree.png",
            apy: aprPct || 0,
            key: "aptree" as any,
          }}
          tokenIn={{
            symbol: selectedDepositPosition.assetInfo?.symbol || "USDT",
            logo: selectedDepositPosition.assetInfo?.logoUrl || "https://assets.panora.exchange/tokens/aptos/USDT.svg",
            decimals: selectedDepositPosition.assetInfo?.decimals || 6,
            address: USDT_FA_ADDRESS,
          }}
          tokenOut={{
            symbol: selectedDepositPosition.assetInfo?.symbol || "USDT",
            logo: selectedDepositPosition.assetInfo?.logoUrl || "https://assets.panora.exchange/tokens/aptos/USDT.svg",
            decimals: selectedDepositPosition.assetInfo?.decimals || 6,
            address: USDT_FA_ADDRESS,
          }}
          priceUSD={1}
        />
      )}

      <AptreeHistoryModal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
        address={walletAddress}
        history={depositHistory}
        currentValueUsd={Number.isFinite(totalValue) ? totalValue : null}
      />
    </div>
  );
}
