import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse, parseOptionalNumber } from "@/lib/utils/http";
import { requireStrategyMutationSecret } from "@/app/api/protocols/yield-ai/strategy/_auth";
import {
  HYPERION_LP_CRON_LOCK_KEY,
  runHyperionLpCronPass,
  type HyperionLpCronAction,
} from "@/lib/protocols/yield-ai/hyperionLpCron";

// Pro plan: allow up to 5 min so a busy recenter pass doesn't hit the default timeout.
export const maxDuration = 300;

function resolveAction(raw: unknown): HyperionLpCronAction {
  if (raw === "recenter") return "recenter";
  if (raw === "recenter-dual") return "recenter-dual";
  return "claim";
}

const num = parseOptionalNumber;

/**
 * Emit one [hyperion-monitor] log line per position (tick / in-range / action) so a
 * scheduled run builds an in-range time-series in function logs — no off-chain store.
 */
function logMonitor(result: Awaited<ReturnType<typeof runHyperionLpCronPass>>) {
  for (const safe of result.results) {
    const positions = (safe as { positions?: Array<Record<string, unknown>> }).positions;
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      console.log(
        `[hyperion-monitor] t=${new Date().toISOString()} safe=${safe.safeAddress} ` +
          `pos=${pos.position ?? "?"} pool=${pos.poolKey ?? "?"} tick=${pos.currentTick ?? "?"} ` +
          `outOfRange=${pos.outOfRange ?? "?"} action=${pos.action ?? "?"}`
      );
    }
  }
}

/**
 * POST /api/protocols/yield-ai/hyperion-lp/cron — secret-gated (x-cron-secret).
 * Body: {
 *   safeAddresses?: string[],
 *   action?: "claim" | "recenter" | "recenter-dual",
 *   halfWidthTicks?, edgeBufferTicks?, slippageBps?, minReopenUsdcBaseUnits?,
 *   minClaimUsd?, minRewardClaimUsd?, minRewardSwapUsd?, swapRewardsToUsdc?,
 *   minPositionAgeSeconds?, minFeesUsd?, forceRerange?, maxActionsPerRun?,
 *   poolKeys?: string[],   // recenter pool filter, e.g. ["usdt_usdc"] — phased rollout
 *   dryRun?,
 * }
 *
 * - "claim"         → auto-claim fees (+ swap APT rewards → USDC).
 * - "recenter"      → close→convert→reopen (legacy, swap-heavy).
 * - "recenter-dual" → swap-free: remove + dual re-add at a centered range (stable-pair
 *                     friendly). Gated by age / fees / out-of-range; capped per run.
 */
export async function POST(request: NextRequest) {
  const authError = requireStrategyMutationSecret(request);
  if (authError) return authError;

  const g = globalThis as Record<string, unknown>;
  if (g[HYPERION_LP_CRON_LOCK_KEY]) {
    return NextResponse.json(createErrorResponse(new Error("Hyperion LP cron is already running")), {
      status: 429,
    });
  }
  g[HYPERION_LP_CRON_LOCK_KEY] = true;

  try {
    const body = await request.json().catch(() => ({}));
    const result = await runHyperionLpCronPass({
      action: resolveAction(body.action),
      dryRun: Boolean(body.dryRun),
      safeAddresses: Array.isArray(body.safeAddresses) ? body.safeAddresses : undefined,
      halfWidthTicks: num(body.halfWidthTicks),
      edgeBufferTicks: num(body.edgeBufferTicks),
      slippageBps: num(body.slippageBps),
      minReopenUsdcBaseUnits:
        body.minReopenUsdcBaseUnits != null ? BigInt(String(body.minReopenUsdcBaseUnits)) : undefined,
      minClaimUsd: num(body.minClaimUsd),
      minRewardClaimUsd: num(body.minRewardClaimUsd),
      minRewardSwapUsd: num(body.minRewardSwapUsd),
      swapRewardsToUsdc: body.swapRewardsToUsdc !== false,
      minPositionAgeSeconds: num(body.minPositionAgeSeconds),
      minFeesUsd: num(body.minFeesUsd),
      forceRerange: Boolean(body.forceRerange),
      maxActionsPerRun: num(body.maxActionsPerRun),
      poolKeys: Array.isArray(body.poolKeys) ? body.poolKeys : undefined,
    });

    logMonitor(result);
    return NextResponse.json(createSuccessResponse(result));
  } catch (err) {
    return NextResponse.json(createErrorResponse(err instanceof Error ? err : new Error(String(err))), {
      status: 500,
    });
  } finally {
    g[HYPERION_LP_CRON_LOCK_KEY] = false;
  }
}

/**
 * GET /api/protocols/yield-ai/hyperion-lp/cron — Vercel Cron entrypoint.
 * Vercel sends GET with `Authorization: Bearer $CRON_SECRET` (set CRON_SECRET env).
 *
 * Behaviour is driven by query params so the schedule (vercel.json `crons`) controls
 * it WITHOUT a code change:
 *   - default (no query): action=recenter, dryRun=true → read-only monitor + log.
 *   - live re-range (stables-first rollout — poolKeys scopes the pass, comma-separated):
 *     ?action=recenter-dual&dryRun=false&poolKeys=usdt_usdc,usd1_usdc&halfWidthTicks=10&minPositionAgeSeconds=3600&minFeesUsd=0.005&maxActionsPerRun=10
 *   - live claim:     ?action=claim&dryRun=false&minClaimUsd=0.05
 * Always emits [hyperion-monitor] log lines regardless of dryRun.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json(createErrorResponse(new Error("Unauthorized")), { status: 401 });
  }

  const g = globalThis as Record<string, unknown>;
  if (g[HYPERION_LP_CRON_LOCK_KEY]) {
    return NextResponse.json(createErrorResponse(new Error("Hyperion LP cron is already running")), {
      status: 429,
    });
  }
  g[HYPERION_LP_CRON_LOCK_KEY] = true;

  try {
    const sp = request.nextUrl.searchParams;
    const action = sp.get("action") ? resolveAction(sp.get("action")) : "recenter";
    const dryRun = sp.get("dryRun") !== "false"; // default true (monitor)

    const result = await runHyperionLpCronPass({
      action,
      dryRun,
      halfWidthTicks: num(sp.get("halfWidthTicks")),
      edgeBufferTicks: num(sp.get("edgeBufferTicks")),
      minPositionAgeSeconds: num(sp.get("minPositionAgeSeconds")),
      minFeesUsd: num(sp.get("minFeesUsd")),
      maxActionsPerRun: num(sp.get("maxActionsPerRun")),
      minClaimUsd: num(sp.get("minClaimUsd")),
      poolKeys: sp.get("poolKeys")?.split(",").map((s) => s.trim()).filter(Boolean),
    });

    logMonitor(result);
    return NextResponse.json(createSuccessResponse(result));
  } catch (err) {
    return NextResponse.json(createErrorResponse(err instanceof Error ? err : new Error(String(err))), {
      status: 500,
    });
  } finally {
    g[HYPERION_LP_CRON_LOCK_KEY] = false;
  }
}
