import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";
import { runHyperionAddDual, runHyperionAddZap } from "@/lib/protocols/yield-ai/hyperionLpActions";
import {
  HyperionManageAuthError,
  assertHyperionManageOwnerAuth,
  assertSafeOptedIntoHyperion,
} from "../_guard";

function parseBigIntNonNeg(raw: unknown): bigint {
  const v = BigInt(String(raw ?? "0").trim());
  if (v < 0n) throw new Error("amount must be >= 0");
  return v;
}

/**
 * POST /api/protocols/yield-ai/hyperion-lp/manage/add
 *
 * User-facing proxy: add liquidity to an EXISTING position at its own range.
 * Live actions require a wallet owner signature.
 *
 * Body (dual — both legs from the safe, no swap):
 *   { safeAddress, position, mode: "dual", amountABaseUnits, amountBBaseUnits, dryRun? }
 * Body (zap — single token, the surplus is swapped to the range ratio):
 *   { safeAddress, position, mode: "zap", inputToken: "usdc" | "tokenA",
 *     amountBaseUnits, slippageBps?, dryRun? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const safeAddressRaw = typeof body.safeAddress === "string" ? body.safeAddress.trim() : "";
    const position = typeof body.position === "string" ? body.position.trim() : "";
    const mode: "dual" | "zap" = body.mode === "zap" ? "zap" : "dual";

    if (!safeAddressRaw) {
      return NextResponse.json(createErrorResponse(new Error("safeAddress is required")), { status: 400 });
    }
    if (!position) {
      return NextResponse.json(createErrorResponse(new Error("position is required")), { status: 400 });
    }

    const safeAddress = await assertSafeOptedIntoHyperion(safeAddressRaw);
    const dryRun = Boolean(body.dryRun);

    if (mode === "zap") {
      const inputToken: "usdc" | "token_a" = body.inputToken === "tokenA" ? "token_a" : "usdc";
      if (body.inputToken !== "tokenA" && body.inputToken !== "usdc") {
        return NextResponse.json(
          createErrorResponse(new Error('inputToken must be "usdc" or "tokenA"')),
          { status: 400 }
        );
      }
      let amount: bigint;
      try {
        amount = parseBigIntNonNeg(body.amountBaseUnits);
      } catch {
        return NextResponse.json(
          createErrorResponse(new Error("amountBaseUnits must be a u64 string")),
          { status: 400 }
        );
      }
      if (amount <= 0n) {
        return NextResponse.json(createErrorResponse(new Error("amountBaseUnits must be > 0")), { status: 400 });
      }
      const slippageBps = Number.isFinite(Number(body.slippageBps)) ? Number(body.slippageBps) : null;

      if (!dryRun) {
        await assertHyperionManageOwnerAuth({
          safeAddress,
          action: "hyperion_lp_manage_add",
          fields: {
            safeAddress,
            position,
            mode,
            inputToken: body.inputToken,
            amountBaseUnits: amount.toString(),
            slippageBps,
            dryRun,
          },
          auth: body.auth,
        });
      }

      const result = await runHyperionAddZap({
        safeAddress,
        position,
        inputToken,
        amountBaseUnits: amount,
        ...(slippageBps != null ? { slippageBps } : {}),
        dryRun,
      });
      return NextResponse.json(createSuccessResponse(result));
    }

    let amountA: bigint;
    let amountB: bigint;
    try {
      amountA = parseBigIntNonNeg(body.amountABaseUnits);
      amountB = parseBigIntNonNeg(body.amountBBaseUnits);
    } catch {
      return NextResponse.json(
        createErrorResponse(new Error("amountABaseUnits / amountBBaseUnits must be u64 strings")),
        { status: 400 }
      );
    }
    if (amountA <= 0n && amountB <= 0n) {
      return NextResponse.json(createErrorResponse(new Error("at least one amount must be > 0")), { status: 400 });
    }

    if (!dryRun) {
      await assertHyperionManageOwnerAuth({
        safeAddress,
        action: "hyperion_lp_manage_add",
        fields: {
          safeAddress,
          position,
          mode,
          amountABaseUnits: amountA.toString(),
          amountBBaseUnits: amountB.toString(),
          dryRun,
        },
        auth: body.auth,
      });
    }

    const result = await runHyperionAddDual({
      safeAddress,
      position,
      amountABaseUnits: amountA,
      amountBBaseUnits: amountB,
      dryRun,
    });

    return NextResponse.json(createSuccessResponse(result));
  } catch (err) {
    return NextResponse.json(createErrorResponse(err instanceof Error ? err : new Error(String(err))), {
      status: err instanceof HyperionManageAuthError ? err.status : 500,
    });
  }
}
