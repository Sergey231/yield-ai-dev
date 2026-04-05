import { PositionBadge, type ProtocolPosition } from "@/shared/ProtocolCard/types";
import { formatNumber } from "@/lib/utils/numberFormat";
import { getPreferredJupiterTokenIcon } from "@/lib/services/solana/jupiterTokenIcons";
import type { JupiterPosition } from "@/lib/query/hooks/protocols/jupiter/useJupiterPositions";

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function computeJupiterTotalValue(positions: JupiterPosition[]): number {
  return positions.reduce((sum, p) => {
    const decimals = toNumber(p?.token?.asset?.decimals, 0);
    const rawAmount = toNumber(p?.underlyingAssets, 0);
    const amount = decimals > 0 ? rawAmount / Math.pow(10, decimals) : 0;
    const price = toNumber(p?.token?.asset?.price, 0);
    return sum + amount * price;
  }, 0);
}

export function mapJupiterToProtocolPositions(
  positions: JupiterPosition[]
): ProtocolPosition[] {
  return positions.map((position, idx) => {
    const symbol =
      position?.token?.asset?.uiSymbol ||
      position?.token?.asset?.symbol ||
      "Unknown";
    const decimals = toNumber(position?.token?.asset?.decimals, 0);
    const rawAmount = toNumber(position?.underlyingAssets, 0);
    const amount = decimals > 0 ? rawAmount / Math.pow(10, decimals) : 0;
    const price = toNumber(position?.token?.asset?.price, 0);
    const value = amount * price;
    return {
      id: `jupiter-${idx}`,
      label: symbol,
      value,
      logoUrl: getPreferredJupiterTokenIcon(symbol, position?.token?.asset?.logoUrl),
      badge: PositionBadge.Supply,
      subLabel: formatNumber(amount, 4),
      price,
    };
  });
}

