const COOKIE_NAME = 'yield_ai_admin_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getSessionSecret(): string | null {
  const user = process.env.ADMIN_BASIC_AUTH_USER;
  const pass = process.env.ADMIN_BASIC_AUTH_PASSWORD;
  if (!user || !pass) return null;
  return `${user}:${pass}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacSign(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return base64UrlEncode(new Uint8Array(sig));
}

async function hmacVerify(message: string, signature: string, secret: string): Promise<boolean> {
  const expected = await hmacSign(message, secret);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export function verifyAdminCredentials(user: string, pass: string): boolean {
  const expectedUser = process.env.ADMIN_BASIC_AUTH_USER;
  const expectedPass = process.env.ADMIN_BASIC_AUTH_PASSWORD;
  if (!expectedUser || !expectedPass) return false;
  return user === expectedUser && pass === expectedPass;
}

export function isAdminAuthConfigured(): boolean {
  return Boolean(process.env.ADMIN_BASIC_AUTH_USER && process.env.ADMIN_BASIC_AUTH_PASSWORD);
}

/** Restrict post-login redirects to admin pages only. */
export function safeAdminNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/admin') || next.startsWith('/admin/login')) {
    return '/admin/yield-ai/flows';
  }
  return next;
}

export async function createSessionToken(username: string): Promise<string | null> {
  const secret = getSessionSecret();
  if (!secret) return null;
  const payload = JSON.stringify({ u: username, exp: Date.now() + SESSION_TTL_MS });
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(payload));
  const sig = await hmacSign(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

export async function verifySessionToken(token: string): Promise<boolean> {
  const secret = getSessionSecret();
  if (!secret) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!(await hmacVerify(payloadB64, sig, secret))) return false;
  try {
    const json = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(json) as { u?: string; exp?: number };
    if (!payload.exp || payload.exp < Date.now()) return false;
    const expectedUser = process.env.ADMIN_BASIC_AUTH_USER;
    if (!expectedUser || payload.u !== expectedUser) return false;
    return true;
  } catch {
    return false;
  }
}

export const ADMIN_SESSION_COOKIE = COOKIE_NAME;
export const ADMIN_SESSION_MAX_AGE_SEC = Math.floor(SESSION_TTL_MS / 1000);

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: ADMIN_SESSION_MAX_AGE_SEC,
  };
}
