import type { ProtocolPosition } from "@/shared/ProtocolCard/types";
import { formatNumber } from "@/lib/utils/numberFormat";
import type { Token } from "@/lib/types/token";

function trimTrailingZeros(value: string): string {
  if (!value.includes(".")) return value;
  const trimmed = value.replace(/\.?0+$/, "");
  return trimmed === "" ? "0" : trimmed;
}

export function mapYieldAiSafeTokensToProtocolPositions(tokens: Token[]): ProtocolPosition[] {
  return tokens
    .map((t) => {
      const value = t.value ? parseFloat(t.value) : 0;
      const amount =
        parseFloat(t.amount ?? "0") / Math.pow(10, t.decimals ?? 8);
      const formattedAmount = trimTrailingZeros(formatNumber(amount, 4));
      const price = t.price ? parseFloat(t.price) : undefined;

      return {
        id: `safe-token-${t.address}`,
        label: t.symbol ?? "—",
        value: Number.isFinite(value) ? value : 0,
        logoUrl: t.logoUrl ?? undefined,
        subLabel: formattedAmount,
        price: price != null && Number.isFinite(price) ? price : undefined,
      } satisfies ProtocolPosition;
    })
    .sort((a, b) => b.value - a.value);
}

