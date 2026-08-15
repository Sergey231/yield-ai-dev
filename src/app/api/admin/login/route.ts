import { NextRequest, NextResponse } from 'next/server';
import {
  ADMIN_SESSION_COOKIE,
  createSessionToken,
  isAdminAuthConfigured,
  safeAdminNextPath,
  sessionCookieOptions,
  verifyAdminCredentials,
} from '@/lib/admin/session';

async function readCredentials(request: NextRequest): Promise<{
  user: string;
  pass: string;
  next: string | null;
}> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = (await request.json()) as Record<string, unknown>;
    return {
      user: String(body.username ?? body.user ?? '').trim(),
      pass: String(body.password ?? ''),
      next: body.next != null ? String(body.next) : null,
    };
  }

  const form = await request.formData();
  return {
    user: String(form.get('username') ?? '').trim(),
    pass: String(form.get('password') ?? ''),
    next: form.get('next') != null ? String(form.get('next')) : null,
  };
}

function loginRedirect(request: NextRequest, next: string, error?: string): NextResponse {
  const url = new URL('/admin/login', request.url);
  url.searchParams.set('next', next);
  if (error) url.searchParams.set('error', error);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: NextRequest) {
  if (!isAdminAuthConfigured()) {
    return NextResponse.json({ error: 'Admin auth not configured' }, { status: 503 });
  }

  let user: string;
  let pass: string;
  let next: string | null;
  try {
    ({ user, pass, next } = await readCredentials(request));
  } catch {
    return loginRedirect(request, safeAdminNextPath(null), 'invalid');
  }

  const redirectTo = safeAdminNextPath(next);
  const wantsJson = (request.headers.get('content-type') ?? '').includes('application/json');

  if (!verifyAdminCredentials(user, pass)) {
    if (wantsJson) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }
    return loginRedirect(request, redirectTo, 'invalid');
  }

  const token = await createSessionToken(user);
  if (!token) {
    return NextResponse.json({ error: 'Admin auth not configured' }, { status: 503 });
  }

  const secure = request.nextUrl.protocol === 'https:';

  if (wantsJson) {
    const res = NextResponse.json({ ok: true, next: redirectTo });
    res.cookies.set(ADMIN_SESSION_COOKIE, token, sessionCookieOptions(secure));
    return res;
  }

  const res = NextResponse.redirect(new URL(redirectTo, request.url), { status: 303 });
  res.cookies.set(ADMIN_SESSION_COOKIE, token, sessionCookieOptions(secure));
  return res;
}
