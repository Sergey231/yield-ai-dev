import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse } from "@/lib/utils/http";

export function getAcceptedDnPilotSecrets(): string[] {
  const secrets = [process.env.YIELD_AI_CRON_SECRET, process.env.CRON_SECRET].filter(
    (value): value is string => Boolean(value?.trim())
  );
  return [...new Set(secrets)];
}

export function verifyDnPilotAuth(request: NextRequest): NextResponse | null {
  const acceptedSecrets = getAcceptedDnPilotSecrets();
  const headerSecret = request.headers.get("x-cron-secret");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();

  if (acceptedSecrets.length === 0) {
    return NextResponse.json(
      createErrorResponse(
        new Error("YIELD_AI_CRON_SECRET (or CRON_SECRET) is not configured on the server")
      ),
      { status: 500 }
    );
  }

  const provided = headerSecret || bearer;
  if (!provided || !acceptedSecrets.includes(provided)) {
    return NextResponse.json(createErrorResponse(new Error("Unauthorized")), { status: 401 });
  }

  return null;
}

export function parseLiveFlag(request: NextRequest, body: Record<string, unknown>): boolean {
  const url = new URL(request.url);
  if (url.searchParams.get("live") === "true") return true;
  return body.live === true;
}

export function parseSkipSignal(body: Record<string, unknown>): boolean {
  return body.skipSignal === true;
}
