import { NextRequest, NextResponse } from "next/server";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { USDC_FA_METADATA_MAINNET } from "@/lib/constants/yieldAiVault";
import {
  decibelChainUnitsToHumanBase,
  type DecibelMarketConfig,
} from "@/lib/protocols/decibel/closePosition";
import {
  getDecibelSpotAssetForMetadata,
  type DecibelSpotAssetConfig,
} from "@/lib/protocols/decibel/deltaNeutralSpotAssets";
import { getHyperionAmountOut } from "@/lib/protocols/yield-ai/engine/hyperionQuote";
import { fetchFaBalanceIndexerOrOnChain } from "@/lib/protocols/yield-ai/indexerFaBalance";
import {
  DELTA_NEUTRAL_GET_POSITION_VIEW,
  parseDeltaNeutralPositionView,
} from "@/lib/protocols/yield-ai/deltaNeutralViews";
import { normalizeAddress, toCanonicalAddress } from "@/lib/utils/addressNormalization";

const DECIBEL_API_KEY = process.env.DECIBEL_API_KEY;
const DECIBEL_API_BASE_URL =
  process.env.DECIBEL_API_BASE_URL || "https://api.testnet.aptoslabs.com/decibel";
const APTOS_API_KEY = process.env.APTOS_API_KEY;

const OK_EXIT_COST_BPS = 30; // 0.30%
const BLOCK_EXIT_COST_BPS = 75; // 0.75%
const DECIBEL_TAKER_FEE_BPS = 3.4;

type PreviewSeverity = "ok" | "warning" | "block";

type DecibelAccountPosition = {
  market?: string;
  size?: number;
  is_deleted?: boolean;
};

function getAptosClient(): Aptos {
  return new Aptos(
    new AptosConfig({
      network: Network.MAINNET,
      ...(APTOS_API_KEY && { clientConfig: { HEADERS: { Authorization: `Bearer ${APTOS_API_KEY}` } } }),
    })
  );
}

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

function severityForExitCost(exitCostBps: number): PreviewSeverity {
  if (!Number.isFinite(exitCostBps) || exitCostBps <= OK_EXIT_COST_BPS) return "ok";
  if (exitCostBps <= BLOCK_EXIT_COST_BPS) return "warning";
  return "block";
}

function baseUnitsToHuman(baseUnits: bigint, decimals: number): number {
  return Number(baseUnits) / 10 ** decimals;
}

