import {
  fetchDecibel,
  fetchDecibelMarkPx,
  normalizeDecibelMarketsPayload,
  resolveDecibelMarketByName,
  resolveMarketForBtcOrApt,
} from "@/lib/protocols/decibel/decibelApi";
import {
  computeAptosHyperionOpenSpread,
  DN_HOLD_FUNDING_SIGNAL_DAYS,
  estimatedExitDragUsd,
  estimatedDaysToBreakEven,
  fundingUsdForHoldDays,
  netEntryEdgeBpsFromJupiterQuote,
  netExitEdgeBpsFromJupiterSellQuote,
  netHoldAfterExitUsd,
  spreadBpsFromPrices,
  spreadPctFromBps,
  severityForSpread,
  type DnSpreadSeverity,
} from "@/lib/protocols/decibel/deltaNeutralSpread";
import {
  effectiveUsdPriceFromJupiterQuote,
  effectiveUsdPriceFromJupiterSellQuote,
  fetchJupiterDnQuote,
  fetchJupiterDnSellQuote,
  mapWithJupiterQuoteRateLimit,
} from "@/lib/protocols/decibel/jupiterDnQuote";
import {
  DN_SPREAD_MONITOR_APTOS_ASSETS,
  DN_SPREAD_MONITOR_NOTIONAL_USD,
  DN_SPREAD_MONITOR_SOLANA,
  DN_SPREAD_MONITOR_SOLANA_EXIT,
} from "@/lib/protocols/decibel/dnSpreadMonitorWatchlist";
import { fetchServerFundingApr, shortEarnsFunding } from "@/lib/protocols/decibel/fundingServer";

export const DN_SPREAD_MONITOR_LOCK_KEY = "__dnSpreadMonitorCronRunning";

/** Log/signal rows where funding is projected to offset entry drag within this many days. */
export const DN_BREAK_EVEN_SIGNAL_MAX_DAYS = 3;

function breakEvenDaysForRow(
  netEntryEdgeBps: number,
  fundingApr24hPct: number | null,
  earnsFunding: boolean
): number | null {
  const days = estimatedDaysToBreakEven(netEntryEdgeBps, fundingApr24hPct, earnsFunding);
  if (days == null) return null;
  return Math.round(days * 100) / 100;
}

export type DnSpreadMonitorSolanaRow = {
  venue: "solana_jupiter_quote";
  market: string;
  token: string;
  mint: string;
  sizeUsd: number;
  decibelMark: number;
  spotPrice: number;
  spreadBps: number;
  spreadPct: number;
  severity: DnSpreadSeverity;
  netEntryEdgeBps: number;
  estimatedEntryCostUsd: number;
  favorableIndicative: boolean;
  favorableAfterFees: boolean;
  priceImpactPct: number | null;
  fundingApr24hPct: number | null;
  fundingDirection: string | null;
  shortEarnsFunding: boolean;
  basisWarning: string | null;
  /** Days until short-leg funding (24h APR) offsets entry drag; null if N/A. */
  estimatedDaysToBreakEven: number | null;
  error?: string;
};

/** Jupiter spot→USDC sell quote vs Decibel mark (exit / close timing). */
export type DnSpreadMonitorSolanaSellRow = {
  venue: "solana_jupiter_sell_quote";
  market: string;
  token: string;
  mint: string;
  sizeUsd: number;
  decibelMark: number;
  /** Effective USD per oz from sell quote. */
  spotSellPrice: number;
  spreadBps: number;
  spreadPct: number;
  severity: DnSpreadSeverity;
  netExitEdgeBps: number;
  estimatedExitDragUsd: number;
  favorableIndicative: boolean;
  favorableExitAfterFees: boolean;
  priceImpactPct: number | null;
  fundingApr24hPct: number | null;
  fundingDirection: string | null;
  shortEarnsFunding: boolean;
  basisWarning: string | null;
  error?: string;
};

export type DnSpreadMonitorAptosRow = {
  venue: "aptos_hyperion_exec";
  market: string;
  asset: "BTC" | "APT";
  sizeUsd: number;
  spotAssetLabel: string;
  decibelMark: number;
  bufferedEffectivePrice: number;
  spreadBps: number;
  spreadPct: number;
  severity: DnSpreadSeverity;
  estimatedEntryCostUsd: number;
  netEntryEdgeBps: number;
  favorableIndicative: boolean;
  favorableAfterFees: boolean;
  fundingApr24hPct: number | null;
  fundingDirection: string | null;
  shortEarnsFunding: boolean;
  /** Days until short-leg funding (24h APR) offsets entry drag; null if N/A. */
  estimatedDaysToBreakEven: number | null;
  error?: string;
};

