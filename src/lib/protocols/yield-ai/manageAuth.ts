/**
 * Shared owner-authorization message for user-initiated executor actions
 * (Yield AI safes and Decibel delegated trading). The wallet signs this
 * message off-chain; the API route verifies it before the executor submits.
 *
 * IMPORTANT: the message embeds `JSON.stringify(params)`, so the client and
 * the route MUST build `fields` with identical keys, key order, and value
 * formatting (sign the exact strings sent in the request body).
 */
export type ManageAuthFields = Record<string, string | number | boolean | null>;

/** How long the authorization remains valid after the wallet finishes signing. */
export const MANAGE_AUTH_TTL_MS = 5 * 60 * 1000;

/** Extra window while the wallet popup is open (keyless Google OAuth can be slow). */
export const MANAGE_AUTH_SIGNING_GRACE_MS = 10 * 60 * 1000;

/**
 * Tolerance for the client device clock drifting from the server clock. The
 * validity window is anchored to the client-supplied issuedAt/expiresAt, so a
 * device whose clock runs fast pushes both into the server's future and trips
 * `clientClockAhead`/`expiresTooFar`. Production logs showed real users 60-99s
 * fast, so 30s was far too tight. This is a user-initiated swap of the user's
 * own safe (signature + on-chain ownership still verified), so a wider window
 * is safe. Keep generous enough to cover unsynced consumer clocks.
 */
export const MANAGE_AUTH_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function getManageAuthMaxWindowMs(): number {
  return MANAGE_AUTH_SIGNING_GRACE_MS + MANAGE_AUTH_TTL_MS;
}

export function computeManageAuthExpiresAt(issuedAt: number = Date.now()): number {
  return issuedAt + getManageAuthMaxWindowMs();
}

export function parseManageAuthNonceIssuedAt(nonce: string): number | null {
  const head = String(nonce).split("-")[0] ?? "";
  const issuedAt = Number(head);
  return Number.isFinite(issuedAt) ? issuedAt : null;
}

export function buildManageAuthMessage(params: {
  action: string;
  fields: ManageAuthFields;
  expiresAt: number;
}): string {
  return `Yield AI manage authorization ${JSON.stringify(params)}`;
}
