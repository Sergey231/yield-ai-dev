import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getServerSolanaConnection } from "@/app/api/jupiter/_lib";

export const dynamic = "force-dynamic";

function isLikelySolanaAddress(input: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input);
}

function sanitizeForJson(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof PublicKey) return value.toBase58();
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;

  // BN / BigNumber / etc.
  if (typeof value === "object" && value) {
    const anyVal = value as any;
    if (typeof anyVal?.toBase58 === "function") {
      try {
        return anyVal.toBase58();
      } catch {
        // ignore
      }
    }
    if (typeof anyVal?.toString === "function") {
      const ctor = (value as object).constructor?.name;
      if (ctor === "BN" || ctor === "BigNumber") {
        try {
          return anyVal.toString();
        } catch {
          return String(value);
        }
      }
    }
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }

  if (Array.isArray(value)) {
    return value.map((x) => sanitizeForJson(x, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value as object)) return "[Circular]";
    seen.add(value as object);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      try {
        out[k] = sanitizeForJson(v, seen);
      } catch {
        out[k] = "[Unserializable]";
      }
    }
    return out;
  }

  return String(value);
}

/**
 * GET /api/protocols/jupiter/borrow?address=<solana_wallet>
 *
 * Jupiter Borrow REST API is "coming soon"; this endpoint uses the Jupiter Lend Read SDK
 * to read on-chain vault positions:
 * https://dev.jup.ag/docs/lend/borrow/read-vault-data
 */
export async function GET(request: NextRequest) {
  const started = Date.now();
  try {
    const { searchParams } = new URL(request.url);
    const address = (searchParams.get("address") || "").trim();
    const debug = (searchParams.get("debug") || "").trim() === "1";

    if (!address) {
      return NextResponse.json({ success: false, error: "Address parameter is required", data: [] }, { status: 400 });
    }
    if (!isLikelySolanaAddress(address)) {
      return NextResponse.json({ success: false, error: "Invalid Solana wallet address", data: [] }, { status: 400 });
    }

    let Client: any = null;
    try {
      const mod = (await import("@jup-ag/lend-read")) as any;
      Client = mod?.Client ?? mod?.default ?? null;
      if (!Client) throw new Error("Missing Client export");
    } catch (e) {
      console.error("[JupiterBorrow] Failed to load @jup-ag/lend-read:", e);
      return NextResponse.json(
        {
          success: false,
          error: "Jupiter Lend Read SDK is not installed or failed to load",
          hint: "npm i @jup-ag/lend-read",
          data: [],
        },
        { status: 503 }
      );
    }

    const connection = getServerSolanaConnection();
    const client = new Client(connection);
    const user = new PublicKey(address);

    const positions = (await client.vault.getAllUserPositions(user)) as unknown[];
    const list = Array.isArray(positions) ? positions : [];

    // For the borrow endpoint, keep only positions that have a non-zero borrow OR are not supply-only.
    const filtered = list.filter((p: any) => {
      const borrowStr = String(p?.borrow?.toString?.() ?? p?.borrow ?? "0");
      const isSupplyOnly = Boolean(p?.isSupplyPosition) || Boolean(p?.isSupplyOnlyPosition);
      const hasBorrow = (() => {
        try {
          return BigInt(borrowStr) > BigInt(0);
        } catch {
          const n = Number(borrowStr);
          return Number.isFinite(n) && n > 0;
        }
      })();
      return hasBorrow || !isSupplyOnly;
    });

    const payload: Record<string, unknown> = {
      success: true,
      address,
      data: sanitizeForJson(filtered),
      count: filtered.length,
    };
    if (debug) {
      payload.meta = { ms: Date.now() - started };
    }

    return NextResponse.json(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[JupiterBorrow] error:", e);
    return NextResponse.json(
      { success: false, error: msg, data: [], count: 0, meta: { ms: Date.now() - started } },
      { status: 500 }
    );
  }
}

