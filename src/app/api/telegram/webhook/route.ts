import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/telegram/webhook — inbound relay: Telegram → Vercel → Yieldai-API PHP.
 *
 * The PHP host (yieldai.aoserver.ru) is directly reachable from api.telegram.org only
 * intermittently — getWebhookInfo has shown `last_error_message: "Connection timed out"`
 * with a growing pending_update_count. Vercel has no trouble reaching either side, so the
 * bot's webhook is pointed here instead of straight at the PHP host, and this route just
 * forwards the raw Telegram Update JSON on to PHP's existing `?tgData` handler.
 *
 * Auth: Telegram echoes back whatever `secret_token` was passed to setWebhook as the header
 * `X-Telegram-Bot-Api-Secret-Token` on every delivery — verified against TELEGRAM_RELAY_SECRET
 * (the same secret already used for the outbound PHP -> Vercel -> Telegram relay, reused here
 * rather than provisioning a second one).
 */
export async function POST(request: NextRequest) {
  const expectedSecret = process.env.TELEGRAM_RELAY_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { ok: false, description: "TELEGRAM_RELAY_SECRET is not configured on the server" },
      { status: 500 }
    );
  }

  const providedSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ ok: false, description: "Unauthorized" }, { status: 401 });
  }

  const body = await request.text();

  const phpWebhookUrl = process.env.PHP_TG_WEBHOOK_URL || "https://yieldai.aoserver.ru/?tgData";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(phpWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return NextResponse.json(
        { ok: false, description: `PHP webhook responded HTTP ${res.status}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, description: err instanceof Error ? err.message : "PHP webhook forward failed" },
      { status: 502 }
    );
  }
}
