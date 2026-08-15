import { toCanonicalAddress } from "@/lib/utils/addressNormalization";

export const USDC_MINT_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS_SOLANA = 6;

/** Recommended SOL for Jupiter swaps + ATA rent on a fresh wallet. */
export const DN_PILOT_RECOMMENDED_SOL = 0.05;

export type DnPilotConfig = {
  market: string;
  token: string;
  spotMint: string;
  spotDecimals: number;
  sizeUsd: number;
  safeAddress: string;
  subaccount: string;
  solanaPubkey: string;
  slippageBps: number;
  minNetEdgeBps: number;
};

const PILOT_DEFAULTS = {
  market: "GOLD/USD",
  token: "XAUt0",
  spotMint: "AymATz4TCL9sWNEEV9Kvyz45CHVhDZ6kUgjTJPzLpU9P",
  spotDecimals: 6,
  sizeUsd: 100,
  safeAddress: "0x23b329bff0ad2f462c7b212458cc0d1b20019af03766cde48bdc9f9d0a17617d",
  subaccount: "0x971eee7f82d2ed4ed9633a2292165c74b354b7932d360a8fc56ed9fa47588fb6",
  solanaPubkey: "EZrrqeQHMpXSF2BdsE9QA4wvGPM4gSiXoP8vvWnaGuVD",
  slippageBps: 50,
  minNetEdgeBps: 0,
} as const;

function stripEnv(value: string): string {
  return value.replace(/^["']|["']$/g, "").trim();
}

function envNumber(key: string, fallback: number): number {
  const raw = stripEnv(process.env[key] || "");
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envString(key: string, fallback: string): string {
  const raw = stripEnv(process.env[key] || "");
  return raw || fallback;
}

export function loadDnPilotConfig(): DnPilotConfig {
  const safeAddress = toCanonicalAddress(envString("DN_PILOT_SAFE", PILOT_DEFAULTS.safeAddress));
  const subaccount = toCanonicalAddress(envString("DN_PILOT_SUBACCOUNT", PILOT_DEFAULTS.subaccount));
  const solanaPubkey = envString("DN_PILOT_SOLANA_PUBKEY", PILOT_DEFAULTS.solanaPubkey);

  return {
    market: envString("DN_PILOT_MARKET", PILOT_DEFAULTS.market),
    token: envString("DN_PILOT_TOKEN", PILOT_DEFAULTS.token),
    spotMint: envString("DN_PILOT_SPOT_MINT", PILOT_DEFAULTS.spotMint),
    spotDecimals: envNumber("DN_PILOT_SPOT_DECIMALS", PILOT_DEFAULTS.spotDecimals),
    sizeUsd: envNumber("DN_PILOT_SIZE_USD", PILOT_DEFAULTS.sizeUsd),
    safeAddress,
    subaccount,
    solanaPubkey,
    slippageBps: envNumber("DN_PILOT_SLIPPAGE_BPS", PILOT_DEFAULTS.slippageBps),
    minNetEdgeBps: envNumber("DN_PILOT_MIN_NET_EDGE_BPS", PILOT_DEFAULTS.minNetEdgeBps),
  };
}
