import { NextResponse } from "next/server";
import { PublicKey, Transaction } from "@solana/web3.js";
import { getServerSolanaConnection } from "@/app/api/jupiter/_lib";

export const dynamic = "force-dynamic";

/**
 * POST /api/protocols/meteora/claimAll
 *
 * Body: { owner: string, pools?: Array<{ poolAddress: string; positionAddresses?: string[] }> }
 *
 * Cross-pool batch claim. The DLMM SDK does NOT expose a single call that
 * claims rewards across multiple pools — every claim method runs against one
 * `DLMM.create(connection, poolPk)` instance — so we iterate pools server-side
 * and flatten the resulting transaction lists.
 *
 * For each pool we use the broadest method available
 * (`claimAllRewards` → `claimAllSwapFee` → per-position fallbacks) so pools
 * with LM emissions get those rewards claimed in the same flow.
 *
 * When `pools` is omitted, we read every pool with a positive position for
 * the owner via `getAllLbPairPositionsByUser` and claim each one. When
 * `positionAddresses` is set for a pool, only those positions are claimed.
 *
 * Returns: { transactions: string[], txCount, poolCount, positionCount,
 * errors: Array<{ poolAddress, error }> }. Errors don't fail the whole
 * request — the UI gets partial success and a per-pool report.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { owner?: unknown; pools?: unknown }
      | null;

    const owner = typeof body?.owner === "string" ? body.owner.trim() : "";
    if (!owner) {
      return NextResponse.json({ success: false, error: "Missing owner" }, { status: 400 });
    }
    let ownerPk: PublicKey;
    try {
      ownerPk = new PublicKey(owner);
    } catch {
      return NextResponse.json({ success: false, error: "Invalid owner pubkey" }, { status: 400 });
    }

    const requestedPools = Array.isArray(body?.pools)
      ? body!.pools
          .map((entry): { poolAddress: string; positionAddresses: string[] } | null => {
            if (!entry || typeof entry !== "object") return null;
            const e = entry as Record<string, unknown>;
            const poolAddress = typeof e.poolAddress === "string" ? e.poolAddress.trim() : "";
            if (!poolAddress) return null;
            const positionAddresses = Array.isArray(e.positionAddresses)
              ? e.positionAddresses
                  .filter((x): x is string => typeof x === "string" && x.length > 0)
                  .map((x) => x.trim())
              : [];
            return { poolAddress, positionAddresses };
          })
          .filter((x): x is { poolAddress: string; positionAddresses: string[] } => x != null)
      : [];

    type DlmmStatic = {
      create: (connection: unknown, pool: PublicKey) => Promise<unknown>;
      getAllLbPairPositionsByUser?: (
        connection: unknown,
        user: PublicKey
      ) => Promise<Map<string, unknown>>;
    };
    let DLMM: DlmmStatic;
    try {
      const mod = (await import("@meteora-ag/dlmm")) as { default?: unknown; DLMM?: unknown };
      const Ctor = (mod.default ?? mod.DLMM) as DlmmStatic | undefined;
      if (!Ctor || typeof Ctor.create !== "function") throw new Error("DLMM export missing");
      DLMM = Ctor;
    } catch (e) {
      console.error("[Meteora claimAll] SDK load failed:", e);
      return NextResponse.json(
        { success: false, error: "DLMM SDK is not installed" },
        { status: 503 }
      );
    }

    const connection = getServerSolanaConnection();

    // Discover pools when caller didn't supply them.
    let poolJobs = requestedPools;
    if (poolJobs.length === 0) {
      if (typeof DLMM.getAllLbPairPositionsByUser !== "function") {
        return NextResponse.json(
          { success: false, error: "SDK has no getAllLbPairPositionsByUser" },
          { status: 501 }
        );
      }
      const map = await DLMM.getAllLbPairPositionsByUser(connection, ownerPk);
      poolJobs = [];
      map.forEach((_, key) => {
        const poolAddress = typeof key === "string" ? key : String(key);
        if (poolAddress) poolJobs.push({ poolAddress, positionAddresses: [] });
      });
    }

    if (poolJobs.length === 0) {
      return NextResponse.json(
        { success: false, error: "No pools to claim from" },
        { status: 404 }
      );
    }

    type ClaimablePool = {
      getPositionsByUserAndLbPair: (
        user: PublicKey
      ) => Promise<{ userPositions: Array<{ publicKey: PublicKey } & Record<string, unknown>> }>;
      claimAllRewards?: (args: {
        owner: PublicKey;
        positions: Array<Record<string, unknown>>;
      }) => Promise<Transaction[] | Transaction>;
      claimAllRewardsByPosition?: (args: {
        owner: PublicKey;
        position: Record<string, unknown>;
      }) => Promise<Transaction[] | Transaction>;
      claimAllSwapFee?: (args: {
        owner: PublicKey;
        positions: Array<Record<string, unknown>>;
      }) => Promise<Transaction[] | Transaction>;
      claimSwapFee?: (args: {
        owner: PublicKey;
        position: Record<string, unknown>;
      }) => Promise<Transaction[] | Transaction>;
    };

    const errors: Array<{ poolAddress: string; error: string }> = [];
    let positionCount = 0;

    // Build pool transactions in parallel — each pool is an independent
    // SDK instance + getPositionsByUserAndLbPair call.
    const perPoolResults = await Promise.all(
      poolJobs.map(async (job) => {
        try {
          const poolPk = new PublicKey(job.poolAddress);
          const dlmmPool = (await DLMM.create(connection, poolPk)) as ClaimablePool;
          const resp = await dlmmPool.getPositionsByUserAndLbPair(ownerPk);
          let positions = Array.isArray(resp.userPositions) ? resp.userPositions : [];
          if (job.positionAddresses.length > 0) {
            const wanted = new Set(job.positionAddresses);
            positions = positions.filter((p) => wanted.has(p.publicKey.toBase58()));
          }
          if (positions.length === 0) return [] as Transaction[];
          positionCount += positions.length;

          if (typeof dlmmPool.claimAllRewards === "function") {
            const raw = await dlmmPool.claimAllRewards({ owner: ownerPk, positions });
            return Array.isArray(raw) ? raw : [raw];
          }
          if (typeof dlmmPool.claimAllRewardsByPosition === "function") {
            const out: Transaction[] = [];
            for (const position of positions) {
              const raw = await dlmmPool.claimAllRewardsByPosition!({ owner: ownerPk, position });
              if (Array.isArray(raw)) out.push(...raw);
              else out.push(raw);
            }
            return out;
          }
          if (typeof dlmmPool.claimAllSwapFee === "function") {
            const raw = await dlmmPool.claimAllSwapFee({ owner: ownerPk, positions });
            return Array.isArray(raw) ? raw : [raw];
          }
          if (typeof dlmmPool.claimSwapFee === "function") {
            const out: Transaction[] = [];
            for (const position of positions) {
              const raw = await dlmmPool.claimSwapFee!({ owner: ownerPk, position });
              if (Array.isArray(raw)) out.push(...raw);
              else out.push(raw);
            }
            return out;
          }
          throw new Error("DLMM SDK has no claim method");
        } catch (e) {
          errors.push({
            poolAddress: job.poolAddress,
            error: e instanceof Error ? e.message : String(e),
          });
          return [] as Transaction[];
        }
      })
    );
    const allTxs: Transaction[] = perPoolResults.flat();

    if (allTxs.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: errors.length > 0 ? "All pools failed" : "Nothing to claim",
          errors,
        },
        { status: 200 }
      );
    }

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const transactions: string[] = [];
    for (const tx of allTxs) {
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      tx.feePayer = ownerPk;
      const buf = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      transactions.push(Buffer.from(buf).toString("base64"));
    }

    return NextResponse.json({
      success: true,
      data: {
        transactions,
        txCount: transactions.length,
        poolCount: poolJobs.length,
        positionCount,
        errors,
      },
    });
  } catch (error) {
    console.error("[Meteora claimAll] error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
