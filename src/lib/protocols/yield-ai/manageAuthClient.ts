import {
  buildManageAuthMessage,
  computeManageAuthExpiresAt,
  type ManageAuthFields,
} from "./manageAuth";
import { authPublicKeyToHex, authSignatureToHex } from "./manageAuthCrypto";

/** Auth body the API routes verify via `assertOwnerManageAuth`. */
export type OwnerManageAuthBody = {
  ownerAddress: string;
  publicKey: string;
  signature: string;
  fullMessage: string;
  nonce: string;
  expiresAt: number;
};

/** @deprecated Prefer authPublicKeyToHex / authSignatureToHex from manageAuthCrypto. */
export function signatureLikeToString(value: unknown): string {
  return authPublicKeyToHex(value) || authSignatureToHex(value);
}

type SignMessageFn = (args: {
  message: string;
  nonce: string;
  address?: boolean;
  application?: boolean;
  chainId?: boolean;
}) => Promise<{ fullMessage?: unknown; signature?: unknown }>;

type WalletAccountLike = {
  address: { toString(): string };
  publicKey?: unknown;
} | null;

/**
 * Asks the connected wallet to sign an owner authorization for a
 * user-initiated executor action. `fields` must contain the EXACT values the
 * request body will carry (same keys, order, and string formatting) — the
 * server rebuilds the message from the body and compares byte-for-byte.
 */
export async function signOwnerManageAuth(params: {
  account: WalletAccountLike;
  signMessage: SignMessageFn | null | undefined;
  action: string;
  fields: ManageAuthFields;
}): Promise<OwnerManageAuthBody> {
  const { account, signMessage, action, fields } = params;
  if (!account?.address || !signMessage) {
    throw new Error("Connect the safe owner wallet to authorize this action.");
  }

  const publicKey = authPublicKeyToHex(account.publicKey);
  if (!publicKey) {
    throw new Error("Connected wallet did not expose a public key for authorization.");
  }

  const issuedAt = Date.now();
  const expiresAt = computeManageAuthExpiresAt(issuedAt);
  const message = buildManageAuthMessage({ action, fields, expiresAt });
  const nonce = `${issuedAt}-${Math.random().toString(16).slice(2)}`;
  const signed = await signMessage({
    message,
    nonce,
    address: true,
    application: true,
    chainId: true,
  });

  const fullMessage = typeof signed.fullMessage === "string" ? signed.fullMessage : "";
  const signature = authSignatureToHex(signed.signature);
  if (!fullMessage || !signature) {
    throw new Error("Wallet did not return a verifiable message signature.");
  }

  return {
    ownerAddress: account.address.toString(),
    publicKey,
    signature,
    fullMessage,
    nonce,
    expiresAt,
  };
}
