"use client";

import Image from "next/image";
import { ChevronDown, Wallet, Percent, HeartPulse, Gift } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/shared/Badge/Badge";
import { Button } from "@/components/ui/button";
import styles from "./LendingProtocolCard.module.css";

export type LendingPositionType = "supply" | "borrow";

export type LendingTileTone = "default" | "success" | "warning" | "danger";

export type LendingTileIcon = "wallet" | "percent" | "health" | "gift";

export interface LendingProtocolCardTile {
  id: string;
  title: string;
  /** Compact label on small screens when set (e.g. «Net Balance» → «Net»). */
  titleShort?: string;
  icon?: LendingTileIcon;
  tone?: LendingTileTone;
  value?: string | number;
  subRows?: Array<{ label: string; labelShort?: string; value?: string | number }>;
  action?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
  };
}

export interface LendingProtocolCardRow {
  id: string;
  symbol: string;
  tokenLogoUrl?: string;
  /** Value string/number already formatted by adapter. */
  value?: string | number;
  /** Human readable amount label (e.g. "0.0841"). Already formatted. */
  amountLabel?: string;
  /** Optional per-token price label (e.g. "$1500.90"). Already formatted. */
  priceLabel?: string;
  /** Optional APR label (e.g. "1.78%"). Already formatted. */
  aprLabel?: string;
  /** Borrow collateral leg (shown in Supplies with a Collateral badge). */
  isCollateral?: boolean;
  positionType: LendingPositionType;
  /** External manage link shown instead of Deposit/Withdraw (e.g. Exponent app). */
  manageLink?: {
    href: string;
    label?: string;
  };
}

export interface LendingProtocolCardSection<Row extends LendingProtocolCardRow> {
  id: "supply" | "borrow";
  /** Unique key when multiple sections share the same `id` (e.g. Positions + Strategy). */
  sectionKey?: string;
  title: string;
  /** Compact heading on narrow viewports (e.g. «Your Supplies» → «Supplies»). */
  titleShort?: string;
  meta?: Array<{ label: string; labelShort?: string; value?: string | number }>;
  rows: Row[];
  defaultOpen?: boolean;
}

export interface LendingProtocolCardProps<Row extends LendingProtocolCardRow> {
  title?: string;
  subtitle?: string;
  /** Header layout. Use `minimal` inside Manage Positions modal (to avoid duplicating modal header). */
  headerVariant?: "full" | "minimal";
  tiles?: LendingProtocolCardTile[];
  sections: Array<LendingProtocolCardSection<Row>>;
  /** Supply-only: show Deposit button when provided. */
  onDeposit?: (row: Row) => void;
  /** Supply-only: show Withdraw button when provided. */
  onWithdraw?: (row: Row) => void;
  /** Disable withdraw button (e.g. when tx pending). */
  withdrawDisabled?: boolean;
}

function iconForTile(icon: LendingTileIcon | undefined, className: string) {
  switch (icon) {
    case "wallet":
      return <Wallet className={className} aria-hidden />;
    case "percent":
      return <Percent className={className} aria-hidden />;
    case "health":
      return <HeartPulse className={className} aria-hidden />;
    case "gift":
      return <Gift className={className} aria-hidden />;
    default:
      return null;
  }
}

