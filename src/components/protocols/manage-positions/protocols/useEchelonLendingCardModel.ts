"use client";

import { useMemo } from "react";
import { usePortfolioAmountsPrivacy } from "@/contexts/PortfolioAmountsPrivacyContext";
import { formatNumber, formatCurrency } from "@/lib/utils/numberFormat";
import type { EchelonPosition } from "@/lib/query/hooks/protocols/echelon/useEchelonPositions";
import type {
  LendingProtocolCardRow,
  LendingProtocolCardSection,
  LendingProtocolCardTile,
  LendingTileTone,
} from "@/shared/ProtocolCard";

export interface EchelonLendingRow extends LendingProtocolCardRow {
  _position: EchelonPosition;
  _valueUsd: number;
}

function parseAprPct(aprLabel?: string): number | null {
  if (!aprLabel) return null;
  const n = Number.parseFloat(aprLabel.trim().replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

function weightedAprPct(rows: Array<{ valueUsd: number; aprLabel?: string }>): number | null {
  let wsum = 0;
  let vsum = 0;
  for (const r of rows) {
    const apr = parseAprPct(r.aprLabel);
    const v = Number.isFinite(r.valueUsd) ? r.valueUsd : 0;
    if (apr == null || v <= 0) continue;
    wsum += v * apr;
    vsum += v;
  }
  if (vsum <= 0) return null;
  return wsum / vsum;
}

function computeNetApyPct(
  supplyUsd: number,
  supplyAprPct: number | null,
  borrowUsd: number,
  borrowAprPct: number | null,
  netUsd: number
): number | null {
  if (!Number.isFinite(netUsd) || netUsd <= 0) return null;
  const sApr = supplyAprPct ?? 0;
  const bApr = borrowAprPct ?? 0;
  const yearlyNet = supplyUsd * (sApr / 100) - borrowUsd * (bApr / 100);
  const pct = (yearlyNet / netUsd) * 100;
  return Number.isFinite(pct) ? pct : null;
}

function toneForHealthFactor(hf: number): LendingTileTone {
  if (hf >= 1.5) return "success";
  if (hf >= 1.2) return "warning";
  return "danger";
}

export interface HealthFactorResult {
  healthFactor: number;
  accountMargin: number;
  totalLiabilities: number;
}

export interface UseEchelonLendingCardModelParams {
  sortedPositions: EchelonPosition[];
  getTokenInfo: (coinAddress: string) =>
    | {
        address?: string;
        symbol: string;
        logoUrl?: string;
        decimals: number;
        usdPrice?: string;
      }
    | undefined;
  getTokenPrice: (coinAddress: string) => string;
  getApyForPosition: (position: EchelonPosition) => number | null;
  calculateHealthFactor: () => HealthFactorResult | null;
  calculateRewardsValue: () => number;
  rewardsDataLength: number;
  isClaiming: boolean;
  onOpenClaimModal: () => void;
}

export function useEchelonLendingCardModel({
  sortedPositions,
  getTokenInfo,
  getTokenPrice,
  getApyForPosition,
  calculateHealthFactor,
  calculateRewardsValue,
  rewardsDataLength,
  isClaiming,
  onOpenClaimModal,
}: UseEchelonLendingCardModelParams) {
  const { formatUsd, maskUsd } = usePortfolioAmountsPrivacy();

  const { supplyRows, borrowRows, supplyTotalUsd, borrowTotalUsd, netUsd } = useMemo(() => {
    const supply: EchelonLendingRow[] = [];
    const borrow: EchelonLendingRow[] = [];

    for (let index = 0; index < sortedPositions.length; index++) {
      const position = sortedPositions[index]!;
      const tokenInfo = getTokenInfo(position.coin);
      const rawAmount =
        typeof position.amount === "number"
          ? position.amount
          : parseFloat(String(position.amount ?? 0));
      const amount =
        !Number.isNaN(rawAmount) && tokenInfo?.decimals ? rawAmount / 10 ** tokenInfo.decimals : 0;
      const priceStr = getTokenPrice(position.coin);
      const price = priceStr && priceStr !== "0" ? parseFloat(priceStr) : 0;
      const valueUsd = price ? amount * price : 0;

      const apy = getApyForPosition(position);
      const aprLabel = apy != null ? `${formatNumber(apy * 100, 2)}%` : undefined;

      const row: EchelonLendingRow = {
        id: `${position.coin}-${position.type ?? "position"}-${index}`,
        symbol: tokenInfo?.symbol || position.coin.substring(0, 4).toUpperCase(),
        tokenLogoUrl: tokenInfo?.logoUrl || undefined,
        value: maskUsd(formatUsd(valueUsd, 2)),
        amountLabel: formatNumber(amount, 4),
        priceLabel: price ? formatCurrency(price, 4) : undefined,
        aprLabel,
        positionType: position.type === "borrow" ? "borrow" : "supply",
        _position: position,
        _valueUsd: valueUsd,
      };

      if (row.positionType === "borrow") {
        borrow.push(row);
      } else {
        supply.push(row);
      }
    }

    const supplyTotal = supply.reduce((sum, r) => sum + (Number.isFinite(r._valueUsd) ? r._valueUsd : 0), 0);
    const borrowTotal = borrow.reduce((sum, r) => sum + (Number.isFinite(r._valueUsd) ? r._valueUsd : 0), 0);
    return {
      supplyRows: supply,
      borrowRows: borrow,
      supplyTotalUsd: supplyTotal,
      borrowTotalUsd: borrowTotal,
      netUsd: supplyTotal - borrowTotal,
    };
  }, [sortedPositions, getTokenInfo, getTokenPrice, getApyForPosition, formatUsd, maskUsd]);

  const healthTile = useMemo(() => {
    const health = calculateHealthFactor();
    if (!health) return null;
    return {
      healthFactor: health.healthFactor,
      collateralUsd: health.accountMargin,
      liabilitiesUsd: health.totalLiabilities,
    };
  }, [calculateHealthFactor]);

  const supplyApr = useMemo(
    () => weightedAprPct(supplyRows.map((r) => ({ valueUsd: r._valueUsd, aprLabel: r.aprLabel }))),
    [supplyRows]
  );
  const borrowApr = useMemo(
    () => weightedAprPct(borrowRows.map((r) => ({ valueUsd: r._valueUsd, aprLabel: r.aprLabel }))),
    [borrowRows]
  );
  const netApy = useMemo(
    () => computeNetApyPct(supplyTotalUsd, supplyApr, borrowTotalUsd, borrowApr, netUsd),
    [supplyTotalUsd, supplyApr, borrowTotalUsd, borrowApr, netUsd]
  );

  const tiles: LendingProtocolCardTile[] = useMemo(() => {
    const out: LendingProtocolCardTile[] = [];
    out.push({
      id: "net-balance",
      title: "Net Balance",
      titleShort: "Net",
      icon: "wallet",
      value: maskUsd(formatUsd(netUsd, 2)),
    });
    out.push({
      id: "net-apy",
      title: "Net APY",
      titleShort: "Yield",
      icon: "percent",
      value: netApy != null ? `${netApy.toFixed(2)}%` : "—",
    });
    if (healthTile && Number.isFinite(healthTile.healthFactor)) {
      out.push({
        id: "health",
        title: "Health Factor",
        titleShort: "Health",
        icon: "health",
        tone: toneForHealthFactor(healthTile.healthFactor),
        value: healthTile.healthFactor.toFixed(2),
        subRows: [
          {
            label: "Collateral:",
            labelShort: "Coll.",
            value: maskUsd(formatUsd(healthTile.collateralUsd, 2)),
          },
          {
            label: "Liabilities:",
            labelShort: "Debt",
            value: maskUsd(formatUsd(healthTile.liabilitiesUsd, 2)),
          },
        ],
      });
    }
    const rewardsUsd = calculateRewardsValue();
    out.push({
      id: "rewards",
      title: "Rewards",
      icon: "gift",
      value:
        rewardsUsd > 0
          ? rewardsUsd < 0.01
            ? "<$0.01"
            : maskUsd(formatUsd(rewardsUsd, 2))
          : "$0.00",
      action:
        rewardsDataLength > 0
          ? { label: "Claim", onClick: onOpenClaimModal, disabled: isClaiming }
          : undefined,
    });
    return out;
  }, [
    netUsd,
    netApy,
    healthTile,
    calculateRewardsValue,
    rewardsDataLength,
    isClaiming,
    onOpenClaimModal,
    formatUsd,
    maskUsd,
  ]);

  const sections: Array<LendingProtocolCardSection<EchelonLendingRow>> = useMemo(() => {
    const borrowingPower = healthTile?.collateralUsd;
    const usedPct =
      healthTile && healthTile.collateralUsd > 0
        ? (healthTile.liabilitiesUsd / healthTile.collateralUsd) * 100
        : null;
    const supplyCount = supplyRows.length;
    const borrowCount = borrowRows.length;
    return [
      {
        id: "supply",
        title: `Your Supplies (${supplyCount})`,
        titleShort: `Supplies (${supplyCount})`,
        meta: [
          { label: "Balance", labelShort: "Bal.", value: maskUsd(formatUsd(supplyTotalUsd, 2)) },
          {
            label: "APR",
            value: supplyApr != null ? `${supplyApr.toFixed(2)}%` : "—",
          },
        ],
        rows: supplyRows,
        defaultOpen: true,
      },
      {
        id: "borrow",
        title: `Your Borrows (${borrowCount})`,
        titleShort: `Borrows (${borrowCount})`,
        meta: [
          { label: "Liability", labelShort: "Debt", value: maskUsd(formatUsd(borrowTotalUsd, 2)) },
          {
            label: "APR",
            value: borrowApr != null ? `${borrowApr.toFixed(2)}%` : "—",
          },
          ...(borrowingPower != null && borrowingPower > 0
            ? [
                {
                  label: "Borrowing power",
                  labelShort: "Power",
                  value:
                    maskUsd(formatUsd(borrowingPower, 2)) +
                    (usedPct != null && Number.isFinite(usedPct)
                      ? ` (${usedPct.toFixed(1)}% used)`
                      : ""),
                },
              ]
            : []),
        ],
        rows: borrowRows,
        defaultOpen: true,
      },
    ];
  }, [
    supplyRows,
    borrowRows,
    supplyTotalUsd,
    borrowTotalUsd,
    supplyApr,
    borrowApr,
    healthTile,
    formatUsd,
    maskUsd,
  ]);

  return {
    supplyRows,
    borrowRows,
    tiles,
    sections,
  };
}
