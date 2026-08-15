import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";
import { requireStrategyMutationSecret } from "@/app/api/protocols/yield-ai/strategy/_auth";
import { runHyperionRecenterDual } from "@/lib/protocols/yield-ai/hyperionLpActions";

const LOCK_KEY = "__yieldAiHyperionRecenterDualRunning";

/**
 * POST /api/protocols/yield-ai/hyperion-lp/recenter-dual
 * Header: x-cron-secret
 * Body: {
 *   safeAddress: string,            // required
 *   halfWidthTicks?: number,        // target band (e.g. 10 ≈ ±0.1% for a stable pair)
 *   edgeBufferTicks?: number,       // also re-center within N ticks of an edge
 *   minPositionAgeSeconds?: number, // age throttle (skipped when forceRerange)
 *   minFeesUsd?: number,            // cost gate (skipped when forceRerange)
 *   forceRerange?: boolean,         // re-range every open position even if in range
 *   dryRun?: boolean,
 * }
 *
 * Swap-free re-center: claim + remove all liquidity, then dual re-add the recovered
 * legs at a centered range (no USDC round-trip). Use `forceRerange:true` to change the
 * band width on demand (e.g. ±0.5% → ±0.1%). Single-flight guarded.
 */
export async function POST(request: NextRequest) {
  const authError = requireStrategyMutationSecret(request);
  if (authError) return authError;

  const g = globalThis as Record<string, unknown>;
  if (g[LOCK_KEY]) {
    return NextResponse.json(createErrorResponse(new Error("Hyperion dual re-center is already running")), {
      status: 429,
    });
  }
  g[LOCK_KEY] = true;

  try {
    const body = await request.json().catch(() => ({}));
    const safeAddress = typeof body.safeAddress === "string" ? body.safeAddress.trim() : "";
    if (!safeAddress) {
      return NextResponse.json(createErrorResponse(new Error("safeAddress is required")), { status: 400 });
    }

    const result = await runHyperionRecenterDual({
      safeAddress,
      halfWidthTicks: body.halfWidthTicks,
      edgeBufferTicks: body.edgeBufferTicks,
      minPositionAgeSeconds: body.minPositionAgeSeconds,
      minFeesUsd: body.minFeesUsd,
      forceRerange: Boolean(body.forceRerange),
      dryRun: Boolean(body.dryRun),
    });

    return NextResponse.json(createSuccessResponse(result));
  } catch (err) {
    return NextResponse.json(createErrorResponse(err instanceof Error ? err : new Error(String(err))), {
      status: 500,
    });
  } finally {
    g[LOCK_KEY] = false;
  }
}
