import { NextResponse } from "next/server";
import { PublicKey, Transaction } from "@solana/web3.js";
import { getServerSolanaConnection } from "@/app/api/jupiter/_lib";

export const dynamic = "force-dynamic";

/**
 * POST /api/protocols/meteora/closePosition
 *
 * Body: { owner: string, poolAddress: string, positionAddress: string }
 *
 * Withdraws 100% of liquidity from the position, claims accrued swap fees, and
 * closes the position account in the same flow (DLMM SDK
 * `removeLiquidity({ bps: 10000, shouldClaimAndClose: true })`).
 *
 * Returns: { transactions: string[] } — base64 legacy Transactions ready for
 * sequential signing through the wallet adapter + `/api/solana/sendRaw`.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { owner?: unknown; poolAddress?: unknown; positionAddress?: unknown }
      | null;

    const owner = typeof body?.owner === "string" ? body.owner.trim() : "";
    const poolAddress = typeof body?.poolAddress === "string" ? body.poolAddress.trim() : "";
    const positionAddress =
      typeof body?.positionAddress === "string" ? body.positionAddress.trim() : "";

    if (!owner) return NextResponse.json({ success: false, error: "Missing owner" }, { status: 400 });
    if (!poolAddress)
      return NextResponse.json({ success: false, error: "Missing poolAddress" }, { status: 400 });
    if (!positionAddress)
      return NextResponse.json({ success: false, error: "Missing positionAddress" }, { status: 400 });

    let ownerPk: PublicKey;
    let poolPk: PublicKey;
    let positionPk: PublicKey;
    try {
      ownerPk = new PublicKey(owner);
      poolPk = new PublicKey(poolAddress);
      positionPk = new PublicKey(positionAddress);
    } catch {
      return NextResponse.json({ success: false, error: "Invalid pubkey" }, { status: 400 });
    }

    type DlmmCtor = { create: (connection: unknown, pool: PublicKey) => Promise<unknown> };
    let DLMM: DlmmCtor;
    let BN: typeof import("bn.js");
    try {
      const mod = (await import("@meteora-ag/dlmm")) as { default?: unknown; DLMM?: unknown };
      const Ctor = (mod.default ?? mod.DLMM) as DlmmCtor | undefined;
      if (!Ctor || typeof Ctor.create !== "function") throw new Error("DLMM export missing");
      DLMM = Ctor;
      const bnMod = await import("bn.js");
      BN = (bnMod.default ?? bnMod) as typeof import("bn.js");
    } catch (e) {
      console.error("[Meteora closePosition] SDK load failed:", e);
      return NextResponse.json(
        { success: false, error: "DLMM SDK is not installed" },
        { status: 503 }
      );
    }

    const connection = getServerSolanaConnection();
    const dlmmPool = (await DLMM.create(connection, poolPk)) as {
      getPositionsByUserAndLbPair: (user: PublicKey) => Promise<{
        userPositions: Array<{ publicKey: PublicKey; positionData?: { lowerBinId?: number; upperBinId?: number } }>;
      }>;
      removeLiquidity: (args: {
        user: PublicKey;
        position: PublicKey;
        fromBinId: number;
        toBinId: number;
        bps: InstanceType<typeof import("bn.js")>;
        shouldClaimAndClose?: boolean;
        skipUnwrapSOL?: boolean;
      }) => Promise<Transaction[] | Transaction>;
    };

    const userPositions = (await dlmmPool.getPositionsByUserAndLbPair(ownerPk)).userPositions || [];
    const target = userPositions.find((p) => p.publicKey.toBase58() === positionPk.toBase58());
    if (!target) {
      return NextResponse.json(
        { success: false, error: "Position not found for this owner / pool" },
        { status: 404 }
      );
    }

    const lower = Number(target.positionData?.lowerBinId);
    const upper = Number(target.positionData?.upperBinId);
    if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
      return NextResponse.json(
        { success: false, error: "Could not read position bin range" },
        { status: 500 }
      );
    }

    const raw = await dlmmPool.removeLiquidity({
      user: ownerPk,
      position: positionPk,
      fromBinId: lower,
      toBinId: upper,
      bps: new BN(10_000), // 100%
      shouldClaimAndClose: true,
    });
    const txs: Transaction[] = Array.isArray(raw) ? raw : [raw];
    if (txs.length === 0) {
      return NextResponse.json(
        { success: false, error: "Nothing to close" },
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
      data: { transactions, txCount: transactions.length },
    });
  } catch (error) {
    console.error("[Meteora closePosition] error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
