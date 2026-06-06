/**
 * Client-side queue for CCTP `MessageSent` event accounts that still hold
 * reclaimable rent (~0.00164 SOL each).
 *
 * Variant A ("batched reclaim"): when a user starts their *next* Solana burn,
 * we prepend a `reclaimEventAccount` instruction for the oldest pending entry
 * into the same transaction — the user signs once, the rent comes back for free.
 *
 * Entries are keyed per Solana wallet in localStorage.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { createReclaimEventAccountInstruction } from "./cctp-reclaim-event";

const MESSAGE_TRANSMITTER_PROGRAM_ID = new PublicKey(
  "CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd",
);

/** Approx rent locked in one MessageSent event account, in SOL (for display).
 *  The account stores the full CCTP message (~290 bytes) — measured ≈0.0029 SOL. */
export const RECLAIMABLE_RENT_SOL = 0.0029;

const STORAGE_PREFIX = "cctp_reclaim_queue:";
const MAX_ENTRIES = 25;

export interface PendingReclaim {
  /** The MessageSent event account pubkey (base58). */
  eventAccount: string;
  /** The burn transaction signature, used to look up the Circle attestation. */
  burnTxSig: string;
  /** CCTP source domain of the burn (5 = Solana). */
  sourceDomain: number;
  /** When the entry was recorded (epoch ms). */
  createdAt: number;
}

function storageKey(walletAddress: string): string {
  return `${STORAGE_PREFIX}${walletAddress}`;
}