function fallbackSpotAsset(metadata: string): DecibelSpotAssetConfig {
  return {
    id: "apt",
    metadata,
    label: "spot",
    logoUrl: "",
    decimals: 8,
    feeTier: 1,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const safeRaw = (searchParams.get("safeAddress") || "").trim();
    if (!safeRaw) {
      return NextResponse.json({ success: false, error: "safeAddress is required" }, { status: 400 });
    }

    const safeAddress = toCanonicalAddress(safeRaw);
    if (!safeAddress.startsWith("0x")) {
      return NextResponse.json({ success: false, error: "Invalid safeAddress" }, { status: 400 });
    }

    const aptos = getAptosClient();
    const positionRaw = await aptos.view({
      payload: {
        function: DELTA_NEUTRAL_GET_POSITION_VIEW,
        typeArguments: [],
        functionArguments: [safeAddress],
      },
    });
    const position = parseDeltaNeutralPositionView(positionRaw);
    if (!position?.recordExists || !position.isOpen) {
      return NextResponse.json({ success: false, error: "No open delta-neutral position" }, { status: 404 });
    }

    const marketAddr = toCanonicalAddress(position.perpMarket);
    const spotMetadata = toCanonicalAddress(position.spotAssetMetadata);
    const spotAsset = getDecibelSpotAssetForMetadata(spotMetadata) ?? fallbackSpotAsset(spotMetadata);

    const [marketsRaw, priceRaw, spotBalance] = await Promise.all([
      fetchDecibel("/api/v1/markets"),
      fetchDecibel(`/api/v1/prices?market=${encodeURIComponent(marketAddr)}`),
      fetchFaBalanceIndexerOrOnChain({
        aptos,
        owner: safeAddress,
        metadata: spotMetadata,
        aptosApiKey: APTOS_API_KEY,
      }),
    ]);

    const markets = normalizeMarketsPayload(marketsRaw);
    const marketConfig = markets.find(
      (m) => m.market_addr && normalizeAddress(toCanonicalAddress(m.market_addr)) === normalizeAddress(marketAddr)
    );
    if (!marketConfig?.market_addr) {
      return NextResponse.json({ success: false, error: "Market config not found" }, { status: 404 });
    }

    const prices = Array.isArray(priceRaw) ? (priceRaw as Array<{ mark_px?: number; mid_px?: number }>) : [];
    const firstPrice = prices[0] ?? null;
    const markPx = Number(firstPrice?.mark_px ?? firstPrice?.mid_px ?? NaN);
    if (!Number.isFinite(markPx) || markPx <= 0) {
      return NextResponse.json({ success: false, error: "Failed to resolve Decibel mark price" }, { status: 502 });
    }

    const spotBalanceBaseUnits = spotBalance.amount;
    const spotBalanceHuman = baseUnitsToHuman(spotBalanceBaseUnits, spotAsset.decimals);
    const recordedShortHumanBase = decibelChainUnitsToHumanBase(
      BigInt(position.filledShortSize),
      marketConfig.sz_decimals ?? 9
    );

    let liveShortHumanBase: number | null = null;
    try {
      const positionsRaw = (await fetchDecibel(
        `/api/v1/account_positions?account=${encodeURIComponent(position.decibelSubaccount)}`
      )) as unknown;
      const list = Array.isArray(positionsRaw) ? (positionsRaw as DecibelAccountPosition[]) : [];
      const row = list.find((p) => {
        if (!p || p.is_deleted) return false;
        const m = String(p.market || "");
        if (!m) return false;
        if (normalizeAddress(toCanonicalAddress(m)) !== normalizeAddress(marketAddr)) return false;
        const sz = Number(p.size);
        return Number.isFinite(sz) && sz < 0;
      });
      const sz = Number(row?.size);
      if (Number.isFinite(sz) && sz < 0) liveShortHumanBase = Math.abs(sz);
    } catch {
      liveShortHumanBase = null;
    }

    if (spotBalanceBaseUnits <= BigInt(0)) {
      return NextResponse.json({
        success: true,
        data: {
          safeAddress,
          marketAddr,
          marketName: marketConfig.market_name ?? "",
          decibelSubaccount: position.decibelSubaccount,
          spotAssetLabel: spotAsset.label,
          spotMetadata,
          spotBalanceBaseUnits: "0",
          spotBalanceHuman: 0,
          spotBalanceSource: spotBalance.source,
          decibelMark: markPx,
          recordedShortHumanBase,
          liveShortHumanBase,
          hasSpotBalance: false,
          quoteUsdcOutBaseUnits: null,
          quoteUsdcOutUsd: null,
          hyperionEffectivePrice: null,
          spreadBps: null,
          spreadPct: null,
          exitCostBps: null,
          estimatedSpotExitCostUsd: null,
          estimatedDecibelCloseFeeUsd: null,
          severity: "ok" as PreviewSeverity,
          thresholds: {
            okBps: OK_EXIT_COST_BPS,
            blockBps: BLOCK_EXIT_COST_BPS,
          },
        },
      });
    }

    const quoteUsdcOutBaseUnits = await getHyperionAmountOut({
      amountInBaseUnits: spotBalanceBaseUnits,
      fromMetadata: spotMetadata,
      toMetadata: USDC_FA_METADATA_MAINNET,
    });
    const quoteUsdcOutUsd = baseUnitsToHuman(quoteUsdcOutBaseUnits, 6);
    const hyperionEffectivePrice = spotBalanceHuman > 0 ? quoteUsdcOutUsd / spotBalanceHuman : null;
    const spotMarkValueUsd = spotBalanceHuman * markPx;
    const spreadBps =
      hyperionEffectivePrice != null && markPx > 0
        ? ((hyperionEffectivePrice / markPx) - 1) * 10_000
        : null;
    const exitCostBps = spreadBps == null ? null : -spreadBps;
    const estimatedSpotExitCostUsd = spotMarkValueUsd - quoteUsdcOutUsd;
    const closeShortHuman = liveShortHumanBase ?? recordedShortHumanBase;
    const estimatedDecibelCloseFeeUsd = closeShortHuman * markPx * (DECIBEL_TAKER_FEE_BPS / 10_000);

    return NextResponse.json({
      success: true,
      data: {
        safeAddress,
        marketAddr,
        marketName: marketConfig.market_name ?? "",
        decibelSubaccount: position.decibelSubaccount,
        spotAssetLabel: spotAsset.label,
        spotMetadata,
        spotBalanceBaseUnits: spotBalanceBaseUnits.toString(),
        spotBalanceHuman,
        spotBalanceSource: spotBalance.source,
        decibelMark: markPx,
        recordedShortHumanBase,
        liveShortHumanBase,
        hasSpotBalance: true,
        quoteUsdcOutBaseUnits: quoteUsdcOutBaseUnits.toString(),
        quoteUsdcOutUsd,
        hyperionEffectivePrice,
        spreadBps,
        spreadPct: spreadBps == null ? null : spreadBps / 100,
        exitCostBps,
        estimatedSpotExitCostUsd,
        estimatedDecibelCloseFeeUsd,
        severity: severityForExitCost(exitCostBps ?? 0),
        thresholds: {
          okBps: OK_EXIT_COST_BPS,
          blockBps: BLOCK_EXIT_COST_BPS,
        },
      },
    });
  } catch (error) {
    console.error("[Decibel] delta-neutral-close-preview error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    const status =
      message.includes("not configured") ? 503 : message.includes("Hyperion quote") ? 502 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
