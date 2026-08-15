import { NextRequest } from "next/server";
import {
  assertTelegramRelaySecret,
  forwardToTelegramBotApi,
  parseRelayJsonBody,
  requireBotToken,
} from "@/lib/telegram/relayToBotApi";

/**
 * POST /api/telegram/deleteWebhook — relay for Yieldai-API PHP.
 *
 * Auth: header `x-telegram-relay-secret` = `TELEGRAM_RELAY_SECRET`.
 * Body: { bot_token, drop_pending_updates? }.
 * Response: Telegram deleteWebhook JSON, unmodified.
 */
export async function POST(request: NextRequest) {
  const authFail = assertTelegramRelaySecret(request);
  if (authFail) return authFail.response;

  const parsed = await parseRelayJsonBody(request);
  if ("response" in parsed) return parsed.response;

  const token = requireBotToken(parsed.body);
  if ("response" in token) return token.response;

  const forward: Record<string, unknown> = {};
  if (parsed.body.drop_pending_updates !== undefined) {
    forward.drop_pending_updates = parsed.body.drop_pending_updates;
  }

  return forwardToTelegramBotApi(token.botToken, "deleteWebhook", forward);
}