export function listPendingReclaims(walletAddress: string): PendingReclaim[] {
  if (typeof window === "undefined" || !walletAddress) return [];
  try {
    const raw = window.localStorage.getItem(storageKey(walletAddress));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingReclaim[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(walletAddress: string, entries: PendingReclaim[]): void {
  if (typeof window === "undefined" || !walletAddress) return;
  try {
    const trimmed = entries.slice(-MAX_ENTRIES);
    window.localStorage.setItem(storageKey(walletAddress), JSON.stringify(trimmed));
  } catch {
    /* ignore quota / serialization errors — reclaim is best-effort */
  }
}

export function recordPendingReclaim(
  walletAddress: string,
  entry: Omit<PendingReclaim, "createdAt">,
): void {
  if (!walletAddress) return;
  const existing = listPendingReclaims(walletAddress);
  if (existing.some((e) => e.eventAccount === entry.eventAccount)) return;
  writeQueue(walletAddress, [...existing, { ...entry, createdAt: Date.now() }]);
}

export function removePendingReclaim(walletAddress: string, eventAccount: string): void {
  if (!walletAddress) return;
  const existing = listPendingReclaims(walletAddress);
  writeQueue(
    walletAddress,
    existing.filter((e) => e.eventAccount !== eventAccount),
  );
}

/** Single-shot attestation fetch — returns the attestation hex if ready, else null. */
async function fetchAttestationOnce(
  sourceDomain: number,
  burnTxSig: string,
): Promise<string | null> {
  const irisApiUrl = process.env.NEXT_PUBLIC_CIRCLE_CCTP_ATTESTATION_URL;
  if (!irisApiUrl) return null;
  try {
    const res = await fetch(`${irisApiUrl}/${sourceDomain}/${burnTxSig}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const att = data?.messages?.[0]?.attestation;
    if (typeof att !== "string") return null;
    if (att.toUpperCase().trim().startsWith("PENDING")) return null;
    return att;
  } catch {
    return null;
  }
}

export interface PreparedReclaim {
  instruction: TransactionInstruction;
  /** The event account this reclaim closes — caller removes it from the queue on success. */
  eventAccount: string;
}

/**
 * Tries to build a reclaim instruction for a single queued entry.
 * Returns the instruction when reclaimable, null when not ready yet.
 * Prunes the entry from the queue when it is stale (closed account / bad data).
 */
async function tryBuildReclaim(
  connection: Connection,
  walletAddress: string,
  payee: PublicKey,
  entry: PendingReclaim,
): Promise<PreparedReclaim | null> {
  let eventPk: PublicKey;
  try {
    eventPk = new PublicKey(entry.eventAccount);
  } catch {
    removePendingReclaim(walletAddress, entry.eventAccount);
    return null;
  }

  // Account already closed (reclaimed elsewhere, or never created) — prune.
  const info = await connection.getAccountInfo(eventPk);
  if (!info) {
    removePendingReclaim(walletAddress, entry.eventAccount);
    return null;
  }

  const attestation = await fetchAttestationOnce(entry.sourceDomain, entry.burnTxSig);
  if (!attestation) return null; // not ready yet — try again later

  try {
    const instruction = createReclaimEventAccountInstruction(
      MESSAGE_TRANSMITTER_PROGRAM_ID,
      payee,
      eventPk,
      attestation,
    );
    return { instruction, eventAccount: entry.eventAccount };
  } catch {
    // Malformed entry — drop it so it can't block future bridges.
    removePendingReclaim(walletAddress, entry.eventAccount);
    return null;
  }
}

/**
 * Max reclaim instructions per manual transaction. reclaimEventAccount verifies
 * the Circle attestation (secp256k1) — ~300k CU each — so the batch is capped to
 * stay under Solana's 1.4M CU-per-tx ceiling.
 */
const MAX_BATCH = 4;
/** Compute-unit budget per reclaim instruction (attestation verification is costly). */
const CU_PER_RECLAIM = 300_000;

/**
 * Builds reclaim instructions for every queued entry that is reclaimable now.
 * Used by the manual "Reclaim SOL" button to drain the tail (the last burn,
 * whose rent batched-mode never gets to reclaim).
 */
export async function prepareAllReclaims(
  connection: Connection,
  walletAddress: string,
): Promise<PreparedReclaim[]> {
  const pending = listPendingReclaims(walletAddress);
  if (pending.length === 0) return [];

  const payee = new PublicKey(walletAddress);
  const ordered = [...pending].sort((a, b) => a.createdAt - b.createdAt);

  const out: PreparedReclaim[] = [];
  for (const entry of ordered) {
    if (out.length >= MAX_BATCH) break;
    const prepared = await tryBuildReclaim(connection, walletAddress, payee, entry);
    if (prepared) out.push(prepared);
  }
  return out;
}

/** Builds, signs, sends and confirms a batch of reclaim instructions. */
async function sendReclaimBatch(
  connection: Connection,
  walletPublicKey: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  prepared: PreparedReclaim[],
  onStatus?: (s: string) => void,
): Promise<{ signature: string; count: number }> {
  const tx = new Transaction();
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({
      units: Math.min(1_400_000, 20_000 + prepared.length * CU_PER_RECLAIM),
    }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
  );
  for (const p of prepared) tx.add(p.instruction);
  tx.feePayer = walletPublicKey;

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  onStatus?.("Approve the reclaim transaction in your wallet...");
  const signed = await signTransaction(tx);

  onStatus?.("Sending reclaim transaction...");
  const raw = signed.serialize();
  const signature = await connection.sendRawTransaction(raw, {
    skipPreflight: true,
    maxRetries: 0,
  });

  // Re-broadcast loop, same approach as the burn path.
  while (true) {
    const status = await connection.getSignatureStatus(signature, {
      searchTransactionHistory: true,
    });
    const value = status?.value;
    if (value?.err) {
      throw new Error(`Reclaim transaction failed: ${JSON.stringify(value.err)}`);
    }
    if (value?.confirmationStatus === "confirmed" || value?.confirmationStatus === "finalized") {
      break;
    }
    let height = 0;
    try {
      height = await connection.getBlockHeight("confirmed");
    } catch {
      /* RPC hiccup */
    }
    if (height > lastValidBlockHeight) {
      throw new Error("Reclaim transaction expired before confirming. Please try again.");
    }
    try {
      await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
    } catch {
      /* duplicate / transient */
    }
    await new Promise((r) => setTimeout(r, 2500));
  }

  const walletAddress = walletPublicKey.toBase58();
  for (const p of prepared) removePendingReclaim(walletAddress, p.eventAccount);
  return { signature, count: prepared.length };
}

/**
 * Manually reclaims all currently-reclaimable rent in a single standalone
 * transaction (one wallet signature). Returns the count reclaimed.
 * Throws when nothing is ready yet.
 */
export async function executeReclaim(
  connection: Connection,
  walletPublicKey: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  onStatus?: (s: string) => void,
): Promise<{ signature: string; count: number }> {
  onStatus?.("Checking reclaimable rent...");
  const prepared = await prepareAllReclaims(connection, walletPublicKey.toBase58());
  if (prepared.length === 0) {
    throw new Error(
      "Nothing to reclaim yet — Circle attestations may still be pending. Try again in a minute.",
    );
  }
  return sendReclaimBatch(connection, walletPublicKey, signTransaction, prepared, onStatus);
}

/**
 * Scans the chain for every open CCTP MessageSent event account whose rent was
 * paid by `walletPublicKey` — i.e. all reclaimable rent from this wallet's past
 * Solana burns, regardless of destination chain and regardless of which app
 * made them. Closed (already-reclaimed) accounts are not returned.
 *
 * Uses `getProgramAccounts` with a memcmp filter on the MessageSent layout
 * (8-byte discriminator + rent_payer Pubkey at offset 8). Requires an RPC that
 * supports getProgramAccounts (e.g. Helius).
 */
export async function scanReclaimableAccounts(
  connection: Connection,
  walletPublicKey: PublicKey,
): Promise<string[]> {
  const res = await connection.getProgramAccounts(MESSAGE_TRANSMITTER_PROGRAM_ID, {
    // Don't fetch account data — we only need the pubkeys here.
    dataSlice: { offset: 0, length: 0 },
    filters: [{ memcmp: { offset: 8, bytes: walletPublicKey.toBase58() } }],
  });
  return res.map((r) => r.pubkey.toBase58());
}

/** Builds a reclaim instruction for a single event account discovered on-chain. */
async function buildReclaimForAccount(
  connection: Connection,
  payee: PublicKey,
  eventAccount: string,
): Promise<PreparedReclaim | null> {
  let eventPk: PublicKey;
  try {
    eventPk = new PublicKey(eventAccount);
  } catch {
    return null;
  }
  const info = await connection.getAccountInfo(eventPk);
  if (!info) return null; // already closed

  // The oldest signature touching the account is the burn that created it.
  const sigs = await connection.getSignaturesForAddress(eventPk, { limit: 10 });
  const burnSig = sigs[sigs.length - 1]?.signature;
  if (!burnSig) return null;

  const attestation = await fetchAttestationOnce(5, burnSig);
  if (!attestation) return null; // not attested yet

  try {
    const instruction = createReclaimEventAccountInstruction(
      MESSAGE_TRANSMITTER_PROGRAM_ID,
      payee,
      eventPk,
      attestation,
    );
    return { instruction, eventAccount };
  } catch {
    return null;
  }
}

/**
 * Reclaims rent for a list of event accounts discovered via `scanReclaimableAccounts`.
 * Accounts whose attestation is not ready yet are skipped (reported in `skipped`).
 */
export async function executeReclaimForAccounts(
  connection: Connection,
  walletPublicKey: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  eventAccounts: string[],
  onStatus?: (s: string) => void,
): Promise<{ signature: string; count: number; skipped: number }> {
  onStatus?.("Checking attestations...");
  const prepared: PreparedReclaim[] = [];
  let checked = 0;
  for (const acc of eventAccounts) {
    if (prepared.length >= MAX_BATCH) break;
    checked++;
    const p = await buildReclaimForAccount(connection, walletPublicKey, acc);
    if (p) prepared.push(p);
  }
  if (prepared.length === 0) {
    throw new Error(
      "None of the found accounts are reclaimable yet — Circle attestations may still be pending. Try again in a minute.",
    );
  }
  const result = await sendReclaimBatch(connection, walletPublicKey, signTransaction, prepared, onStatus);
  return { ...result, skipped: Math.max(0, checked - prepared.length) };
}

/**
 * Finds the MessageSent event account inside a Solana CCTP burn transaction
 * whose rent_payer is `walletPublicKey`. Lets users reclaim rent from burns
 * made before the queue existed, by pasting the burn signature.
 */
export async function findEventAccountInBurnTx(
  connection: Connection,
  signature: string,
  walletPublicKey: PublicKey,
): Promise<string> {
  const tx = await connection.getTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  if (!tx) {
    throw new Error("Transaction not found — check the signature and that it is a Solana mainnet tx.");
  }

  const msg = tx.transaction.message as unknown as {
    accountKeys?: PublicKey[];
    staticAccountKeys?: PublicKey[];
  };
  const keys: PublicKey[] = msg.accountKeys ?? msg.staticAccountKeys ?? [];
  if (keys.length === 0) {
    throw new Error("Could not read accounts from the transaction.");
  }

  const wantedRentPayer = walletPublicKey.toBuffer();
  const infos = await connection.getMultipleAccountsInfo(keys);
  for (let i = 0; i < keys.length; i++) {
    const info = infos[i];
    if (!info || !info.owner.equals(MESSAGE_TRANSMITTER_PROGRAM_ID)) continue;
    // MessageSent layout: 8-byte Anchor discriminator + rent_payer (Pubkey, 32).
    if (info.data.length < 40) continue;
    if (Buffer.from(info.data.subarray(8, 40)).equals(wantedRentPayer)) {
      return keys[i].toBase58();
    }
  }
  throw new Error(
    "No reclaimable rent found for your wallet in this transaction — it may already be reclaimed, or the burn was paid by a different wallet.",
  );
}

/**
 * Reclaims rent for a past burn identified only by its Solana tx signature.
 * Discovers the event account, queues it, then runs the standard reclaim
 * (which also drains anything else already pending for this wallet).
 */
export async function reclaimByTransaction(
  connection: Connection,
  signature: string,
  walletPublicKey: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  onStatus?: (s: string) => void,
): Promise<{ signature: string; count: number }> {
  const sig = signature.trim();
  onStatus?.("Looking up the burn transaction...");
  const eventAccount = await findEventAccountInBurnTx(connection, sig, walletPublicKey);

  recordPendingReclaim(walletPublicKey.toBase58(), {
    eventAccount,
    burnTxSig: sig,
    sourceDomain: 5,
  });
  return executeReclaim(connection, walletPublicKey, signTransaction, onStatus);
}
