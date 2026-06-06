/**
 * Build claim instructions for the Tramplin draw program.
 *
 * Mirrors `prepareClaimInstruction` from tramplin-io/tramplin-mobile
 * (src/utils/solana.ts) but uses @solana/web3.js — to match the rest of
 * our Solana code (Kamino server tx, sendRaw).
 *
 * Program ID:  3NJyzGWjSHP4hZvsqakodi7jAtbufwd52vn1ek6EzQ35
 *
 * Instruction layout (LE):
 *   u8  discriminator = 7  (Claim)
 *   u8  kind           = 0 for regular/epoch, 1 for big
 *   u64 winner_id
 *   u64 stake_id
 *   u64 stake
 *   [32]byte proof[remainder]
 *
 * Accounts (order matters):
 *   0. wallet         WRITABLE_SIGNER
 *   1. wallet         WRITABLE  (duplicate — prize recipient)
 *   2. config PDA     READONLY
 *   3. draw PDA       WRITABLE
 *   4. claimed PDA    WRITABLE
 *   5. metrics PDA    WRITABLE
 *   6. System program READONLY
 */

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type Blockhash,
} from "@solana/web3.js";
import bs58 from "bs58";

import type { TramplinWin } from "./tramplinApi";

export const TRAMPLIN_DRAW_PROGRAM_ID = new PublicKey(
  "3NJyzGWjSHP4hZvsqakodi7jAtbufwd52vn1ek6EzQ35",
);

const CONFIG_SEED = Buffer.from("config");
const METRICS_SEED = Buffer.from("metrics");
const REGULAR_DRAW_SEED = Buffer.from("regular_draw");
const BIG_DRAW_SEED = Buffer.from("big_draw");
const CLAIMED_SEED = Buffer.from("claimed");

const CLAIM_DISCRIMINATOR = 7;

/** Solana versioned-transaction wire limit. */
const TX_WIRE_LIMIT = 1232;

/** Subset of TramplinWin that's needed to build a claim instruction. */
export type ClaimableWin = {
  winnerId: bigint;
  stakeId: bigint;
  stake: bigint;
  epochOrSlot: bigint;
  /** Base58-encoded 32-byte hashes from API `merkleProofs`. */
  proof: string[];
  kind: "regular" | "epoch" | "big";
};

function toBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && value.trim() !== "") {
    try {
      return BigInt(value.trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** Map a raw API Win into the shape expected by `prepareClaimInstruction`. */
export function winToClaimable(win: TramplinWin): ClaimableWin | null {
  const winnerId = toBigInt(win.winnerId);
  const stakeId = toBigInt(win.stakeId);
  const stake = toBigInt(win.stake);
  const epochOrSlot = toBigInt(win.epochOrSlot);
  const proof = Array.isArray(win.merkleProofs)
    ? win.merkleProofs.filter((p): p is string => typeof p === "string" && p.length > 0)
    : [];
  const kindRaw = (win.drawType || "").toString().toLowerCase();
  const kind: ClaimableWin["kind"] | null =
    kindRaw === "big" ? "big" : kindRaw === "epoch" ? "epoch" : kindRaw === "regular" ? "regular" : null;

  if (winnerId == null || stakeId == null || stake == null || epochOrSlot == null || !kind) return null;
  return { winnerId, stakeId, stake, epochOrSlot, proof, kind };
}

function u64ToBufferLE(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) {
    buf[i] = Number((value >> (BigInt(i) * 8n)) & 0xffn);
  }
  return buf;
}

function encodeClaimData(win: ClaimableWin, isBigDraw: boolean): Buffer {
  // Header: u8 disc + u8 kind + u64 winner_id + u64 stake_id + u64 stake
  const header = Buffer.alloc(1 + 1 + 8 + 8 + 8);
  header[0] = CLAIM_DISCRIMINATOR;
  header[1] = isBigDraw ? 1 : 0;
  u64ToBufferLE(win.winnerId).copy(header, 2);
  u64ToBufferLE(win.stakeId).copy(header, 10);
  u64ToBufferLE(win.stake).copy(header, 18);

  // Proof: concatenated 32-byte hashes
  const proofBytes = win.proof.map((p) => {
    const decoded = Buffer.from(bs58.decode(p));
    if (decoded.length !== 32) {
      throw new Error(`Invalid Tramplin merkle proof element length: ${decoded.length}`);
    }
    return decoded;
  });
  const proofConcat = Buffer.concat(proofBytes, 32 * proofBytes.length);

  return Buffer.concat([header, proofConcat]);
}

function deriveClaimPdas(win: ClaimableWin): {
  configPda: PublicKey;
  metricsPda: PublicKey;
  drawPda: PublicKey;
  claimedPda: PublicKey;
} {
  const isBigDraw = win.kind === "big";
  const [configPda] = PublicKey.findProgramAddressSync([CONFIG_SEED], TRAMPLIN_DRAW_PROGRAM_ID);
  const [metricsPda] = PublicKey.findProgramAddressSync([METRICS_SEED], TRAMPLIN_DRAW_PROGRAM_ID);

  const drawSeed = isBigDraw ? BIG_DRAW_SEED : REGULAR_DRAW_SEED;
  const [drawPda] = PublicKey.findProgramAddressSync(
    [drawSeed, u64ToBufferLE(win.epochOrSlot)],
    TRAMPLIN_DRAW_PROGRAM_ID,
  );

  const [claimedPda] = PublicKey.findProgramAddressSync(
    [
      CLAIMED_SEED,
      Buffer.from([isBigDraw ? 1 : 0]),
      u64ToBufferLE(win.epochOrSlot),
      u64ToBufferLE(win.winnerId),
    ],
    TRAMPLIN_DRAW_PROGRAM_ID,
  );

  return { configPda, metricsPda, drawPda, claimedPda };
}

/** Build a single unsigned claim instruction for one winning row. */
export function prepareClaimInstruction(win: ClaimableWin, wallet: PublicKey): TransactionInstruction {
  const isBigDraw = win.kind === "big";
  const { configPda, metricsPda, drawPda, claimedPda } = deriveClaimPdas(win);

  return new TransactionInstruction({
    programId: TRAMPLIN_DRAW_PROGRAM_ID,
    keys: [
      { pubkey: wallet, isSigner: true, isWritable: true },
      { pubkey: wallet, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: drawPda, isSigner: false, isWritable: true },
      { pubkey: claimedPda, isSigner: false, isWritable: true },
      { pubkey: metricsPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeClaimData(win, isBigDraw),
  });
}

/**
 * Compile claim instructions into base64-encoded VersionedTransactions,
 * batched so each fits under the 1232-byte wire limit.
 */
export function buildClaimTransactions(
  instructions: TransactionInstruction[],
  payer: PublicKey,
  recentBlockhash: Blockhash,
): { txBase64: string; instructionCount: number }[] {
  const batches: { txBase64: string; instructionCount: number }[] = [];
  if (instructions.length === 0) return batches;

  let current: TransactionInstruction[] = [];

  const compile = (ixs: TransactionInstruction[]) => {
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash,
      instructions: ixs,
    }).compileToV0Message();
    return new VersionedTransaction(message);
  };

  for (const ix of instructions) {
    const candidate = [...current, ix];
    let candidateTx: VersionedTransaction;
    try {
      candidateTx = compile(candidate);
    } catch (e) {
      // If single instruction can't even compile, skip with a warning.
      if (current.length === 0) {
        console.warn("Tramplin claim: instruction failed to compile, skipping", e);
        continue;
      }
      // Otherwise flush current and try fresh.
      batches.push({
        txBase64: Buffer.from(compile(current).serialize()).toString("base64"),
        instructionCount: current.length,
      });
      current = [ix];
      continue;
    }

    if (candidateTx.serialize().length <= TX_WIRE_LIMIT) {
      current.push(ix);
    } else if (current.length === 0) {
      console.warn("Tramplin claim: instruction too large for single tx, skipping");
    } else {
      batches.push({
        txBase64: Buffer.from(compile(current).serialize()).toString("base64"),
        instructionCount: current.length,
      });
      current = [ix];
    }
  }

  if (current.length > 0) {
    batches.push({
      txBase64: Buffer.from(compile(current).serialize()).toString("base64"),
      instructionCount: current.length,
    });
  }

  return batches;
}
