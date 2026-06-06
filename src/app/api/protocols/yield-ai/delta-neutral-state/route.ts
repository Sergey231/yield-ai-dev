import { NextRequest, NextResponse } from "next/server";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { normalizeAddress, toCanonicalAddress } from "@/lib/utils/addressNormalization";
import {
  DELTA_NEUTRAL_GET_POSITION_VIEW,
  parseDeltaNeutralPositionView,
  type DeltaNeutralCloseSwapStatus,
  type DeltaNeutralSpotHedgeInference,
  type DeltaNeutralStateResponse,
} from "@/lib/protocols/yield-ai/deltaNeutralViews";
import { fetchIndexerFaBalanceForMetadataAtOwner } from "@/lib/protocols/yield-ai/indexerFaBalance";
import { resolveCloseSwapUsdcOut } from "@/lib/protocols/yield-ai/closeSwapResolver";

const APTOS_API_KEY = process.env.APTOS_API_KEY;
const DECIBEL_API_KEY = process.env.DECIBEL_API_KEY;
const DECIBEL_API_BASE_URL =
  process.env.DECIBEL_API_BASE_URL || "https://api.testnet.aptoslabs.com/decibel";

async function fetchDecibelMarketSzDecimals(perpMarket: string): Promise<number | null> {
  if (!DECIBEL_API_KEY) return null;
  try {
    const baseUrl = DECIBEL_API_BASE_URL.replace(/\/$/, "");
    const res = await fetch(`${baseUrl}/api/v1/markets`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${DECIBEL_API_KEY}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) return null;
    const raw = await res.json();
    const list: Array<{ market_addr?: string; sz_decimals?: number }> = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.items)
        ? raw.items
        : Array.isArray(raw?.markets)
          ? raw.markets
          : Array.isArray(raw?.data)
            ? raw.data
            : [];
    const want = normalizeAddress(toCanonicalAddress(perpMarket));
    const match = list.find(
      (m) => m.market_addr && normalizeAddress(toCanonicalAddress(m.market_addr)) === want
    );
    const sz = match?.sz_decimals;
    return typeof sz === "number" && Number.isFinite(sz) ? sz : null;
  } catch {
    return null;
  }
}

const aptos = new Aptos(
  new AptosConfig({
    network: Network.MAINNET,
    ...(APTOS_API_KEY && {
      clientConfig: { HEADERS: { Authorization: `Bearer ${APTOS_API_KEY}` } },
    }),
  })
);

/**
 * GET /api/protocols/yield-ai/delta-neutral-state?safeAddress=0x...
 * Reads on-chain delta-neutral registry position for the Yield AI safe (mainnet).
 */
export async function GET(request: NextRequest) {
  try {
    const safeRaw = request.nextUrl.searchParams.get("safeAddress")?.trim();
    if (!safeRaw) {
      return NextResponse.json({ success: false, error: "safeAddress is required" }, { status: 400 });
    }
    const safe = toCanonicalAddress(safeRaw);
    if (!safe.startsWith("0x")) {
      return NextResponse.json({ success: false, error: "Invalid safeAddress" }, { status: 400 });
    }

    const raw = await aptos.view({
      payload: {
        function: DELTA_NEUTRAL_GET_POSITION_VIEW,
        typeArguments: [],
        functionArguments: [safe],
      },
    });

    const position = parseDeltaNeutralPositionView(raw);
    if (!position) {
      const hint =
        raw == null
          ? "null"
          : Array.isArray(raw)
            ? `array length ${raw.length}`
            : typeof raw === "object"
              ? `object keys: ${Object.keys(raw as object).join(", ")}`
              : typeof raw;
      console.warn("[Yield AI] delta-neutral-state parse failed; raw shape:", hint);
      return NextResponse.json(
        {
          success: false,
          error: "Unexpected view response from delta_neutral::get_delta_neutral_position",
          debug: { rawHint: hint },
        },
        { status: 502 }
      );
    }

    let spotBalanceBaseUnits = BigInt(0);
    const metaNorm = normalizeAddress(toCanonicalAddress(position.spotAssetMetadata));
    const hasSpotMeta = Boolean(metaNorm && metaNorm !== normalizeAddress("0x0"));
    if (position.recordExists && hasSpotMeta) {
      spotBalanceBaseUnits = await fetchIndexerFaBalanceForMetadataAtOwner(
        safe,
        position.spotAssetMetadata,
        APTOS_API_KEY
      );
    }

    let spotHedgeInference: DeltaNeutralSpotHedgeInference;
    let spotHedgeInferenceNote: string;
    if (!position.recordExists) {
      spotHedgeInference = "no_record";
      spotHedgeInferenceNote =
        "No on-chain delta-neutral record for this safe; indexer spot balance is not attached.";
    } else if (position.isOpen) {
      spotHedgeInference = "open";
      spotHedgeInferenceNote =
        "Open position: indexer balance is for the recorded spot metadata on this safe (may lag Panora).";
    } else if (!hasSpotMeta) {
      spotHedgeInference = "closed_spot_metadata_empty";
      spotHedgeInferenceNote =
        "Record is closed but spot metadata is empty; cannot infer spot FA from indexer.";
    } else if (spotBalanceBaseUnits > BigInt(0)) {
      spotHedgeInference = "closed_spot_still_on_safe";
      spotHedgeInferenceNote =
        "Registry shows closed, but indexer still reports spot FA for this metadata on the safe—close-path swap may have been skipped or failed, or assets were re-deposited.";
    } else {
      spotHedgeInference = "closed_no_spot_for_metadata";
      spotHedgeInferenceNote =
        "Indexer shows zero for this spot metadata on the safe—likely sold on close or moved manually (not provable from the registry alone).";
    }

    const spotHuman =
      spotBalanceBaseUnits === BigInt(0)
        ? null
        : (Number(spotBalanceBaseUnits) / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 });

    const szDecimals = position.recordExists && position.perpMarket
      ? await fetchDecibelMarketSzDecimals(position.perpMarket)
      : null;

    let closeSwapStatus: DeltaNeutralCloseSwapStatus = "skipped";
    let closeSwapUsdcOutBaseUnits: string | null = null;
    let closeSwapTxVersion: string | null = null;
    let closeSwapNote = "Position is open or no close-version recorded.";
    if (
      position.recordExists &&
      !position.isOpen &&
      hasSpotMeta &&
      position.closeDecibelTxVersion !== "0"
    ) {
      const resolution = await resolveCloseSwapUsdcOut({
        safeAddress: safe,
        spotAssetMetadata: position.spotAssetMetadata,
        closeDecibelTxVersion: position.closeDecibelTxVersion,
        aptosApiKey: APTOS_API_KEY,
      });
      closeSwapStatus = resolution.status;
      closeSwapNote = resolution.note;
      if (resolution.status === "resolved") {
        closeSwapUsdcOutBaseUnits = resolution.usdcOutBaseUnits;
        closeSwapTxVersion = resolution.swapTxVersion;
      }
    }

    const data: DeltaNeutralStateResponse = {
      ...position,
      spotBalanceBaseUnits: spotBalanceBaseUnits.toString(),
      spotBalanceHumanApprox: spotHuman,
      spotHedgeInference,
      spotHedgeInferenceNote,
      szDecimals,
      closeSwapStatus,
      closeSwapUsdcOutBaseUnits,
      closeSwapTxVersion,
      closeSwapNote,
    };

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[Yield AI] delta-neutral-state error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
