import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";
import { VAULT_VIEW } from "@/lib/constants/yieldAiVault";
import {
  MANAGE_AUTH_CLOCK_SKEW_MS,
  buildManageAuthMessage,
  computeManageAuthExpiresAt,
  getManageAuthMaxWindowMs,
  parseManageAuthNonceIssuedAt,
  type ManageAuthFields,
} from "./manageAuth";
import {
  parseManageAuthPublicKey,
  parseManageAuthSignature,
  publicKeyAuthenticatesOwner,
  verifyManageAuthSignature,
} from "./manageAuthCrypto";

const APTOS_API_KEY = process.env.APTOS_API_KEY;

const aptosConfig = new AptosConfig({
  network: Network.MAINNET,
  ...(APTOS_API_KEY && {
    clientConfig: { HEADERS: { Authorization: `Bearer ${APTOS_API_KEY}` } },
  }),
});

const aptos = new Aptos(aptosConfig);

export class ManageAuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "ManageAuthError";
    this.status = status;
  }
}

type ManageAuthBody = {
  ownerAddress?: unknown;
  publicKey?: unknown;
  signature?: unknown;
  fullMessage?: unknown;
  nonce?: unknown;
  expiresAt?: unknown;
};

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ManageAuthError(`Missing manage auth field: ${field}`);
  }
  return value.trim();
}

