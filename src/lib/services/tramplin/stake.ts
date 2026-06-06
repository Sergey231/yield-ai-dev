/**
 * Build a Solana native-stake "create + initialize + delegate" transaction
 * pointing at the Tramplin validator vote account.
 *
 * No Tramplin-specific program is involved — Tramplin simply picks up stake
 * accounts that delegate to its validator via off-chain snapshots. The user
 * remains the sole staker AND withdrawer authority and can later deactivate
 * + withdraw without any Tramplin permission.
 *
 * The new stake account is a fresh ephemeral keypair. The transaction needs
 * TWO signers: this ephemeral keypair (partially signed here on the server)
 * and the user's wallet (which signs and submits on the client).
 *
 * Modelled on tramplin-mobile/src/hooks/useStake.ts.
 */

import {
  Authorized,
  Connection,
  Keypair,
  Lockup,
  PublicKey,
  StakeProgram,
  TransactionMessage,
  VersionedTransaction,
  type Blockhash,
} from "@solana/web3.js";

import { TRAMPLIN_VOTE_ACCOUNT } from "./tramplinApi";

/** Stake account data layout is a fixed 200 bytes. */
const STAKE_ACCOUNT_SPACE = 200;

const TRAMPLIN_VOTE_PUBKEY = new PublicKey(TRAMPLIN_VOTE_ACCOUNT);

export type BuildStakeResult = {
  txBase64: string;
  stakeAccountAddress: string;
  rentExemptLamports: number;
  totalChargedLamports: number;
};

/**
 * Build a partially-signed VersionedTransaction that, when finalized by the
 * wallet, creates a new stake account funded with `amountLamports + rent` and
 * delegates it to the Tramplin validator.
 */
export async function buildTramplinStakeTransaction(opts: {
  connection: Connection;
  payer: PublicKey;
  amountLamports: bigint;
  /** Pass a fresh blockhash; the caller is responsible for liveness. */
  blockhash: Blockhash;
}): Promise<BuildStakeResult> {
  const { connection, payer, amountLamports, blockhash } = opts;
  if (amountLamports <= 0n) throw new Error("amountLamports must be positive");

  const stakeAccount = Keypair.generate();

  const rentExemptLamports = await connection.getMinimumBalanceForRentExemption(STAKE_ACCOUNT_SPACE);
  const totalLamports = Number(amountLamports) + rentExemptLamports;

  // createAccount returns a legacy Transaction containing 2 instructions:
  //   - system::create_account (sized 200 bytes, owner = Stake program)
  //   - stake::initialize      (staker = withdrawer = payer)
  const createAndInit = StakeProgram.createAccount({
    fromPubkey: payer,
    stakePubkey: stakeAccount.publicKey,
    authorized: new Authorized(payer, payer),
    lockup: new Lockup(0, 0, PublicKey.default),
    lamports: totalLamports,
  });

  const delegate = StakeProgram.delegate({
    stakePubkey: stakeAccount.publicKey,
    authorizedPubkey: payer,
    votePubkey: TRAMPLIN_VOTE_PUBKEY,
  });

  const instructions = [...createAndInit.instructions, ...delegate.instructions];

  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const vtx = new VersionedTransaction(message);
  // Partial sign with the ephemeral stake-account keypair. The wallet (payer)
  // will fill in its own signature on the client.
  vtx.sign([stakeAccount]);

  return {
    txBase64: Buffer.from(vtx.serialize()).toString("base64"),
    stakeAccountAddress: stakeAccount.publicKey.toBase58(),
    rentExemptLamports,
    totalChargedLamports: totalLamports,
  };
}
