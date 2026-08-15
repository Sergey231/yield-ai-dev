"use client";

import { useEffect, useMemo } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatNumber } from "@/lib/utils/numberFormat";
import { queryKeys } from "@/lib/query/queryKeys";
import { useSolanaPortfolio } from "@/hooks/useSolanaPortfolio";
import { useExponentPositions } from "@/lib/query/hooks/protocols/exponent/useExponentPositions";
import type { ExponentUserPositionRow } from "@/lib/services/exponent/types";
import { computeExponentTotalUsd } from "@/components/protocols/exponent/mapExponentToProtocolPositions";
import { resolveExponentTokenIcon } from "@/lib/services/exponent/resolveExponentTokenIcon";
import {
  buildExponentManageUrl,
  EXPONENT_APP_ORIGIN,
} from "@/lib/services/exponent/buildExponentManageUrl";
import {
  LendingProtocolCard,
  type LendingProtocolCardRow,
  type LendingProtocolCardSection,
  type LendingProtocolCardTile,
} from "@/shared/ProtocolCard";

const MANAGE_LABEL = "Manage on Exponent";

function formatMaturity(unixTs?: number): string | null {
  if (typeof unixTs !== "number" || !Number.isFinite(unixTs) || unixTs <= 0) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(unixTs * 1000));
  } catch {
    return null;
  }
}

function aprLabel(impliedApy?: number): string | undefined {
  if (typeof impliedApy !== "number" || !Number.isFinite(impliedApy)) return undefined;
  const pct = impliedApy <= 1 ? impliedApy * 100 : impliedApy;
  return `${formatNumber(pct, 2)}%`;
}

function sumSectionUsd(rows: ExponentUserPositionRow[]): number {
  return rows.reduce((sum, row) => sum + (row.valueUsd ?? 0), 0);
}

function rowToLendingCard(row: ExponentUserPositionRow, index: number): LendingProtocolCardRow {
  const valueUsd = row.valueUsd ?? 0;
  const { logoUrl } = resolveExponentTokenIcon(row);
  const maturity =
    row.source === "exponent-pt" ? formatMaturity(row.maturityDateUnixTs) : null;

  let priceLabel: string | undefined;
  if (maturity) {
    priceLabel = `Matures ${maturity} UTC`;
  } else if (row.source === "exponent-strategy-vault" && typeof row.lpPrice === "number") {
    priceLabel = `LP price ${formatNumber(row.lpPrice, 4)}`;
  } else if (row.platform) {
    priceLabel = row.platform;
  }

  const manageHref = buildExponentManageUrl(row);

  return {
    id: `exponent-${row.source}-${row.mint ?? row.positionAddress ?? row.vaultAddress ?? index}`,
    symbol: row.symbol,
    tokenLogoUrl: logoUrl,
    value: valueUsd > 0 ? formatCurrency(valueUsd, 2) : "—",
    amountLabel:
      row.amountUi > 0 && Number.isFinite(row.amountUi)
        ? formatNumber(row.amountUi, 4)
        : undefined,
    priceLabel,
    aprLabel: aprLabel(row.impliedApy),
    positionType: "supply",
    manageLink: manageHref ? { href: manageHref, label: MANAGE_LABEL } : undefined,
  };
}

type ExponentSectionDraft = {
  sectionKey: string;
  title: string;
  titleShort: string;
  rows: ExponentUserPositionRow[];
  meta?: Array<{ label: string; labelShort?: string; value?: string | number }>;
};

