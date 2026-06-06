import { getTokenList } from "@/lib/tokens/getTokenList";
import { normalizeAddress, toCanonicalAddress } from "@/lib/utils/addressNormalization";

type HyperionTokenMeta = {
  address: string;
  symbol: string;
  decimals: number;
  usdPrice?: number;
};

type HyperionTokenSide = "token1" | "token2";

export interface HyperionStableChartData {
  chartTokenAddress: string;
  chartTokenSymbol: string;
  quoteTokenSymbol: string;
  lowerPrice: number;
  upperPrice: number;
  currentPrice: number;
}

export interface HyperionStableChartInput {
  token1Address?: string;
  token2Address?: string;
  token1Symbol?: string;
  token2Symbol?: string;
  tickLower?: number;
  tickUpper?: number;
  currentTick?: number;
}

const APTOS_TOKENS = getTokenList(1);
const STABLE_SYMBOLS = new Set(["USDC", "USDT", "USDT", "USD1", "USDA", "DAI", "USDE"]);
const STABLE_QUOTE_PREFERENCE = ["USDC", "USDT", "USD1", "USDA", "DAI", "USDE"];

function normalizeAssetId(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (!trimmed.startsWith("0x")) return trimmed;

  if (!trimmed.includes("::")) {
    return normalizeAddress(trimmed);
  }

  const [address, ...rest] = trimmed.split("::");
  return [normalizeAddress(address), ...rest].join("::");
}

function rootAddressOf(value?: string | null): string | null {
  const normalized = normalizeAssetId(value);
  if (!normalized) return null;
  const [root] = normalized.split("::");
  return root || null;
}

function stableRank(symbol?: string): number {
  if (!symbol) return Number.MAX_SAFE_INTEGER;
  const normalized = symbol.trim().toUpperCase();
  const rank = STABLE_QUOTE_PREFERENCE.indexOf(normalized);
  return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
}

function isStableToken(meta: HyperionTokenMeta): boolean {
  const normalizedSymbol = meta.symbol.trim().toUpperCase();
  if (STABLE_SYMBOLS.has(normalizedSymbol)) return true;

  const price = meta.usdPrice;
  return (
    Number.isFinite(price) &&
    price! >= 0.95 &&
    price! <= 1.05 &&
    /USD|DAI|USDE/.test(normalizedSymbol)
  );
}

function buildTokenMeta(address?: string, fallbackSymbol?: string): HyperionTokenMeta | null {
  const normalized = normalizeAssetId(address);
  const root = rootAddressOf(address);
  if (!normalized && !root) return null;

  const match = APTOS_TOKENS.find((token) => {
    const faAddress = normalizeAssetId(token.faAddress);
    const tokenAddress = normalizeAssetId(token.tokenAddress);
    const tokenRoot = rootAddressOf(token.tokenAddress ?? token.faAddress);

    return normalized === faAddress || normalized === tokenAddress || root === tokenRoot || root === faAddress;
  });

  if (!match) {
    return normalized
      ? {
          address: root ?? normalized,
          symbol: fallbackSymbol?.trim() || "Unknown",
          decimals: 8,
        }
      : null;
  }

  return {
    address: match.faAddress || root || normalized || "",
    symbol: match.symbol || fallbackSymbol?.trim() || "Unknown",
    decimals: Number(match.decimals) || 8,
    usdPrice: match.usdPrice != null ? Number(match.usdPrice) : undefined,
  };
}

function pickChartSides(
  token1: HyperionTokenMeta,
  token2: HyperionTokenMeta
): { chartSide: HyperionTokenSide; quoteSide: HyperionTokenSide } | null {
  const token1Stable = isStableToken(token1);
  const token2Stable = isStableToken(token2);

  if (!token1Stable && !token2Stable) return null;
  if (token1Stable && !token2Stable) return { chartSide: "token2", quoteSide: "token1" };
  if (!token1Stable && token2Stable) return { chartSide: "token1", quoteSide: "token2" };

  return stableRank(token1.symbol) <= stableRank(token2.symbol)
    ? { chartSide: "token2", quoteSide: "token1" }
    : { chartSide: "token1", quoteSide: "token2" };
}