function extractFullMessageLine(fullMessage: string, key: string): string | null {
  const prefix = `${key}: `;
  const line = fullMessage.split(/\r?\n/).find((entry) => entry.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : null;
}

/**
 * Petra's keyless (Google OAuth) web-signing popup ("web.petra.app/prompt")
 * encodes the VALUE of the "message: " and "nonce: " lines in `fullMessage`
 * as `0x` + hex of the UTF-8 bytes, instead of the plain text every other
 * wallet (including non-keyless Petra) puts there — e.g. the line reads
 * `message: 0x5969656c64...` where that hex decodes back to our exact
 * `expectedMessage` byte-for-byte. Confirmed from production logs (both the
 * message and nonce lines round-tripped exactly). Decode before comparing so
 * this wallet-specific quirk doesn't need special-casing at every call site.
 */
function decodeHexUtf8IfHex(raw: string): string {
  if (!/^0x[0-9a-fA-F]+$/.test(raw) || raw.length % 2 !== 0) return raw;
  try {
    return Buffer.from(raw.slice(2), "hex").toString("utf8");
  } catch {
    return raw;
  }
}

/**
 * True if `fullMessage` contains a token matching `expectedCanonical` (after
 * address normalization) anywhere in its text — not just on a strict
 * "address: "-prefixed line. Some wallets (observed with Petra's keyless /
 * Google-login accounts) reformat the wallet-standard `fullMessage` layout,
 * so this is deliberately more permissive than an exact-line match while
 * still requiring the exact owner address to appear in the signed bytes.
 */
function messageContainsAddress(fullMessage: string, expectedCanonical: string): boolean {
  const line = extractFullMessageLine(fullMessage, "address");
  if (line) {
    try {
      if (toCanonicalAddress(line) === expectedCanonical) return true;
    } catch {
      // Not a parseable address on its own line — fall through to the scan.
    }
  }
  const candidates = fullMessage.match(/0x[0-9a-fA-F]+/g) ?? [];
  return candidates.some((candidate) => {
    try {
      return toCanonicalAddress(candidate) === expectedCanonical;
    } catch {
      return false;
    }
  });
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
    throw new ManageAuthError("Signed owner does not have Yield AI safes", 403);
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
    throw new ManageAuthError("Signed owner does not own this safe", 403);
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

  throw new ManageAuthError("Signed owner does not own this safe", 403);
}

async function assertPublicKeyAuthenticatesOwner(params: {
  publicKey: ReturnType<typeof parseManageAuthPublicKey>;
  ownerAddress: string;
}) {
  const owner = toCanonicalAddress(params.ownerAddress);
  const accountInfo = await aptos.getAccountInfo({ accountAddress: owner });
  const onChainAuthKey = toCanonicalAddress(accountInfo.authentication_key);

  if (
    !publicKeyAuthenticatesOwner({
      publicKey: params.publicKey,
      ownerAddress: owner,
      onChainAuthKey,
    })
  ) {
    throw new ManageAuthError("Wallet public key does not authenticate the signed owner", 403);
  }
}

/**
 * Verifies a wallet-signed owner authorization for a user-initiated executor
 * action. Checks: TTL, that the signed bytes contain the expected
 * `action`+`fields`+`expiresAt` message and the owner's address (tolerant of
 * per-wallet `fullMessage` layout — see the inline comment below), signature
 * (Ed25519, unified SingleKey, or keyless), and that the public key
 * authenticates the claimed owner on-chain. When `safeAddress` is given,
 * additionally verifies the owner owns that Yield AI safe.
 *
 * Returns the canonical verified owner address — routes must use it (or
 * compare it against any caller-supplied owner) instead of trusting the body.
 */
export async function assertOwnerManageAuth(params: {
  action: string;
  fields: ManageAuthFields;
  auth: unknown;
  safeAddress?: string;
}): Promise<{ ownerAddress: string }> {
  const auth = params.auth as ManageAuthBody | null | undefined;
  if (!auth || typeof auth !== "object") {
    throw new ManageAuthError("Wallet signature is required for this action");
  }

  const ownerAddress = toCanonicalAddress(requireString(auth.ownerAddress, "ownerAddress"));
  const publicKeyRaw = requireString(auth.publicKey, "publicKey");
  const signatureRaw = requireString(auth.signature, "signature");
  const fullMessage = requireString(auth.fullMessage, "fullMessage");
  const nonce = requireString(auth.nonce, "nonce");
  const expiresAt = Number(auth.expiresAt);
  if (!Number.isFinite(expiresAt)) {
    throw new ManageAuthError("Invalid manage auth expiry");
  }

  const issuedAt = parseManageAuthNonceIssuedAt(nonce);
  if (issuedAt == null) {
    throw new ManageAuthError("Invalid manage auth nonce");
  }

  const now = Date.now();
  const maxWindow = getManageAuthMaxWindowMs();
  const skew = MANAGE_AUTH_CLOCK_SKEW_MS;
  // Window is anchored to the client-supplied issuedAt (from the nonce) and the
  // signed expiresAt. The range checks below already bound expiresAt; we do NOT
  // require expiresAt === computeManageAuthExpiresAt(issuedAt) because that exact
  // equality hard-couples client/server versions — a cached/older client bundle
  // (common on keyless/mobile) would fail every time until a hard refresh.
  const clientClockAhead = now < issuedAt - skew;
  const windowExpired = now > expiresAt;
  const signingTooSlow = now - issuedAt > maxWindow + skew;
  const expiresTooFar = expiresAt - now > maxWindow + skew;
  if (clientClockAhead || windowExpired || signingTooSlow || expiresTooFar) {
    console.error("[manage-auth] Authorization expired", {
      action: params.action,
      now,
      issuedAt,
      expiresAt,
      computedExpiresAt: computeManageAuthExpiresAt(issuedAt),
      nowMinusIssuedAtMs: now - issuedAt,
      expiresAtMinusNowMs: expiresAt - now,
      maxWindowMs: maxWindow,
      skewMs: skew,
      reason: {
        clientClockAhead,
        windowExpired,
        signingTooSlow,
        expiresTooFar,
      },
    });
    throw new ManageAuthError("Authorization expired");
  }

  const expectedMessage = buildManageAuthMessage({
    action: params.action,
    fields: params.fields,
    expiresAt,
  });

  // The wallet-standard `fullMessage` normally carries the signed text as an
  // exact "message: <text>" line and the app nonce as its own "nonce: <nonce>"
  // line. Two independent wallet-specific layout quirks have broken the
  // naive exact-line-match here in production, both confirmed via prod
  // logs on this exact error ("Wallet signature does not match this
  // action" for every keyless user on close/open/add/claim):
  //  1. Petra's keyless (Google-login) web-signing popup hex-encodes the
  //     "message: " (and "nonce: ") line VALUE — see decodeHexUtf8IfHex.
  //  2. Some wallets reformat surrounding whitespace/line order.
  // `expectedMessage` already embeds the action, the exact field values,
  // and a millisecond-precision `expiresAt` — unique per request — so
  // requiring only that the SIGNED bytes CONTAIN this exact string (in
  // either its raw or hex-decoded form, rather than appearing alone on its
  // own line) keeps the same guarantee (the wallet must have signed this
  // exact action + fields + expiry) while tolerating both quirks. The
  // separate nonce-line match is dropped entirely: it added no entropy
  // beyond what `expiresAt` already provides.
  const messageLine = extractFullMessageLine(fullMessage, "message");
  const decodedMessageLine = messageLine != null ? decodeHexUtf8IfHex(messageLine) : null;
  const messageMatches =
    fullMessage.includes(expectedMessage) ||
    (decodedMessageLine != null && decodedMessageLine.includes(expectedMessage));

  if (!messageMatches) {
    console.error("[manage-auth] signed message text not found in fullMessage", {
      action: params.action,
      fullMessageLength: fullMessage.length,
      expectedMessageLength: expectedMessage.length,
      foundNonceLine: extractFullMessageLine(fullMessage, "nonce"),
      expectedNonce: nonce,
      decodedMessageLinePreview: decodedMessageLine?.slice(0, 600) ?? null,
      fullMessagePreview: fullMessage.slice(0, 600),
      expectedMessagePreview: expectedMessage.slice(0, 600),
    });
    throw new ManageAuthError("Wallet signature does not match this action");
  }
  if (!messageContainsAddress(fullMessage, ownerAddress)) {
    console.error("[manage-auth] signed address not found in fullMessage", {
      action: params.action,
      ownerAddress,
      fullMessagePreview: fullMessage.slice(0, 600),
    });
    throw new ManageAuthError("Wallet signature address does not match the claimed owner");
  }

  let publicKeyObject: ReturnType<typeof parseManageAuthPublicKey>;
  let signatureObject: ReturnType<typeof parseManageAuthSignature>;
  try {
    publicKeyObject = parseManageAuthPublicKey(publicKeyRaw);
    signatureObject = parseManageAuthSignature(signatureRaw);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Invalid wallet credentials";
    throw new ManageAuthError(msg, 401);
  }

  const valid = await verifyManageAuthSignature({
    aptosConfig,
    publicKey: publicKeyObject,
    signature: signatureObject,
    fullMessage,
  });
  if (!valid) {
    throw new ManageAuthError("Invalid owner signature");
  }

  await assertPublicKeyAuthenticatesOwner({ publicKey: publicKeyObject, ownerAddress });
  if (params.safeAddress) {
    await assertSafeOwnedByOwner({ safeAddress: params.safeAddress, ownerAddress });
  }

  return { ownerAddress };
}
