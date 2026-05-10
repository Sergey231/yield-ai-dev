import { NextRequest, NextResponse } from "next/server";
import { SolanaPortfolioService } from "@/lib/services/solana/portfolio";

type SolanaPortfolioResponse = Awaited<ReturnType<SolanaPortfolioService["getPortfolio"]>>;

type CacheEntry = { expiresAt: number; value: SolanaPortfolioResponse; hasAnyPriced: boolean; atMs: number };

function getPortfolioCache(): Map<string, CacheEntry> {
  const g = globalThis as unknown as { __solanaPortfolioCache?: Map<string, CacheEntry> };
  g.__solanaPortfolioCache ??= new Map<string, CacheEntry>();
  return g.__solanaPortfolioCache;
}

function getPortfolioInFlight(): Map<string, Promise<SolanaPortfolioResponse>> {
  const g = globalThis as unknown as {
    __solanaPortfolioInFlight?: Map<string, Promise<SolanaPortfolioResponse>>;
  };
  g.__solanaPortfolioInFlight ??= new Map<string, Promise<SolanaPortfolioResponse>>();
  return g.__solanaPortfolioInFlight;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");

  if (!address) {
    return NextResponse.json(
      { error: "Missing address parameter" },
      { status: 400 },
    );
  }

  try {
    console.log(`[API /api/solana/portfolio] 📡 Request received for address: ${address}`);

    // Short-lived cache per wallet address to reduce RPC load + Jupiter 429s.
    // Additionally keep a "last good" payload to avoid transient N/A after cold starts.
    const cache = getPortfolioCache();
    const now = Date.now();
    const cached = cache.get(address);
    if (cached && cached.expiresAt > now) {
      return NextResponse.json(cached.value, {
        headers: {
          "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=300",
        },
      });
    }

    // In-flight coalescing: if multiple requests hit the API simultaneously for the same address,
    // they should share a single upstream fetch (RPC + Jupiter) to avoid bursts and 429s.
    const inFlight = getPortfolioInFlight();
    const existing = inFlight.get(address);
    const portfolioPromise =
      existing ??
      (async () => {
        try {
          const portfolioService = SolanaPortfolioService.getInstance();
          return await portfolioService.getPortfolio(address);
        } finally {
          // Ensure we don't leak promises on errors or long runtimes.
          inFlight.delete(address);
        }
      })();

    if (!existing) {
      inFlight.set(address, portfolioPromise);
    }

    const portfolio = await portfolioPromise;

    const hasAnyPriced = Array.isArray(portfolio?.tokens)
      ? portfolio.tokens.some((t: any) => t?.price != null || t?.value != null)
      : false;

    // If this fresh payload has no prices/values (typical after cold starts), prefer stale "good" payload if available.
    if (!hasAnyPriced && cached?.hasAnyPriced && now - cached.atMs <= 60 * 60 * 1000) {
      return NextResponse.json(cached.value, {
        headers: {
          "Cache-Control": "public, max-age=15, s-maxage=15, stale-while-revalidate=300",
        },
      });
    }

    cache.set(address, { expiresAt: now + 30_000, value: portfolio, hasAnyPriced, atMs: now });
    
    console.log(`[API /api/solana/portfolio] ✅ Portfolio fetched successfully:`, {
      tokensCount: portfolio.tokens.length,
      totalValueUsd: portfolio.totalValueUsd,
      tokens: portfolio.tokens.map(t => ({
        address: t.address,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        price: t.price,
        value: t.value,
        hasLogoUrl: !!t.logoUrl,
        logoUrl: t.logoUrl,
      })),
    });
    
    return NextResponse.json(portfolio, {
      headers: {
        "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=300",
      },
    });
  } catch (error: any) {
    console.error("Failed to load Solana portfolio:", error);
    console.error("Error details:", {
      message: error?.message,
      stack: error?.stack,
      name: error?.name,
    });
    
    // Return more detailed error information
    const errorMessage = error?.message || "Failed to load Solana portfolio";
    return NextResponse.json(
      { 
        error: errorMessage,
        tokens: [], // Return empty tokens array instead of failing completely
        totalValueUsd: 0,
        success: false,
      },
      // Use non-2xx so client doesn't overwrite good cached UI state with empty tokens.
      { status: 503 },
    );
  }
}

