import { NextRequest, NextResponse } from "next/server";

/**
 * Shared auth + forward for PHP → Vercel → api.telegram.org relays.
 * Returns Telegram's JSON body verbatim (PHP parses `{ok,result}` / `{ok,description}`).
 */

export type RelayAuthFailure = {
  response: NextResponse;
};

export function assertTelegramRelaySecret(
  request: NextRequest
): RelayAuthFailure | null {
  const secret = process.env.TELEGRAM_RELAY_SECRET;
  if (!secret) {
    return {
      response: NextResponse.json(
        { ok: false, description: "TELEGRAM_RELAY_SECRET is not configured on the server" },
        { status: 500 }
      ),
    };
  }
  const provided = request.headers.get("x-telegram-relay-secret");
  if (!provided || provided !== secret) {
    return {
      response: NextResponse.json({ ok: false, description: "Unauthorized" }, { status: 401 }),
    };
  }
  return null;
}

export async function parseRelayJsonBody(
  request: NextRequest
): Promise<{ body: Record<string, unknown> } | { response: NextResponse }> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return {
      response: NextResponse.json({ ok: false, description: "Invalid JSON body" }, { status: 400 }),
    };
  }
  return { body: body as Record<string, unknown> };
}

export function requireBotToken(
  body: Record<string, unknown>
): { botToken: string } | { response: NextResponse } {
  const raw = body.bot_token;
  if (typeof raw !== "string" || !raw.trim()) {
    return {
      response: NextResponse.json({ ok: false, description: "bot_token is required" }, { status: 400 }),
    };
  }
  return { botToken: raw.trim() };
}

/**
 * POST JSON to Telegram Bot API method; forward status + body unchanged.
 */
export async function forwardToTelegramBotApi(
  botToken: string,
  method: string,
  payload: Record<string, unknown>
): Promise<NextResponse> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
    return NextResponse.json(json, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { ok: false, description: err instanceof Error ? err.message : "Telegram request failed" },
      { status: 502 }
    );
  }
}
