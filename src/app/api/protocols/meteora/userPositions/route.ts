import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getServerSolanaConnection } from "@/app/api/jupiter/_lib";

export const dynamic = "force-dynamic";

type DlmmSdkStatic = {
  /** SDK 1.9.x: `Map<string, PositionInfo>` — pool address (base58) -> one position aggregate per pool. */
  getAllLbPairPositionsByUser: (connection: unknown, user: PublicKey) => Promise<Map<string, unknown>>;
};

/**
 * GET /api/protocols/meteora/userPositions?address=<solana_wallet>&debug=1
 *
 * Uses Meteora DLMM SDK:
 * https://docs.meteora.ag/developer-guide/guides/dlmm/typescript-sdk/sdk-functions#getalllbpairpositionsbyuser
 *
 * `DLMM.getAllLbPairPositionsByUser(connection, userPubKey)` returns `Map<string, PositionInfo>`:
 * LB pair (pool) pubkey as **string** -> `PositionInfo` (see SDK typings; includes position / bin data).
 *
 * REST pool metadata (names, TVL) is separate: https://dlmm.datapi.meteora.ag (OpenAPI in docs).
 */

function isLikelySolanaAddress(input: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input);
}

function sanitizeForJson(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof PublicKey) return value.toBase58();
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;

  if (typeof (value as { toBase58?: () => string }).toBase58 === "function") {
    try {
      return (value as PublicKey).toBase58();
    } catch {
      // fall through
    }
  }

  if (typeof (value as { toString?: () => string }).toString === "function") {
    const ctor = (value as object).constructor?.name;
    if (ctor === "BN" || ctor === "BigNumber") {
      try {
        return (value as { toString: () => string }).toString();
      } catch {
        return String(value);
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

export async function GET(request: NextRequest) {
  const started = Date.now();
  try {
    const { searchParams } = new URL(request.url);
    const address = (searchParams.get("address") || "").trim();
    const debug = (searchParams.get("debug") || "").trim() === "1";

    if (!address) {
      return NextResponse.json({ success: false, error: "Address parameter is required" }, { status: 400 });
    }
    if (!isLikelySolanaAddress(address)) {
      return NextResponse.json({ success: false, error: "Invalid Solana wallet address" }, { status: 400 });
    }

    // Package may export default or `DLMM` named export depending on version/bundler.
    let DLMM: DlmmSdkStatic;
    try {
      const mod = (await import("@meteora-ag/dlmm")) as { default?: unknown; DLMM?: unknown };
      const Ctor = (mod.default ?? mod.DLMM) as { getAllLbPairPositionsByUser?: unknown } | undefined;
      if (!Ctor || typeof Ctor.getAllLbPairPositionsByUser !== "function") {
        throw new Error("DLMM export missing getAllLbPairPositionsByUser");
      }
      DLMM = Ctor as DlmmSdkStatic;
    } catch (e) {
      console.error("[Meteora] Failed to load @meteora-ag/dlmm:", e);
      return NextResponse.json(
        {
          success: false,
          error:
            "Meteora DLMM SDK is not installed or failed to load. Run `npm install --legacy-peer-deps` if peer resolution fails.",
          hint: "https://www.npmjs.com/package/@meteora-ag/dlmm",
        },
        { status: 503 }
      );
    }

    const connection = getServerSolanaConnection();
    const owner = new PublicKey(address);

    const positionsByPool = await DLMM.getAllLbPairPositionsByUser(connection, owner);

    const pools: Array<{ lbPair: string; positions: unknown[] }> = [];
    let positionCount = 0;

    const lbPairKeyToString = (k: unknown): string => {
      if (typeof k === "string") return k;
      if (k instanceof PublicKey) return k.toBase58();
      const t = k as { toBase58?: () => string; toString?: () => string };
      if (typeof t?.toBase58 === "function") return t.toBase58();
      if (typeof t?.toString === "function") return String(t.toString());
      return String(k);
    };

    positionsByPool.forEach((positionInfo, lbPairKey) => {
      const lbPair = lbPairKeyToString(lbPairKey);
      const rows: unknown[] = Array.isArray(positionInfo)
        ? positionInfo
        : positionInfo != null
          ? [positionInfo]
          : [];
      positionCount += rows.length;
      pools.push({
        lbPair,
        positions: sanitizeForJson(rows) as unknown[],
      });
    });

    const payload: Record<string, unknown> = {
      success: true,
      address,
      data: pools,
      poolCount: pools.length,
      positionCount,
      note:
        "Raw on-chain DLMM positions per LB pair. For pool names/TVL/token metadata see GET https://dlmm.datapi.meteora.ag/pools/{address}",
    };

    if (debug) {
      payload.meta = {
        ms: Date.now() - started,
        rpcHost: (() => {
          try {
            return new URL((connection as any).rpcEndpoint || "").host || "unknown";
          } catch {
            return "unknown";
          }
        })(),
      };
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[Meteora] userPositions error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        data: [],
        poolCount: 0,
        positionCount: 0,
      },
      { status: 500 }
    );
  }
}
