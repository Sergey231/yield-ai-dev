import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";
import { runYieldAiVaultCronPass } from "@/lib/protocols/yield-ai/yieldAiVaultWorker";
import {
  HYPERION_LP_CRON_LOCK_KEY,
  runHyperionLpCronPass,
  type HyperionLpCronRunResult,
} from "@/lib/protocols/yield-ai/hyperionLpCron";

type CronRunBody = {
  /** Some clients send `"true"` / `"false"` instead of JSON booleans. */
  dryRun?: boolean | string;
  /** Optional: run engine only for these safes (addresses). */
  safeAddresses?: string[];
  pageSize?: number;
  maxSafesProcessedPerRun?: number;
  maxTxPerRun?: number;
  concurrencyReads?: number;
  /**
   * Default true: the primary cron also runs Hyperion LP auto-claim so the
   * external scheduler has a single entrypoint. Set false for stablecoin-only
   * manual runs.
   */
  includeHyperionLp?: boolean | string;
  hyperionMinClaimUsd?: number | string;
  hyperionMinRewardClaimUsd?: number | string;
  hyperionMinRewardSwapUsd?: number | string;
  hyperionSwapRewardsToUsdc?: boolean | string;
};

function getGlobalLockKey() {
  return "__yieldAiVaultCronRunning";
}

function parseOptionalBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const s = value.trim().toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return undefined;
}

export async function POST(request: NextRequest) {
  const secret = process.env.YIELD_AI_CRON_SECRET;
  const provided = request.headers.get("x-cron-secret");

  if (!secret) {
    return NextResponse.json(
      createErrorResponse(
        new Error("YIELD_AI_CRON_SECRET is not configured on the server")
      ),
      { status: 500 }
    );
  }

  if (!provided || provided !== secret) {
    return NextResponse.json(createErrorResponse(new Error("Unauthorized")), {
      status: 401,
    });
  }

  const lockKey = getGlobalLockKey();
  const g = globalThis as any;
  if (g[lockKey]) {
    return NextResponse.json(
      createErrorResponse(new Error("Cron worker is already running")),
      { status: 429 }
    );
  }

  g[lockKey] = true;

  try {
    const contentLength = request.headers.get("content-length");
    const raw = await request.text();
    const rawTrimmed = raw.trim();

    let body: CronRunBody = {};
    if (rawTrimmed.length > 0) {
      try {
        body = JSON.parse(rawTrimmed) as CronRunBody;
      } catch (parseErr) {
        console.error("[Yield AI] cron: invalid JSON body", {
          contentLength,
          rawByteLength: Buffer.byteLength(raw, "utf8"),
          rawPreview: raw.slice(0, 400),
          parseErr:
            parseErr instanceof Error ? parseErr.message : String(parseErr),
        });
      }
    } else {
      console.warn("[Yield AI] cron: empty request body (defaults will apply)", {
        contentLength,
        contentType: request.headers.get("content-type"),
      });
    }

    const dryRun =
      body.dryRun === true ||
      (typeof body.dryRun === "string" &&
        body.dryRun.toLowerCase() === "true");
    const safeAddresses = Array.isArray(body.safeAddresses)
      ? body.safeAddresses.filter((x) => typeof x === "string" && x.trim().length > 0)
      : undefined;
    const includeHyperionLp = parseOptionalBool(body.includeHyperionLp) ?? true;
    const hyperionSwapRewardsToUsdc =
      parseOptionalBool(body.hyperionSwapRewardsToUsdc) ?? true;
    const hyperionMinClaimUsd = Number(body.hyperionMinClaimUsd);
    const hyperionMinRewardClaimUsd = Number(body.hyperionMinRewardClaimUsd);
    const hyperionMinRewardSwapUsd = Number(body.hyperionMinRewardSwapUsd);

    console.log("[Yield AI] cron: parsed request", {
      contentLength,
      contentType: request.headers.get("content-type"),
      rawByteLength: Buffer.byteLength(raw, "utf8"),
      rawPreview:
        rawTrimmed.length > 0
          ? `${rawTrimmed.slice(0, 300)}${rawTrimmed.length > 300 ? "…" : ""}`
          : "(empty)",
      dryRunFromPayload: body.dryRun,
      dryRunResolved: dryRun,
      safeAddresses: Array.isArray(body.safeAddresses) ? body.safeAddresses.length : undefined,
      pageSize: body.pageSize,
      maxSafesProcessedPerRun: body.maxSafesProcessedPerRun,
      maxTxPerRun: body.maxTxPerRun,
      concurrencyReads: body.concurrencyReads,
      includeHyperionLp,
      hyperionMinClaimUsd: Number.isFinite(hyperionMinClaimUsd) ? hyperionMinClaimUsd : undefined,
      hyperionMinRewardClaimUsd: Number.isFinite(hyperionMinRewardClaimUsd)
        ? hyperionMinRewardClaimUsd
        : undefined,
      hyperionMinRewardSwapUsd: Number.isFinite(hyperionMinRewardSwapUsd)
        ? hyperionMinRewardSwapUsd
        : undefined,
      hyperionSwapRewardsToUsdc,
    });

    const result = await runYieldAiVaultCronPass({
      dryRun,
      safeAddresses,
      pageSize:
        typeof body.pageSize === "number" && body.pageSize > 0 ? body.pageSize : undefined,
      maxSafesProcessedPerRun:
        typeof body.maxSafesProcessedPerRun === "number" &&
        body.maxSafesProcessedPerRun > 0
          ? body.maxSafesProcessedPerRun
          : undefined,
      maxTxPerRun:
        typeof body.maxTxPerRun === "number" && body.maxTxPerRun > 0 ? body.maxTxPerRun : undefined,
      concurrencyReads:
        typeof body.concurrencyReads === "number" && body.concurrencyReads > 0
          ? body.concurrencyReads
          : undefined,
    });

    let hyperionLp: HyperionLpCronRunResult | null = null;
    if (includeHyperionLp) {
      if (g[HYPERION_LP_CRON_LOCK_KEY]) {
        hyperionLp = {
          action: "claim",
          dryRun,
          safesProcessed: 0,
          actedPositions: 0,
          results: [
            {
              safeAddress: "(cron-lock)",
              error: "Skipped: Hyperion LP cron is already running.",
            },
          ],
        };
      } else {
        g[HYPERION_LP_CRON_LOCK_KEY] = true;
        try {
          hyperionLp = await runHyperionLpCronPass({
            action: "claim",
            dryRun,
            safeAddresses,
            minClaimUsd: Number.isFinite(hyperionMinClaimUsd) ? hyperionMinClaimUsd : undefined,
            minRewardClaimUsd: Number.isFinite(hyperionMinRewardClaimUsd)
              ? hyperionMinRewardClaimUsd
              : undefined,
            minRewardSwapUsd: Number.isFinite(hyperionMinRewardSwapUsd)
              ? hyperionMinRewardSwapUsd
              : undefined,
            swapRewardsToUsdc: hyperionSwapRewardsToUsdc,
          });
        } finally {
          g[HYPERION_LP_CRON_LOCK_KEY] = false;
        }
      }
    }

    return NextResponse.json(createSuccessResponse({ ...result, hyperionLp }));
  } catch (error) {
    console.error("[Yield AI] cron run endpoint error:", error);
    return NextResponse.json(
      createErrorResponse(
        error instanceof Error ? error : new Error("Unknown cron run error")
      ),
      { status: 500 }
    );
  } finally {
    g[lockKey] = false;
  }
}

