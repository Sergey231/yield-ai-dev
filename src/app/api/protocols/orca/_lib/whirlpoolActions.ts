import { NextResponse } from "next/server";
import type { Instruction } from "@solana/instructions";
import { address as toAddress } from "@solana/addresses";
import { createSolanaRpc } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { getServerSolanaConnection, getSolanaRpcUrl } from "@/app/api/jupiter/_lib";

type OrcaWhirlpoolAction = "claim" | "close";

type OrcaActionBody = {
  owner?: unknown;
  poolId?: unknown;
  positionPda?: unknown;
  nftMint?: unknown;
  slippageBps?: unknown;
};

type DecodedPosition = {
  address: string;
  whirlpool: string;
  positionMint: string;
  liquidity: bigint;
};

const WHIRLPOOL_PROGRAM_ID = new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc");
const TOKEN_PROGRAMS = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readU128LE(buf: Buffer, offset: number): bigint {
  let out = 0n;
  for (let i = 15; i >= 0; i -= 1) {
    out = (out << 8n) + BigInt(buf[offset + i] ?? 0);
  }
  return out;
}

function readPubkey(buf: Buffer, offset: number): string {
  return new PublicKey(buf.subarray(offset, offset + 32)).toBase58();
}

function decodePosition(data: Buffer, positionPda: string): DecodedPosition | null {
  if (data.length < 88) return null;
  return {
    address: positionPda,
    whirlpool: readPubkey(data, 8),
    positionMint: readPubkey(data, 40),
    liquidity: readU128LE(data, 72),
  };
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

function serializeUnsignedTx(tx: Transaction): string {
  return Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");
}

function kitInstructionToWeb3(ix: Instruction): TransactionInstruction {
  const programId = new PublicKey(String(ix.programAddress));
  const keys =
    (ix.accounts ?? []).map((account) => {
      const role = (account as { role?: unknown }).role as number | undefined;
      return {
        pubkey: new PublicKey(String((account as { address: unknown }).address)),
        isSigner: role === 2 || role === 3,
        isWritable: role === 1 || role === 3,
      };
    }) ?? [];
  const data = Buffer.from(ix.data ? Uint8Array.from(ix.data) : new Uint8Array());
  return new TransactionInstruction({ programId, keys, data });
}

function createAddressOnlySigner(ownerBase58: string) {
  const signerAddress = toAddress(ownerBase58.trim());
  return {
    address: signerAddress,
    signTransactions: async () => {
      throw new Error("Server cannot sign transactions");
    },
  };
}

async function ownsPositionNft(owner: PublicKey, mint: PublicKey): Promise<boolean> {
  const connection = getServerSolanaConnection();
  for (const programId of TOKEN_PROGRAMS) {
    const accounts = await connection.getParsedTokenAccountsByOwner(owner, { programId }, "confirmed");
    for (const item of accounts.value) {
      const parsed = (item.account.data as { parsed?: { info?: Record<string, unknown> } })?.parsed?.info;
      const tokenAmount = parsed?.tokenAmount as Record<string, unknown> | undefined;
      const accountMint = typeof parsed?.mint === "string" ? parsed.mint : "";
      const amountRaw = typeof tokenAmount?.amount === "string" ? tokenAmount.amount : "0";
      const decimals = Number(tokenAmount?.decimals ?? 0);
      if (accountMint === mint.toBase58() && amountRaw === "1" && decimals === 0) {
        return true;
      }
    }
  }
  return false;
}

async function resolvePosition(params: {
  positionPda?: PublicKey;
  nftMint?: PublicKey;
}): Promise<{ positionPda: PublicKey; position: DecodedPosition }> {
  const connection = getServerSolanaConnection();
  const positionPda =
    params.positionPda ??
    PublicKey.findProgramAddressSync(
      [Buffer.from("position"), params.nftMint!.toBuffer()],
      WHIRLPOOL_PROGRAM_ID
    )[0];

  const accountInfo = await connection.getAccountInfo(positionPda, "confirmed");
  if (!accountInfo) {
    throw new Error("Position account not found");
  }
  if (!accountInfo.owner.equals(WHIRLPOOL_PROGRAM_ID)) {
    throw new Error("Position account is not owned by Orca Whirlpool program");
  }

  const position = decodePosition(accountInfo.data, positionPda.toBase58());
  if (!position) {
    throw new Error("Invalid Orca position account");
  }
  if (params.nftMint && position.positionMint !== params.nftMint.toBase58()) {
    throw new Error("Position NFT mint mismatch");
  }

  return { positionPda, position };
}

export async function buildOrcaWhirlpoolAction(req: Request, action: OrcaWhirlpoolAction) {
  try {
    const body = (await req.json().catch(() => null)) as OrcaActionBody | null;
    const owner = readString(body?.owner);
    const poolId = readString(body?.poolId);
    const positionPda = readString(body?.positionPda);
    const nftMint = readString(body?.nftMint);
    const slippageBpsRaw = typeof body?.slippageBps === "number" ? body.slippageBps : Number(body?.slippageBps);

    if (!owner) return jsonError("Missing owner", 400);
    if (!positionPda && !nftMint) return jsonError("Missing positionPda or nftMint", 400);

    let ownerPk: PublicKey;
    let poolPk: PublicKey | undefined;
    let positionPk: PublicKey | undefined;
    let nftMintPk: PublicKey | undefined;
    try {
      ownerPk = new PublicKey(owner);
      poolPk = poolId ? new PublicKey(poolId) : undefined;
      positionPk = positionPda ? new PublicKey(positionPda) : undefined;
      nftMintPk = nftMint ? new PublicKey(nftMint) : undefined;
    } catch {
      return jsonError("Invalid pubkey", 400);
    }

    let sdk: typeof import("@orca-so/whirlpools");
    try {
      sdk = await import("@orca-so/whirlpools");
    } catch (e) {
      console.error("[Orca Whirlpool action] SDK load failed:", e);
      return jsonError("Orca Whirlpool SDK is not installed", 503);
    }

    const { positionPda: resolvedPda, position } = await resolvePosition({
      positionPda: positionPk,
      nftMint: nftMintPk,
    });
    const resolvedMintPk = new PublicKey(position.positionMint);
    if (poolPk && position.whirlpool !== poolPk.toBase58()) {
      return jsonError("Position does not belong to this pool", 400);
    }

    const ownsNft = await ownsPositionNft(ownerPk, resolvedMintPk);
    if (!ownsNft) {
      return jsonError("Position NFT is not owned by this wallet", 403);
    }

    const rpcEndpoint = getSolanaRpcUrl();
    const rpc = createSolanaRpc(rpcEndpoint as Parameters<typeof createSolanaRpc>[0]);
    const authority = createAddressOnlySigner(ownerPk.toBase58());
    const positionMintAddress = toAddress(resolvedMintPk.toBase58());

    const built =
      action === "claim"
        ? await sdk.harvestPositionInstructions(rpc, positionMintAddress, authority)
        : await sdk.closePositionInstructions(
            rpc,
            positionMintAddress,
            Number.isFinite(slippageBpsRaw) ? Math.max(0, Math.floor(slippageBpsRaw)) : undefined,
            authority
          );

    const connection = getServerSolanaConnection();
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({
      feePayer: ownerPk,
      blockhash,
      lastValidBlockHeight,
    });
    tx.add(...built.instructions.map((ix: Instruction) => kitInstructionToWeb3(ix)));

    return NextResponse.json({
      success: true,
      data: {
        transactions: [serializeUnsignedTx(tx)],
        txCount: 1,
        action,
        poolId: position.whirlpool,
        positionPda: resolvedPda.toBase58(),
        nftMint: resolvedMintPk.toBase58(),
        liquidity: position.liquidity.toString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("not found") ? 404 : 500;
    console.error(`[Orca ${action}] error:`, error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