function expectedQuotePerChartToken(
  chartToken: HyperionTokenMeta,
  quoteToken: HyperionTokenMeta
): number | null {
  if (!Number.isFinite(chartToken.usdPrice) || !Number.isFinite(quoteToken.usdPrice) || !quoteToken.usdPrice) {
    return null;
  }

  const expected = chartToken.usdPrice! / quoteToken.usdPrice!;
  return Number.isFinite(expected) && expected > 0 ? expected : null;
}

function rawToken2PerToken1(tick: number, token1Decimals: number, token2Decimals: number): number | null {
  if (!Number.isFinite(tick)) return null;
  const ratio = Math.pow(1.0001, tick) * Math.pow(10, token1Decimals - token2Decimals);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

function logDistance(a: number, b: number): number {
  return Math.abs(Math.log(a) - Math.log(b));
}

function pickOrientation(
  rawPrice: number,
  chartSide: HyperionTokenSide,
  expectedPrice: number | null
): boolean {
  const direct = chartSide === "token1" ? rawPrice : 1 / rawPrice;
  const inverted = 1 / direct;

  if (!expectedPrice || !Number.isFinite(expectedPrice) || expectedPrice <= 0) {
    return false;
  }

  return logDistance(inverted, expectedPrice) < logDistance(direct, expectedPrice);
}

function displayPriceForTick(
  tick: number,
  token1: HyperionTokenMeta,
  token2: HyperionTokenMeta,
  chartSide: HyperionTokenSide,
  invert: boolean
): number | null {
  const rawPrice = rawToken2PerToken1(tick, token1.decimals, token2.decimals);
  if (!rawPrice) return null;

  let displayed = chartSide === "token1" ? rawPrice : 1 / rawPrice;
  if (invert) displayed = 1 / displayed;

  return Number.isFinite(displayed) && displayed > 0 ? displayed : null;
}

function chartTokenAddress(meta: HyperionTokenMeta): string | null {
  const root = rootAddressOf(meta.address);
  if (!root) return null;
  return toCanonicalAddress(root);
}

export function buildHyperionStableChart(input: HyperionStableChartInput): HyperionStableChartData | null {
  const tickLower = Number(input.tickLower);
  const tickUpper = Number(input.tickUpper);
  const currentTick = Number(input.currentTick);

  if (!Number.isFinite(tickLower) || !Number.isFinite(tickUpper) || !Number.isFinite(currentTick)) {
    return null;
  }

  const token1 = buildTokenMeta(input.token1Address, input.token1Symbol);
  const token2 = buildTokenMeta(input.token2Address, input.token2Symbol);
  if (!token1 || !token2) return null;

  const sides = pickChartSides(token1, token2);
  if (!sides) return null;

  const chartToken = sides.chartSide === "token1" ? token1 : token2;
  const quoteToken = sides.quoteSide === "token1" ? token1 : token2;
  const expectedPrice = expectedQuotePerChartToken(chartToken, quoteToken);
  const rawCurrentPrice = rawToken2PerToken1(currentTick, token1.decimals, token2.decimals);
  if (!rawCurrentPrice) return null;

  const invert = pickOrientation(rawCurrentPrice, sides.chartSide, expectedPrice);
  const lowerPriceA = displayPriceForTick(tickLower, token1, token2, sides.chartSide, invert);
  const upperPriceA = displayPriceForTick(tickUpper, token1, token2, sides.chartSide, invert);
  const currentPrice = displayPriceForTick(currentTick, token1, token2, sides.chartSide, invert);
  const chartAddress = chartTokenAddress(chartToken);

  if (!lowerPriceA || !upperPriceA || !currentPrice || !chartAddress) {
    return null;
  }

  return {
    chartTokenAddress: chartAddress,
    chartTokenSymbol: chartToken.symbol,
    quoteTokenSymbol: quoteToken.symbol,
    lowerPrice: Math.min(lowerPriceA, upperPriceA),
    upperPrice: Math.max(lowerPriceA, upperPriceA),
    currentPrice,
  };
}