export type DnSpreadMonitorRunResult = {
  runId: string;
  sampledAtUnixMs: number;
  solana: DnSpreadMonitorSolanaRow[];
  solanaExit: DnSpreadMonitorSolanaSellRow[];
  aptos: DnSpreadMonitorAptosRow[];
  signals: {
    netEdgePositive: Array<{ venue: string; market: string; token: string; spreadBps: number; netEntryEdgeBps: number }>;
    netExitEdgePositive: Array<{
      venue: string;
      market: string;
      token: string;
      spreadBps: number;
      netExitEdgeBps: number;
    }>;
    fundingAndNetEdge: Array<{ market: string; fundingApr24hPct: number; netEntryEdgeBps: number; venue: string }>;
    breakEvenWithinDays: Array<{
      venue: string;
      market: string;
      sizeUsd: number;
      netEntryEdgeBps: number;
      fundingApr24hPct: number;
      estimatedDaysToBreakEven: number;
    }>;
    /** 3d funding (7d APR) minus Jupiter+Decibel exit drag; entry ignored. */
    hold3dFundingBeatsExit: Array<{
      market: string;
      token: string;
      sizeUsd: number;
      fundingApr7dPct: number;
      funding3dUsd: number;
      exitDragUsd: number;
      net3dAfterExitUsd: number;
      netExitEdgeBps: number;
    }>;
  };
  errors: string[];
};

async function buildSolanaRows(
  markByMarket: Map<string, number>,
  fundingCache: Map<string, Awaited<ReturnType<typeof fetchServerFundingApr>>>
): Promise<DnSpreadMonitorSolanaRow[]> {
  const rows: DnSpreadMonitorSolanaRow[] = [];

  const quoteTasks = DN_SPREAD_MONITOR_SOLANA.flatMap((item) =>
    DN_SPREAD_MONITOR_NOTIONAL_USD.map((sizeUsd) => ({ item, sizeUsd }))
  );

  const quoteResults = await mapWithJupiterQuoteRateLimit(quoteTasks, async ({ item, sizeUsd }) => {
      const mark = markByMarket.get(item.market);
      if (mark == null) {
        return { item, sizeUsd, row: null as DnSpreadMonitorSolanaRow | null };
      }

      let funding = fundingCache.get(item.market) ?? null;
      if (!fundingCache.has(item.market)) {
        funding = await fetchServerFundingApr(item.market, "24h");
        fundingCache.set(item.market, funding);
      }

      try {
        const quote = await fetchJupiterDnQuote({ outputMint: item.mint, sizeUsd });
        const spot = effectiveUsdPriceFromJupiterQuote(quote, item.outputDecimals);
        if (spot == null) {
          throw new Error("Could not derive effective USD price from Jupiter quote");
        }

        const spreadBps = spreadBpsFromPrices(spot, mark);
        if (spreadBps == null) {
          throw new Error("Invalid spread from quote price and Decibel mark");
        }

        const netEdge = netEntryEdgeBpsFromJupiterQuote(spreadBps);
        const estimatedEntryCostUsd = sizeUsd * Math.max(0, -netEdge) / 10_000;
        const earnsFunding = shortEarnsFunding(funding);
        const fundingApr24hPct = funding?.avg_yearly_apr_pct ?? null;

        return {
          item,
          sizeUsd,
          row: {
            venue: "solana_jupiter_quote",
            market: item.market,
            token: item.token,
            mint: item.mint,
            sizeUsd,
            decibelMark: mark,
            spotPrice: spot,
            spreadBps,
            spreadPct: spreadPctFromBps(spreadBps),
            severity: severityForSpread(spreadBps),
            netEntryEdgeBps: netEdge,
            estimatedEntryCostUsd,
            favorableIndicative: spreadBps < 0,
            favorableAfterFees: Number.isFinite(netEdge) && netEdge > 0 && !item.basisWarning,
            priceImpactPct: quote.priceImpactPct,
            fundingApr24hPct,
            fundingDirection: funding?.direction ?? null,
            shortEarnsFunding: earnsFunding,
            basisWarning: item.basisWarning ?? null,
            estimatedDaysToBreakEven: breakEvenDaysForRow(netEdge, fundingApr24hPct, earnsFunding),
          } satisfies DnSpreadMonitorSolanaRow,
        };
      } catch (err) {
        return {
          item,
          sizeUsd,
          row: {
            venue: "solana_jupiter_quote",
            market: item.market,
            token: item.token,
            mint: item.mint,
            sizeUsd,
            decibelMark: mark,
            spotPrice: 0,
            spreadBps: 0,
            spreadPct: 0,
            severity: "block",
            netEntryEdgeBps: 0,
            estimatedEntryCostUsd: 0,
            favorableIndicative: false,
            favorableAfterFees: false,
            priceImpactPct: null,
            fundingApr24hPct: funding?.avg_yearly_apr_pct ?? null,
            fundingDirection: funding?.direction ?? null,
            shortEarnsFunding: shortEarnsFunding(funding),
            basisWarning: item.basisWarning ?? null,
            estimatedDaysToBreakEven: null,
            error: err instanceof Error ? err.message : String(err),
          } satisfies DnSpreadMonitorSolanaRow,
        };
      }
  });

  for (const { row } of quoteResults) {
    if (row) rows.push(row);
  }

  return rows;
}

