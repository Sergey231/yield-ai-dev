import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";
import { normalizeAddress, toCanonicalAddress } from "@/lib/utils/addressNormalization";
import { readSafeHyperionPositions } from "@/lib/protocols/yield-ai/hyperionLp";
import {
  loadHyperionLpEventTotalsBySafe,
  netLpLegTotals,
  type HyperionLpPositionEventTotals,
} from "@/lib/protocols/yield-ai/hyperionLpEvents";
import { PanoraPricesService } from "@/lib/services/panora/prices";
import { APTOS_COIN_TYPE } from "@/lib/constants/yieldAiVault";

/** APT FA metadata address (rewards report APT via the 0xa paired metadata). */
const APT_FA_METADATA = "0x000000000000000000000000000000000000000000000000000000000000000a";

type PriceInfo = { usd: number; decimals: number; symbol: string };

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
/** Min elapsed before a realized per-position APR is meaningful (avoids huge early numbers). */
const APR_MIN_ELAPSED_SECONDS = 60 * 60;

function rawToUsd(raw: bigint, info?: PriceInfo): number {
  if (!info || raw <= 0n) return 0;
  return (Number(raw) / 10 ** info.decimals) * info.usd;
}

function basisUsdFromEvents(
  totals: HyperionLpPositionEventTotals,
  priceOf: (addr: string) => PriceInfo | undefined,
  tokenA: string,
  tokenB: string,
  closed: boolean
): number {
  if (closed) {
    return rawToUsd(totals.depositedA, priceOf(tokenA)) + rawToUsd(totals.depositedB, priceOf(tokenB));
  }
  const { netA, netB } = netLpLegTotals(totals);
  return rawToUsd(netA, priceOf(tokenA)) + rawToUsd(netB, priceOf(tokenB));
}

function claimedUsdFromVaultEvents(
  totals: HyperionLpPositionEventTotals,
  priceOf: (addr: string) => PriceInfo | undefined,
  tokenA: string,
  tokenB: string
): number {
  let usd = rawToUsd(totals.feesClaimedA, priceOf(tokenA)) + rawToUsd(totals.feesClaimedB, priceOf(tokenB));
  for (const [meta, amount] of totals.rewardsClaimed) {
    usd += rawToUsd(amount, priceOf(meta));
  }
  return usd;
}

function hasDeploymentEvents(totals: HyperionLpPositionEventTotals): boolean {
  return totals.depositedA > 0n || totals.depositedB > 0n;
}

/**
 * GET /api/protocols/yield-ai/hyperion-lp/positions?safe=0x...
 * Read-only: Hyperion LP positions tracked on a safe, with live composition,
 * active/inactive flag, and USD-priced value + uncollected fees/rewards. Realized APR
 * annualizes total earned (claimed + uncollected fees/rewards) vs the deposit basis
 * (falling back to current LP value when basis is not indexed).
 * PnL uses vault `HyperionLp*Event` totals (`used_a/b` basis, `got_a/b` on close) — not
 * `principal_usdc`. Prices from Panora. No secret required.
 */
