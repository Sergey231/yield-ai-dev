import {
  estimatedDaysToBreakEven,
  netEntryEdgeBpsFromJupiterQuote,
  spreadBpsFromPrices,
  spreadPctFromBps,
  severityForSpread,
} from "@/lib/protocols/decibel/deltaNeutralSpread";
import { fetchDecibelMarkPx } from "@/lib/protocols/decibel/decibelApi";
import { resolvePilotMarket } from "@/lib/protocols/decibel/dnMultiChain/decibelShortLeg";
import type { DnPilotConfig } from "@/lib/protocols/decibel/dnMultiChain/pilotConfig";
import { fetchServerFundingApr, shortEarnsFunding } from "@/lib/protocols/decibel/fundingServer";
import {
  effectiveUsdPriceFromJupiterQuote,
  fetchJupiterDnQuote,
} from "@/lib/protocols/decibel/jupiterDnQuote";

export type DnPilotSignal = {
  market: string;
  token: string;
  sizeUsd: number;
  decibelMark: number;
  spotPrice: number;
  spreadBps: number;
  spreadPct: number;
  severity: ReturnType<typeof severityForSpread>;
  netEntryEdgeBps: number;
  estimatedEntryCostUsd: number;
  favorableAfterFees: boolean;
  priceImpactPct: number | null;
  fundingApr24hPct: number | null;
  shortEarnsFunding: boolean;
  estimatedDaysToBreakEven: number | null;
  passesMinNetEdge: boolean;
};

export async function evaluateDnPilotSignal(config: DnPilotConfig): Promise<DnPilotSignal> {
  const market = await resolvePilotMarket(config.market);
  const mark = await fetchDecibelMarkPx(market.market_addr);
  if (mark == null || mark <= 0) {
    throw new Error(`Decibel mark unavailable for ${config.market}`);
  }

  const funding = await fetchServerFundingApr(config.market, "24h");
  const earnsFunding = shortEarnsFunding(funding);
  const fundingApr24hPct = funding?.avg_yearly_apr_pct ?? null;

  const quote = await fetchJupiterDnQuote({
    outputMint: config.spotMint,
    sizeUsd: config.sizeUsd,
    slippageBps: config.slippageBps,
  });
  const spot = effectiveUsdPriceFromJupiterQuote(quote, config.spotDecimals);
  if (spot == null) {
    throw new Error("Could not derive effective USD price from Jupiter quote");
  }

  const spreadBps = spreadBpsFromPrices(spot, mark);
  if (spreadBps == null) {
    throw new Error("Invalid spread from Jupiter quote and Decibel mark");
  }

  const netEdge = netEntryEdgeBpsFromJupiterQuote(spreadBps);
  const estimatedEntryCostUsd = config.sizeUsd * Math.max(0, -netEdge) / 10_000;
  const beDaysRaw = estimatedDaysToBreakEven(netEdge, fundingApr24hPct, earnsFunding);
  const estimatedDaysToBreakEvenRounded =
    beDaysRaw == null ? null : Math.round(beDaysRaw * 100) / 100;

  return {
    market: config.market,
    token: config.token,
    sizeUsd: config.sizeUsd,
    decibelMark: mark,
    spotPrice: spot,
    spreadBps,
    spreadPct: spreadPctFromBps(spreadBps),
    severity: severityForSpread(spreadBps),
    netEntryEdgeBps: netEdge,
    estimatedEntryCostUsd,
    favorableAfterFees: netEdge > 0,
    priceImpactPct: quote.priceImpactPct,
    fundingApr24hPct,
    shortEarnsFunding: earnsFunding,
    estimatedDaysToBreakEven: estimatedDaysToBreakEvenRounded,
    passesMinNetEdge: netEdge >= config.minNetEdgeBps,
  };
}
