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
};

export async function POST(request: NextRequest) {
  try {
    const unauthorized = requireStrategyMutationSecret(request);
    if (unauthorized) return unauthorized;

    const body = (await request.json().catch(() => ({}))) as Partial<Body>;
    const safeAddress = typeof body.safeAddress === "string" ? body.safeAddress.trim() : "";
    const strategyId = typeof body.strategyId === "string" ? (body.strategyId as AiAgentStrategyId) : "";

    if (!safeAddress) {
      return NextResponse.json(createErrorResponse(new Error("safeAddress is required")), { status: 400 });
    }
    if (strategyId !== "stablecoin_compound" && strategyId !== "decibel_delta_neutral") {
      return NextResponse.json(createErrorResponse(new Error("strategyId must be stablecoin_compound or decibel_delta_neutral")), {
        status: 400,
      });
    }

    const res = await submitYieldAiExecutorEntryFunction({
      fn: STRATEGY_REGISTRY_ENTRYPOINTS.attachStrategy,
      functionArguments: [toCanonicalAddress(safeAddress), utf8BytesArray(strategyId)],
      maxGasAmount: 50_000,
      logPrefix: "[Yield AI] strategy_registry::attach_strategy",
    });

    return NextResponse.json(
      createSuccessResponse({
        hash: res.hash,
        safeAddress: toCanonicalAddress(safeAddress),
        strategyId,
      })
    );
  } catch (error) {
    console.error("[Yield AI] strategy attach error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(createErrorResponse(new Error(message)), { status: 500 });
  }
}

