import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";
import { computeHyperionYesterdayEarnedUsd } from "@/lib/protocols/yield-ai/hyperionLpYesterdayEarnings";

/**
 * GET /api/protocols/yield-ai/hyperion-lp/earnings-summary?safe=0x...
 *
 * v1: cash-basis **Yesterday earned** — fees + rewards actually claimed to the
 * safe during the previous UTC calendar day (not uncollected accrual or PnL).
 */
export async function GET(request: NextRequest) {
  try {
    const safe = request.nextUrl.searchParams.get("safe")?.trim();
    if (!safe) {
      return NextResponse.json(createErrorResponse(new Error("safe query param is required")), { status: 400 });
    }

    const result = await computeHyperionYesterdayEarnedUsd(safe);

    return NextResponse.json(
      createSuccessResponse({
        profitYesterdayUsd: result.profitYesterdayUsd,
        claimsYesterdayCount: result.claimsCount,
        window: result.window,
        pricing: { mode: "spot", note: "Claim legs valued at Panora spot (MVP)." },
      }),
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=120",
        },
      }
    );
  } catch (err) {
    return NextResponse.json(createErrorResponse(err instanceof Error ? err : new Error(String(err))), {
      status: 500,
    });
  }
}
