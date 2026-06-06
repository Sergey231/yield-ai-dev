/**
 * Hard-coded fallback metadata for the canonical Solana mints we always want
 * to render correctly even when the Jupiter token-search service has a
 * transient miss (429 / cold cache / network blip). Without this fallback the
 * route shortens unknown mints to `So11…` / `EPjF…` in the UI, which has
 * happened repeatedly on the Vercel preview for the very same SOL/USDC pool.
 *
 * Keep this list short — it's a safety net, not a directory.
 */
export interface WellKnownToken {
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string;
}

export const WELL_KNOWN_SOLANA_TOKENS: Record<string, WellKnownToken> = {
  So11111111111111111111111111111111111111112: {
    symbol: "SOL",
    name: "Wrapped SOL",
    decimals: 9,
    logoUrl: "/token_ico/sol.png",
  },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logoUrl: "/token_ico/usdc.png",
  },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: {
    symbol: "USDT",
    name: "Tether USD",
    decimals: 6,
    logoUrl: "/token_ico/usdt.png",
  },
  USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA: {
    symbol: "USDS",
    name: "USDS",
    decimals: 6,
    logoUrl: "/token_ico/usds.png",
  },
};

export function lookupWellKnownToken(mint: string): WellKnownToken | undefined {
  return WELL_KNOWN_SOLANA_TOKENS[mint];
}
