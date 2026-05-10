"use client";

import { formatCurrency, formatNumber } from "@/lib/utils/numberFormat";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

export function AccountHealthSummary({
  accountHealth,
  collateral,
  liabilities,
  border = "top",
  compact = false,
  showHelp = false,
}: {
  accountHealth: number;
  collateral: number;
  liabilities: number;
  border?: "top" | "bottom" | "none";
  compact?: boolean;
  showHelp?: boolean;
}) {
  const getHealthFactorColor = (healthFactor: number) => {
    if (healthFactor >= 1.5) return "text-green-500";
    if (healthFactor >= 1.2) return "text-yellow-500";
    return "text-red-500";
  };

  const getHealthFactorStatus = (healthFactor: number) => {
    if (healthFactor >= 1.5) return "Safe";
    if (healthFactor >= 1.2) return "Risky";
    return "Danger";
  };

  const borderClass =
    border === "top"
      ? "border-t border-gray-200"
      : border === "bottom"
        ? "border-b border-gray-200"
        : "";
  const padClass = compact ? "pt-2 pb-2" : "pt-4 pb-6";

  return (
    <div className={`flex items-center justify-between ${borderClass} ${padClass}`}>
      <div className="flex flex-col">
        <span className="text-lg font-semibold">Account Health:</span>
        {showHelp ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="mt-0.5 inline-flex w-fit items-center gap-1 text-xs text-muted-foreground underline decoration-dotted"
                >
                  <Info className="h-3.5 w-3.5" />
                  <span>Account Health</span>
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Account Health is an estimate (higher is safer). Values below 1 are typically liquidatable.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
      </div>
      <div className="text-right">
        <div className="flex items-center gap-3">
          <div className="text-center">
            <div className={`text-2xl font-bold ${getHealthFactorColor(accountHealth)}`}>
              {formatNumber(accountHealth, 2)}
            </div>
            <div className={`text-sm font-medium ${getHealthFactorColor(accountHealth)}`}>
              {getHealthFactorStatus(accountHealth)}
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            <div>Collateral: {formatCurrency(collateral, 2)}</div>
            <div>Liabilities: {formatCurrency(liabilities, 2)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

