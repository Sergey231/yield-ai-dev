"use client";

type NativeBridgeCommand = {
  type: string;
  payload?: Record<string, unknown>;
};

type PendingBridgeRequest = {
  requestId: string;
  resolve: (value: { signature: string }) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  cleanup: () => void;
};

const BRIDGE_REQUEST_TIMEOUT_MS = 60_000;

let pendingSignAndSubmitRequest: PendingBridgeRequest | null = null;

function makeRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function isYieldAiNativeAppNow() {
  if (typeof window === "undefined") return false;
  const w = window as any;
  return (
    Boolean(w?.__YIELDAI_NATIVE_APP__) &&
    Boolean(w?.ReactNativeWebView?.postMessage) &&
    typeof w?.YieldAIBridge?.post === "function"
  );
}

export function postToNative(type: string, payload: Record<string, unknown>) {
  if (typeof window === "undefined") return false;
  const w = window as any;
  if (typeof w?.YieldAIBridge?.post === "function") {
    w.YieldAIBridge.post(type, payload);
    return true;
  }
  return false;
}

function clearPendingRequest() {
  if (pendingSignAndSubmitRequest) {
    clearTimeout(pendingSignAndSubmitRequest.timeoutId);
    pendingSignAndSubmitRequest.cleanup();
    pendingSignAndSubmitRequest = null;
  }
}

function errorFromPayload(payload: Record<string, unknown>) {
  const message = typeof payload.message === "string" ? payload.message : "Native wallet error";
  const code = typeof payload.code === "string" ? payload.code : undefined;
  return new Error(code ? `${code}: ${message}` : message);
}

function waitForSignAndSubmitResponse(requestId: string) {
  if (typeof window === "undefined") {
    throw new Error("Native bridge is not available");
  }

  if (pendingSignAndSubmitRequest) {
    throw new Error("A Solana transaction request is already pending");
  }

  return new Promise<{ signature: string }>((resolve, reject) => {
    const onNativeCommand = (event: Event) => {
      const customEvent = event as CustomEvent<NativeBridgeCommand>;
      const type = customEvent.detail?.type;
      const payload = customEvent.detail?.payload ?? {};
      const responseRequestId = typeof payload.requestId === "string" ? payload.requestId : null;

      if (responseRequestId !== requestId) return;

      if (type === "transaction_submitted") {
        const signature = typeof payload.signature === "string" ? payload.signature : "";
        clearPendingRequest();

        if (!signature) {
          reject(new Error("Missing transaction signature from native"));
          return;
        }

        resolve({ signature });
        return;
      }

      if (type === "wallet_error") {
        clearPendingRequest();
        reject(errorFromPayload(payload));
      }
    };

    const timeoutId = setTimeout(() => {
      clearPendingRequest();
      reject(new Error("Native transaction request timed out"));
    }, BRIDGE_REQUEST_TIMEOUT_MS);

    pendingSignAndSubmitRequest = {
      requestId,
      resolve,
      reject,
      timeoutId,
      cleanup: () => window.removeEventListener("yieldai:native-command", onNativeCommand as EventListener),
    };
    window.addEventListener("yieldai:native-command", onNativeCommand as EventListener);
  });
}

export async function signAndSubmitSolanaTransaction(transactionBase64: string) {
  const requestId = makeRequestId();
  const resultPromise = waitForSignAndSubmitResponse(requestId);

  const ok = postToNative("sign_and_submit_transaction", {
    chain: "solana",
    transaction: transactionBase64,
    requestId,
  });

  if (!ok) {
    clearPendingRequest();
    throw new Error("Native bridge is not available");
  }

  const result = await resultPromise;
  return result.signature;
}

/**
 * Converts a raw byte array to base64 without relying on Buffer
 * (so it stays safe in browser/RN webview runtimes).
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa === "function") return btoa(binary);
  // Node fallback (used during SSR/tests).
  return (globalThis as any).Buffer?.from(bytes).toString("base64") ?? "";
}

/**
 * Serializes an unsigned Solana transaction (legacy or versioned) to base64.
 * Caller must ensure feePayer + recentBlockhash are set on the transaction.
 */
export function serializeUnsignedSolanaTxToBase64(tx: {
  serialize: (options?: { requireAllSignatures?: boolean; verifySignatures?: boolean }) => Uint8Array;
}): string {
  const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return bytesToBase64(raw);
}

/**
 * Convenience helper: serializes the unsigned Solana transaction and routes it
 * through the native sign_and_submit_transaction bridge call. Returns Solana txid.
 */
export async function submitSolanaTransactionViaNative(tx: {
  serialize: (options?: { requireAllSignatures?: boolean; verifySignatures?: boolean }) => Uint8Array;
}): Promise<string> {
  const base64 = serializeUnsignedSolanaTxToBase64(tx);
  return signAndSubmitSolanaTransaction(base64);
}
