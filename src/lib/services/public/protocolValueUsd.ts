import { computeJupiterTotalValue } from '@/components/protocols/jupiter/mapJupiterToProtocolPositions';
import { computeKaminoPositionsUsd } from '@/components/protocols/kamino/mapKaminoToProtocolPositions';
import { computeOrcaTotalUsd } from '@/components/protocols/orca/mapOrcaToProtocolPositions';
import { computeRaydiumTotalUsd } from '@/components/protocols/raydium/mapRaydiumToProtocolPositions';
import type { JupiterPosition } from '@/lib/query/hooks/protocols/jupiter/useJupiterPositions';
import type { KaminoUserPositionsRow } from '@/lib/query/hooks/protocols/kamino/useKaminoPositions';
import type { OrcaPosition } from '@/lib/query/hooks/protocols/orca/useOrcaPositions';
import type { RaydiumPosition } from '@/lib/query/hooks/protocols/raydium/useRaydiumPositions';
import { computeExponentTotalUsd } from '@/components/protocols/exponent/mapExponentToProtocolPositions';
import type { ExponentUserPositionRow } from '@/lib/services/exponent/types';

export type ProtocolValueResult = {
  valueUSD: number;
  /** False when USD could not be derived reliably for this protocol's positions. */
  valueUSDComplete: boolean;
};