export async function GET(request: NextRequest) {
  try {
    const safe = request.nextUrl.searchParams.get("safe")?.trim();
    if (!safe) {
      return NextResponse.json(createErrorResponse(new Error("safe query param is required")), { status: 400 });
    }

    const safeCanon = toCanonicalAddress(safe);
    const [positions, eventTotalsByPosition] = await Promise.all([
      readSafeHyperionPositions(safeCanon),
      loadHyperionLpEventTotalsBySafe(safeCanon).catch(() => new Map<string, HyperionLpPositionEventTotals>()),
    ]);

    // Collect every token that needs a price (legs + reward tokens).
    const addrs = new Set<string>([APTOS_COIN_TYPE]);
    for (const p of positions) {
      addrs.add(p.tokenA);
      addrs.add(p.tokenB);
      for (const r of p.pendingRewards ?? []) addrs.add(r.metadata);
      const ev = eventTotalsByPosition.get(toCanonicalAddress(p.position));
      if (ev) {
        for (const meta of ev.rewardsClaimed.keys()) addrs.add(meta);
      }
    }

    const byAddr = new Map<string, PriceInfo>();
    try {
      const pr = await PanoraPricesService.getInstance().getPrices(1, Array.from(addrs));
      const list: Array<Record<string, unknown>> = Array.isArray(pr)
        ? (pr as Array<Record<string, unknown>>)
        : ((pr as { data?: unknown })?.data as Array<Record<string, unknown>>) ?? [];
      for (const it of list) {
        const usd = parseFloat(String(it.usdPrice ?? "0")) || 0;
        const decimals = Number(it.decimals ?? 0) || 0;
        const symbol = typeof it.symbol === "string" ? it.symbol : "?";
        const info: PriceInfo = { usd, decimals, symbol };
        if (typeof it.faAddress === "string") byAddr.set(normalizeAddress(it.faAddress), info);
        if (typeof it.tokenAddress === "string") byAddr.set(normalizeAddress(it.tokenAddress), info);
      }
    } catch {
      // No prices → USD fields fall back to 0.
    }

    const priceOf = (addr: string): PriceInfo | undefined => {
      const direct = byAddr.get(normalizeAddress(addr));
      if (direct) return direct;
      if (normalizeAddress(addr) === normalizeAddress(APT_FA_METADATA)) {
        return byAddr.get(normalizeAddress(APTOS_COIN_TYPE));
      }
      return undefined;
    };

    const toHuman = (rawAmount: string | undefined, info?: PriceInfo): number => {
      if (!info || rawAmount == null) return 0;
      const n = Number(rawAmount);
      return Number.isFinite(n) ? n / 10 ** info.decimals : 0;
    };
    const toUsd = (rawAmount: string | undefined, info?: PriceInfo): number =>
      info ? toHuman(rawAmount, info) * info.usd : 0;

    const nowSec = Math.floor(Date.now() / 1000);

    const enriched = positions.map((p) => {
      const pa = priceOf(p.tokenA);
      const pb = priceOf(p.tokenB);
      const symbolA = pa?.symbol ?? "?";
      const symbolB = pb?.symbol ?? "?";
      const valueUsd = toUsd(p.amountA, pa) + toUsd(p.amountB, pb);
      const feesUsd = toUsd(p.pendingFeeA, pa) + toUsd(p.pendingFeeB, pb);

      const feesBreakdown: Array<{ symbol: string; amount: number }> = [];
      const feeAh = toHuman(p.pendingFeeA, pa);
      const feeBh = toHuman(p.pendingFeeB, pb);
      if (feeAh > 0) feesBreakdown.push({ symbol: symbolA, amount: feeAh });
      if (feeBh > 0) feesBreakdown.push({ symbol: symbolB, amount: feeBh });

      let rewardsUsd = 0;
      const rewardsBreakdown: Array<{ symbol: string; amount: number }> = [];
      for (const r of p.pendingRewards ?? []) {
        const info = priceOf(r.metadata);
        rewardsUsd += toUsd(r.amount, info);
        const amt = toHuman(r.amount, info);
        if (amt > 0) rewardsBreakdown.push({ symbol: info?.symbol ?? "reward", amount: amt });
      }

      const posKey = toCanonicalAddress(p.position);
      const evTotals = eventTotalsByPosition.get(posKey);
      const claimedUsd = evTotals ? claimedUsdFromVaultEvents(evTotals, priceOf, p.tokenA, p.tokenB) : 0;

      const openedAt = Number(p.openedAt);
      const elapsed = Number.isFinite(openedAt) && openedAt > 0 ? nowSec - openedAt : 0;
      const earnedUsd = feesUsd + rewardsUsd + claimedUsd;

      // Deposit basis (USD of net deployed legs from vault events) — the same
      // figure PnL uses. Computed before APR so APR can annualize the realized
      // yield on *deposited capital*, not on current LP value.
      let basisUsd: number | null = null;
      if (evTotals && hasDeploymentEvents(evTotals)) {
        basisUsd = basisUsdFromEvents(evTotals, priceOf, p.tokenA, p.tokenB, p.closed);
      }

      // APR = earned ÷ basis, annualized over the position's age. Falls back to
      // current LP value when the deposit basis isn't indexed, so the realized
      // APR badge still shows. Stables: basis ≈ value; volatile pairs diverge.
      const aprDenominator = basisUsd != null && basisUsd > 0 ? basisUsd : valueUsd;
      const aprPct =
        aprDenominator > 0 && elapsed >= APR_MIN_ELAPSED_SECONDS
          ? (earnedUsd / aprDenominator) * (SECONDS_PER_YEAR / elapsed) * 100
          : null;

      let pnlUsd: number | null = null;
      let pnlUnavailableReason: string | null = null;

      if (evTotals && basisUsd != null) {
        if (p.closed) {
          const exitUsd =
            rawToUsd(evTotals.removedA, pa) + rawToUsd(evTotals.removedB, pb);
          pnlUsd = exitUsd + claimedUsd - basisUsd;
        } else {
          pnlUsd = valueUsd + feesUsd + rewardsUsd + claimedUsd - basisUsd;
        }
      } else if (!p.closed) {
        pnlUnavailableReason = "No vault deployment events indexed for this position";
      }

      return {
        ...p,
        valueUsd,
        feesUsd,
        rewardsUsd,
        feesBreakdown,
        rewardsBreakdown,
        aprPct,
        claimedUsd,
        basisUsd,
        pnlUsd,
        pnlUnavailableReason,
      };
    });

    return NextResponse.json(createSuccessResponse({ positions: enriched }));
  } catch (err) {
    return NextResponse.json(createErrorResponse(err instanceof Error ? err : new Error(String(err))), {
      status: 500,
    });
  }
}
