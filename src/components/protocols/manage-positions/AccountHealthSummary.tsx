import { formatCurrency, formatNumber } from "@/lib/utils/numberFormat";

export function AccountHealthSummary({
  accountHealth,
  collateral,
  liabilities,
}: {
  accountHealth: number;
  collateral: number;
  liabilities: number;
}) {
  const getHealthFactorColor = (healthFactor: number) => {
    if (healthFactor >= 1.5) return "text-green-500";
    if (healthFactor >= 1.2) return "text-yellow-500";
    return "text-red-500";
  };

  const getHealthFactorStatus = (healthFactor: number) => {
    if (healthFactor >= 1.5) return "Safe";
    if (healthFactor >= 1.2) return "";
    return "Danger";
  };

  return (
    <div className="flex items-center justify-between border-t border-gray-200 pt-4 pb-6">
      <span className="text-lg font-semibold">Account Health:</span>
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

