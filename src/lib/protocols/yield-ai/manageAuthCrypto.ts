import {
  AccountPublicKey,
  AnyPublicKey,
  AnySignature,
  AptosConfig,
  Ed25519PublicKey,
  Ed25519Signature,
  FederatedKeylessPublicKey,
  Hex,
  HexInput,
  KeylessPublicKey,
  KeylessSignature,
  MultiEd25519PublicKey,
  MultiKey,
  PublicKey,
  Signature,
  deserializePublicKey,
  deserializeSignature,
} from "@aptos-labs/ts-sdk";

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

function rawBytesFromUnknown(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((x) => typeof x === "number")) {
    return Uint8Array.from(value);
  }
  if (value && typeof value === "object" && "toUint8Array" in value) {
    try {
      return (value as { toUint8Array: () => Uint8Array }).toUint8Array();
    } catch {
      return null;
    }
  }
  return null;
}

function usesBcsWireFormat(value: unknown): boolean {
  return (
    value instanceof AnyPublicKey ||
    value instanceof AnySignature ||
    value instanceof KeylessPublicKey ||
    value instanceof FederatedKeylessPublicKey ||
    value instanceof KeylessSignature ||
    value instanceof MultiKey ||
    value instanceof MultiEd25519PublicKey
  );
}

/** Serialize wallet public key for manage-auth wire transport. */
export function authPublicKeyToHex(value: unknown): string {
  if (
    value instanceof Ed25519Signature ||
    value instanceof AnySignature ||
    value instanceof KeylessSignature
  ) {
    return "";
  }
  if (typeof value === "string") return value;
  const raw = rawBytesFromUnknown(value);
  if (raw && raw.length === Ed25519PublicKey.LENGTH) {
    return bytesToHex(raw);
  }
  if (usesBcsWireFormat(value)) {
    return bytesToHex((value as { bcsToBytes: () => Uint8Array }).bcsToBytes());
  }
  if (value instanceof Ed25519PublicKey) {
    return bytesToHex(value.toUint8Array());
  }
  if (value && typeof value === "object" && "bcsToBytes" in value) {
    return bytesToHex((value as { bcsToBytes: () => Uint8Array }).bcsToBytes());
  }
  if (value && typeof value === "object" && "toString" in value) {
    return String(value);
  }
  return "";
}

/** Serialize wallet signature for manage-auth wire transport. */
export function authSignatureToHex(value: unknown): string {
  if (typeof value === "string") return value;
  const raw = rawBytesFromUnknown(value);
  if (raw && raw.length === Ed25519Signature.LENGTH) {
    return bytesToHex(raw);
  }
  if (usesBcsWireFormat(value)) {
    return bytesToHex((value as { bcsToBytes: () => Uint8Array }).bcsToBytes());
  }
  if (value instanceof Ed25519Signature) {
    return bytesToHex(value.toUint8Array());
  }
  if (value && typeof value === "object" && "bcsToBytes" in value) {
    return bytesToHex((value as { bcsToBytes: () => Uint8Array }).bcsToBytes());
  }
  if (value && typeof value === "object" && "toString" in value) {
    return String(value);
  }
  return "";
}

/** @deprecated Prefer authPublicKeyToHex / authSignatureToHex. */
export function authMaterialToHex(value: unknown): string {
  if (
    value instanceof Ed25519Signature ||
    value instanceof AnySignature ||
    value instanceof KeylessSignature
  ) {
    return authSignatureToHex(value);
  }
  return authPublicKeyToHex(value);
}

function hexByteLength(hex: HexInput): number {
  return Hex.fromHexInput(hex).toUint8Array().length;
}

export function parseManageAuthPublicKey(publicKeyHex: string): PublicKey {
  if (hexByteLength(publicKeyHex) === Ed25519PublicKey.LENGTH) {
    return new Ed25519PublicKey(publicKeyHex);
  }
  try {
    return deserializePublicKey(publicKeyHex);
  } catch {
    return new Ed25519PublicKey(publicKeyHex);
  }
}