export function LendingProtocolCard<Row extends LendingProtocolCardRow>({
  title,
  subtitle,
  headerVariant = "full",
  tiles = [],
  sections,
  onDeposit,
  onWithdraw,
  withdrawDisabled,
}: LendingProtocolCardProps<Row>) {
  const showSupplyActions = Boolean(onDeposit || onWithdraw);

  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const s of sections) {
      const key = s.sectionKey ?? s.id;
      initial[key] = s.defaultOpen ?? true;
    }
    return initial;
  });

  const sectionsMemo = useMemo(() => sections, [sections]);

  return (
    <div className={styles.card}>
      {headerVariant === "full" ? (
        <div className={styles.header}>
          {title ? (
            <div className={styles.titleBlock}>
              <div className={styles.titleRow}>
                <span className={styles.title}>{title}</span>
              </div>
              {subtitle ? <div className={styles.subtitle}>{subtitle}</div> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={styles.body}>
        {tiles.length > 0 ? (
          <div className={styles.tilesGrid}>
            {tiles.map((t) => {
              const toneClass =
                t.tone === "success"
                  ? styles.tileValueSafe
                  : t.tone === "warning"
                    ? styles.tileValueRisky
                    : t.tone === "danger"
                      ? styles.tileValueDanger
                      : undefined;
              return (
                <div key={t.id} className={styles.tile}>
                  <div className={styles.tileHeader}>
                    <span
                      className={cn(
                        styles.tileTitle,
                        t.titleShort ? styles.tileTitleHasShort : null
                      )}
                    >
                      {t.icon ? (
                        <span className={styles.tileIconWrap}>{iconForTile(t.icon, styles.tileIcon)}</span>
                      ) : null}
                      <span className={styles.tileTitleTexts}>
                        <span className={styles.tileTitleFull}>{t.title}</span>
                        {t.titleShort ? (
                          <span className={styles.tileTitleShort}>{t.titleShort}</span>
                        ) : null}
                      </span>
                    </span>
                  </div>
                  {t.value != null ? (
                    <div className={[styles.tileValue, toneClass].filter(Boolean).join(" ")}>
                      {t.value}
                    </div>
                  ) : null}
                  {t.subRows && t.subRows.length > 0 ? (
                    <div className={styles.tileSubRows}>
                      {t.subRows.map((sr, idx) => (
                        <div key={`${t.id}-sub-${idx}`} className={styles.tileSubRow}>
                          <span
                            className={cn(
                              styles.tileSubLabel,
                              sr.labelShort ? styles.tileSubLabelHasShort : null
                            )}
                          >
                            <span className={styles.tileSubLabelFull}>{sr.label}</span>
                            {sr.labelShort ? (
                              <span className={styles.tileSubLabelShort}>{sr.labelShort}</span>
                            ) : null}
                          </span>
                          {sr.value != null ? (
                            <span className={styles.tileSubValue}>{sr.value}</span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {t.action ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className={styles.claimBtn}
                      onClick={t.action.onClick}
                      disabled={t.action.disabled}
                    >
                      {t.action.label}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {sectionsMemo.map((s) => {
          const sectionKey = s.sectionKey ?? s.id;
          const expanded = openSections[sectionKey] ?? true;
          const isCollapsed = !expanded;
          const isEmpty = s.rows.length === 0;
          return (
            <div key={sectionKey} className={styles.section}>
              <div
                className={styles.sectionHeader}
                onClick={() => setOpenSections((prev) => ({ ...prev, [sectionKey]: !expanded }))}
                role="button"
                tabIndex={0}
                onKeyDown={(e) =>
                  e.key === "Enter" &&
                  setOpenSections((prev) => ({ ...prev, [sectionKey]: !expanded }))
                }
              >
                <div className={styles.sectionHeaderMain}>
                  <div className={cn(styles.sectionTitle, s.titleShort && styles.sectionTitleHasShort)}>
                    <span className={styles.sectionTitleFull}>{s.title}</span>
                    {s.titleShort ? (
                      <span className={styles.sectionTitleShort}>{s.titleShort}</span>
                    ) : null}
                  </div>
                  {s.meta && s.meta.length > 0 ? (
                    <div className={styles.sectionMetaRow}>
                      {s.meta.map((m, idx) => (
                        <div key={`${s.id}-meta-${idx}`} className={styles.metaItem}>
                          <span
                            className={cn(
                              styles.metaLabel,
                              m.labelShort ? styles.metaLabelHasShort : null
                            )}
                          >
                            <span className={styles.metaLabelFull}>{m.label}</span>
                            {m.labelShort ? (
                              <span className={styles.metaLabelShort}>{m.labelShort}</span>
                            ) : null}
                          </span>
                          {m.value != null ? (
                            <span className={styles.metaValue}>{m.value}</span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <ChevronDown className={cn(styles.chevron, isCollapsed && styles.chevronCollapsed)} />
              </div>

              {expanded ? (
                <div className={styles.rows}>
                  {isEmpty ? (
                    <div className={styles.empty}>No positions.</div>
                  ) : (
                    <>
                      <div className={styles.tableHeader}>
                        <div className={styles.colAsset}>ASSET</div>
                        <div className={styles.colApr}>APR</div>
                        <div className={styles.colValue}>VALUE</div>
                        <div className={styles.colActions} aria-hidden />
                      </div>

                      {s.rows.map((row) => {
                        const aprText = row.aprLabel ?? null;
                        const showManageLink = Boolean(row.manageLink?.href);
                        const showActionsForRow =
                          s.id === "supply" &&
                          !row.isCollateral &&
                          (showSupplyActions || showManageLink);
                        const renderApr = () =>
                          aprText ? (
                            <Badge variant="success" className={styles.aprPill}>
                              {aprText}
                            </Badge>
                          ) : (
                            <span className={styles.aprEmpty}>—</span>
                          );

                        return (
                          <div key={row.id} className={styles.row}>
                            <div className={styles.tableRow}>
                              <div className={styles.colAsset}>
                                <div className={styles.assetCell}>
                                  {row.tokenLogoUrl ? (
                                    <Image
                                      src={row.tokenLogoUrl}
                                      alt=""
                                      width={36}
                                      height={36}
                                      className={styles.logoLg}
                                      unoptimized
                                    />
                                  ) : (
                                    <div className={styles.logoLg} aria-hidden />
                                  )}
                                  <div className={styles.assetMeta}>
                                    <div className={styles.assetTop}>
                                      <span className={styles.assetSymbol}>{row.symbol}</span>
                                      {row.isCollateral ? (
                                        <Badge variant="info" className={styles.roleBadge}>
                                          Collateral
                                        </Badge>
                                      ) : null}
                                      <div className={styles.aprInlineMobile}>{renderApr()}</div>
                                    </div>
                                    {row.priceLabel ? (
                                      <div className={styles.assetPrice}>{row.priceLabel}</div>
                                    ) : null}
                                  </div>
                                </div>
                              </div>

                              <div className={styles.colApr}>{renderApr()}</div>

                              <div className={styles.colValue}>
                                <div className={styles.valueCell}>
                                  {row.value != null ? (
                                    <div className={styles.valueUsd}>{row.value}</div>
                                  ) : null}
                                  {row.amountLabel ? (
                                    <div className={styles.valueAmount}>{row.amountLabel}</div>
                                  ) : null}
                                </div>
                              </div>

                              <div className={styles.colActions}>
                                {showActionsForRow && (
                                  <div className={styles.actionsCell}>
                                    {showManageLink ? (
                                      <Button size="sm" variant="outline" asChild>
                                        <a
                                          href={row.manageLink!.href}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                        >
                                          {row.manageLink!.label ?? "Manage"}
                                        </a>
                                      </Button>
                                    ) : (
                                      <>
                                        {onDeposit ? (
                                          <Button size="sm" onClick={() => onDeposit(row as Row)}>
                                            Deposit
                                          </Button>
                                        ) : null}
                                        {onWithdraw ? (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => onWithdraw(row as Row)}
                                            disabled={withdrawDisabled}
                                          >
                                            Withdraw
                                          </Button>
                                        ) : null}
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

