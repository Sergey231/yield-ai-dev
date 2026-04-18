import { NextResponse } from "next/server";
import { YIELD_AI_ECHELON_ADAPTER_VIEW } from "@/lib/constants/yieldAiVault";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";

const VIEW_URL = "https://fullnode.mainnet.aptoslabs.com/v1/view";

function unwrapAddress(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "string" && raw.startsWith("0x")) return toCanonicalAddress(raw);
  if (typeof raw === "object" && raw !== null && "inner" in raw) {
    const inner = (raw as { inner?: unknown }).inner;
    if (typeof inner === "string" && inner.startsWith("0x")) {
      return toCanonicalAddress(inner);
    }
  }
  return null;
}

/**
 * GET /api/protocols/yield-ai/echelon-adapter-address
 * Resolves Echelon adapter object address from on-chain view (mainnet).
 */
export async function GET() {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.APTOS_API_KEY) {
      headers.Authorization = `Bearer ${process.env.APTOS_API_KEY}`;
    }

    const response = await fetch(VIEW_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        function: YIELD_AI_ECHELON_ADAPTER_VIEW,
        type_arguments: [],
        arguments: [],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        createErrorResponse(new Error(`View failed: ${response.status} ${text.slice(0, 200)}`)),
        { status: response.status }
      );
    }

    const payload = (await response.json()) as unknown;
    const first = Array.isArray(payload) ? payload[0] : payload;
    const address = unwrapAddress(first);
    if (!address) {
      return NextResponse.json(
        createErrorResponse(new Error("Could not parse Echelon adapter address from view")),
        { status: 502 }
      );
    }

    return NextResponse.json(createSuccessResponse({ address }));
  } catch (error) {
    return NextResponse.json(
      createErrorResponse(error instanceof Error ? error : new Error("Unknown error")),
      { status: 500 }
    );
  }
}
