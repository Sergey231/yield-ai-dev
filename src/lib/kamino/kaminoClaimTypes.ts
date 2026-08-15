export type KaminoRewardRow = {
  tokenMint: string;
  tokenSymbol?: string;
  tokenLogoUrl?: string;
  amount: string;
  usdValue?: number;
};

export type KaminoClaimTargetReward = {
  tokenMint: string;
  tokenSymbol?: string;
  amount: string;
  usdValue?: number;
};

export type KaminoClaimTarget = {
  id: string;
  source: "farm" | "vault";
  farmPubkey?: string;
  vaultAddress?: string;
  isDelegated?: boolean;
  delegatees?: string[];
  rewards: KaminoClaimTargetReward[];
  usdValue?: number;
};

export type KaminoRewardsPayload = {
  rewards: KaminoRewardRow[];
  claimTargets: KaminoClaimTarget[];
  totalUsdValue?: number;
};
