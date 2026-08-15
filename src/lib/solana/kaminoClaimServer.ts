import "server-only";

import { Farms } from "@kamino-finance/farms-sdk";
import { KaminoManager, KaminoVault } from "@kamino-finance/klend-sdk";
import type { Address } from "@solana/addresses";
import type { Instruction } from "@solana/instructions";
import { address } from "@solana/addresses";
import { createSolanaRpc } from "@solana/kit";
import { Buffer } from "buffer";
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
} from "@solana/web3.js";
import { getSafeSolanaRpcEndpoint } from "@/lib/solana/solanaRpcEndpoint";
import { loadKaminoVaultForAddress } from "@/lib/solana/kaminoTxServer";

function getSolanaRpcEndpoint(): string {
  return getSafeSolanaRpcEndpoint();
}

function kitInstructionToWeb3(ix: Instruction): TransactionInstruction {
  const programId = new PublicKey(String(ix.programAddress));
  const keys =
    (ix.accounts ?? []).map((a) => {
      const role = (a as { role?: unknown }).role as number | undefined;
      const isSigner = role === 2 || role === 3;
      const isWritable = role === 1 || role === 3;
      return {
        pubkey: new PublicKey(String((a as { address: unknown }).address)),
        isSigner,
        isWritable,
      };
    }) ?? [];
  const data = Buffer.from(ix.data ? Uint8Array.from(ix.data) : new Uint8Array());
  return new TransactionInstruction({ programId, keys, data });
}

function createAddressOnlySigner(ownerBase58: string) {
  const addr = address(ownerBase58.trim());
  return {
    address: addr,
    signTransactions: async () => {
      throw new Error("Server cannot sign transactions");
    },
  };
}

async function compileInstructionsToTransactionBase64(params: {
  ownerBase58: string;
  instructions: Instruction[];
  lookupTable?: Address;
}): Promise<{ transactionBase64: string }> {
  if (!params.instructions.length) {
    throw new Error("No claim instructions returned by Kamino SDK");
  }

  const connection = new Connection(getSolanaRpcEndpoint(), "confirmed");
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const web3Ixs = params.instructions.map(kitInstructionToWeb3);

  let alt: AddressLookupTableAccount[] = [];
  if (params.lookupTable) {
    const altRes = await connection.getAddressLookupTable(new PublicKey(String(params.lookupTable)));
    if (altRes.value) alt = [altRes.value];
  }

  const messageV0 = new TransactionMessage({
    payerKey: new PublicKey(params.ownerBase58),
    recentBlockhash: blockhash,
    instructions: web3Ixs,
  }).compileToV0Message(alt);

  const vtx = new VersionedTransaction(messageV0);
  const transactionBase64 = Buffer.from(vtx.serialize()).toString("base64");
  return { transactionBase64 };
}

export async function buildKaminoFarmClaimTransactionBase64(params: {
  ownerBase58: string;
  farmPubkey: string;
  isDelegated?: boolean;
  delegatees?: string[];
}): Promise<{ transactionBase64: string }> {
  const ownerBase58 = params.ownerBase58.trim();
  const farmPubkey = params.farmPubkey.trim();
  if (!ownerBase58) throw new Error("Missing signer");
  if (!farmPubkey) throw new Error("Missing farmPubkey");

  const rpc = createSolanaRpc(getSolanaRpcEndpoint() as Parameters<typeof createSolanaRpc>[0]);
  const farms = new Farms(rpc as any);
  const ownerSigner = createAddressOnlySigner(ownerBase58);
  const isDelegated = params.isDelegated === true;
  const delegatees =
    isDelegated && Array.isArray(params.delegatees) && params.delegatees.length > 0
      ? params.delegatees.map((d) => address(d.trim()))
      : undefined;

  const instructions = await farms.claimForUserForFarmAllRewardsIx(
    ownerSigner,
    address(ownerBase58),
    address(farmPubkey),
    isDelegated,
    delegatees
  );

  return compileInstructionsToTransactionBase64({
    ownerBase58,
    instructions,
  });
}

export async function buildKaminoVaultClaimTransactionBase64(params: {
  ownerBase58: string;
  vaultAddress: string;
}): Promise<{ transactionBase64: string }> {
  const ownerBase58 = params.ownerBase58.trim();
  const vaultAddress = params.vaultAddress.trim();
  if (!ownerBase58) throw new Error("Missing signer");
  if (!vaultAddress) throw new Error("Missing vaultAddress");

  const rpc = createSolanaRpc(getSolanaRpcEndpoint() as Parameters<typeof createSolanaRpc>[0]);
  const manager = new KaminoManager(rpc as any);
  const { vault, lookupTable } = await loadKaminoVaultForAddress({ vaultAddress });
  const ownerSigner = createAddressOnlySigner(ownerBase58);

  const instructions = await manager.getClaimAllRewardsForVaultIxs(
    ownerSigner,
    vault as KaminoVault
  );

  return compileInstructionsToTransactionBase64({
    ownerBase58,
    instructions,
    lookupTable,
  });
}
