"use client";

import bs58 from "bs58";
import { AccountAddress, U32, U64 } from "@aptos-labs/ts-sdk";
import type { Aptos } from "@aptos-labs/ts-sdk";
import { isDerivedAptosWallet } from "@/lib/aptosWalletUtils";

const USDC_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_APTOS = "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b";
const CCTP_DEPOSIT_FOR_BURN_ENTRY_FUNCTION =
  "0x35e75139eea19566dc8ac00be056e9bd605e788370d76e8bacf87177aeb32dac::cctp_tools::deposit_for_burn";
const DOMAIN_SOLANA = 5;

function solanaAddressToHexBytes(solanaAddress: string): Uint8Array {
  const decoded = bs58.decode(solanaAddress);
  return new Uint8Array(decoded);
}

async function getSolanaTokenAccountAddress(
  ownerPublicKey: string,
  mintAddress: string
): Promise<string> {
  const { getAssociatedTokenAddress } = await import("@solana/spl-token");
  const { PublicKey } = await import("@solana/web3.js");
  const ownerPubkey = new PublicKey(ownerPublicKey);
  const mintPubkey = new PublicKey(mintAddress);
  const ataAddress = await getAssociatedTokenAddress(mintPubkey, ownerPubkey, false);
  return ataAddress.toBase58();
}

async function getAptosExpireTimestampSecs(ttlSeconds: number = 1800): Promise<number | undefined> {
  try {
    const res = await fetch("https://fullnode.mainnet.aptoslabs.com/v1");
    if (!res.ok) return undefined;
    const ledgerInfo = await res.json();
    if (!ledgerInfo.ledger_timestamp) return undefined;
    const ledgerTimestamp = parseInt(ledgerInfo.ledger_timestamp, 10);
    if (Number.isNaN(ledgerTimestamp)) return undefined;
    return Math.floor(ledgerTimestamp / 1_000_000) + ttlSeconds;
  } catch {
    return undefined;
  }
}

export interface ExecuteAptosNativeToSolanaBridgeParams {
  amount: string;
  aptosAccount: { address: any };
  aptosWallet: {
    name?: string;
    isAptosNativeWallet?: boolean;
    features?: {
      "aptos:signTransaction"?: {
        signTransaction: (tx: unknown) => Promise<{ status: string; args?: unknown }>;
      };
    };
  };
  aptosClient: Aptos;
  destinationSolanaAddress: string;
  onStatusUpdate: (status: string) => void;
}

/**
 * Aptos (native) → Solana: burn via on-chain entry function (no bytecode download).
 * Подпись и оплата газа — нативный Aptos‑кошелёк пользователя. Сервисный fee payer не используется.
 * Возвращает хэш транзакции Aptos.
 */
export async function executeAptosNativeToSolanaBridge(
  params: ExecuteAptosNativeToSolanaBridgeParams
): Promise<string> {
  const { amount, aptosAccount, aptosWallet, aptosClient, destinationSolanaAddress, onStatusUpdate } = params;

  if (isDerivedAptosWallet(aptosWallet)) {
    throw new Error("Aptos (native) → Solana supports only native Aptos wallets (e.g. Petra). Use derived flow for Solana-linked wallets.");
  }
  const signTx = aptosWallet.features?.["aptos:signTransaction"];
  if (!signTx) {
    throw new Error("Wallet does not support aptos:signTransaction");
  }

  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    throw new Error("Please enter a valid amount");
  }
  const amountOctas = BigInt(Math.floor(amountNum * 1_000_000));

  onStatusUpdate("Computing Solana token account address (ATA)...");
  const tokenAccountAddress = await getSolanaTokenAccountAddress(destinationSolanaAddress, USDC_SOLANA);
  const mintRecipientBytes = solanaAddressToHexBytes(tokenAccountAddress);
  const mintRecipientAddress = AccountAddress.from(mintRecipientBytes).toString();

  onStatusUpdate("Building transaction...");
  const expireTimestamp = await getAptosExpireTimestampSecs(1800);

  const transaction = await aptosClient.transaction.build.simple({
    sender: aptosAccount.address,
    withFeePayer: false,
    data: {
      typeArguments: [],
      function: CCTP_DEPOSIT_FOR_BURN_ENTRY_FUNCTION as `${string}::${string}::${string}`,
      functionArguments: [
        amountOctas.toString(),
        DOMAIN_SOLANA.toString(),
        mintRecipientAddress,
        USDC_APTOS,
      ],
    },
    options: {
      maxGasAmount: 100000,
      gasUnitPrice: 100,
      ...(expireTimestamp ? { expireTimestamp } : {}),
    },
  } as any);

  onStatusUpdate("Please approve the transaction in your Aptos wallet...");
  const walletSignResult = await signTx.signTransaction(transaction);
  if (walletSignResult.status === "rejected" || (walletSignResult as any).status === 2) {
    throw new Error("User rejected the transaction");
  }
  const senderAuthenticator = walletSignResult.args;
  if (!senderAuthenticator) {
    throw new Error("Transaction signing failed");
  }

  onStatusUpdate("Submitting transaction...");
  const response = await aptosClient.transaction.submit.simple({
    transaction,
    senderAuthenticator: senderAuthenticator as any,
  });

  if (!response?.hash) {
    throw new Error("Transaction submission failed: no hash returned");
  }
  return response.hash;
}
