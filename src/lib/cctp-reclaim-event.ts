/**
 * Server-safe CCTP `reclaimEventAccount` instruction builder.
 *
 * When a CCTP `depositForBurn` runs on Solana, the MessageTransmitter program
 * creates a `MessageSent` event account (a fresh keypair) that holds ~0.00164
 * SOL of rent. That rent is stranded after the bridge completes. The original
 * rent payer can close the account and reclaim the rent with `reclaimEventAccount`,
 * once Circle has issued the attestation for the message.
 *
 * No "use client" — safe to import anywhere.
 */

import { createHash } from "crypto";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";

/** Anchor discriminator = first 8 bytes of SHA256("global:instruction_name"). */
function computeDiscriminator(instructionName: string): Buffer {
  const hash = createHash("sha256")
    .update(Buffer.from(`global:${instructionName}`, "utf8"))
    .digest();
  return Buffer.from(hash.slice(0, 8));
}

function findMessageTransmitterPda(messageTransmitterProgramId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("message_transmitter", "utf8")],
    messageTransmitterProgramId,
  );
  return pda;
}

/** Decode a hex string (with or without 0x prefix) to bytes. */
function hexToBytes(hex: string): Buffer {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error(`Invalid hex length: ${clean.length}`);
  }
  return Buffer.from(clean, "hex");
}

/**
 * Builds the CCTP `reclaimEventAccount` instruction.
 *
 * @param messageTransmitterProgramId  MessageTransmitter program id.
 * @param payee                        Original rent payer; receives the reclaimed rent. Must sign.
 * @param messageSentEventData         The `MessageSent` event account to close.
 * @param attestation                  Circle attestation for the message (hex string).
 */
export function createReclaimEventAccountInstruction(
  messageTransmitterProgramId: PublicKey,
  payee: PublicKey,
  messageSentEventData: PublicKey,
  attestation: string,
): TransactionInstruction {
  const messageTransmitter = findMessageTransmitterPda(messageTransmitterProgramId);

  const discriminator = computeDiscriminator("reclaim_event_account");

  // Args: ReclaimEventAccountParams { attestation: Vec<u8> }
  // Borsh Vec<u8> = u32 LE length prefix + raw bytes.
  const attestationBytes = hexToBytes(attestation);
  const lenPrefix = Buffer.allocUnsafe(4);
  lenPrefix.writeUInt32LE(attestationBytes.length, 0);

  const data = Buffer.concat([discriminator, lenPrefix, attestationBytes]);

  // Account order matches ReclaimEventAccountContext in
  // circlefin/solana-cctp-contracts (message-transmitter program).
  const keys = [
    { pubkey: payee, isSigner: true, isWritable: true },
    { pubkey: messageTransmitter, isSigner: false, isWritable: true },
    { pubkey: messageSentEventData, isSigner: false, isWritable: true },
  ];

  return new TransactionInstruction({
    programId: messageTransmitterProgramId,
    keys,
    data,
  });
}
