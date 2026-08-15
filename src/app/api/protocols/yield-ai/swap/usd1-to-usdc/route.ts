import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";
import {
  USD1_FA_METADATA_MAINNET,
  USDC_FA_METADATA_MAINNET,
} from "@/lib/constants/yieldAiVault";
import { getSwapPairParams } from "@/lib/protocols/yield-ai/engine/swapPairTable";
import { getHyperionAmountOut } from "@/lib/protocols/yield-ai/engine/hyperionQuote";
import { executeSwapFaToFa } from "@/lib/protocols/yield-ai/vaultExecutor";
import {
  ManageAuthError,
  assertOwnerManageAuth,
} from "@/lib/protocols/yield-ai/manageAuthServer";

const DEFAULT_SLIPPAGE_BPS = 50; // 0.50%
// Hard server-side cap: a caller-controlled slippage of 10000 bps would mean
// minOut=0 and let anyone sandwich the swap for the full amount.
const MAX_SLIPPAGE_BPS = 100;
const DEADLINE_SECS = 120;

/**
 * POST /api/protocols/yield-ai/swap/usd1-to-usdc
 * Body: { safeAddress: string, amountInBaseUnits: string, slippageBps?: number, auth: OwnerManageAuthBody }
 *
 * Executor signs and submits vault::execute_swap_fa_to_fa to swap USD1 (FA) -> USDC (FA)
 * inside the AI agent safe. User-initiated: requires a wallet-signed owner
 * authorization bound to the exact body values.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const safeAddress = typeof body.safeAddress === "string" ? body.safeAddress.trim() : "";
    const amountInRaw =
      typeof body.amountInBaseUnits === "string"
        ? body.amountInBaseUnits.trim()
        : String(body.amountInBaseUnits ?? "");

    if (!safeAddress) {
      return NextResponse.json(createErrorResponse(new Error("safeAddress is required")), {
        status: 400,
      });
    }

    let amountIn: bigint;
    try {
      amountIn = BigInt(amountInRaw);
    } catch {
      return NextResponse.json(createErrorResponse(new Error("amountInBaseUnits must be a u64 string")), {
        status: 400,
      });
    }
    if (amountIn <= 0n) {
      return NextResponse.json(createErrorResponse(new Error("amountInBaseUnits must be > 0")), {
        status: 400,
      });
    }

    const slippageBpsRaw = Number(body.slippageBps ?? DEFAULT_SLIPPAGE_BPS);
    const slippageBps = Math.max(0, Math.min(MAX_SLIPPAGE_BPS, Math.trunc(slippageBpsRaw)));

    await assertOwnerManageAuth({
      action: "usd1_to_usdc_swap",
      // Must mirror the client exactly: same keys, order, and raw string values.
      fields: { safeAddress, amountInBaseUnits: amountInRaw },
      auth: body.auth,
      safeAddress,
    });

    const pair = getSwapPairParams(USD1_FA_METADATA_MAINNET, USDC_FA_METADATA_MAINNET);
    if (!pair) {
      return NextResponse.json(
        createErrorResponse(new Error("USD1 -> USDC swap pair is not configured")),
        { status: 500 }
      );
    }

    const quotedOut = await getHyperionAmountOut({
      amountInBaseUnits: amountIn,
      fromMetadata: USD1_FA_METADATA_MAINNET,
      toMetadata: USDC_FA_METADATA_MAINNET,
    });
    const minOut = (quotedOut * (10_000n - BigInt(slippageBps))) / 10_000n;

    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECS);
    const result = await executeSwapFaToFa({
      safeAddress: toCanonicalAddress(safeAddress),
      feeTier: pair.feeTier,
      amountInBaseUnits: amountIn,
      amountOutMinBaseUnits: minOut,
      sqrtPriceLimit: pair.sqrtPriceLimit,
      fromTokenMetadata: USD1_FA_METADATA_MAINNET,
      toTokenMetadata: USDC_FA_METADATA_MAINNET,
      deadlineUnixSeconds: deadline,
    });

    return NextResponse.json(
      createSuccessResponse({
        hash: result.hash,
        amountInBaseUnits: amountIn.toString(),
        quotedOutBaseUnits: quotedOut.toString(),
        minOutBaseUnits: minOut.toString(),
        slippageBps,
      })
    );
  } catch (error) {
    console.error("[Yield AI] swap USD1->USDC error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(createErrorResponse(new Error(message)), {
      status: error instanceof ManageAuthError ? error.status : 500,
    });
  }
}

