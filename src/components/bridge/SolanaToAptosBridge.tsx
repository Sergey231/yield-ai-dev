"use client";

import {
  PublicKey,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
  Keypair,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { USDC_MINT, TOKEN_MESSENGER_MINTER_PROGRAM_ID } from "@/lib/cctp-mint-pdas";
import { createDepositForBurnInstructionManual } from "@/lib/cctp-deposit-for-burn";

// CCTP Domain IDs
const DOMAIN_SOLANA = 5;
const DOMAIN_APTOS = 9;

// USDC addresses
const USDC_SOLANA = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_APTOS =
  "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b";

const MESSAGE_TRANSMITTER_PROGRAM_ID = new PublicKey(
  "CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd"
);

/**
 * Converts Aptos address (32 bytes hex) to bytes for mint_recipient.
 */
function aptosAddressToBytes(aptosAddress: string): Uint8Array {
  const cleanAddress = aptosAddress.startsWith("0x")
    ? aptosAddress.slice(2)
    : aptosAddress;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(cleanAddress.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Re-export for callers that import from this component
export { createDepositForBurnInstructionManual };

export type SolanaToAptosBridgeTmpOptions = {
  mode: "tmp";
  tmpKeypair: Keypair;
  feePayerKeypair: Keypair;
  onStatusUpdate?: (status: string) => void;
};

/** Wallet-mode options. Pass a bare function for the plain status-callback form. */
export type SolanaToAptosBridgeWalletOptions = {
  onStatusUpdate: (status: string) => void;
  /** Native/mobile flow: transaction is already partially signed by the event account;
   * wallet signs the fee payer/owner and submits it, returning the tx signature. */
  signAndSubmitTransaction?: (tx: Transaction | VersionedTransaction) => Promise<string>;
  /** Called after confirmation with the new burn's MessageSent event account (base58),
   *  so the caller can queue it for a later manual rent reclaim. */
  onEventAccount?: (eventAccount: string) => void;
};

/**
 * Executes Solana -> Aptos bridge transfer
 * Uses CCTP depositForBurn on Solana
 * Default: connected wallet signs & pays fee.
 * Tmp mode: tmpKeypair as owner, feePayerKeypair pays fee (no wallet adapter).
 */
export async function executeSolanaToAptosBridge(
  amount: string,
  solanaPublicKey: PublicKey,
  signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>,
  solanaConnection: any,
  aptosAddress: string,
  onStatusUpdateOrOptions:
    | ((status: string) => void)
    | SolanaToAptosBridgeTmpOptions
    | SolanaToAptosBridgeWalletOptions
): Promise<string> {
  // Priority fee to reduce "block height exceeded" confirmations under congestion.
  // microLamports per compute unit; small value is usually enough to nudge inclusion.
  const PRIORITY_FEE_MICROLAMPORTS = 5_000;
  const COMPUTE_UNIT_LIMIT = 200_000;

  // TMP MODE: burn from tmp wallet using keypairs only (no wallet adapter)
  if (
    typeof onStatusUpdateOrOptions !== "function" &&
    (onStatusUpdateOrOptions as SolanaToAptosBridgeTmpOptions)?.mode === "tmp"
  ) {
    const { tmpKeypair, feePayerKeypair, onStatusUpdate } =
      onStatusUpdateOrOptions as SolanaToAptosBridgeTmpOptions;
    const log = (s: string) => onStatusUpdate?.(s);

    log("Preparing burn transaction on Solana (tmp wallet mode)...");

    // Get tmp wallet USDC ATA and full balance
    const ownerTokenAccount = await getAssociatedTokenAddress(
      USDC_MINT,
      tmpKeypair.publicKey
    );

    const balanceInfo = await solanaConnection.getTokenAccountBalance(
      ownerTokenAccount
    );
    const rawAmount = balanceInfo?.value?.amount;
    if (!rawAmount) {
      throw new Error("No USDC balance found on tmp wallet token account");
    }
    const amountInBaseUnits = BigInt(rawAmount);

    // Convert Aptos address to 32 bytes for mint_recipient
    const mintRecipientBytes = aptosAddressToBytes(aptosAddress);

    log("Building depositForBurn instruction (tmp wallet)...");

    const messageSendEventDataKeypair = Keypair.generate();
    const messageSendEventData = messageSendEventDataKeypair.publicKey;

    const { instruction } = await createDepositForBurnInstructionManual(
      TOKEN_MESSENGER_MINTER_PROGRAM_ID,
      MESSAGE_TRANSMITTER_PROGRAM_ID,
      USDC_MINT,
      DOMAIN_APTOS,
      tmpKeypair.publicKey,
      feePayerKeypair.publicKey,
      ownerTokenAccount,
      mintRecipientBytes,
      amountInBaseUnits,
      messageSendEventData,
      messageSendEventDataKeypair
    );

    const tx = new Transaction();
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICROLAMPORTS }),
    );
    tx.add(instruction);
    tx.feePayer = feePayerKeypair.publicKey;

    log("Getting fresh blockhash...");
    const { blockhash } = await solanaConnection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;

    log("Signing burn transaction with tmp wallet and fee payer...");
    tx.partialSign(tmpKeypair, messageSendEventDataKeypair, feePayerKeypair);

    log("Sending transaction to Solana...");
    const signature = await solanaConnection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });

    log(`Burn transaction sent: ${signature}`);
    return signature;
  }

  // WALLET MODE (текущая логика моста)
  const walletOpts: SolanaToAptosBridgeWalletOptions =
    typeof onStatusUpdateOrOptions === "function"
      ? { onStatusUpdate: onStatusUpdateOrOptions }
      : (onStatusUpdateOrOptions as SolanaToAptosBridgeWalletOptions);
  const onStatusUpdate = walletOpts.onStatusUpdate;

  try {
    onStatusUpdate('Preparing burn transaction on Solana...');

    // Parse amount (USDC has 6 decimals)
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new Error('Invalid amount');
    }
    const amountInBaseUnits = BigInt(Math.floor(amountNum * Math.pow(10, 6)));

    // Get owner's USDC token account (ATA) - from connected Solana wallet
    const ownerTokenAccount = await getAssociatedTokenAddress(
      USDC_MINT,
      solanaPublicKey
    );

    // Convert Aptos address to 32 bytes for mint_recipient - from connected Aptos wallet
    const mintRecipientBytes = aptosAddressToBytes(aptosAddress);

    onStatusUpdate('Building depositForBurn instruction...');

    // Generate keypair for messageSendEventData account (will be created by program)
    const messageSendEventDataKeypair = Keypair.generate();
    const messageSendEventData = messageSendEventDataKeypair.publicKey;

    // Build depositForBurn instruction manually
    const { instruction, messageSendEventDataKeypair: eventDataKeypair } = await createDepositForBurnInstructionManual(
      TOKEN_MESSENGER_MINTER_PROGRAM_ID,
      MESSAGE_TRANSMITTER_PROGRAM_ID,
      USDC_MINT,
      DOMAIN_APTOS,
      solanaPublicKey,
      solanaPublicKey,
      ownerTokenAccount,
      mintRecipientBytes,
      amountInBaseUnits,
      messageSendEventData,
      messageSendEventDataKeypair
    );

    // Build a v0 (versioned) transaction instead of a legacy one.
    //
    // Why: the burn tx needs a second signer — the ephemeral `messageSendEventData`
    // account the CCTP program initializes. With a legacy Transaction the wallet
    // adapter could reorder accounts, which forced the old code into fragile manual
    // nacl signing on the recompiled message (and skipPreflight: true to dodge the
    // resulting checks). A v0 message is immutable once compiled, so the ephemeral
    // keypair co-signs cleanly AND Phantom can simulate the tx and attach its
    // Lighthouse guard instructions — which is what clears the "this transaction may
    // be malicious" warning users were seeing on the burn step.
    onStatusUpdate('Getting fresh blockhash...');
    const { blockhash, lastValidBlockHeight } = await solanaConnection.getLatestBlockhash('confirmed');

    const messageV0 = new TransactionMessage({
      payerKey: solanaPublicKey,
      recentBlockhash: blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICROLAMPORTS }),
        instruction,
      ],
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);

    // Co-sign with the ephemeral MessageSent event account first. Its signature slot
    // survives the wallet signing step because the v0 message can't be mutated.
    transaction.sign([eventDataKeypair]);

    if (walletOpts.signAndSubmitTransaction) {
      onStatusUpdate('Please approve the transaction in your Solana wallet...');

      const signature = await walletOpts.signAndSubmitTransaction(transaction);
      console.log('[SolanaToAptosBridge] Native transaction submitted:', signature);
      console.log('[SolanaToAptosBridge] View on Solscan: https://solscan.io/tx/' + signature);

      onStatusUpdate('Waiting for transaction confirmation...');
      const confirmation = await solanaConnection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      }, 'confirmed');

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      onStatusUpdate(`Burn completed! Transaction: ${signature.slice(0, 8)}...${signature.slice(-8)}`);
      walletOpts.onEventAccount?.(messageSendEventData.toBase58());
      return signature;
    }

    onStatusUpdate('Please approve the transaction in your Solana wallet...');
    const signed = (await signTransaction(transaction)) as VersionedTransaction;

    // Both required signatures (fee payer + event account) must be present.
    const requiredSigners = signed.message.header.numRequiredSignatures;
    const presentSigs = signed.signatures.filter((s) => s.some((b) => b !== 0)).length;
    console.log('[SolanaToAptosBridge] v0 burn tx signatures required/present:', requiredSigners, presentSigs);
    if (presentSigs < requiredSigners) {
      throw new Error(`Missing signatures: required ${requiredSigners}, present ${presentSigs}`);
    }

    // Preflight back ON now that the tx is well-formed: let the RPC reject a bad tx
    // before submit instead of relying on skipPreflight like the old legacy path.
    onStatusUpdate('Sending transaction to Solana...');
    const signature = await solanaConnection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });

    console.log('[SolanaToAptosBridge] Transaction sent:', signature);
    console.log('[SolanaToAptosBridge] View on Solscan: https://solscan.io/tx/' + signature);

    // Wait for confirmation with better error handling
    onStatusUpdate('Waiting for transaction confirmation...');
    try {
      const confirmation = await solanaConnection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      }, 'confirmed');

      if (confirmation.value.err) {
        // Get detailed error information
        const errorDetails = JSON.stringify(confirmation.value.err, null, 2);
        console.error('[SolanaToAptosBridge] Transaction failed with error:', errorDetails);

        // Try to get transaction details for more info
        try {
          const txDetails = await solanaConnection.getTransaction(signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          });

          if (txDetails?.meta?.err) {
            console.error('[SolanaToAptosBridge] Transaction error details:', {
              err: txDetails.meta.err,
              logMessages: txDetails.meta.logMessages?.slice(0, 10), // First 10 log messages
            });

            // Extract error message from logs if available
            const errorLogs = txDetails.meta.logMessages?.filter((log: string) =>
              log.includes('Error') || log.includes('failed') || log.includes('AccountNotSigner')
            );

            if (errorLogs && errorLogs.length > 0) {
              throw new Error(`Transaction failed: ${errorLogs.join('; ')}`);
            }
          }
        } catch (txError: any) {
          console.warn('[SolanaToAptosBridge] Could not get transaction details:', txError.message);
        }

        throw new Error(`Transaction failed: ${errorDetails}`);
      }

      console.log('[SolanaToAptosBridge] ✅ Transaction confirmed successfully');
      onStatusUpdate(`✅ Burn completed! Transaction: ${signature.slice(0, 8)}...${signature.slice(-8)}`);

      // Report the new MessageSent event account so the caller can queue it for a manual reclaim.
      walletOpts.onEventAccount?.(messageSendEventData.toBase58());

      return signature;
    } catch (confirmError: any) {
      // Check if transaction exists and get its status
      try {
        const status = await solanaConnection.getSignatureStatus(signature);
        if (status.value?.err) {
          console.error('[SolanaToAptosBridge] Transaction status shows error:', status.value.err);
          throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
        }
      } catch (statusError: any) {
        console.warn('[SolanaToAptosBridge] Could not get transaction status:', statusError.message);
      }

      throw confirmError;
    }

  } catch (error: any) {
    console.error('[SolanaToAptosBridge] Error:', error);
    throw error;
  }
}
