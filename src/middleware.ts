import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  ADMIN_SESSION_COOKIE,
  isAdminAuthConfigured,
  verifySessionToken,
} from '@/lib/admin/session';

/**
 * Cookie session gate for admin pages and admin APIs.
 * Set ADMIN_BASIC_AUTH_USER / ADMIN_BASIC_AUTH_PASSWORD in env to enable.
 * Sign in at /admin/login (same credentials).
 */
function isAdminAuthPublicPath(pathname: string): boolean {
  return pathname === '/admin/login' || pathname === '/api/admin/login';
}

async function checkAdminSession(request: NextRequest): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl;

  if (isAdminAuthPublicPath(pathname)) return null;

  if (!isAdminAuthConfigured()) {
    return new NextResponse('Admin auth not configured', { status: 503 });
  }

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (token && (await verifySessionToken(token))) return null;

  if (pathname.startsWith('/api/admin')) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const loginUrl = new URL('/admin/login', request.url);
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export async function middleware(request: NextRequest) {
  const { pathname, hostname } = request.nextUrl;

  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    const denied = await checkAdminSession(request);
    if (denied) return denied;
  }

  // Check if we're on the main domain
  const isMainDomain = hostname === 'yieldai.app' || hostname === 'www.yieldai.app';
  
  // Add special headers for main domain
  if (isMainDomain) {
    const response = NextResponse.next();
    
    // Add cache control headers for static assets
    if (pathname.startsWith('/_next/static/') || 
        pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|ico|css|js)$/)) {
      response.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    }
    
    // Add security headers
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('X-XSS-Protection', '1; mode=block');
    
    // Add CORS headers for main domain
    response.headers.set('Access-Control-Allow-Origin', 'https://yieldai.app');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    return response;
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes) — admin APIs are matched separately below
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
    '/api/admin/:path*',
  ],
};

