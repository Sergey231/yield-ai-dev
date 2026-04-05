"use client";

import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatNumber } from "@/lib/utils/numberFormat";
import { Loader2 } from "lucide-react";

interface PnlSummaryRowProps {
  pnlUsd?: number | null;
  aprPct: number | null;
  holdingDays: number;
  isLoading?: boolean;
  aprGateDays?: number;
  aprLabel?: string;
  className?: string;
}

export function PnlSummaryRow({
  pnlUsd,
  aprPct,
  holdingDays,
  isLoading = false,
  aprGateDays = 7,
  aprLabel = "Historical APR",
  className,
}: PnlSummaryRowProps) {
  const showApr = aprPct != null && holdingDays >= aprGateDays;

  return (
    <div className={className}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Total PnL</span>
        <div className="flex items-center gap-2">
          {showApr && (
            <Badge
              variant="outline"
              className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs font-normal px-2 py-0.5 h-5"
            >
              {aprLabel}: {formatNumber(aprPct, 2)}%
            </Badge>
          )}
          {isLoading ? (
            <span className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Calculating your performance…
            </span>
          ) : pnlUsd == null ? (
            <span className="text-sm font-semibold text-muted-foreground">—</span>
          ) : (
            <span
              className={`text-sm font-semibold ${
                pnlUsd >= 0 ? "text-green-600" : "text-destructive"
              }`}
            >
              <span className="inline-block w-3 text-left">
                {pnlUsd > 0 ? "+" : pnlUsd < 0 ? "-" : ""}
              </span>
              {formatCurrency(Math.abs(pnlUsd), 2)}
            </span>
          )}
        </div>
      </div>

      {!isLoading && holdingDays > 0 && holdingDays < aprGateDays && (
        <div className="text-xs text-muted-foreground mt-2">
          APR is shown after {aprGateDays} days of history.
        </div>
      )}
    </div>
  );
}

