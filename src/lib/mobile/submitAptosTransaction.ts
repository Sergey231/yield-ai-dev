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
    const hash = await signAndSubmitAptosTransaction(transaction);
    return { hash };
  }

  if (!connected || !signAndSubmitTransaction) {
    throw new Error("Wallet not connected");
  }

  return signAndSubmitTransaction(transaction);
}
