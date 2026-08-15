export type DnSolanaPriceKind = "usd" | "xstock";

export type DnSolanaWatchItem = {
  market: string;
  token: string;
  mint: string;
  /** Output token decimals for Jupiter ExactIn quote → effective price. */
  outputDecimals: number;
  /** Legacy tag; quotes use swap route prices, not price-feed fields. */
  priceKind: DnSolanaPriceKind;
  /** If true, spread vs mark is not a valid DN hedge (different index). */
  basisWarning?: string;
};

export const DN_SPREAD_MONITOR_NOTIONAL_USD = [500, 5_000] as const;

export const DN_SPREAD_MONITOR_SOLANA: DnSolanaWatchItem[] = [
  {
    market: "BTC/USD",
    token: "cbBTC",
    mint: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij",
    outputDecimals: 8,
    priceKind: "usd",
  },
  {
    market: "ETH/USD",
    token: "WETH",
    mint: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
    outputDecimals: 8,
    priceKind: "usd",
  },
  {
    market: "SOL/USD",
    token: "SOL",
    mint: "So11111111111111111111111111111111111111112",
    outputDecimals: 9,
    priceKind: "usd",
  },
  {
    market: "HYPE/USD",
    token: "HYPE",
    mint: "98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g",
    outputDecimals: 9,
    priceKind: "usd",
  },
  {
    market: "ZEC/USD",
    token: "ZEC",
    mint: "A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS",
    outputDecimals: 8,
    priceKind: "usd",
  },
  {
    market: "GOLD/USD",
    token: "XAUt0",
    mint: "AymATz4TCL9sWNEEV9Kvyz45CHVhDZ6kUgjTJPzLpU9P",
    outputDecimals: 6,
    priceKind: "usd",
  },
  {
    market: "SILVER/USD",
    token: "SLVon",
    mint: "iy11ytbSGcUnrjE6Lfv78TFqxKyUESfku1FugS9ondo",
    outputDecimals: 8,
    priceKind: "xstock",
    basisWarning: "Ondo SLV ETF (~$60 NAV), not spot silver oz (~$67 Decibel mark)",
  },
  {
    market: "SILVER/USD",
    token: "SLVx",
    mint: "XsxAd6okt8y1RRK6gNg7iJaqiWNiq5Md5EDf3ZrF2dm",
    outputDecimals: 8,
    priceKind: "xstock",
    basisWarning: "Backed SLVx tracks SLV ETF; illiquid pool",
  },
  {
    market: "NVDA/USD",
    token: "NVDAx",
    mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    outputDecimals: 8,
    priceKind: "xstock",
  },
  {
    market: "GOOGL/USD",
    token: "GOOGLx",
    mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    outputDecimals: 8,
    priceKind: "xstock",
  },
  {
    market: "TSLA/USD",
    token: "TSLAx",
    mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    outputDecimals: 8,
    priceKind: "xstock",
  },
  {
    market: "SPY/USD",
    token: "SPYx",
    mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    outputDecimals: 8,
    priceKind: "xstock",
  },
  {
    market: "QQQ/USD",
    token: "QQQx",
    mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
    outputDecimals: 8,
    priceKind: "xstock",
  },
  {
    market: "AMZN/USD",
    token: "AMZNx",
    mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg",
    outputDecimals: 8,
    priceKind: "xstock",
  },
];

export const DN_SPREAD_MONITOR_APTOS_ASSETS = ["BTC", "APT"] as const;

/** Jupiter sell quotes for all watchlist items without basis mismatch (excludes SILVER legs). */
export const DN_SPREAD_MONITOR_SOLANA_EXIT: DnSolanaWatchItem[] = DN_SPREAD_MONITOR_SOLANA.filter(
  (item) => !item.basisWarning
);
