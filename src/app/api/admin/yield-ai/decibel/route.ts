import { NextRequest, NextResponse } from "next/server";
import { buildDecibelBuilderFeeReport } from "@/lib/admin/decibelBuilderFeeReport";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_RANGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /api/admin/yield-ai/decibel?from=2026-05-24&to=2026-06-24
 *
 * Reports Decibel builder-fee order volume for:
 * - direct Decibel positions sponsored by the Yield AI gas station
 * - Yield AI agent delta-neutral Decibel legs submitted by the executor
 *
 * `to` is treated as an inclusive calendar date for date-only values.
 */
export async function GET(request: NextRequest) {
  try {
    const now = new Date();
    const defaultToExclusive = startOfUtcDay(new Date(now.getTime() + DAY_MS));
    const defaultFrom = new Date(defaultToExclusive.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);

    const from =
      parseDateParam(request.nextUrl.searchParams.get("from"), "start") ?? defaultFrom;
    const toExclusive =
      parseDateParam(request.nextUrl.searchParams.get("to"), "end-exclusive") ??
      defaultToExclusive;

    const report = await buildDecibelBuilderFeeReport({ from, toExclusive });
    return NextResponse.json(createSuccessResponse(report));
  } catch (error) {
    console.error("[Admin Decibel] report error:", error);
    return NextResponse.json(
      createErrorResponse(error instanceof Error ? error : new Error("Unknown error")),
      { status: 500 },
    );
  }
}

function parseDateParam(
  value: string | null,
  mode: "start" | "end-exclusive",
): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const date = new Date(`${trimmed}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime())) return null;
    return mode === "end-exclusive" ? new Date(date.getTime() + DAY_MS) : date;
  }
  const parsed = new Date(trimmed);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
