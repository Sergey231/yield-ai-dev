import {
  Aptos,
  AptosConfig,
  Ed25519PublicKey,
  Ed25519Signature,
  Network,
} from "@aptos-labs/ts-sdk";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";
import {
  STRATEGY_REGISTRY_VIEWS,
  resolveActiveAiAgentStrategy,
} from "@/lib/protocols/yield-ai/strategyRegistry";
import { VAULT_VIEW } from "@/lib/constants/yieldAiVault";
import {
  HYPERION_MANAGE_AUTH_TTL_MS,
  buildHyperionManageAuthMessage,
  type HyperionManageAction,
  type HyperionManageSignedFields,
} from "@/lib/protocols/yield-ai/hyperionManageAuth";

const APTOS_API_KEY = process.env.APTOS_API_KEY;

const aptos = new Aptos(
  new AptosConfig({
    network: Network.MAINNET,
    ...(APTOS_API_KEY && {
      clientConfig: { HEADERS: { Authorization: `Bearer ${APTOS_API_KEY}` } },
    }),
  })
);

export class HyperionManageAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "HyperionManageAuthError";
    this.status = status;
  }
}

type HyperionManageAuthBody = {
  ownerAddress?: unknown;
  publicKey?: unknown;
  signature?: unknown;
  fullMessage?: unknown;
  nonce?: unknown;
  expiresAt?: unknown;
};

/**
 * Authorization for the user-facing Hyperion LP `manage/*` routes.
 *
 * These routes are NOT gated by the cron secret (it must never reach the
 * browser). Live executor actions require a wallet-signed owner authorization
 * bound to the exact action fields, plus on-chain checks that the signer owns
 * the safe and that the safe is opted into the `hyperion_lp` strategy.
 */
export async function assertSafeOptedIntoHyperion(safeAddressRaw: string): Promise<string> {
  const safe = toCanonicalAddress(safeAddressRaw);
  if (!safe.startsWith("0x")) {
    throw new Error("Invalid safeAddress");
  }

  const raw = await aptos.view({
    payload: {
      function: STRATEGY_REGISTRY_VIEWS.getSafeActiveStrategies,
      typeArguments: [],
      functionArguments: [safe],
    },
  });
  const vec = Array.isArray(raw) ? raw[0] : raw;
  const resolved = resolveActiveAiAgentStrategy({ activeStrategyIdBytesVec: vec });

  if (resolved.activeStrategyId !== "hyperion_lp") {
    throw new Error(
      "Safe is not opted into the Hyperion LP strategy. Attach the hyperion_lp strategy first."
    );
  }
  return safe;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HyperionManageAuthError(`Missing manage auth field: ${field}`);
  }
  return value.trim();
}

function extractFullMessageLine(fullMessage: string, key: string): string | null {
  const prefix = `${key}: `;
  const line = fullMessage.split(/\r?\n/).find((entry) => entry.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : null;
}

async function assertSafeOwnedByOwner(params: { safeAddress: string; ownerAddress: string }) {
  const safe = toCanonicalAddress(params.safeAddress);
  const owner = toCanonicalAddress(params.ownerAddress);

  const existsResult = await aptos.view({
    payload: {
      function: VAULT_VIEW.safeRefExists,
      typeArguments: [],
      functionArguments: [owner],
    },
  });
  const exists = Array.isArray(existsResult) && existsResult[0] === true;
  if (!exists) {
    throw new HyperionManageAuthError("Signed owner does not have Yield AI safes", 403);
  }

  const countResult = await aptos.view({
    payload: {
      function: VAULT_VIEW.getSafeCount,
      typeArguments: [],
      functionArguments: [owner],
    },
  });
  const rawCount = Array.isArray(countResult) ? countResult[0] : countResult;
  const count = Number(rawCount);
  if (!Number.isFinite(count) || count <= 0) {
    throw new HyperionManageAuthError("Signed owner does not own this safe", 403);
  }

  for (let i = 0; i < count; i += 1) {
    const addrResult = await aptos.view({
      payload: {
        function: VAULT_VIEW.getSafeAddress,
        typeArguments: [],
        functionArguments: [owner, i],
      },
    });
    const addr = Array.isArray(addrResult) ? addrResult[0] : addrResult;
    if (typeof addr === "string" && toCanonicalAddress(addr) === safe) {
      return;
    }
  }

  throw new HyperionManageAuthError("Signed owner does not own this safe", 403);
}

async function assertPublicKeyAuthenticatesOwner(params: {
  publicKey: Ed25519PublicKey;
  ownerAddress: string;
}) {
  const owner = toCanonicalAddress(params.ownerAddress);
  const derivedAuthKey = toCanonicalAddress(params.publicKey.authKey().derivedAddress().toString());
  const accountInfo = await aptos.getAccountInfo({ accountAddress: owner });
  const onChainAuthKey = toCanonicalAddress(accountInfo.authentication_key);

  if (derivedAuthKey !== onChainAuthKey) {
    throw new HyperionManageAuthError("Wallet public key does not authenticate the signed owner", 403);
  }
}

export async function assertHyperionManageOwnerAuth(params: {
  safeAddress: string;
  action: HyperionManageAction;
  fields: HyperionManageSignedFields;
  auth: unknown;
}) {
  const auth = params.auth as HyperionManageAuthBody | null | undefined;
  if (!auth || typeof auth !== "object") {
    throw new HyperionManageAuthError("Wallet signature is required for live Hyperion LP actions");
  }

  const ownerAddress = toCanonicalAddress(requireString(auth.ownerAddress, "ownerAddress"));
  const publicKey = requireString(auth.publicKey, "publicKey");
  const signature = requireString(auth.signature, "signature");
  const fullMessage = requireString(auth.fullMessage, "fullMessage");
  const nonce = requireString(auth.nonce, "nonce");
  const expiresAt = Number(auth.expiresAt);
  if (!Number.isFinite(expiresAt)) {
    throw new HyperionManageAuthError("Invalid manage auth expiry");
  }
  if (Date.now() > expiresAt || expiresAt - Date.now() > HYPERION_MANAGE_AUTH_TTL_MS + 30_000) {
    throw new HyperionManageAuthError("Hyperion LP authorization expired");
  }

  const expectedMessage = buildHyperionManageAuthMessage({
    action: params.action,
    fields: params.fields,
    expiresAt,
  });
  const signedMessage = extractFullMessageLine(fullMessage, "message");
  const signedNonce = extractFullMessageLine(fullMessage, "nonce");
  const signedAddress = extractFullMessageLine(fullMessage, "address");

  if (signedMessage !== expectedMessage || signedNonce !== nonce) {
    throw new HyperionManageAuthError("Wallet signature does not match this Hyperion LP action");
  }
  if (!signedAddress || toCanonicalAddress(signedAddress) !== ownerAddress) {
    throw new HyperionManageAuthError("Wallet signature address does not match the claimed owner");
  }

  const publicKeyObject = new Ed25519PublicKey(publicKey);
  let valid = false;
  try {
    valid = publicKeyObject.verifySignature({
      message: new TextEncoder().encode(fullMessage),
      signature: new Ed25519Signature(signature),
    });
  } catch {
    valid = false;
  }
  if (!valid) {
    throw new HyperionManageAuthError("Invalid Hyperion LP owner signature");
  }

  await assertPublicKeyAuthenticatesOwner({ publicKey: publicKeyObject, ownerAddress });
  await assertSafeOwnedByOwner({ safeAddress: params.safeAddress, ownerAddress });
}
