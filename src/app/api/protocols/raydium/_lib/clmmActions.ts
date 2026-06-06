import { NextResponse } from "next/server";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { getServerSolanaConnection } from "@/app/api/jupiter/_lib";

type RaydiumClmmAction = "claim" | "close";

type RaydiumActionBody = {
  owner?: unknown;
  poolId?: unknown;
  positionPda?: unknown;
  nftMint?: unknown;
};

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function serializeUnsignedTx(tx: Transaction | VersionedTransaction): string {
  if (tx instanceof Transaction) {
    return Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");
  }
  return Buffer.from(tx.serialize()).toString("base64");
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function buildRaydiumClmmAction(req: Request, action: RaydiumClmmAction) {
  try {
    const body = (await req.json().catch(() => null)) as RaydiumActionBody | null;
    const owner = readString(body?.owner);
    const poolId = readString(body?.poolId);
    const positionPda = readString(body?.positionPda);
    const nftMint = readString(body?.nftMint);

    if (!owner) return jsonError("Missing owner", 400);
    if (!poolId) return jsonError("Missing poolId", 400);
    if (!positionPda && !nftMint) return jsonError("Missing positionPda or nftMint", 400);

    let ownerPk: PublicKey;
    let poolPk: PublicKey;
    let positionPk: PublicKey;
    let nftMintPk: PublicKey | undefined;
    try {
      ownerPk = new PublicKey(owner);
      poolPk = new PublicKey(poolId);
      nftMintPk = nftMint ? new PublicKey(nftMint) : undefined;
      positionPk = positionPda
        ? new PublicKey(positionPda)
        : PublicKey.findProgramAddressSync(
            [Buffer.from("position"), nftMintPk!.toBuffer()],
            new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK")
          )[0];
    } catch {
      return jsonError("Invalid pubkey", 400);
    }

    let sdk: typeof import("@raydium-io/raydium-sdk-v2");
    let BN: typeof import("bn.js");
    try {
      sdk = await import("@raydium-io/raydium-sdk-v2");
      const bnMod = await import("bn.js");
      BN = (bnMod.default ?? bnMod) as typeof import("bn.js");
    } catch (e) {
      console.error("[Raydium CLMM action] SDK load failed:", e);
      return jsonError("Raydium SDK is not installed", 503);
    }

    const connection = getServerSolanaConnection();
    const accountInfo = await connection.getAccountInfo(positionPk, "confirmed");
    if (!accountInfo) return jsonError("Position account not found", 404);

    const ownerPosition = sdk.PositionInfoLayout.decode(accountInfo.data);
    if (!ownerPosition.poolId.equals(poolPk)) {
      return jsonError("Position does not belong to this pool", 400);
    }
    if (nftMintPk && !ownerPosition.nftMint.equals(nftMintPk)) {
      return jsonError("Position NFT mint mismatch", 400);
    }

    const raydium = await sdk.Raydium.load({
      connection,
      owner: ownerPk,
      cluster: "mainnet",
      disableFeatureCheck: true,
      disableLoadToken: true,
      blockhashCommitment: "confirmed",
    });
    await raydium.account.fetchWalletTokenAccounts({ forceUpdate: true, commitment: "confirmed" });

    const ownsPositionNft = raydium.account.tokenAccountRawInfos.some((account) => {
      return account.accountInfo.mint.equals(ownerPosition.nftMint) && account.accountInfo.amount.eq(new BN(1));
    });
    if (!ownsPositionNft) {
      return jsonError("Position NFT is not owned by this wallet", 403);
    }

    const { poolInfo, poolKeys } = await raydium.clmm.getPoolInfoFromRpc(poolPk.toBase58());
    const poolInfoForAction = {
      ...poolInfo,
      // Raydium's RPC-derived API shape may omit initialized reward slots while
      // DecreaseLiquidityV2 validates remaining reward accounts against the
      // on-chain pool state. Build the SDK input from pool keys so account
      // counts match the program's initialized reward count.
      rewardDefaultInfos: poolKeys.rewardInfos.map((reward) => ({ mint: reward.mint })),
    } as typeof poolInfo;

    const built = await raydium.clmm.decreaseLiquidity({
      poolInfo: poolInfoForAction,
      poolKeys,
      ownerPosition,
      ownerInfo: {
        useSOLBalance: true,
        closePosition: action === "close",
      },
      liquidity: action === "close" ? ownerPosition.liquidity : new BN(0),
      amountMinA: new BN(0),
      amountMinB: new BN(0),
      txVersion: sdk.TxVersion.V0,
    });

    const transactions = [serializeUnsignedTx(built.transaction)];

    return NextResponse.json({
      success: true,
      data: {
        transactions,
        txCount: transactions.length,
        action,
        poolId: poolPk.toBase58(),
        positionPda: positionPk.toBase58(),
        nftMint: ownerPosition.nftMint.toBase58(),
      },
    });
  } catch (error) {
    console.error(`[Raydium ${action}] error:`, error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
