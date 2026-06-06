import { NextRequest, NextResponse } from "next/server";
import { USDC_FA_METADATA_MAINNET } from "@/lib/constants/yieldAiVault";
import {
  decibelChainUnitsToHumanBase,
  decibelOpenOrderSizeChainUnits,
  type DecibelMarketConfig,
} from "@/lib/protocols/decibel/closePosition";
import {
  DECIBEL_APT_SPOT_ASSET,
  getConfiguredDecibelBtcSpotAsset,
  type DecibelSpotAssetConfig,
} from "@/lib/protocols/decibel/deltaNeutralSpotAssets";
import { getHyperionAmountIn } from "@/lib/protocols/yield-ai/engine/hyperionQuote";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";

const DECIBEL_API_KEY = process.env.DECIBEL_API_KEY;
const DECIBEL_API_BASE_URL =
  process.env.DECIBEL_API_BASE_URL || "https://api.testnet.aptoslabs.com/decibel";

const INPUT_BUFFER_BPS = BigInt(20); // Must match executor-open-delta-neutral.
const OK_SPREAD_BPS = 30; // 0.30%
const BLOCK_SPREAD_BPS = 75; // 0.75%

type PreviewSeverity = "ok" | "warning" | "block";

async function fetchDecibel(path: string) {
  if (!DECIBEL_API_KEY) throw new Error("Decibel API key not configured");
  const baseUrl = DECIBEL_API_BASE_URL.replace(/\/$/, "");
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${DECIBEL_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("Invalid response from Decibel API");
  }
  if (!res.ok) {
    const msg =
      typeof data === "object" && data !== null && "message" in (data as object)
        ? String((data as { message?: string }).message)
        : `Decibel API error: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function normalizeMarketsPayload(data: unknown): Array<DecibelMarketConfig & { market_addr?: string; market_name?: string }> {
  if (Array.isArray(data)) return data as Array<DecibelMarketConfig & { market_addr?: string; market_name?: string }>;
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  const candidates: unknown[] = [];
  if (Array.isArray(obj.items)) candidates.push(...obj.items);
  if (Array.isArray(obj.markets)) candidates.push(...obj.markets);
  if (Array.isArray(obj.data)) candidates.push(...obj.data);
  return candidates as Array<DecibelMarketConfig & { market_addr?: string; market_name?: string }>;
}

function resolveMarketForAsset(
  asset: "BTC" | "APT",
  markets: Array<DecibelMarketConfig & { market_addr?: string; market_name?: string }>
): (DecibelMarketConfig & { market_addr: string; market_name: string }) | null {
  const extractBaseSymbol = (name: string): string => {
    const upper = name.toUpperCase();
    return upper.split(/[-/_\s]/)[0] || upper;
  };
  const candidates = markets.filter((m) => {
    const name = (m.market_name || "").toUpperCase();
    if (!name) return false;
    if (name.startsWith(`${asset}-`) || name.startsWith(`${asset}/`) || name.startsWith(`${asset}_`)) {
      return true;
    }
    return extractBaseSymbol(name) === asset;
  });
  const selected = candidates[0];
  if (!selected?.market_addr || !selected?.market_name) return null;
  return {
    ...selected,
    market_addr: selected.market_addr,
    market_name: selected.market_name,
  };
}

function spotAssetConfigForAsset(asset: "BTC" | "APT"): DecibelSpotAssetConfig {
  return asset === "BTC" ? getConfiguredDecibelBtcSpotAsset() : DECIBEL_APT_SPOT_ASSET;
}

function severityForSpread(spreadBps: number): PreviewSeverity {
  if (!Number.isFinite(spreadBps) || spreadBps <= OK_SPREAD_BPS) return "ok";
  if (spreadBps <= BLOCK_SPREAD_BPS) return "warning";
  return "block";
}

function baseUnitsToHuman(baseUnits: bigint, decimals: number): number {
  return Number(baseUnits) / 10 ** decimals;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const assetRaw = (searchParams.get("asset") || "").trim().toUpperCase();
    const sizeUsd = Number(searchParams.get("sizeUsd"));

    if (assetRaw !== "BTC" && assetRaw !== "APT") {
      return NextResponse.json({ success: false, error: "asset must be BTC or APT" }, { status: 400 });
    }
    if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) {
      return NextResponse.json({ success: false, error: "sizeUsd must be a positive number" }, { status: 400 });
    }

    const asset = assetRaw as "BTC" | "APT";
    const markets = normalizeMarketsPayload(await fetchDecibel("/api/v1/markets"));
    const selectedMarket = resolveMarketForAsset(asset, markets);
    if (!selectedMarket) {
      return NextResponse.json({ success: false, error: `Market not found for asset ${asset}` }, { status: 404 });
    }

    const prices = (await fetchDecibel(
      `/api/v1/prices?market=${encodeURIComponent(selectedMarket.market_addr)}`
    )) as Array<{ mark_px?: number; mid_px?: number }>;
    const firstPrice = Array.isArray(prices) ? prices[0] : null;
    const markPx = Number(firstPrice?.mark_px ?? firstPrice?.mid_px ?? NaN);
    if (!Number.isFinite(markPx) || markPx <= 0) {
      return NextResponse.json({ success: false, error: "Failed to resolve Decibel mark price" }, { status: 502 });
    }

    const shortSizeChainUnits = BigInt(decibelOpenOrderSizeChainUnits(sizeUsd, markPx, selectedMarket));
    const shortSizeHumanBase = decibelChainUnitsToHumanBase(
      shortSizeChainUnits,
      selectedMarket.sz_decimals ?? 9
    );
    const shortNotionalUsd = shortSizeHumanBase * markPx;
    if (!Number.isFinite(shortNotionalUsd) || shortNotionalUsd <= 0) {
      return NextResponse.json({ success: false, error: "Failed to size Decibel order" }, { status: 502 });
    }

    const spotAsset = spotAssetConfigForAsset(asset);
    const targetSpotOutBaseUnits = BigInt(
      Math.max(1, Math.ceil(shortSizeHumanBase * 10 ** spotAsset.decimals))
    );
    const quoteUsdcInBaseUnits = await getHyperionAmountIn({
      amountOutBaseUnits: targetSpotOutBaseUnits,
      fromMetadata: USDC_FA_METADATA_MAINNET,
      toMetadata: toCanonicalAddress(spotAsset.metadata),
    });
    const bufferedUsdcInBaseUnits =
      (quoteUsdcInBaseUnits * (BigInt(10_000) + INPUT_BUFFER_BPS)) / BigInt(10_000);

    const targetSpotHuman = baseUnitsToHuman(targetSpotOutBaseUnits, spotAsset.decimals);
    const quoteUsdcInUsd = baseUnitsToHuman(quoteUsdcInBaseUnits, 6);
    const bufferedUsdcInUsd = baseUnitsToHuman(bufferedUsdcInBaseUnits, 6);
    const hyperionEffectivePrice = targetSpotHuman > 0 ? quoteUsdcInUsd / targetSpotHuman : null;
    const bufferedEffectivePrice = targetSpotHuman > 0 ? bufferedUsdcInUsd / targetSpotHuman : null;
    const spreadBps =
      bufferedEffectivePrice != null && markPx > 0
        ? ((bufferedEffectivePrice / markPx) - 1) * 10_000
        : 0;
    const estimatedEntryCostUsd = bufferedUsdcInUsd - shortNotionalUsd;

    return NextResponse.json({
      success: true,
      data: {
        asset,
        requestedSizeUsd: sizeUsd,
        marketAddr: selectedMarket.market_addr,
        marketName: selectedMarket.market_name,
        spotAsset: spotAsset.id,
        spotAssetLabel: spotAsset.label,
        spotMetadata: toCanonicalAddress(spotAsset.metadata),
        decibelMark: markPx,
        shortSizeBaseUnits: shortSizeChainUnits.toString(),
        shortSizeHumanBase,
        shortNotionalUsd,
        targetSpotOutBaseUnits: targetSpotOutBaseUnits.toString(),
        targetSpotHuman,
        quoteUsdcInBaseUnits: quoteUsdcInBaseUnits.toString(),
        quoteUsdcInUsd,
        bufferedUsdcInBaseUnits: bufferedUsdcInBaseUnits.toString(),
        bufferedUsdcInUsd,
        hyperionEffectivePrice,
        bufferedEffectivePrice,
        spreadBps,
        spreadPct: spreadBps / 100,
        estimatedEntryCostUsd,
        inputBufferBps: Number(INPUT_BUFFER_BPS),
        thresholds: {
          okBps: OK_SPREAD_BPS,
          blockBps: BLOCK_SPREAD_BPS,
        },
        severity: severityForSpread(spreadBps),
      },
    });
  } catch (error) {
    console.error("[Decibel] delta-neutral-open-preview error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    const status =
      message.includes("not configured") ? 503 : message.includes("Hyperion quote") ? 502 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
