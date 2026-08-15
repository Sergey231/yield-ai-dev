import { NextRequest, NextResponse } from "next/server";
import {
  assertTelegramRelaySecret,
  forwardToTelegramBotApi,
  parseRelayJsonBody,
  requireBotToken,
} from "@/lib/telegram/relayToBotApi";

/**
 * POST /api/telegram/send — outbound Telegram relay for the Yieldai-API PHP bot.
 *
 * The PHP host (yieldai.aoserver.ru) cannot reach api.telegram.org directly (network-blocked),
 * so it proxies sendMessage calls through this route instead. Stateless: no DB, no auth beyond
 * the shared secret — this app never decides WHO gets notified, PHP does (it resolves the
 * subscriber from its own DB and hands us only chat_id + text + which bot to send as).
 *
 * Auth: header `x-telegram-relay-secret` must equal `TELEGRAM_RELAY_SECRET`.
 * Body: { chat_id, text, bot_token, parse_mode?, disable_web_page_preview?, reply_markup? }.
 * Response: Telegram's raw sendMessage JSON, forwarded verbatim (PHP parses `{ok, result}` /
 * `{ok, description}` directly) — do NOT wrap in this app's usual {success,data} envelope.
 */
export async function POST(request: NextRequest) {
  const authFail = assertTelegramRelaySecret(request);
  if (authFail) return authFail.response;

  const parsed = await parseRelayJsonBody(request);
  if ("response" in parsed) return parsed.response;

  const token = requireBotToken(parsed.body);
  if ("response" in token) return token.response;

  const { chat_id: chatId, text, ...rest } = parsed.body;
  if (chatId == null || (typeof text === "string" && !text.trim())) {
    return NextResponse.json({ ok: false, description: "chat_id and text are required" }, { status: 400 });
  }

  // Only forward the fields Telegram's sendMessage actually accepts (drop bot_token/anything else).
  const forward: Record<string, unknown> = { chat_id: chatId, text };
  for (const field of ["parse_mode", "disable_web_page_preview", "reply_markup"] as const) {
    if (rest[field] !== undefined) forward[field] = rest[field];
  }

  return forwardToTelegramBotApi(token.botToken, "sendMessage", forward);
}
