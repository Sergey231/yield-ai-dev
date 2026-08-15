"use client";

import {
  type AptosTransactionInput,
  isYieldAiNativeAppNow,
  signAndSubmitAptosTransaction,
} from "@/lib/mobile/nativeBridge";

type AptosSubmitResponse = {
  hash?: string;
  [key: string]: unknown;
};

type AptosSignAndSubmitFn = ((input: AptosTransactionInput) => Promise<AptosSubmitResponse>) | null | undefined;

type SubmitAptosTransactionArgs = {
  transaction: AptosTransactionInput;
  signAndSubmitTransaction: AptosSignAndSubmitFn;
  connected: boolean;
  address?: string | null;
  isNativeApp?: boolean;
};

/**
 * Unified Aptos transaction submit path.
 * - Browser wallet: use wallet.signAndSubmitTransaction as before.
 * - YieldAI native WebView: route through the native bridge instead.
 */
export async function submitAptosTransaction({
  transaction,
  signAndSubmitTransaction,
  connected,
  address,
  isNativeApp = isYieldAiNativeAppNow(),
}: SubmitAptosTransactionArgs): Promise<AptosSubmitResponse> {
  const nativeFlowActive = isNativeApp && !!address;

  if (nativeFlowActive) {
    try {
      const hash = await signAndSubmitAptosTransaction(transaction);
      return { hash };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/encryption key|reconnect/i.test(message)) {
        throw new Error(
          "Petra session expired. Disconnect and connect the wallet again in the app, then retry.",
        );
      }
      throw error;
    }
  }

  if (!connected || !signAndSubmitTransaction) {
    throw new Error("Wallet not connected");
  }

  return signAndSubmitTransaction(transaction);
}