async function buildSolanaExitRows(
  markByMarket: Map<string, number>,
  fundingCache: Map<string, Awaited<ReturnType<typeof fetchServerFundingApr>>>
): Promise<DnSpreadMonitorSolanaSellRow[]> {
  const rows: DnSpreadMonitorSolanaSellRow[] = [];

  const quoteTasks = DN_SPREAD_MONITOR_SOLANA_EXIT.flatMap((item) =>
    DN_SPREAD_MONITOR_NOTIONAL_USD.map((sizeUsd) => ({ item, sizeUsd }))
  );

  const quoteResults = await mapWithJupiterQuoteRateLimit(quoteTasks, async ({ item, sizeUsd }) => {
    const mark = markByMarket.get(item.market);
    if (mark == null) {
      return { row: null as DnSpreadMonitorSolanaSellRow | null };
    }

    let funding = fundingCache.get(item.market) ?? null;
    if (!fundingCache.has(item.market)) {
      funding = await fetchServerFundingApr(item.market, "24h");
      fundingCache.set(item.market, funding);
    }

    try {
      const quote = await fetchJupiterDnSellQuote({
        inputMint: item.mint,
        sizeUsd,
        markPx: mark,
        inputDecimals: item.outputDecimals,
      });
      const spotSell = effectiveUsdPriceFromJupiterSellQuote(quote, item.outputDecimals);
      if (spotSell == null) {
        throw new Error("Could not derive effective USD sell price from Jupiter quote");
      }

      const spreadBps = spreadBpsFromPrices(spotSell, mark);
      if (spreadBps == null) {
        throw new Error("Invalid exit spread from sell quote and Decibel mark");
      }

      const netExitEdge = netExitEdgeBpsFromJupiterSellQuote(spreadBps);
      const estimatedExitDrag = estimatedExitDragUsd(sizeUsd, netExitEdge);

      return {
        row: {
          venue: "solana_jupiter_sell_quote",
          market: item.market,
          token: item.token,
          mint: item.mint,
          sizeUsd,
          decibelMark: mark,
          spotSellPrice: spotSell,
          spreadBps,
          spreadPct: spreadPctFromBps(spreadBps),
          severity: severityForSpread(spreadBps),
          netExitEdgeBps: netExitEdge,
          estimatedExitDragUsd: estimatedExitDrag,
          favorableIndicative: spreadBps > 0,
          favorableExitAfterFees:
            Number.isFinite(netExitEdge) && netExitEdge > 0 && !item.basisWarning,
          priceImpactPct: quote.priceImpactPct,
          fundingApr24hPct: funding?.avg_yearly_apr_pct ?? null,
          fundingDirection: funding?.direction ?? null,
          shortEarnsFunding: shortEarnsFunding(funding),
          basisWarning: item.basisWarning ?? null,
        } satisfies DnSpreadMonitorSolanaSellRow,
      };
    } catch (err) {
      return {
        row: {
          venue: "solana_jupiter_sell_quote",
          market: item.market,
          token: item.token,
          mint: item.mint,
          sizeUsd,
          decibelMark: mark,
          spotSellPrice: 0,
          spreadBps: 0,
          spreadPct: 0,
          severity: "block",
          netExitEdgeBps: 0,
          estimatedExitDragUsd: 0,
          favorableIndicative: false,
          favorableExitAfterFees: false,
          priceImpactPct: null,
          fundingApr24hPct: funding?.avg_yearly_apr_pct ?? null,
          fundingDirection: funding?.direction ?? null,
          shortEarnsFunding: shortEarnsFunding(funding),
          basisWarning: item.basisWarning ?? null,
          error: err instanceof Error ? err.message : String(err),
        } satisfies DnSpreadMonitorSolanaSellRow,
      };
    }
  });

  for (const { row } of quoteResults) {
    if (row) rows.push(row);
  }

  return rows;
}

