import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Basic Auth gate for admin pages and admin APIs.
 * Set ADMIN_BASIC_AUTH_USER / ADMIN_BASIC_AUTH_PASSWORD in env to enable.
 * If env vars are missing, admin routes return 503 (deny by default).
 */
function checkAdminBasicAuth(request: NextRequest): NextResponse | null {
  const expectedUser = process.env.ADMIN_BASIC_AUTH_USER;
  const expectedPass = process.env.ADMIN_BASIC_AUTH_PASSWORD;

  if (!expectedUser || !expectedPass) {
    return new NextResponse('Admin auth not configured', { status: 503 });
  }

  const header = request.headers.get('authorization') ?? '';
  if (header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6));
      const sepIdx = decoded.indexOf(':');
      const user = sepIdx >= 0 ? decoded.slice(0, sepIdx) : '';
      const pass = sepIdx >= 0 ? decoded.slice(sepIdx + 1) : '';
      if (user === expectedUser && pass === expectedPass) return null;
    } catch {
      // fall through to 401
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Yield AI Admin"' },
  });
}

export function middleware(request: NextRequest) {
  const { pathname, hostname } = request.nextUrl;

  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    const denied = checkAdminBasicAuth(request);
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

