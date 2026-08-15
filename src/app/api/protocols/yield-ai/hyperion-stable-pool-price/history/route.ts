import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse } from "@/lib/utils/http";
import { isHyperionStablePoolKey } from "@/lib/protocols/yield-ai/hyperionStablePoolPrice";
import { resolveHyperionPoolPriceHistoryUrl } from "@/lib/protocols/yield-ai/hyperionPoolPriceApi";

export const maxDuration = 30;

/**
 * GET /api/protocols/yield-ai/hyperion-stable-pool-price/history
 * Thin proxy → PHP hyperion_pool_price_history.php (BinChart facade, no CORS from browser).
 *
 * Query: poolKey, period (1h|1d|7d|30d), type (raw|1m|…|1h), limit
 *
 * Env: YIELDAI_API_BASE_URL or YIELDAI_HYPERION_POOL_PRICE_HISTORY_URL
 * (also derives host from YIELDAI_MESSAGE_API_URL).
 */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const poolKey = String(sp.get("poolKey") ?? "").trim();
    if (!poolKey) {
      return NextResponse.json(createErrorResponse(new Error("Missing poolKey")), { status: 400 });
    }
    if (!isHyperionStablePoolKey(poolKey)) {
      return NextResponse.json(
        createErrorResponse(new Error("Unsupported poolKey (stable pools only)")),
        { status: 400 }
      );
    }

    const upstream = new URL(resolveHyperionPoolPriceHistoryUrl());
    upstream.searchParams.set("poolKey", poolKey);
    const period = sp.get("period");
    if (period) upstream.searchParams.set("period", period);
    const type = sp.get("type") ?? sp.get("downsample");
    if (type) upstream.searchParams.set("type", type);
    const limit = sp.get("limit");
    if (limit) upstream.searchParams.set("limit", limit);

    const res = await fetch(upstream.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error: (json as { error?: string } | null)?.error || `Upstream returned ${res.status}`,
        },
        { status: res.status >= 500 ? 502 : res.status }
      );
    }

    return NextResponse.json(json);
  } catch (err) {
    return NextResponse.json(
      createErrorResponse(err instanceof Error ? err : new Error(String(err))),
      { status: 502 }
    );
  }
}
