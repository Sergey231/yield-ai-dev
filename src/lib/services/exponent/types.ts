export type ExponentPositionSource =
  | "exponent-pt"
  | "exponent-yt"
  | "exponent-yt-staked"
  | "exponent-clmm"
  | "exponent-strategy-vault";

export type ExponentUserPositionRow = {
  source: ExponentPositionSource;
  vaultAddress: string;
  symbol: string;
  ticker?: string;
  platform?: string;
  mint?: string;
  positionAddress?: string;
  amountRaw: string;
  amountUi: number;
  impliedApy?: number;
  lpPrice?: number;
  maturityDateUnixTs?: number;
  valueUsd: number | null;
  underlyingMint?: string;
  underlyingSymbol?: string;
  underlyingLogoUrl?: string;
  /** Mint used only for UI icon (e.g. strategy vault share vs economic underlying). */
  tokenIconMint?: string;
  tokenIconSymbol?: string;
  clmmMarketAddress?: string;
};

export type ExponentUserPositionsResult = {
  positions: ExponentUserPositionRow[];
  meta: {
    wallet: string;
    totalValueUsd: number;
    marketsCatalogCount: number;
    strategyVaultCatalogCount: number;
    walletSplMintsWithBalance: number;
    timingsMs?: Record<string, number>;
  };
};
