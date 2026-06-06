import type { ProtocolPosition } from "@/shared/ProtocolCard/types";
import { PositionBadge } from "@/shared/ProtocolCard/types";
import { normalizeAddress } from "@/lib/utils/addressNormalization";
import type { DeltaNeutralStateResponse } from "@/lib/protocols/yield-ai/deltaNeutralViews";

const DECIBEL_LOGO_URL = "/protocol_ico/decibel.png";

/**
 * Format Decibel market address → "BTC/USD". Falls back to truncated address
 * when the markets map doesn't have a name yet.
 */
function formatPair(perpMarket: string, marketNames: Record<string, string>): string {
  const name = marketNames[normalizeAddress(perpMarket)];
  if (!name) return `${perpMarket.slice(0, 8)}…`;
  return name.replace("-", "/");
}

function formatDuration(openedAtMs: number, nowMs: number): string {
  const diff = Math.max(0, nowMs - openedAtMs);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

interface MapDeltaNeutralOptions {
  /** Carries the spot leg current value computed from safeTokens (price × balance). */
  spotLegValueUsd: number;
  /** Spot token logo from safeTokens (BTC/APT). */
  spotLogoUrl?: string;
  /** Map of canonical perp market address → "BTC-USD" name. */
  marketNames: Record<string, string>;
  now?: number;
}

/**
 * Build a synthetic ProtocolPosition for an active delta-neutral position.
 * Returns [] when no record exists or the position is closed.
 */
export function mapDeltaNeutralToProtocolPosition(
  state: DeltaNeutralStateResponse | null | undefined,
  options: MapDeltaNeutralOptions
): ProtocolPosition[] {
  if (!state || !state.recordExists || !state.isOpen) return [];

  const pair = formatPair(state.perpMarket, options.marketNames);
  const notionalUsd = Number(state.usdcSwappedIn) / 1e6;
  const openedAtMs = Number(state.openedAt) * 1000;
  const now = options.now ?? Date.now();

  const subParts: string[] = [];
  if (Number.isFinite(notionalUsd) && notionalUsd > 0) {
    subParts.push(`Size $${notionalUsd.toFixed(2)}`);
  }
  if (Number.isFinite(openedAtMs) && openedAtMs > 0) {
    subParts.push(formatDuration(openedAtMs, now));
  }

  return [
    {
      id: `dn-${normalizeAddress(state.perpMarket)}-${normalizeAddress(state.spotAssetMetadata)}`,
      label: pair,
      value: options.spotLegValueUsd,
      logoUrl: DECIBEL_LOGO_URL,
      logoUrl2: options.spotLogoUrl,
      badge: PositionBadge.DeltaNeutral,
      subLabel: subParts.length > 0 ? subParts.join(" · ") : undefined,
    },
  ];
}
