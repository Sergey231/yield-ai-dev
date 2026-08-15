import { USDC_FA_METADATA_MAINNET } from "@/lib/constants/yieldAiVault";
import {
  decibelChainUnitsToHumanBase,
  decibelOpenOrderSizeChainUnits,
  type DecibelMarketConfig,
} from "@/lib/protocols/decibel/closePosition";
import {
  DECIBEL_APT_SPOT_ASSET,
  getConfiguredDecibelBtcSpotAsset,
  type DecibelSpotAssetConfig,
} from "@/lib/protocols/decibel/deltaNeutralSpotAssets";
import { getHyperionAmountIn } from "@/lib/protocols/yield-ai/engine/hyperionQuote";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";

export const DN_INPUT_BUFFER_BPS = 20;
export const DN_OK_SPREAD_BPS = 30;
export const DN_BLOCK_SPREAD_BPS = 75;
/** Decibel Tier-0 taker: 0.034% = 3.4 bps per open/close (see docs/decibel-builder-integration.md). */
export const DN_EST_DECIBEL_TAKER_BPS = 3.4;
/** Yield AI builder default in code; production reads DECIBEL_BUILDER_FEE_BPS (currently 1 bps on prod). Charged only when user approved on-chain. */
export const DN_EST_DECIBEL_BUILDER_BPS = 10;
export const DN_EST_JUPITER_INDICATIVE_SWAP_BPS = 15;
/** Legacy planning buffer when no exec quote; do NOT add to Hyperion exec spread (quote already includes swap cost). */
export const DN_EST_HYPERION_SWAP_BPS = 30;

/** Protocol taker only, or taker + builder for trades routed via Yield AI. */
export function decibelPerLegFeeBps(includeBuilderFee = false): number {
  return DN_EST_DECIBEL_TAKER_BPS + (includeBuilderFee ? DN_EST_DECIBEL_BUILDER_BPS : 0);
}

export type DnSpreadSeverity = "ok" | "warning" | "block";

export function spreadBpsFromPrices(spotPrice: number, markPx: number): number | null {
  if (!Number.isFinite(spotPrice) || spotPrice <= 0 || !Number.isFinite(markPx) || markPx <= 0) {
    return null;
  }
  return ((spotPrice / markPx) - 1) * 10_000;
}

export function spreadPctFromBps(spreadBps: number): number {
  return spreadBps / 100;
}

export function severityForSpread(spreadBps: number): DnSpreadSeverity {
  if (!Number.isFinite(spreadBps) || spreadBps <= DN_OK_SPREAD_BPS) return "ok";
  if (spreadBps <= DN_BLOCK_SPREAD_BPS) return "warning";
  return "block";
}

/** Rough edge after indicative fees; positive = net favorable entry. */
export function netEntryEdgeBps(
  spreadBps: number,
  extraFeeBps: number = DN_EST_DECIBEL_TAKER_BPS + DN_EST_JUPITER_INDICATIVE_SWAP_BPS
): number {
  if (!Number.isFinite(spreadBps)) return Number.NaN;
  return -spreadBps - extraFeeBps;
}

/** Net edge when Jupiter swap fees are already in the quote; only Decibel per-leg fee remains. */
export function netEntryEdgeBpsFromJupiterQuote(
  spreadBps: number,
  includeBuilderFee = false
): number {
  return netEntryEdgeBps(spreadBps, decibelPerLegFeeBps(includeBuilderFee));
}

/**
 * Exit edge for Jupiter spot sell + Decibel close. Positive = sell price above mark enough
 * to cover Decibel per-leg fee (Jupiter sell fees already in quote).
 */
export function netExitEdgeBpsFromJupiterSellQuote(
  spreadBps: number,
  includeBuilderFee = false
): number {
  if (!Number.isFinite(spreadBps)) return Number.NaN;
  return spreadBps - decibelPerLegFeeBps(includeBuilderFee);
}

/** USD drag vs mark when net exit edge is negative (unfavorable exit). */
export function estimatedExitDragUsd(sizeUsd: number, netExitEdgeBps: number): number {
  return sizeUsd * Math.max(0, -netExitEdgeBps) / 10_000;
}

/** Projected short-leg funding USD for `holdDays` at constant `aprPct` (annualized). */
export function fundingUsdForHoldDays(notionalUsd: number, aprPct: number, holdDays: number): number {
  if (!Number.isFinite(notionalUsd) || notionalUsd <= 0 || !Number.isFinite(aprPct) || aprPct <= 0) {
    return 0;
  }
  return notionalUsd * (aprPct / 100) * (holdDays / 365);
}

/** Net USD after holding `holdDays` with funding APR, then paying exit drag (entry ignored). */
export function netHoldAfterExitUsd(
  notionalUsd: number,
  fundingAprPct: number,
  holdDays: number,
  netExitEdgeBps: number
): number {
  return (
    fundingUsdForHoldDays(notionalUsd, fundingAprPct, holdDays) -
    estimatedExitDragUsd(notionalUsd, netExitEdgeBps)
  );
}

