import { NextResponse } from "next/server";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { STRATEGY_REGISTRY_VIEWS } from "@/lib/protocols/yield-ai/strategyRegistry";

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
 * GET /api/protocols/yield-ai/strategy/initialized
 * Returns whether the on-chain strategy registry was initialized.
 */
export async function GET() {
  try {
    const raw = await aptos.view({
      payload: {
        function: STRATEGY_REGISTRY_VIEWS.initialized,
        typeArguments: [],
        functionArguments: [],
      },
    });
    const v = Array.isArray(raw) ? raw[0] : raw;
    const initialized = v === true || v === "true";
    return NextResponse.json({ success: true, data: { initialized } });
  } catch (error) {
    console.error("[Yield AI] strategy registry initialized view error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

