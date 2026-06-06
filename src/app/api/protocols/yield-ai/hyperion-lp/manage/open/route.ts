import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";
import { runHyperionOpen, runHyperionOpenDual } from "@/lib/protocols/yield-ai/hyperionLpActions";
import {
  HyperionManageAuthError,
  assertHyperionManageOwnerAuth,
  assertSafeOptedIntoHyperion,
} from "../_guard";
import type { HyperionPoolKey } from "@/lib/constants/yieldAiVault";

function optionalNumber(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseBigIntPositive(raw: unknown): bigint {
  const v = BigInt(String(raw ?? "").trim());
  if (v <= 0n) throw new Error("amount must be > 0");
  return v;
}

/**
 * POST /api/protocols/yield-ai/hyperion-lp/manage/open
 *
 * User-facing proxy: opens a Hyperion LP position. Two modes:
 *  - `mode: "zap"` (default): from USDC only; the contract swaps part to the
 *    non-USDC leg (charges the safe's USDC swap limits).
 *  - `mode: "dual"`: from BOTH legs already in the safe (no swap); body carries
 *    `amountABaseUnits` + `amountBBaseUnits`.
 * No cron secret in the browser. Live actions require a wallet owner signature;
 * dry-run previews only check the on-chain `hyperion_lp` tag.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const safeAddressRaw = typeof body.safeAddress === "string" ? body.safeAddress.trim() : "";
    if (!safeAddressRaw) {
      return NextResponse.json(createErrorResponse(new Error("safeAddress is required")), { status: 400 });
    }

    const mode: "zap" | "dual" = body.mode === "dual" ? "dual" : "zap";
    const safeAddress = await assertSafeOptedIntoHyperion(safeAddressRaw);
    const dryRun = Boolean(body.dryRun);

    if (mode === "dual") {
      let amountA: bigint;
      let amountB: bigint;
      try {
        amountA = parseBigIntPositive(body.amountABaseUnits);
        amountB = parseBigIntPositive(body.amountBBaseUnits);
      } catch {
        return NextResponse.json(
          createErrorResponse(new Error("amountABaseUnits and amountBBaseUnits must be positive u64 strings")),
          { status: 400 }
        );
      }

      if (!dryRun) {
        await assertHyperionManageOwnerAuth({
          safeAddress,
          action: "hyperion_lp_manage_open",
          fields: {
            safeAddress,
            mode,
            amountABaseUnits: amountA.toString(),
            amountBBaseUnits: amountB.toString(),
            poolKey: typeof body.poolKey === "string" && body.poolKey.trim() ? body.poolKey.trim() : null,
            halfWidthTicks: optionalNumber(body.halfWidthTicks),
            tickLower: optionalNumber(body.tickLower),
            tickUpper: optionalNumber(body.tickUpper),
            dryRun,
          },
          auth: body.auth,
        });
      }

      const result = await runHyperionOpenDual({
        safeAddress,
        amountABaseUnits: amountA,
        amountBBaseUnits: amountB,
        poolKey: (body.poolKey as HyperionPoolKey) || undefined,
        halfWidthTicks: body.halfWidthTicks,
        tickLower: body.tickLower,
        tickUpper: body.tickUpper,
        dryRun,
      });
      return NextResponse.json(createSuccessResponse(result));
    }

    // mode === "zap"
    let usdcAmountIn: bigint;
    try {
      usdcAmountIn = BigInt(String(body.usdcAmountInBaseUnits ?? "").trim());
    } catch {
      return NextResponse.json(createErrorResponse(new Error("usdcAmountInBaseUnits must be a u64 string")), { status: 400 });
    }
    if (usdcAmountIn <= 0n) {
      return NextResponse.json(createErrorResponse(new Error("usdcAmountInBaseUnits must be > 0")), { status: 400 });
    }

    if (!dryRun) {
      await assertHyperionManageOwnerAuth({
        safeAddress,
        action: "hyperion_lp_manage_open",
        fields: {
          safeAddress,
          usdcAmountInBaseUnits: usdcAmountIn.toString(),
          poolKey: typeof body.poolKey === "string" && body.poolKey.trim() ? body.poolKey.trim() : null,
          halfWidthTicks: optionalNumber(body.halfWidthTicks),
          tickLower: optionalNumber(body.tickLower),
          tickUpper: optionalNumber(body.tickUpper),
          slippageBps: optionalNumber(body.slippageBps),
          dryRun,
        },
        auth: body.auth,
      });
    }

    const result = await runHyperionOpen({
      safeAddress,
      usdcAmountInBaseUnits: usdcAmountIn,
      poolKey: (body.poolKey as HyperionPoolKey) || undefined,
      halfWidthTicks: body.halfWidthTicks,
      tickLower: body.tickLower,
      tickUpper: body.tickUpper,
      slippageBps: body.slippageBps,
      dryRun,
    });

    return NextResponse.json(createSuccessResponse(result));
  } catch (err) {
    return NextResponse.json(createErrorResponse(err instanceof Error ? err : new Error(String(err))), {
      status: err instanceof HyperionManageAuthError ? err.status : 500,
    });
  }
}
