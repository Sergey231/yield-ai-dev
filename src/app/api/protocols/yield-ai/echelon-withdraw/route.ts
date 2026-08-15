import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";
import { YIELD_AI_ECHELON_ADAPTER_VIEW } from "@/lib/constants/yieldAiVault";
import { executeWithdrawEchelonFa } from "@/lib/protocols/yield-ai/vaultExecutor";
import {
  ManageAuthError,
  assertOwnerManageAuth,
} from "@/lib/protocols/yield-ai/manageAuthServer";

const VIEW_URL = "https://fullnode.mainnet.aptoslabs.com/v1/view";

const ECHELON_LENDING_MODULE =
  "0xc6bc659f1649553c1a3fa05d9727433dc03843baac29473c817d06d39e7621ba::lending";

async function callView(fn: string, args: unknown[]): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.APTOS_API_KEY) {
    headers.Authorization = `Bearer ${process.env.APTOS_API_KEY}`;
  }
  const response = await fetch(VIEW_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ function: fn, type_arguments: [], arguments: args }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`View ${fn} failed: ${response.status} ${text.slice(0, 200)}`);
  }
  const payload = (await response.json()) as unknown;
  return Array.isArray(payload) ? payload[0] : payload;
}

function viewU64(raw: unknown, label: string): bigint {
  if (typeof raw === "string" || typeof raw === "number") {
    try {
      return BigInt(raw);
    } catch {
      /* fall through */
    }
  }
  throw new Error(`Could not parse ${label} from view result`);
}

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

async function resolveEchelonAdapterAddress(): Promise<string> {
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
    throw new Error(`Echelon adapter view failed: ${response.status} ${text.slice(0, 200)}`);
  }
  const payload = (await response.json()) as unknown;
  const address = unwrapAddress(Array.isArray(payload) ? payload[0] : payload);
  if (!address) {
    throw new Error("Could not parse Echelon adapter address from view");
  }
  return address;
}

/**
 * POST /api/protocols/yield-ai/echelon-withdraw
 * Body: { safeAddress: string, marketObj: string, amountBaseUnits: string, auth: OwnerManageAuthBody }
 *
 * Executor signs and submits vault::execute_withdraw_echelon_fa — a PARTIAL
 * withdraw from an Echelon FA market back into the AI agent safe. Requires a
 * wallet-signed owner authorization bound to the exact body values.
 *
 * `amountBaseUnits` is the UNDERLYING token amount the user asked for. The
 * vault entry (like Echelon's lending::withdraw) takes SHARES, so we convert
 * via lending::coins_to_shares at submit time and clamp to the safe's share
 * balance (verified on mainnet: tx 5703561323 withdrew 1.0218 USD1 for an
 * input of 1.0 because shares were passed through unconverted).
 *
 * Aborts on-chain with E_VAULT_PAUSED while the safe is paused — the UI falls
 * back to the owner-signed full exit in that case.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const safeAddress = typeof body.safeAddress === "string" ? body.safeAddress.trim() : "";
    const marketObj = typeof body.marketObj === "string" ? body.marketObj.trim() : "";
    const amountRaw =
      typeof body.amountBaseUnits === "string"
        ? body.amountBaseUnits.trim()
        : String(body.amountBaseUnits ?? "");

    if (!safeAddress || !safeAddress.startsWith("0x")) {
      return NextResponse.json(createErrorResponse(new Error("safeAddress is required")), {
        status: 400,
      });
    }
    if (!marketObj || !marketObj.startsWith("0x")) {
      return NextResponse.json(createErrorResponse(new Error("marketObj is required")), {
        status: 400,
      });
    }

    let amount: bigint;
    try {
      amount = BigInt(amountRaw);
    } catch {
      return NextResponse.json(
        createErrorResponse(new Error("amountBaseUnits must be a u64 string")),
        { status: 400 }
      );
    }
    if (amount <= 0n) {
      return NextResponse.json(
        createErrorResponse(new Error("amountBaseUnits must be > 0")),
        { status: 400 }
      );
    }

    await assertOwnerManageAuth({
      action: "echelon_partial_withdraw",
      // Must mirror the client exactly: same keys, order, and raw string values.
      fields: { safeAddress, marketObj, amountBaseUnits: amountRaw },
      auth: body.auth,
      safeAddress,
    });

    const adapterAddress = await resolveEchelonAdapterAddress();
    const canonicalSafe = toCanonicalAddress(safeAddress);
    const canonicalMarket = toCanonicalAddress(marketObj);

    // Underlying coins → market shares, clamped to what the safe actually holds.
    const [sharesRaw, safeSharesRaw] = await Promise.all([
      callView(`${ECHELON_LENDING_MODULE}::coins_to_shares`, [canonicalMarket, amount.toString()]),
      callView(`${ECHELON_LENDING_MODULE}::account_shares`, [canonicalSafe, canonicalMarket]),
    ]);
    const requestedShares = viewU64(sharesRaw, "coins_to_shares");
    const safeShares = viewU64(safeSharesRaw, "account_shares");
    const shares = requestedShares < safeShares ? requestedShares : safeShares;
    if (shares <= 0n) {
      return NextResponse.json(
        createErrorResponse(new Error("Requested amount converts to zero market shares")),
        { status: 400 }
      );
    }

    const result = await executeWithdrawEchelonFa({
      safeAddress: canonicalSafe,
      adapterAddress,
      marketObj: canonicalMarket,
      amountShares: shares,
    });

    return NextResponse.json(
      createSuccessResponse({
        hash: result.hash,
        requestedCoinsBaseUnits: amount.toString(),
        sharesWithdrawn: shares.toString(),
      })
    );
  } catch (error) {
    console.error("[Yield AI] echelon-withdraw failed:", error);
    return NextResponse.json(
      createErrorResponse(error instanceof Error ? error : new Error("Unknown error")),
      { status: error instanceof ManageAuthError ? error.status : 500 }
    );
  }
}