async function buildAptosRows(
  markets: ReturnType<typeof normalizeDecibelMarketsPayload>,
  fundingCache: Map<string, Awaited<ReturnType<typeof fetchServerFundingApr>>>
): Promise<DnSpreadMonitorAptosRow[]> {
  const rows: DnSpreadMonitorAptosRow[] = [];

  for (const asset of DN_SPREAD_MONITOR_APTOS_ASSETS) {
    const market = resolveMarketForBtcOrApt(asset, markets);
    if (!market) {
      rows.push({
        venue: "aptos_hyperion_exec",
        market: `${asset}/USD`,
        asset,
        sizeUsd: 0,
        spotAssetLabel: asset,
        decibelMark: 0,
        bufferedEffectivePrice: 0,
        spreadBps: 0,
        spreadPct: 0,
        severity: "block",
        estimatedEntryCostUsd: 0,
        netEntryEdgeBps: 0,
        favorableIndicative: false,
        favorableAfterFees: false,
        fundingApr24hPct: null,
        fundingDirection: null,
        shortEarnsFunding: false,
        estimatedDaysToBreakEven: null,
        error: `Market not found for ${asset}`,
      });
      continue;
    }

    const marketKey = market.market_name.replace(/-/g, "/").replace(/USDC/gi, "USD");
    let funding = fundingCache.get(marketKey) ?? null;
    if (!fundingCache.has(marketKey)) {
      funding = await fetchServerFundingApr(marketKey, "24h");
      fundingCache.set(marketKey, funding);
    }

    const markPx = await fetchDecibelMarkPx(market.market_addr);
    if (markPx == null) continue;

    for (const sizeUsd of DN_SPREAD_MONITOR_NOTIONAL_USD) {
      try {
        const quote = await computeAptosHyperionOpenSpread({
          asset,
          sizeUsd,
          markPx,
          marketConfig: market,
        });
        if (!quote) continue;
        const earnsFunding = shortEarnsFunding(funding);
        const fundingApr24hPct = funding?.avg_yearly_apr_pct ?? null;
        rows.push({
          venue: "aptos_hyperion_exec",
          market: marketKey,
          asset,
          sizeUsd,
          spotAssetLabel: quote.spotAssetLabel,
          decibelMark: quote.decibelMark,
          bufferedEffectivePrice: quote.bufferedEffectivePrice,
          spreadBps: quote.spreadBps,
          spreadPct: quote.spreadPct,
          severity: quote.severity,
          estimatedEntryCostUsd: quote.estimatedEntryCostUsd,
          netEntryEdgeBps: quote.netEntryEdgeBps,
          favorableIndicative: quote.spreadBps < 0,
          favorableAfterFees: quote.netEntryEdgeBps > 0,
          fundingApr24hPct,
          fundingDirection: funding?.direction ?? null,
          shortEarnsFunding: earnsFunding,
          estimatedDaysToBreakEven: breakEvenDaysForRow(
            quote.netEntryEdgeBps,
            fundingApr24hPct,
            earnsFunding
          ),
        });
      } catch (err) {
        rows.push({
          venue: "aptos_hyperion_exec",
          market: marketKey,
          asset,
          sizeUsd,
          spotAssetLabel: asset,
          decibelMark: markPx,
          bufferedEffectivePrice: 0,
          spreadBps: 0,
          spreadPct: 0,
          severity: "block",
          estimatedEntryCostUsd: 0,
          netEntryEdgeBps: 0,
          favorableIndicative: false,
          favorableAfterFees: false,
          fundingApr24hPct: funding?.avg_yearly_apr_pct ?? null,
          fundingDirection: funding?.direction ?? null,
          shortEarnsFunding: shortEarnsFunding(funding),
          estimatedDaysToBreakEven: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return rows;
}

export async function runDnSpreadMonitorPass(): Promise<DnSpreadMonitorRunResult> {
  const runId = `dn_monitor_${Date.now()}`;
  const sampledAtUnixMs = Date.now();
  const errors: string[] = [];
  const fundingCache = new Map<string, Awaited<ReturnType<typeof fetchServerFundingApr>>>();

  const marketsRaw = await fetchDecibel("/api/v1/markets");
  const markets = normalizeDecibelMarketsPayload(marketsRaw);

  const markByMarket = new Map<string, number>();
  const uniqueMarketKeys = [
    ...new Set([
      ...DN_SPREAD_MONITOR_SOLANA.map((w) => w.market),
      ...DN_SPREAD_MONITOR_APTOS_ASSETS.map((a) => `${a}/USD`),
    ]),
  ];

  await Promise.all(
    uniqueMarketKeys.map(async (marketKey) => {
      const row = resolveDecibelMarketByName(marketKey, markets);
      if (!row) return;
      try {
        const mark = await fetchDecibelMarkPx(row.market_addr);
        if (mark != null) markByMarket.set(marketKey, mark);
      } catch (err) {
        errors.push(`${marketKey}: ${err instanceof Error ? err.message : String(err)}`);
      }
    })
  );

  let solana: DnSpreadMonitorSolanaRow[] = [];
  let solanaExit: DnSpreadMonitorSolanaSellRow[] = [];
  let aptos: DnSpreadMonitorAptosRow[] = [];

  try {
    solana = await buildSolanaRows(markByMarket, fundingCache);
  } catch (err) {
    errors.push(`solana: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    solanaExit = await buildSolanaExitRows(markByMarket, fundingCache);
  } catch (err) {
    errors.push(`solana_exit: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    aptos = await buildAptosRows(markets, fundingCache);
  } catch (err) {
    errors.push(`aptos: ${err instanceof Error ? err.message : String(err)}`);
  }

  const netEdgePositive = [
    ...solana
      .filter((r) => r.favorableAfterFees && !r.basisWarning && !r.error)
      .map((r) => ({
        venue: r.venue,
        market: r.market,
        token: `${r.token}@$${r.sizeUsd}`,
        spreadBps: r.spreadBps,
        netEntryEdgeBps: r.netEntryEdgeBps,
      })),
    ...aptos
      .filter((r) => r.favorableAfterFees && !r.error)
      .map((r) => ({
        venue: r.venue,
        market: r.market,
        token: `${r.spotAssetLabel}@$${r.sizeUsd}`,
        spreadBps: r.spreadBps,
        netEntryEdgeBps: r.netEntryEdgeBps,
      })),
  ];

  const netExitEdgePositive = solanaExit
    .filter((r) => r.favorableExitAfterFees && !r.basisWarning && !r.error)
    .map((r) => ({
      venue: r.venue,
      market: r.market,
      token: `${r.token}@$${r.sizeUsd}`,
      spreadBps: r.spreadBps,
      netExitEdgeBps: r.netExitEdgeBps,
    }));

  const fundingAndNetEdge = [
    ...solana
      .filter((r) => r.shortEarnsFunding && r.favorableAfterFees && !r.basisWarning && !r.error)
      .map((r) => ({
        market: r.market,
        fundingApr24hPct: r.fundingApr24hPct ?? 0,
        netEntryEdgeBps: r.netEntryEdgeBps,
        venue: `${r.venue}:$${r.sizeUsd}`,
      })),
    ...aptos
      .filter((r) => r.shortEarnsFunding && r.favorableAfterFees && !r.error)
      .map((r) => ({
        market: r.market,
        fundingApr24hPct: r.fundingApr24hPct ?? 0,
        netEntryEdgeBps: r.netEntryEdgeBps,
        venue: `${r.venue}:$${r.sizeUsd}`,
      })),
  ];

  const breakEvenWithinDays = [
    ...solana
      .filter(
        (r) =>
          !r.error &&
          !r.basisWarning &&
          r.estimatedDaysToBreakEven != null &&
          r.estimatedDaysToBreakEven <= DN_BREAK_EVEN_SIGNAL_MAX_DAYS
      )
      .map((r) => ({
        venue: `${r.venue}:$${r.sizeUsd}`,
        market: r.market,
        sizeUsd: r.sizeUsd,
        netEntryEdgeBps: r.netEntryEdgeBps,
        fundingApr24hPct: r.fundingApr24hPct ?? 0,
        estimatedDaysToBreakEven: r.estimatedDaysToBreakEven as number,
      })),
    ...aptos
      .filter(
        (r) =>
          !r.error &&
          r.estimatedDaysToBreakEven != null &&
          r.estimatedDaysToBreakEven <= DN_BREAK_EVEN_SIGNAL_MAX_DAYS
      )
      .map((r) => ({
        venue: `${r.venue}:$${r.sizeUsd}`,
        market: r.market,
        sizeUsd: r.sizeUsd,
        netEntryEdgeBps: r.netEntryEdgeBps,
        fundingApr24hPct: r.fundingApr24hPct ?? 0,
        estimatedDaysToBreakEven: r.estimatedDaysToBreakEven as number,
      })),
  ];

  const funding7dCache = new Map<string, Awaited<ReturnType<typeof fetchServerFundingApr>>>();
  const hold3dFundingBeatsExit: DnSpreadMonitorRunResult["signals"]["hold3dFundingBeatsExit"] = [];

  for (const exitRow of solanaExit.filter((r) => !r.error && !r.basisWarning)) {
    const marketKey = exitRow.market;
    if (!funding7dCache.has(marketKey)) {
      funding7dCache.set(marketKey, await fetchServerFundingApr(marketKey, "7d"));
    }
    const funding7d = funding7dCache.get(marketKey) ?? null;
    if (!shortEarnsFunding(funding7d)) continue;

    const apr7 = funding7d?.avg_yearly_apr_pct ?? 0;
    const funding3dUsd = fundingUsdForHoldDays(exitRow.sizeUsd, apr7, DN_HOLD_FUNDING_SIGNAL_DAYS);
    const exitDragUsd = estimatedExitDragUsd(exitRow.sizeUsd, exitRow.netExitEdgeBps);
    const net3dAfterExitUsd = netHoldAfterExitUsd(
      exitRow.sizeUsd,
      apr7,
      DN_HOLD_FUNDING_SIGNAL_DAYS,
      exitRow.netExitEdgeBps
    );

    if (net3dAfterExitUsd > 0) {
      hold3dFundingBeatsExit.push({
        market: exitRow.market,
        token: exitRow.token,
        sizeUsd: exitRow.sizeUsd,
        fundingApr7dPct: apr7,
        funding3dUsd: Math.round(funding3dUsd * 100) / 100,
        exitDragUsd: Math.round(exitDragUsd * 100) / 100,
        net3dAfterExitUsd: Math.round(net3dAfterExitUsd * 100) / 100,
        netExitEdgeBps: exitRow.netExitEdgeBps,
      });
    }
  }

  hold3dFundingBeatsExit.sort((a, b) => b.net3dAfterExitUsd - a.net3dAfterExitUsd);

  const result: DnSpreadMonitorRunResult = {
    runId,
    sampledAtUnixMs,
    solana,
    solanaExit,
    aptos,
    signals: {
      netEdgePositive,
      netExitEdgePositive,
      fundingAndNetEdge,
      breakEvenWithinDays,
      hold3dFundingBeatsExit,
    },
    errors,
  };

  for (const row of solana) {
    console.log("[DN-Monitor]", JSON.stringify({ runId, kind: "solana", ...row }));
  }
  for (const row of solanaExit) {
    console.log("[DN-Monitor]", JSON.stringify({ runId, kind: "solana_exit", ...row }));
  }
  for (const row of aptos) {
    console.log("[DN-Monitor]", JSON.stringify({ runId, kind: "aptos", ...row }));
  }
  console.log("[DN-Monitor] summary", JSON.stringify({
    runId,
    sampledAtUnixMs,
    solanaCount: solana.length,
    solanaExitCount: solanaExit.length,
    aptosCount: aptos.length,
    netEdgePositive: netEdgePositive.length,
    netExitEdgePositive: netExitEdgePositive.length,
    fundingAndNetEdge: fundingAndNetEdge.length,
    breakEvenWithin3Days: breakEvenWithinDays.length,
    hold3dFundingBeatsExit: hold3dFundingBeatsExit.length,
    errors,
  }));

  return result;
}
