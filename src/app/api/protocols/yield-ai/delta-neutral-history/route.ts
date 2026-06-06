import { NextRequest, NextResponse } from "next/server";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";
import { getDecibelExecutorAccount } from "@/lib/protocols/decibel/executorSubmit";
import {
  fetchDeltaNeutralHistory,
  type DeltaNeutralHistorySummary,
} from "@/lib/protocols/yield-ai/deltaNeutralHistory";

const APTOS_API_KEY = process.env.APTOS_API_KEY;

/**
 * GET /api/protocols/yield-ai/delta-neutral-history?safeAddress=0x...&limit=100
 *
 * Reconstructs the per-safe history of executor-signed
 * `delta_neutral::record_open` / `record_close` calls. V1 contract stores
 * only the latest snapshot, so this is the only way to surface previous
 * deals, total deal count, and the markets we hedged into.
 *
 * Cost: 1 indexer GraphQL call + 1 fullnode tx fetch per matched version
 * (capped by `limit`). Safe to call from the browser; endpoint is read-only.
 */
export async function GET(request: NextRequest) {
  try {
    const safeRaw = request.nextUrl.searchParams.get("safeAddress")?.trim();
    if (!safeRaw) {
      return NextResponse.json(
        { success: false, error: "safeAddress is required" },
        { status: 400 }
      );
    }
    const limitRaw = request.nextUrl.searchParams.get("limit");
    const scanLimit = (() => {
      if (!limitRaw) return 100;
      const n = parseInt(limitRaw, 10);
      if (!Number.isFinite(n) || n <= 0) return 100;
      return Math.min(n, 500);
    })();

    const safe = toCanonicalAddress(safeRaw);
    if (!safe.startsWith("0x")) {
      return NextResponse.json(
        { success: false, error: "Invalid safeAddress" },
        { status: 400 }
      );
    }

    let executorAddress: string;
    try {
      executorAddress = toCanonicalAddress(
        getDecibelExecutorAccount().accountAddress.toString()
      );
    } catch (e) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Executor account is not configured on the server. " +
            "Set YIELD_AI_EXECUTOR_PRIVATE_KEY to enable delta-neutral history.",
        },
        { status: 500 }
      );
    }

    const data: DeltaNeutralHistorySummary = await fetchDeltaNeutralHistory({
      safeAddress: safe,
      executorAddress,
      scanLimit,
      aptosApiKey: APTOS_API_KEY ?? null,
    });

    return NextResponse.json({ success: true, data, executorAddress });
  } catch (error) {
    console.error("[Yield AI] delta-neutral-history error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
