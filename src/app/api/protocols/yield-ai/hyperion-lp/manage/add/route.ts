import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";
import { runHyperionAddDual } from "@/lib/protocols/yield-ai/hyperionLpActions";
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
 * User-facing proxy: add both legs (dual) to an EXISTING position — no swap,
 * uses the position's own range. Live actions require a wallet owner signature.
 *
 * Body: { safeAddress, position, mode: "dual", amountABaseUnits, amountBBaseUnits, dryRun? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const safeAddressRaw = typeof body.safeAddress === "string" ? body.safeAddress.trim() : "";
    const position = typeof body.position === "string" ? body.position.trim() : "";
    const mode = "dual" as const; // only dual add is exposed for now

    if (!safeAddressRaw) {
      return NextResponse.json(createErrorResponse(new Error("safeAddress is required")), { status: 400 });
    }
    if (!position) {
      return NextResponse.json(createErrorResponse(new Error("position is required")), { status: 400 });
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

    const safeAddress = await assertSafeOptedIntoHyperion(safeAddressRaw);
    const dryRun = Boolean(body.dryRun);

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