export function parseManageAuthSignature(signatureHex: string): Signature {
  if (hexByteLength(signatureHex) === Ed25519Signature.LENGTH) {
    return new Ed25519Signature(signatureHex);
  }
  try {
    return deserializeSignature(signatureHex);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to deserialize signature";
    throw new Error(msg);
  }
}

export function isKeylessManagePublicKey(publicKey: PublicKey): boolean {
  if (publicKey instanceof KeylessPublicKey || publicKey instanceof FederatedKeylessPublicKey) {
    return true;
  }
  if (publicKey instanceof AnyPublicKey) {
    return (
      publicKey.publicKey instanceof KeylessPublicKey ||
      publicKey.publicKey instanceof FederatedKeylessPublicKey
    );
  }
  return false;
}

function unwrapEd25519Signature(signature: Signature): Ed25519Signature | null {
  if (signature instanceof Ed25519Signature) return signature;
  if (signature instanceof AnySignature && signature.signature instanceof Ed25519Signature) {
    return signature.signature;
  }
  return null;
}

function wrapSignatureForVerification(publicKey: PublicKey, signature: Signature): Signature {
  if (signature instanceof AnySignature) return signature;
  if (publicKey instanceof AnyPublicKey || isKeylessManagePublicKey(publicKey)) {
    return new AnySignature(signature);
  }
  return signature;
}

function normalizeSignatureForVerification(publicKey: PublicKey, signature: Signature): Signature {
  if (publicKey instanceof Ed25519PublicKey) {
    const ed25519Sig = unwrapEd25519Signature(signature);
    if (ed25519Sig) return ed25519Sig;
  }
  return wrapSignatureForVerification(publicKey, signature);
}

export async function verifyManageAuthSignature(params: {
  aptosConfig: AptosConfig;
  publicKey: PublicKey;
  signature: Signature;
  fullMessage: string;
}): Promise<boolean> {
  const message = new TextEncoder().encode(params.fullMessage);
  const signature = normalizeSignatureForVerification(params.publicKey, params.signature);

  if (!(params.publicKey instanceof AccountPublicKey)) {
    return false;
  }

  if (isKeylessManagePublicKey(params.publicKey)) {
    try {
      return await params.publicKey.verifySignatureAsync({
        aptosConfig: params.aptosConfig,
        message,
        signature: wrapSignatureForVerification(params.publicKey, params.signature),
      });
    } catch {
      return false;
    }
  }

  if (params.publicKey instanceof AnyPublicKey) {
    try {
      return params.publicKey.verifySignature({
        message,
        signature: signature as AnySignature,
      });
    } catch {
      return false;
    }
  }

  if (params.publicKey instanceof Ed25519PublicKey && signature instanceof Ed25519Signature) {
    try {
      return params.publicKey.verifySignature({ message, signature });
    } catch {
      return false;
    }
  }

  try {
    return params.publicKey.verifySignature({ message, signature });
  } catch {
    try {
      return await params.publicKey.verifySignatureAsync({
        aptosConfig: params.aptosConfig,
        message,
        signature,
      });
    } catch {
      return false;
    }
  }
}

export function publicKeyAuthenticatesOwner(params: {
  publicKey: PublicKey;
  ownerAddress: string;
  onChainAuthKey: string;
}): boolean {
  if (!(params.publicKey instanceof AccountPublicKey)) {
    return false;
  }

  const owner = params.ownerAddress.toLowerCase();
  const onChainAuthKey = params.onChainAuthKey.toLowerCase();
  const derivedAuthKey = params.publicKey.authKey().derivedAddress().toString().toLowerCase();

  if (derivedAuthKey === onChainAuthKey) {
    return true;
  }

  // Keyless and some smart-wallet accounts store authentication_key equal to the account address.
  return derivedAuthKey === owner && onChainAuthKey === owner;
}
