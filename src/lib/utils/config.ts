/**
 * Utility functions for configuration and environment variables
 */

/**
 * Base URL for same-origin server-side API calls (no NEXT_PUBLIC_*).
 * Priority: VERCEL_URL (preview + production) > APP_URL (optional, e.g. non-default local port) > localhost:3000
 */
export function getBaseUrl(): string {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    return appUrl.replace(/\/$/, '');
  }
  return 'http://localhost:3000';
}

/**
 * Get the base URL for client-side API calls
 * This should be used in components and client-side code
 */
export function getClientBaseUrl(): string {
  if (typeof window !== 'undefined') {
    // Client-side: use current origin
    return window.location.origin;
  }
  
  // Server-side: use environment variables
  return getBaseUrl();
}

/**
 * Check if we're running in production
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Check if we're running on Vercel
 */
export function isVercel(): boolean {
  return !!process.env.VERCEL_URL;
}
