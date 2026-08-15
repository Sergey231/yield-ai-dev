import { PositionBadge, type ProtocolPosition } from "@/shared/ProtocolCard/types";
import { formatNumber } from "@/lib/utils/numberFormat";
import type { ExponentUserPositionRow } from "@/lib/services/exponent/types";
import { resolveExponentTokenIcon } from "@/lib/services/exponent/resolveExponentTokenIcon";

export function computeExponentTotalUsd(rows: ExponentUserPositionRow[]): number {
  return rows.reduce((sum, row) => sum + (row.valueUsd ?? 0), 0);
}

function aprFromImpliedApy(impliedApy?: number): string | undefined {
  if (typeof impliedApy !== "number" || !Number.isFinite(impliedApy)) return undefined;
  const pct = impliedApy <= 1 ? impliedApy * 100 : impliedApy;
  return pct.toFixed(2);
}

export function mapExponentToProtocolPositions(
  rows: ExponentUserPositionRow[]
): ProtocolPosition[] {
  const out: ProtocolPosition[] = [];

  for (const row of rows) {
    if (row.source === "exponent-clmm") continue;

    const value = row.valueUsd ?? 0;
    const isPrincipalMarket =
      row.source === "exponent-pt" ||
      row.source === "exponent-yt" ||
      row.source === "exponent-yt-staked";

    const apr = isPrincipalMarket ? aprFromImpliedApy(row.impliedApy) : undefined;
    const { logoUrl, logoUrlFallback } = resolveExponentTokenIcon(row);

    out.push({
      id: `exponent-${row.source}-${row.mint ?? row.positionAddress ?? row.vaultAddress}`,
      label: row.symbol,
      value,
      logoUrl,
      logoUrlFallback,
      badge: PositionBadge.Active,
      apr,
      subLabel:
        row.amountUi > 0 && Number.isFinite(row.amountUi)
          ? formatNumber(row.amountUi, 4)
          : undefined,
    });
  }

  return out.sort((a, b) => b.value - a.value);
}