export function ExponentPositions() {
  const { protocolsAddress } = useSolanaPortfolio();
  const ownerAddress = (protocolsAddress ?? "").trim();
  const queryClient = useQueryClient();

  const { data: positions = [], isLoading, isError } = useExponentPositions(ownerAddress, {
    refetchOnMount: "always",
  });

  useEffect(() => {
    if (!ownerAddress) return;
    const handler: EventListener = (evt) => {
      const event = evt as CustomEvent<{ protocol?: string }>;
      if (event?.detail?.protocol !== "exponent") return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.exponent.userPositions(ownerAddress),
      });
    };
    window.addEventListener("refreshPositions", handler);
    return () => window.removeEventListener("refreshPositions", handler);
  }, [ownerAddress, queryClient]);

  const principalRows = useMemo(
    () =>
      positions
        .filter(
          (row) =>
            row.source === "exponent-pt" ||
            row.source === "exponent-yt" ||
            row.source === "exponent-yt-staked"
        )
        .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0)),
    [positions]
  );

  const vaultRows = useMemo(
    () =>
      positions
        .filter((row) => row.source === "exponent-strategy-vault")
        .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0)),
    [positions]
  );

  const clmmRows = useMemo(
    () =>
      positions
        .filter((row) => row.source === "exponent-clmm")
        .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0)),
    [positions]
  );

  const totalUsd = useMemo(() => computeExponentTotalUsd(positions), [positions]);

  const { tiles, sections } = useMemo(() => {
    const tilesLocal: LendingProtocolCardTile[] = [
      {
        id: "total-assets",
        title: "Total Assets",
        titleShort: "Assets",
        icon: "wallet",
        value: formatCurrency(totalUsd, 2),
      },
    ];

    const sectionDrafts: ExponentSectionDraft[] = [];

    if (principalRows.length > 0) {
      sectionDrafts.push({
        sectionKey: "positions",
        title: `Positions (${principalRows.length})`,
        titleShort: `Positions (${principalRows.length})`,
        rows: principalRows,
      });
    }

    if (vaultRows.length > 0) {
      sectionDrafts.push({
        sectionKey: "strategy",
        title: `Strategy (${vaultRows.length})`,
        titleShort: `Strategy (${vaultRows.length})`,
        rows: vaultRows,
      });
    }

    if (clmmRows.length > 0) {
      sectionDrafts.push({
        sectionKey: "clmm",
        title: `CLMM LP (${clmmRows.length})`,
        titleShort: `CLMM (${clmmRows.length})`,
        meta: [{ label: "USD pricing not available in this release." }],
        rows: clmmRows,
      });
    }

    sectionDrafts.sort((a, b) => sumSectionUsd(b.rows) - sumSectionUsd(a.rows));

    const sectionsLocal: Array<LendingProtocolCardSection<LendingProtocolCardRow>> =
      sectionDrafts.map((draft) => ({
        id: "supply",
        sectionKey: draft.sectionKey,
        title: draft.title,
        titleShort: draft.titleShort,
        meta: draft.meta,
        rows: draft.rows.map(rowToLendingCard),
        defaultOpen: true,
      }));

    return { tiles: tilesLocal, sections: sectionsLocal };
  }, [clmmRows, principalRows, totalUsd, vaultRows]);

  if (!ownerAddress) {
    return (
      <p className="text-sm text-muted-foreground">
        Connect a Solana wallet to view Exponent positions.
      </p>
    );
  }

  if (isLoading && positions.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Exponent positions…
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-destructive">
        Failed to load Exponent positions. Try refreshing.
      </p>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">No Exponent positions found for this wallet.</p>
        <Button variant="outline" size="sm" asChild>
          <a href={EXPONENT_APP_ORIGIN} target="_blank" rel="noopener noreferrer">
            Open Exponent
            <ExternalLink className="ml-2 h-4 w-4" />
          </a>
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 max-w-full space-y-4 text-base">
      {isLoading && positions.length > 0 ? (
        <div className="text-muted-foreground text-sm">Refreshing Exponent positions…</div>
      ) : null}

      <LendingProtocolCard headerVariant="minimal" tiles={tiles} sections={sections} />

      <div className="flex items-center justify-between pt-6 pb-2">
        <span className="text-xl">Total assets in Exponent:</span>
        <span className="text-xl text-primary font-bold">{formatCurrency(totalUsd, 2)}</span>
      </div>

      <p className="text-xs text-muted-foreground pb-4">
        Deposits and withdrawals are managed on Exponent. Use &quot;{MANAGE_LABEL}&quot; on each row to open the matching market or strategy.
      </p>
    </div>
  );
}
