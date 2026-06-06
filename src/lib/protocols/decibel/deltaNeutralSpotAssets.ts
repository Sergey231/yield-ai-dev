import {
  WBTC_FA_METADATA_MAINNET,
  XBTC_FA_METADATA_MAINNET,
} from "@/lib/constants/yieldAiVault";
import { normalizeAddress, toCanonicalAddress } from "@/lib/utils/addressNormalization";

export const APT_FA_METADATA_MAINNET =
  "0x000000000000000000000000000000000000000000000000000000000000000a";

export type DecibelBtcSpotAssetId = "wbtc" | "xbtc";

export type DecibelSpotAssetConfig = {
  id: DecibelBtcSpotAssetId | "apt";
  metadata: string;
  label: string;
  logoUrl: string;
  decimals: number;
  feeTier: number;
};

const BTC_SPOT_ASSETS: Record<DecibelBtcSpotAssetId, DecibelSpotAssetConfig> = {
  wbtc: {
    id: "wbtc",
    metadata: WBTC_FA_METADATA_MAINNET,
    label: "WBTC",
    logoUrl: "https://assets.panora.exchange/tokens/aptos/WBTC.png",
    decimals: 8,
    feeTier: 1,
  },
  xbtc: {
    id: "xbtc",
    metadata: XBTC_FA_METADATA_MAINNET,
    label: "xBTC",
    logoUrl: "https://assets.panora.exchange/tokens/aptos/xBTC.png",
    decimals: 8,
    feeTier: 1,
  },
};

export const DECIBEL_APT_SPOT_ASSET: DecibelSpotAssetConfig = {
  id: "apt",
  metadata: APT_FA_METADATA_MAINNET,
  label: "APT",
  logoUrl: "https://assets.panora.exchange/tokens/aptos/APT.svg",
  decimals: 8,
  feeTier: 1,
};

export function parseDecibelBtcSpotAssetId(raw: string | undefined | null): DecibelBtcSpotAssetId {
  return raw?.trim().toLowerCase() === "xbtc" ? "xbtc" : "wbtc";
}

export function getDecibelBtcSpotAsset(raw?: string | null): DecibelSpotAssetConfig {
  return BTC_SPOT_ASSETS[parseDecibelBtcSpotAssetId(raw)];
}

export function getConfiguredDecibelBtcSpotAsset(): DecibelSpotAssetConfig {
  return getDecibelBtcSpotAsset(process.env.DECIBEL_DN_BTC_SPOT_ASSET);
}

export function getClientDecibelBtcSpotAsset(): DecibelSpotAssetConfig {
  return getDecibelBtcSpotAsset(process.env.NEXT_PUBLIC_DECIBEL_DN_BTC_SPOT_ASSET);
}

export function getDecibelSpotAssetForMetadata(metadata: string): DecibelSpotAssetConfig | null {
  const n = normalizeAddress(toCanonicalAddress(metadata));
  if (n === normalizeAddress(WBTC_FA_METADATA_MAINNET)) return BTC_SPOT_ASSETS.wbtc;
  if (n === normalizeAddress(XBTC_FA_METADATA_MAINNET)) return BTC_SPOT_ASSETS.xbtc;
  if (n === normalizeAddress(APT_FA_METADATA_MAINNET)) return DECIBEL_APT_SPOT_ASSET;
  return null;
}

export function isDecibelBtcSpotMetadata(metadata: string): boolean {
  const n = normalizeAddress(toCanonicalAddress(metadata));
  return (
    n === normalizeAddress(WBTC_FA_METADATA_MAINNET) ||
    n === normalizeAddress(XBTC_FA_METADATA_MAINNET)
  );
}

export function decibelSpotFeeTierForMetadata(metadata: string): number {
  return getDecibelSpotAssetForMetadata(metadata)?.feeTier ?? BTC_SPOT_ASSETS.wbtc.feeTier;
}

export { WBTC_FA_METADATA_MAINNET, XBTC_FA_METADATA_MAINNET };
