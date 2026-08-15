import { NextRequest } from "next/server";
import {
  assertTelegramRelaySecret,
  forwardToTelegramBotApi,
  parseRelayJsonBody,
  requireBotToken,
} from "@/lib/telegram/relayToBotApi";

/**
 * POST /api/telegram/getWebhookInfo — relay for Yieldai-API PHP.
 *
 * Needed on subscribe: TGData calls getWebhookInfo before setWebhook; without a relay that
 * call fails on the Russian host and surfaces as "Server error 1018".
 *
 * Auth: header `x-telegram-relay-secret` = `TELEGRAM_RELAY_SECRET`.
 * Body: { bot_token }.
 * Response: Telegram getWebhookInfo JSON, unmodified.
 */
export async function POST(request: NextRequest) {
  const authFail = assertTelegramRelaySecret(request);
  if (authFail) return authFail.response;

  const parsed = await parseRelayJsonBody(request);
  if ("response" in parsed) return parsed.response;

  const token = requireBotToken(parsed.body);
  if ("response" in token) return token.response;

  return forwardToTelegramBotApi(token.botToken, "getWebhookInfo", {});
}
