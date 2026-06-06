import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";
import { normalizeAddress, toCanonicalAddress } from "@/lib/utils/addressNormalization";
import { readSafeHyperionPositions } from "@/lib/protocols/yield-ai/hyperionLp";
import { PanoraPricesService } from "@/lib/services/panora/prices";
import { APTOS_COIN_TYPE } from "@/lib/constants/yieldAiVault";

/** APT FA metadata address (rewards report APT via the 0xa paired metadata). */
const APT_FA_METADATA = "0x000000000000000000000000000000000000000000000000000000000000000a";

type PriceInfo = { usd: number; decimals: number; symbol: string };

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
/** Min elapsed before a realized per-position APR is meaningful (avoids huge early numbers). */
const APR_MIN_ELAPSED_SECONDS = 60 * 60;

/**
 * GET /api/protocols/yield-ai/hyperion-lp/positions?safe=0x...
 * Read-only: Hyperion LP positions tracked on a safe, with live composition,
 * active/inactive flag, and USD-priced value + uncollected fees/rewards. The
 * pending fees/rewards are read on-chain (the Hyperion indexer/SDK does not
 * track vault-owned positions); prices come from Panora. No secret required.
 */
export async function GET(request: NextRequest) {
  try {
    const safe = request.nextUrl.searchParams.get("safe")?.trim();
    if (!safe) {
      return NextResponse.json(createErrorResponse(new Error("safe query param is required")), { status: 400 });
    }

    const positions = await readSafeHyperionPositions(toCanonicalAddress(safe));

    // Collect every token that needs a price (legs + reward tokens).
    const addrs = new Set<string>([APTOS_COIN_TYPE]);
    for (const p of positions) {
      addrs.add(p.tokenA);
      addrs.add(p.tokenB);
      for (const r of p.pendingRewards ?? []) addrs.add(r.metadata);
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
      // APT may be priced under its coin type while rewards report the 0xa FA.
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

      // Per-token breakdowns (amount in token units) for the hover tooltips.
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

      // Realized per-position APR: annualized uncollected (fees+rewards) over the
      // value, since the position opened. Est. only — resets on claim; hidden for
      // brand-new positions where the number would be noise.
      const openedAt = Number(p.openedAt);
      const elapsed = Number.isFinite(openedAt) && openedAt > 0 ? nowSec - openedAt : 0;
      const aprPct =
        valueUsd > 0 && elapsed >= APR_MIN_ELAPSED_SECONDS
          ? ((feesUsd + rewardsUsd) / valueUsd) * (SECONDS_PER_YEAR / elapsed) * 100
          : null;

      return { ...p, valueUsd, feesUsd, rewardsUsd, feesBreakdown, rewardsBreakdown, aprPct };
    });

    return NextResponse.json(createSuccessResponse({ positions: enriched }));
  } catch (err) {
    return NextResponse.json(createErrorResponse(err instanceof Error ? err : new Error(String(err))), {
      status: 500,
    });
  }
}
