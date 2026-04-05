import type { NextRequest } from "next/server";

/** Public origin of the incoming request (matches browser address bar on that deployment). */
export function getRequestOrigin(request: Request | NextRequest): string {
  return new URL(request.url).origin;
}
