import type { ComponentProps } from "react";
import type { DepositModal } from "@/components/ui/deposit-modal";
import {
  USDC_FA_METADATA_MAINNET,
  WBTC_FA_METADATA_MAINNET,
  YIELD_AI_HYPERION_POOLS,
} from "@/lib/constants/yieldAiVault";

const USDC_LOGO_APTOS = "https://assets.panora.exchange/tokens/aptos/USDC.svg";
const WBTC_LOGO_APTOS = "https://assets.panora.exchange/tokens/aptos/WBTC.png";

export type HyperionAgentDepositToken = {
  symbol: string;
  logo: string;
  decimals: number;
  address: string;
};

/** Wallet -> safe deposit tokens for Hyperion LP agents (vault::deposit metadata). */
export const HYPERION_AGENT_DEPOSIT_TOKENS: HyperionAgentDepositToken[] = [
  { symbol: "USDC", logo: USDC_LOGO_APTOS, decimals: 6, address: USDC_FA_METADATA_MAINNET },
  { symbol: "WBTC", logo: WBTC_LOGO_APTOS, decimals: 8, address: WBTC_FA_METADATA_MAINNET },
  {
    symbol: "USDt",
    logo: "https://assets.panora.exchange/tokens/aptos/USDT.svg",
    decimals: 6,
    address: YIELD_AI_HYPERION_POOLS.usdt_usdc.tokenA,
  },
];

/** Minimum notional for Hyperion agent deposits (USD-equivalent for all tokens). */
export const HYPERION_AGENT_MIN_DEPOSIT_USD = 0.1;

export type HyperionAgentDepositModalConfig = Omit<
  ComponentProps<typeof DepositModal>,
  "isOpen" | "onClose"
>;

/**
 * Shared DepositModal props for Hyperion LP agent funding (main dashboard card +
 * manage-positions header). Keeps branding and token picker in sync.
 */
export function buildHyperionAgentDepositModalConfig(params: {
  aiAgentLogoUrl: string;
  hyperionLogoUrl?: string;
  yieldAiSafeAddress?: string;
  /** Historical PnL APR on manage view; main card passes 0. */
  apy?: number;
  onDepositSuccess?: () => void;
}): HyperionAgentDepositModalConfig {
  const primary = HYPERION_AGENT_DEPOSIT_TOKENS[0];
  return {
    protocol: {
      name: "Hyperion LP agent",
      logo: params.aiAgentLogoUrl,
      apy: params.apy ?? 0,
      key: "yield-ai",
    },
    tokenIn: primary,
    tokenOut: primary,
    tokenInOptions: HYPERION_AGENT_DEPOSIT_TOKENS,
    priceUSD: 1,
    yieldAiSafeAddress: params.yieldAiSafeAddress,
    yieldAiMinDepositUsd: HYPERION_AGENT_MIN_DEPOSIT_USD,
    secondaryLogoUrl: params.hyperionLogoUrl,
    secondaryLogoAlt: "Hyperion",
    yieldAiSuccessDescription: "",
    onDepositSuccess: params.onDepositSuccess,
  };
}
