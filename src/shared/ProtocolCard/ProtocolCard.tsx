"use client";

import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import Image from "next/image";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCollapsible } from "@/contexts/CollapsibleContext";
import { usePortfolioAmountsPrivacy } from "@/contexts/PortfolioAmountsPrivacyContext";
import { ManagePositionsButton } from "@/components/protocols/ManagePositionsButton";
import { ProtocolClosureNotice } from "@/components/ui/protocol-closure-notice";
import { ProtocolCardSkeleton } from "./ProtocolCardSkeleton/ProtocolCardSkeleton";
import { ProtocolCardPosition } from "./ProtocolCardPosition/ProtocolCardPosition";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Protocol } from "@/lib/protocols/getProtocolsList";
import type { ProtocolPosition, ProtocolPositionGroup } from "./types";
import styles from "./ProtocolCard.module.css";

export interface ProtocolCardProps {
  protocol: Protocol;
  totalValue: number;
  totalRewardsUsd?: string;
  /** Override the "💰 Total rewards:" row label (e.g. "💰 Total fees:" for DLMM protocols). */
  rewardsLabel?: string;
  /** Optional tooltip body (e.g. per-token breakdown), shown when hovering the rewards row. */
  rewardsBreakdown?: ReactNode;
  /** Optional extra block inside expanded content (below positions). */
  extraContent?: ReactNode;
  /** Optional block rendered below rewards row and above Manage Positions. */
  belowRewardsContent?: ReactNode;
  /**
   * Match Echelon sidebar: border-top, text-sm label/value, rewards row after positions.
   * When false, uses compact ProtocolCard styles.
   */
  rewardsEchelonStyle?: boolean;
  positions?: ProtocolPosition[];
  /**
   * Optional grouping (e.g. one group per AI agent safe). When non-empty,
   * groups are rendered instead of the flat `positions` list.
   */
  groups?: ProtocolPositionGroup[];
  isLoading?: boolean;
  className?: string;
  /** When false, hides the "Manage positions" button (e.g. on portfolio grid). Default true. */
  showManageButton?: boolean;
  /** Override section key used by `useCollapsible`. Default: protocol.key. */
  sectionKey?: string;
  /** Optional dim suffix shown after the protocol name (e.g. strategy label or safe slice). */
  titleSuffix?: string;
}

export function ProtocolCard({
  protocol,
  totalValue,
  totalRewardsUsd,
  rewardsLabel = "💰 Total rewards:",
  rewardsBreakdown,
  extraContent,
  belowRewardsContent,
  rewardsEchelonStyle = false,
  positions = [],
  groups,
  isLoading = false,
  className,
  showManageButton = true,
  sectionKey: sectionKeyProp,
  titleSuffix,
}: ProtocolCardProps) {
  const { formatUsd, maskUsd } = usePortfolioAmountsPrivacy();
  const { isExpanded, toggleSection } = useCollapsible();
  const sectionKey = sectionKeyProp ?? protocol.key;
  const expanded = isExpanded(sectionKey);
  const logoUrl = protocol.logoUrl;

  if (isLoading) {
    return <ProtocolCardSkeleton protocol={protocol} />;
  }

  return (
    <div className={cn(styles.card, className)}>
      <div
        className={styles.header}
        onClick={() => toggleSection(sectionKey)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && toggleSection(sectionKey)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {logoUrl ? <Image src={logoUrl} alt="" width={20} height={20} className={styles.logo} unoptimized /> : null}
          <span className={styles.title}>{protocol.name}</span>
          {titleSuffix ? (
            <span className="text-xs text-muted-foreground truncate">· {titleSuffix}</span>
          ) : null}
          <ProtocolClosureNotice protocolKey={protocol.key} stopPropagation className="-ml-1" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span className={styles.headerValue}>{formatUsd(totalValue, 2)}</span>
          <ChevronDown
            className={cn(styles.chevron, !expanded && styles.chevronCollapsed)}
            size={20}
          />
        </div>
      </div>

      {expanded && (
        <div className={styles.content}>
          {groups && groups.length > 0
            ? groups.map((group) => (
                <div key={group.key}>
                  <div
                    className={cn(
                      "flex items-center justify-between gap-2 mt-1 border-t border-border pt-2",
                      group.onClick &&
                        "cursor-pointer -mx-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/40 active:bg-muted/55"
                    )}
                    {...(group.onClick
                      ? {
                          onClick: (e: MouseEvent) => {
                            e.stopPropagation();
                            group.onClick?.();
                          },
                          role: "button",
                          tabIndex: 0,
                          onKeyDown: (e: KeyboardEvent) => {
                            if (e.key === "Enter") {
                              e.stopPropagation();
                              group.onClick?.();
                            }
                          },
                        }
                      : {})}
                  >
                    <span className="text-xs font-medium text-muted-foreground truncate">
                      {group.title}
                      {group.subtitle && (
                        <span className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground/70">
                          {group.subtitle}
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatUsd(group.subtotal, 2)}
                    </span>
                  </div>
                  {group.positions.map((pos, i) => (
                    <ProtocolCardPosition key={pos.id ?? i} position={pos} />
                  ))}
                  {group.dust && group.dust.count > 0 && (
                    <div className="flex items-center justify-between py-1 text-xs text-muted-foreground/70">
                      <span>
                        Other · {group.dust.count} {group.dust.count === 1 ? "token" : "tokens"}
                      </span>
                      <span>{formatUsd(group.dust.valueUsd, 2)}</span>
                    </div>
                  )}
                </div>
              ))
            : positions.length > 0 &&
              positions.map((pos, i) => (
                <ProtocolCardPosition key={pos.id ?? i} position={pos} />
              ))}
          {extraContent}
          {totalRewardsUsd &&
            (rewardsBreakdown ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      className={cn(
                        rewardsEchelonStyle
                          ? "flex items-center justify-between pt-2 border-t border-gray-200 cursor-help"
                          : styles.totalRewardsRow,
                        !rewardsEchelonStyle && "cursor-help"
                      )}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <span
                        className={rewardsEchelonStyle ? "text-sm text-muted-foreground" : styles.totalRewardsLabel}
                      >
                        {rewardsLabel}
                      </span>
                      <span
                        className={rewardsEchelonStyle ? "text-sm font-medium" : styles.totalRewardsValue}
                      >
                        {maskUsd(totalRewardsUsd)}
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent
                    className="bg-popover text-popover-foreground border-border max-w-xs"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {rewardsBreakdown}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <div
                className={cn(
                  rewardsEchelonStyle
                    ? "flex items-center justify-between pt-2 border-t border-gray-200"
                    : styles.totalRewardsRow
                )}
              >
                <span
                  className={rewardsEchelonStyle ? "text-sm text-muted-foreground" : styles.totalRewardsLabel}
                >
                  {rewardsLabel}
                </span>
                <span className={rewardsEchelonStyle ? "text-sm font-medium" : styles.totalRewardsValue}>
                  {maskUsd(totalRewardsUsd)}
                </span>
              </div>
            ))}
          {belowRewardsContent}
          {showManageButton && <ManagePositionsButton protocol={protocol} />}
        </div>
      )}
    </div>
  );
}