function parseNum(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function sumRewardUsd(items: unknown): number {
  if (!Array.isArray(items)) return 0;
  return items.reduce<number>((sum, item) => {
    if (!item || typeof item !== 'object') return sum;
    return sum + parseNum((item as { amountUSD?: unknown }).amountUSD);
  }, 0);
}

export function extractUpstreamTotalUsd(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const obj = payload as Record<string, unknown>;
  for (const key of ['totalUsd', 'totalValueUsd', 'totalUSD', 'totalValueUSD']) {
    const n = parseNum(obj[key]);
    if (n > 0) return n;
  }
  return null;
}

function computeHyperionUsd(positions: unknown[]): number {
  return positions.reduce<number>((sum, position) => {
    if (!position || typeof position !== 'object') return sum;
    const row = position as Record<string, unknown>;
    let total = parseNum(row.value);
    total += sumRewardUsd((row.farm as { unclaimed?: unknown })?.unclaimed);
    total += sumRewardUsd((row.fees as { unclaimed?: unknown })?.unclaimed);
    return sum + total;
  }, 0);
}

function computeAaveUsd(positions: unknown[]): number {
  return positions.reduce<number>((sum, position) => {
    if (!position || typeof position !== 'object') return sum;
    const row = position as {
      deposit_value_usd?: unknown;
      borrow_value_usd?: unknown;
    };
    return sum + parseNum(row.deposit_value_usd) - parseNum(row.borrow_value_usd);
  }, 0);
}

function computeEchoUsd(positions: unknown[]): number {
  return positions.reduce<number>((sum, position) => {
    if (!position || typeof position !== 'object') return sum;
    const row = position as { type?: string; valueUSD?: unknown };
    const value = parseNum(row.valueUSD);
    return row.type === 'borrow' ? sum - value : sum + value;
  }, 0);
}

function computeMesoUsd(positions: unknown[]): number {
  return positions.reduce<number>((sum, position) => {
    if (!position || typeof position !== 'object') return sum;
    const row = position as { type?: string; usdValue?: unknown };
    const value = parseNum(row.usdValue);
    return row.type === 'debt' ? sum - value : sum + value;
  }, 0);
}

function computeThalaUsd(positions: unknown[]): number {
  return positions.reduce<number>((sum, position) => {
    if (!position || typeof position !== 'object') return sum;
    const row = position as { totalValueUSD?: unknown; positionValueUSD?: unknown };
    const total = parseNum(row.totalValueUSD);
    if (total > 0) return sum + total;
    return sum + parseNum(row.positionValueUSD);
  }, 0);
}

function computeTappUsd(positions: unknown[]): number {
  return positions.reduce<number>((sum, position) => {
    if (!position || typeof position !== 'object') return sum;
    const row = position as {
      estimatedWithdrawals?: Array<{ usd?: unknown }>;
      estimatedIncentives?: Array<{ usd?: unknown }>;
    };
    const withdrawals = Array.isArray(row.estimatedWithdrawals)
      ? row.estimatedWithdrawals.reduce<number>((s, token) => s + parseNum(token?.usd), 0)
      : 0;
    const incentives = Array.isArray(row.estimatedIncentives)
      ? row.estimatedIncentives.reduce<number>((s, token) => s + parseNum(token?.usd), 0)
      : 0;
    return sum + withdrawals + incentives;
  }, 0);
}

function computeMoarUsd(positions: unknown[]): number {
  return positions.reduce<number>((sum, position) => {
    if (!position || typeof position !== 'object') return sum;
    return sum + parseNum((position as { value?: unknown }).value);
  }, 0);
}

function computeAmnisUsd(positions: unknown[]): number {
  return positions.reduce<number>((sum, position) => {
    if (!position || typeof position !== 'object') return sum;
    return sum + parseNum((position as { usdValue?: unknown }).usdValue);
  }, 0);
}

function computeAptreeUsd(positions: unknown[]): number {
  return positions.reduce<number>((sum, position) => {
    if (!position || typeof position !== 'object') return sum;
    return sum + parseNum((position as { value?: unknown }).value);
  }, 0);
}

function computeGenericPositionUsd(positions: unknown[]): number {
  return positions.reduce<number>((sum, position) => {
    if (!position || typeof position !== 'object') return sum;
    const row = position as Record<string, unknown>;
    for (const key of [
      'valueUsd',
      'valueUSD',
      'totalValueUSD',
      'positionValueUSD',
      'usdValue',
      'netUsdAmount',
      'marketValueUsd',
    ]) {
      const n = parseNum(row[key]);
      if (n > 0) return sum + n;
    }
    const value = parseNum(row.value);
    if (value > 0) return sum + value;
    return sum;
  }, 0);
}

export function computeProtocolValueUsd(
  protocolKey: string,
  positions: unknown[],
  upstreamPayload?: unknown
): ProtocolValueResult {
  if (positions.length === 0) {
    return { valueUSD: 0, valueUSDComplete: true };
  }

  const upstreamTotal = extractUpstreamTotalUsd(upstreamPayload);
  if (upstreamTotal != null && upstreamTotal > 0) {
    return { valueUSD: upstreamTotal, valueUSDComplete: true };
  }

  switch (protocolKey) {
    case 'hyperion':
      return { valueUSD: computeHyperionUsd(positions), valueUSDComplete: true };
    case 'aave':
      return { valueUSD: computeAaveUsd(positions), valueUSDComplete: true };
    case 'echo':
      return { valueUSD: computeEchoUsd(positions), valueUSDComplete: true };
    case 'meso':
      return { valueUSD: computeMesoUsd(positions), valueUSDComplete: true };
    case 'thala':
      return { valueUSD: computeThalaUsd(positions), valueUSDComplete: true };
    case 'tapp':
      return { valueUSD: computeTappUsd(positions), valueUSDComplete: true };
    case 'moar':
      return { valueUSD: computeMoarUsd(positions), valueUSDComplete: true };
    case 'amnis':
      return { valueUSD: computeAmnisUsd(positions), valueUSDComplete: true };
    case 'aptree':
      return { valueUSD: computeAptreeUsd(positions), valueUSDComplete: true };
    case 'jupiter':
      return {
        valueUSD: computeJupiterTotalValue(positions as JupiterPosition[]),
        valueUSDComplete: true,
      };
    case 'kamino':
      return {
        valueUSD: computeKaminoPositionsUsd(positions as KaminoUserPositionsRow[]),
        valueUSDComplete: true,
      };
    case 'raydium':
      return {
        valueUSD: computeRaydiumTotalUsd(positions as RaydiumPosition[]),
        valueUSDComplete: true,
      };
    case 'orca':
      return {
        valueUSD: computeOrcaTotalUsd(positions as OrcaPosition[]),
        valueUSDComplete: true,
      };
    case 'exponent':
      return {
        valueUSD: computeExponentTotalUsd(positions as ExponentUserPositionRow[]),
        valueUSDComplete: true,
      };
    case 'echelon':
    case 'aries':
    case 'joule':
    case 'auro':
    case 'earnium':
    case 'decibel':
      return { valueUSD: 0, valueUSDComplete: false };
    default: {
      const generic = computeGenericPositionUsd(positions);
      return {
        valueUSD: generic,
        valueUSDComplete: generic > 0,
      };
    }
  }
}

/**
 * Deprecated protocols we intentionally do not price (hidden from the Sidebar too).
 * Their unpriced positions must not flip the headline completeness flag to false.
 */
export const DEPRECATED_PROTOCOLS = new Set(['aries', 'joule', 'auro', 'earnium']);

export function aggregateProtocolValues(
  protocols: Array<{ protocol: string; positionsCount: number; valueUSD: number; valueUSDComplete: boolean }>
): { totalDeFiValueUSD: number; totalDeFiValueUSDComplete: boolean } {
  const totalDeFiValueUSD = protocols.reduce((sum, p) => sum + (p.valueUSD || 0), 0);
  // Completeness reflects only the protocols we actively value. Deprecated
  // protocols are surfaced (with their own valueUSDComplete=false) but excluded
  // here so legacy dust never marks the whole response incomplete.
  const relevant = protocols.filter(
    (p) => p.positionsCount > 0 && !DEPRECATED_PROTOCOLS.has(p.protocol)
  );
  const totalDeFiValueUSDComplete =
    relevant.length === 0 || relevant.every((p) => p.valueUSDComplete);

  return { totalDeFiValueUSD, totalDeFiValueUSDComplete };
}
