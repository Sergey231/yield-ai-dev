/**
 * Wallet-addressed Telegram notifications, routed through the Yieldai-API PHP bot
 * (repo `Yieldai-API`, `data/www/yieldai.aoserver.ru/message.php` -> `TGMessaging.php`).
 *
 * The PHP host cannot reach api.telegram.org directly, so it relays the actual send through
 * this app's `/api/telegram/send` route (see that file) — this module only calls INTO PHP;
 * it never talks to Telegram itself.
 *
 * Auth: `x-api-secret: YIELDAI_MESSAGE_API_SECRET` (mirrors the PHP-side `api.message_secret`).
 * Best-effort: every caller treats a failed/missing notify as non-fatal — never let a Telegram
 * hiccup block or fail the actual on-chain action it's reporting on.
 */
const MESSAGE_API_URL =
  process.env.YIELDAI_MESSAGE_API_URL || "https://yieldai.aoserver.ru/message.php";

/**
 * Shared emoji taxonomy — two categories, consistent across every cron caller (see
 * docs/telegram-notifications.md):
 *   - ACTION: the agent DID something (a real tx landed). Emoji varies by action type.
 *   - ALERT:  informational only — nothing was done, but the user should know (out of range,
 *             margin-skip). Always the same "warning" emoji, regardless of cron/strategy.
 * Add a new action kind here rather than inventing an ad-hoc emoji in a caller.
 */
export const NOTIFY_EMOJI = {
  claim: "💰",
  rehedge: "🔄",
  recenter: "🎯",
  open: "🟢",
  close: "🔴",
  alert: "⚠️",
} as const;

/**
 * Bare URL (no Markdown link syntax) appended to every notification — Telegram
 * auto-links plain `https://…` text in a message regardless of `parse_mode`, so
 * this renders as a tappable link without needing PHP to set/forward
 * `parse_mode` (which this chain does not — see the doc comment below).
 */
const APP_LINK = "https://yieldai.app/";

/** `${emoji} ${title}\n<lines>\n<app link>` — drops falsy lines. Plain text (no Markdown
 * parse_mode is set anywhere in this chain), so avoid characters Telegram would otherwise
 * try to parse as markup. Every caller is an ACTION or ALERT per docs/telegram-notifications.md
 * — i.e. always "the user should probably go look at the app" — so the link is unconditional
 * here rather than opt-in per caller. */
export function formatTelegramNotification(
  emoji: string,
  title: string,
  lines: Array<string | null | undefined | false>
): string {
  const body = [...lines.filter((l): l is string => Boolean(l)), APP_LINK].join("\n");
  return `${emoji} ${title}\n${body}`;
}

/** Shorten a 0x… address to `0xabcdef…123456` for compact display inside a message. */
export function shortAddr(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-6)}` : addr;
}

export type WalletNotifyResult = {
  ok: boolean;
  status?: number;
  error?: string;
};

/**
 * Send a Telegram message to whichever subscriber (if any) has this wallet address registered
 * in Yieldai-API's `001_subscribe` table. Silently returns `{ ok: false }` on any failure
 * (missing secret, network error, no subscriber, Telegram error) — callers should log but never
 * throw on this.
 */
export async function notifyWalletTelegram(params: {
  address: string;
  message: string;
  timeoutMs?: number;
}): Promise<WalletNotifyResult> {
  const secret = process.env.YIELDAI_MESSAGE_API_SECRET;
  if (!secret) {
    return { ok: false, error: "YIELDAI_MESSAGE_API_SECRET is not configured" };
  }
  if (!params.address || !params.message) {
    return { ok: false, error: "address and message are required" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 10_000);
  try {
    const res = await fetch(MESSAGE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-secret": secret },
      body: JSON.stringify({ address: params.address, message: params.message }),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null;
    if (!res.ok || !json?.success) {
      return { ok: false, status: res.status, error: json?.error || `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}
