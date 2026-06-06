import { NextResponse } from "next/server";
import { PublicKey, Transaction } from "@solana/web3.js";
import { getServerSolanaConnection } from "@/app/api/jupiter/_lib";

export const dynamic = "force-dynamic";

/**
 * POST /api/protocols/meteora/claimFees
 *
 * Body: { owner: string, poolAddress: string, positionAddresses?: string[] }
 *
 * Builds DLMM claimSwapFee transaction(s) using the Meteora SDK.
 * `positionAddresses` defaults to all of the owner's positions in the given pool.
 *
 * Returns: { transactions: string[] } — base64-serialized legacy Transactions
 * with `recentBlockhash` and `feePayer` set. Client must sign each in order
 * and submit through `/api/solana/sendRaw`.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { owner?: unknown; poolAddress?: unknown; positionAddresses?: unknown }
      | null;

    const owner = typeof body?.owner === "string" ? body.owner.trim() : "";
    const poolAddress = typeof body?.poolAddress === "string" ? body.poolAddress.trim() : "";
    const positionAddresses = Array.isArray(body?.positionAddresses)
      ? body!.positionAddresses
          .filter((x): x is string => typeof x === "string" && x.length > 0)
          .map((x) => x.trim())
      : [];

    if (!owner) {
      return NextResponse.json({ success: false, error: "Missing owner" }, { status: 400 });
    }
    if (!poolAddress) {
      return NextResponse.json({ success: false, error: "Missing poolAddress" }, { status: 400 });
    }

    let ownerPk: PublicKey;
    let poolPk: PublicKey;
    try {
      ownerPk = new PublicKey(owner);
      poolPk = new PublicKey(poolAddress);
    } catch {
      return NextResponse.json({ success: false, error: "Invalid pubkey" }, { status: 400 });
    }

    // DLMM SDK is heavy and ESM-shaped — load lazily so the rest of the API tree
    // doesn't pull it on cold start.
    type DlmmCtor = {
      create: (connection: unknown, pool: PublicKey) => Promise<unknown>;
    };
    let DLMM: DlmmCtor;
    try {
      const mod = (await import("@meteora-ag/dlmm")) as { default?: unknown; DLMM?: unknown };
      const Ctor = (mod.default ?? mod.DLMM) as DlmmCtor | undefined;
      if (!Ctor || typeof Ctor.create !== "function") {
        throw new Error("DLMM export missing");
      }
      DLMM = Ctor;
    } catch (e) {
      console.error("[Meteora claimFees] SDK load failed:", e);
      return NextResponse.json(
        { success: false, error: "DLMM SDK is not installed" },
        { status: 503 }
      );
    }

    const connection = getServerSolanaConnection();
    const dlmmPool = (await DLMM.create(connection, poolPk)) as {
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

    const userPositionsResp = await dlmmPool.getPositionsByUserAndLbPair(ownerPk);
    let userPositions = Array.isArray(userPositionsResp.userPositions)
      ? userPositionsResp.userPositions
      : [];

    if (positionAddresses.length > 0) {
      const wanted = new Set(positionAddresses);
      userPositions = userPositions.filter((p) => wanted.has(p.publicKey.toBase58()));
    }

    if (userPositions.length === 0) {
      return NextResponse.json(
        { success: false, error: "No matching positions for this owner / pool" },
        { status: 404 }
      );
    }

    // Method preference, per Meteora docs:
    //   1. claimAllRewards         — fees + LM rewards, batched across positions in one pool.
    //   2. claimAllRewardsByPosition — fees + LM rewards for a single position.
    //   3. claimAllSwapFee         — fees only, batched.
    //   4. claimSwapFee            — fees only, single position.
    // Using the broadest method we have so pools with emissions get LM rewards
    // claimed too, without changing the UX.
    let txs: Transaction[];
    if (typeof dlmmPool.claimAllRewards === "function") {
      const raw = await dlmmPool.claimAllRewards({ owner: ownerPk, positions: userPositions });
      txs = Array.isArray(raw) ? raw : [raw];
    } else if (typeof dlmmPool.claimAllRewardsByPosition === "function") {
      const collected: Transaction[] = [];
      for (const position of userPositions) {
        const raw = await dlmmPool.claimAllRewardsByPosition!({ owner: ownerPk, position });
        if (Array.isArray(raw)) collected.push(...raw);
        else collected.push(raw);
      }
      txs = collected;
    } else if (typeof dlmmPool.claimAllSwapFee === "function") {
      const raw = await dlmmPool.claimAllSwapFee({ owner: ownerPk, positions: userPositions });
      txs = Array.isArray(raw) ? raw : [raw];
    } else if (typeof dlmmPool.claimSwapFee === "function") {
      const collected: Transaction[] = [];
      for (const position of userPositions) {
        const raw = await dlmmPool.claimSwapFee({ owner: ownerPk, position });
        if (Array.isArray(raw)) collected.push(...raw);
        else collected.push(raw);
      }
      txs = collected;
    } else {
      return NextResponse.json(
        { success: false, error: "DLMM SDK has no claim method" },
        { status: 501 }
      );
    }

    if (txs.length === 0) {
      return NextResponse.json(
        { success: false, error: "Nothing to claim (positions have zero unclaimed fees)" },
        { status: 200 }
      );
    }

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const transactions: string[] = [];
    for (const tx of txs) {
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
        positionCount: userPositions.length,
        txCount: transactions.length,
      },
    });
  } catch (error) {
    console.error("[Meteora claimFees] error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
