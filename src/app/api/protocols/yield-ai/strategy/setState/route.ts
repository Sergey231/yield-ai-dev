import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";
import {
  STRATEGY_REGISTRY_ENTRYPOINTS,
  type AiAgentStrategyId,
  utf8BytesArray,
} from "@/lib/protocols/yield-ai/strategyRegistry";
import { submitYieldAiExecutorEntryFunction } from "@/lib/protocols/yield-ai/vaultExecutor";
import { requireStrategyMutationSecret } from "../_auth";

type Body = {
  safeAddress: string;
  strategyId: AiAgentStrategyId;
  newState: number; // u8
};

export async function POST(request: NextRequest) {
  try {
    const unauthorized = requireStrategyMutationSecret(request);
    if (unauthorized) return unauthorized;

    const body = (await request.json().catch(() => ({}))) as Partial<Body>;
    const safeAddress = typeof body.safeAddress === "string" ? body.safeAddress.trim() : "";
    const strategyId = typeof body.strategyId === "string" ? (body.strategyId as AiAgentStrategyId) : "";
    const newStateRaw = Number(body.newState);

    if (!safeAddress) {
      return NextResponse.json(createErrorResponse(new Error("safeAddress is required")), { status: 400 });
    }
    if (strategyId !== "stablecoin_compound" && strategyId !== "decibel_delta_neutral") {
      return NextResponse.json(
        createErrorResponse(new Error("strategyId must be stablecoin_compound or decibel_delta_neutral")),
        { status: 400 }
      );
    }
    if (!Number.isFinite(newStateRaw) || newStateRaw < 0 || newStateRaw > 255) {
      return NextResponse.json(createErrorResponse(new Error("newState must be a u8 (0..255)")), { status: 400 });
    }

    const res = await submitYieldAiExecutorEntryFunction({
      fn: STRATEGY_REGISTRY_ENTRYPOINTS.setStrategyState,
      functionArguments: [toCanonicalAddress(safeAddress), utf8BytesArray(strategyId), Math.trunc(newStateRaw)],
      maxGasAmount: 50_000,
      logPrefix: "[Yield AI] strategy_registry::set_strategy_state",
    });

    return NextResponse.json(
      createSuccessResponse({
        hash: res.hash,
        safeAddress: toCanonicalAddress(safeAddress),
        strategyId,
        newState: Math.trunc(newStateRaw),
      })
    );
  } catch (error) {
    console.error("[Yield AI] strategy set state error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(createErrorResponse(new Error(message)), { status: 500 });
  }
}

