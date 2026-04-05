"use client";

import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatNumber } from "@/lib/utils/numberFormat";
import type { YieldAiDepositHistory } from "@/lib/query/hooks/protocols/yield-ai/useYieldAiDepositHistory";

interface YieldAiHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  safeAddress?: string;
  history: YieldAiDepositHistory | undefined;
  currentValueUsd?: number | null;
}

type TimelineRow = {
  from: string;
  to: string;
  days: number;
  balance: number;
  dollarDays: number;
};

function explorerTxUrl(txVersion: string) {
  return `https://explorer.aptoslabs.com/txn/${txVersion}?network=mainnet`;
}

function fmtDateTime(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

export function YieldAiHistoryModal({
  isOpen,
  onClose,
  safeAddress,
  history,
  currentValueUsd,
}: YieldAiHistoryModalProps) {
  const entries = history?.entries ?? [];
  const pnl = history?.pnlStats?.pnl ?? null;
  const apr = history?.pnlStats?.apr ?? null;
  const holdingDays = history?.pnlStats?.holdingDays ?? 0;

  const timeline = useMemo((): TimelineRow[] => {
    if (entries.length === 0) return [];
    const chronological = [...entries].reverse();

    let balance = 0;
    let prevTs = new Date(chronological[0].timestamp).getTime();
    if (Number.isNaN(prevTs)) return [];

    const now = Date.now();
    const rows: TimelineRow[] = [];

    for (const entry of chronological) {
      const ts = new Date(entry.timestamp).getTime();
      if (Number.isNaN(ts)) continue;
      const days = Math.max(0, (ts - prevTs) / (1000 * 60 * 60 * 24));
      if (days > 0) {
        rows.push({
          from: new Date(prevTs).toISOString(),
          to: new Date(ts).toISOString(),
          days,
          balance,
          dollarDays: balance * days,
        });
      }
      prevTs = ts;

      const amount = parseFloat(entry.amount);
      if (entry.direction === "deposit") balance += amount;
      else balance -= amount;
    }

    const remaining = Math.max(0, (now - prevTs) / (1000 * 60 * 60 * 24));
    if (remaining > 0) {
      rows.push({
        from: new Date(prevTs).toISOString(),
        to: new Date(now).toISOString(),
        days: remaining,
        balance,
        dollarDays: balance * remaining,
      });
    }

    return rows.slice(-12); // keep it compact
  }, [entries]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Deposit history</DialogTitle>
          <DialogDescription>
            {safeAddress ? (
              <span>
                Safe {safeAddress.slice(0, 8)}...{safeAddress.slice(-6)}
              </span>
            ) : (
              "Yield AI safe cashflows"
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {currentValueUsd != null && Number.isFinite(currentValueUsd) && (
              <Badge variant="outline" className="text-xs">
                Total assets: {formatCurrency(currentValueUsd, 2)}
              </Badge>
            )}
            {pnl != null && (
              <Badge variant="outline" className="text-xs">
                PnL: {formatCurrency(parseFloat(pnl), 2)}
              </Badge>
            )}
            {apr != null && holdingDays >= 7 && (
              <Badge variant="outline" className="text-xs">
                Historical APR: {apr}%
              </Badge>
            )}
            {holdingDays > 0 && (
              <Badge variant="outline" className="text-xs">
                Period: {holdingDays}d
              </Badge>
            )}
            {history?.netDeposits && (
              <Badge variant="outline" className="text-xs">
                Net deposits: {history.netDeposits} USDC
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              APR is calculated using the Modified Dietz method.
            </span>
          </div>

          {timeline.length > 0 && (
            <div className="rounded-lg border bg-card p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Capital timeline</div>
                <div className="text-xs text-muted-foreground">
                  Shows intervals used in APR calculation (days × running balance)
                </div>
              </div>
              <div className="space-y-1 text-xs">
                {timeline.map((row, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-3">
                    <div className="min-w-0 text-muted-foreground">
                      {fmtDateTime(row.from)} → {fmtDateTime(row.to)}
                    </div>
                    <div className="shrink-0 tabular-nums">
                      {formatNumber(row.days, 2)}d × {formatNumber(row.balance, 6)} ={" "}
                      {formatNumber(row.dollarDays, 2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border overflow-hidden">
            <div className="grid grid-cols-12 gap-2 bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
              <div className="col-span-5">Time</div>
              <div className="col-span-3">Direction</div>
              <div className="col-span-2 text-right">Amount</div>
              <div className="col-span-2 text-right">Tx</div>
            </div>
            <div className="max-h-[340px] overflow-y-auto">
              {entries.length === 0 ? (
                <div className="px-3 py-6 text-sm text-muted-foreground">
                  No deposits or withdrawals found for this safe.
                </div>
              ) : (
                entries.map((e) => (
                  <div
                    key={`${e.txVersion}-${e.timestamp}-${e.amountRaw}`}
                    className="grid grid-cols-12 gap-2 px-3 py-2 text-sm border-t"
                  >
                    <div className="col-span-5 text-muted-foreground">
                      {fmtDateTime(e.timestamp)}
                    </div>
                    <div className="col-span-3">
                      <span
                        className={
                          e.direction === "deposit" ? "text-green-600" : "text-destructive"
                        }
                      >
                        {e.direction === "deposit" ? "Deposit" : "Withdraw"}
                      </span>
                    </div>
                    <div className="col-span-2 text-right tabular-nums">
                      {e.direction === "deposit" ? "+" : "-"}
                      {e.amount} USDC
                    </div>
                    <div className="col-span-2 text-right">
                      <a
                        href={explorerTxUrl(e.txVersion)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 underline text-xs"
                      >
                        View
                      </a>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