/** Days of funding (at aprPct) required to cover exit drag; null if shorts do not earn or exit is free. */
export function daysFundingToCoverExit(
  notionalUsd: number,
  fundingAprPct: number,
  netExitEdgeBps: number
): number | null {
  const exitDrag = estimatedExitDragUsd(notionalUsd, netExitEdgeBps);
  if (exitDrag <= 0) return 0;
  if (!Number.isFinite(fundingAprPct) || fundingAprPct <= 0) return null;
  const dailyFunding = fundingUsdForHoldDays(notionalUsd, fundingAprPct, 1);
  if (dailyFunding <= 0) return null;
  return exitDrag / dailyFunding;
}

export const DN_HOLD_FUNDING_SIGNAL_DAYS = 3;

/**
 * Calendar days until 24h funding APR on the short leg (equal to quoted `sizeUsd`) offsets
 * `estimatedEntryCostUsd` from a negative net entry edge. null when entry is already favorable,
 * funding does not pay shorts, or inputs are missing.
 */
export function estimatedDaysToBreakEven(
  netEntryEdgeBps: number,
  fundingApr24hPct: number | null,
  shortEarnsFunding: boolean
): number | null {
  if (!Number.isFinite(netEntryEdgeBps) || netEntryEdgeBps >= 0) return null;
  if (
    !shortEarnsFunding ||
    fundingApr24hPct == null ||
    !Number.isFinite(fundingApr24hPct) ||
    fundingApr24hPct <= 0
  ) {
    return null;
  }
  const dailyFundingBpsOnShort = (fundingApr24hPct * 100) / 365;
  if (dailyFundingBpsOnShort <= 0) return null;
  return Math.abs(netEntryEdgeBps) / dailyFundingBpsOnShort;
}

export function estimatedEntryCostUsd(bufferedUsdcInUsd: number, shortNotionalUsd: number): number {
  return bufferedUsdcInUsd - shortNotionalUsd;
}

function baseUnitsToHuman(baseUnits: bigint, decimals: number): number {
  return Number(baseUnits) / 10 ** decimals;
}

function spotAssetConfigForAsset(asset: "BTC" | "APT"): DecibelSpotAssetConfig {
  return asset === "BTC" ? getConfiguredDecibelBtcSpotAsset() : DECIBEL_APT_SPOT_ASSET;
}

export type AptosHyperionSpreadQuote = {
  asset: "BTC" | "APT";
  sizeUsd: number;
  decibelMark: number;
  shortNotionalUsd: number;
  bufferedEffectivePrice: number;
  spreadBps: number;
  spreadPct: number;
  estimatedEntryCostUsd: number;
  severity: DnSpreadSeverity;
  netEntryEdgeBps: number;
  spotAssetLabel: string;
};

export async function computeAptosHyperionOpenSpread(options: {
  asset: "BTC" | "APT";
  sizeUsd: number;
  markPx: number;
  marketConfig: DecibelMarketConfig;
}): Promise<AptosHyperionSpreadQuote | null> {
  const { asset, sizeUsd, markPx, marketConfig } = options;
  if (!Number.isFinite(sizeUsd) || sizeUsd <= 0 || !Number.isFinite(markPx) || markPx <= 0) {
    return null;
  }

  const shortSizeChainUnits = BigInt(decibelOpenOrderSizeChainUnits(sizeUsd, markPx, marketConfig));
  const shortSizeHumanBase = decibelChainUnitsToHumanBase(
    shortSizeChainUnits,
    marketConfig.sz_decimals ?? 9
  );
  const shortNotionalUsd = shortSizeHumanBase * markPx;
  if (!Number.isFinite(shortNotionalUsd) || shortNotionalUsd <= 0) return null;

  const spotAsset = spotAssetConfigForAsset(asset);
  const targetSpotOutBaseUnits = BigInt(
    Math.max(1, Math.ceil(shortSizeHumanBase * 10 ** spotAsset.decimals))
  );

  const quoteUsdcInBaseUnits = await getHyperionAmountIn({
    amountOutBaseUnits: targetSpotOutBaseUnits,
    fromMetadata: USDC_FA_METADATA_MAINNET,
    toMetadata: toCanonicalAddress(spotAsset.metadata),
  });
  const bufferedUsdcInBaseUnits =
    (quoteUsdcInBaseUnits * (BigInt(10_000) + BigInt(DN_INPUT_BUFFER_BPS))) / BigInt(10_000);

  const targetSpotHuman = baseUnitsToHuman(targetSpotOutBaseUnits, spotAsset.decimals);
  const bufferedUsdcInUsd = baseUnitsToHuman(bufferedUsdcInBaseUnits, 6);
  const bufferedEffectivePrice = targetSpotHuman > 0 ? bufferedUsdcInUsd / targetSpotHuman : 0;
  const spreadBps = spreadBpsFromPrices(bufferedEffectivePrice, markPx) ?? 0;

  return {
    asset,
    sizeUsd,
    decibelMark: markPx,
    shortNotionalUsd,
    bufferedEffectivePrice,
    spreadBps,
    spreadPct: spreadPctFromBps(spreadBps),
    estimatedEntryCostUsd: estimatedEntryCostUsd(bufferedUsdcInUsd, shortNotionalUsd),
    severity: severityForSpread(spreadBps),
    netEntryEdgeBps: netEntryEdgeBps(spreadBps, decibelPerLegFeeBps(false)),
    spotAssetLabel: spotAsset.label,
  };
}
