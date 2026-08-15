import { NextRequest, NextResponse } from "next/server";
import {
  assertTelegramRelaySecret,
  forwardToTelegramBotApi,
  parseRelayJsonBody,
  requireBotToken,
} from "@/lib/telegram/relayToBotApi";

/**
 * POST /api/telegram/setWebhook — relay for Yieldai-API PHP (Russian host cannot reach api.telegram.org).
 *
 * Auth: header `x-telegram-relay-secret` = `TELEGRAM_RELAY_SECRET`.
 * Body: { bot_token, url, secret_token?, drop_pending_updates?, allowed_updates?, max_connections?, ip_address? }.
 * Response: Telegram setWebhook JSON, unmodified.
 */
export async function POST(request: NextRequest) {
  const authFail = assertTelegramRelaySecret(request);
  if (authFail) return authFail.response;

  const parsed = await parseRelayJsonBody(request);
  if ("response" in parsed) return parsed.response;

  const token = requireBotToken(parsed.body);
  if ("response" in token) return token.response;

  const { url, ...rest } = parsed.body;
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ ok: false, description: "url is required" }, { status: 400 });
  }

  const forward: Record<string, unknown> = { url: url.trim() };
  for (const field of [
    "secret_token",
    "drop_pending_updates",
    "allowed_updates",
    "max_connections",
    "ip_address",
  ] as const) {
    if (rest[field] !== undefined) forward[field] = rest[field];
  }

  return forwardToTelegramBotApi(token.botToken, "setWebhook", forward);
}
