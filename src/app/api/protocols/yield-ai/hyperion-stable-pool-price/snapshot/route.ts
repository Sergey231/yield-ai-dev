import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/utils/http";
import { resolveHyperionPoolPriceSnapshotUrl } from "@/lib/protocols/yield-ai/hyperionPoolPriceApi";

export const maxDuration = 60;

/**
 * Optional facade → PHP hyperion_pool_price_snapshot.php.
 * Prefer scheduling curl on the PHP host (requireCronIp).
 * If Vercel IP ≠ cron.allowed_ip, this proxy will 404 at PHP — use server cron instead.
 *
 * Auth: Authorization Bearer CRON_SECRET, or x-api-secret = YIELDAI_API_SECRET /
 * YIELDAI_MESSAGE_API_SECRET.
 */
function authorize(request: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (cronSecret && auth === `Bearer ${cronSecret}`) {
    return null;
  }

  const apiSecret =
    process.env.YIELDAI_API_SECRET?.trim() ||
    process.env.YIELDAI_MESSAGE_API_SECRET?.trim();
  const provided =
    request.headers.get("x-api-secret") ||
    request.headers.get("x-message-secret") ||
    "";
  if (apiSecret && provided && provided === apiSecret) {
    return null;
  }

  return NextResponse.json(createErrorResponse(new Error("Unauthorized")), { status: 401 });
}

async function proxySnapshot(request: NextRequest) {
  const authError = authorize(request);
  if (authError) return authError;

  try {
    const url = new URL(resolveHyperionPoolPriceSnapshotUrl());
    const sp = request.nextUrl.searchParams;
    for (const key of ["unixTime", "ts", "retentionDays", "poolKeys"] as const) {
      const v = sp.get(key);
      if (v) url.searchParams.set(key, v);
    }

    let body: string | undefined;
    const headers: Record<string, string> = { Accept: "application/json" };

    if (request.method === "POST") {
      const raw = await request.text().catch(() => "");
      if (raw) {
        body = raw;
        headers["Content-Type"] = "application/json";
      }
    }

    const res = await fetch(url.toString(), {
      method: body ? "POST" : "GET",
      headers,
      body,
      cache: "no-store",
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json(
        {
          success: false,
          error: (json as { error?: string } | null)?.error || `Upstream returned ${res.status}`,
        },
        { status: res.status >= 500 ? 502 : res.status }
      );
    }

    if (json && typeof json === "object" && "success" in (json as object)) {
      return NextResponse.json(json);
    }
    return NextResponse.json(createSuccessResponse(json));
  } catch (err) {
    return NextResponse.json(
      createErrorResponse(err instanceof Error ? err : new Error(String(err))),
      { status: 502 }
    );
  }
}

export async function GET(request: NextRequest) {
  return proxySnapshot(request);
}

export async function POST(request: NextRequest) {
  return proxySnapshot(request);
}
