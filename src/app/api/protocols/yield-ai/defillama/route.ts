import { NextResponse } from "next/server";

type LlamaTvlPoint = {
  date?: number;
  totalLiquidityUSD?: number;
};

type LlamaProtocolResponse = {
  tvl?: LlamaTvlPoint[];
  currentChainTvls?: Record<string, number>;
};

function latestSeriesTvl(series: LlamaTvlPoint[] | undefined): number | null {
  if (!Array.isArray(series)) return null;

  for (let i = series.length - 1; i >= 0; i -= 1) {
    const value = Number(series[i]?.totalLiquidityUSD);
    if (Number.isFinite(value) && value > 0) return value;
  }

  return null;
}

function currentChainTvl(chainTvls: Record<string, number> | undefined): number | null {
  if (!chainTvls) return null;

  const total = Object.values(chainTvls).reduce((sum, raw) => {
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? sum + value : sum;
  }, 0);

  return total > 0 ? total : null;
}

export async function GET() {
  try {
    const response = await fetch("https://api.llama.fi/protocol/yield-ai", {
      headers: {
        Accept: "application/json",
      },
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      throw new Error(`DeFi Llama HTTP ${response.status}`);
    }

    const data = (await response.json()) as LlamaProtocolResponse;
    const tvlUSD = currentChainTvl(data.currentChainTvls) ?? latestSeriesTvl(data.tvl) ?? 0;

    return NextResponse.json({
      tvlUSD,
      source: "defillama",
      sourceUrl: "https://defillama.com/protocol/yield-ai",
    });
  } catch (error) {
    console.error("[Yield AI DeFi Llama] TVL fetch failed:", error);
    return NextResponse.json(
      {
        tvlUSD: 0,
        source: "defillama",
        sourceUrl: "https://defillama.com/protocol/yield-ai",
        error: "Failed to fetch Yield AI TVL",
      },
      { status: 502 }
    );
  }
}
