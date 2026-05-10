import { NextRequest, NextResponse } from "next/server";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";
import {
  STRATEGY_REGISTRY_VIEWS,
  resolveActiveAiAgentStrategy,
} from "@/lib/protocols/yield-ai/strategyRegistry";

const APTOS_API_KEY = process.env.APTOS_API_KEY;

const aptos = new Aptos(
  new AptosConfig({
    network: Network.MAINNET,
    ...(APTOS_API_KEY && {
      clientConfig: { HEADERS: { Authorization: `Bearer ${APTOS_API_KEY}` } },
    }),
  })
);

/**
 * GET /api/protocols/yield-ai/strategy/active?safeAddress=0x...
 * Reads active strategy ids (vector<vector<u8>>) and resolves the active AI agent strategy.
 */
export async function GET(request: NextRequest) {
  try {
    const safeRaw = request.nextUrl.searchParams.get("safeAddress")?.trim();
    if (!safeRaw) {
      return NextResponse.json({ success: false, error: "safeAddress is required" }, { status: 400 });
    }
    const safe = toCanonicalAddress(safeRaw);
    if (!safe.startsWith("0x")) {
      return NextResponse.json({ success: false, error: "Invalid safeAddress" }, { status: 400 });
    }

    const raw = await aptos.view({
      payload: {
        function: STRATEGY_REGISTRY_VIEWS.getSafeActiveStrategies,
        typeArguments: [],
        functionArguments: [safe],
      },
    });

    const vec = Array.isArray(raw) ? raw[0] : raw;
    const resolved = resolveActiveAiAgentStrategy({ activeStrategyIdBytesVec: vec });

    return NextResponse.json({
      success: true,
      data: {
        safeAddress: safe,
        ...resolved,
      },
    });
  } catch (error) {
    console.error("[Yield AI] strategy active view error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

