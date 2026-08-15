/**
 * PHP Yieldai-API host helpers for Hyperion stable pool price history / snapshot / upsert.
 * Same host/secret pattern as `telegramWalletNotify` → message.php.
 */

const DEFAULT_BASE = "https://yieldai.aoserver.ru";

function phpBaseUrl(): string {
  const override = process.env.YIELDAI_API_BASE_URL?.trim();
  if (override) return override.replace(/\/$/, "");

  const messageUrl =
    process.env.YIELDAI_MESSAGE_API_URL || `${DEFAULT_BASE}/message.php`;
  // Strip trailing filename if URL ends with …/message.php (or any .php).
  const u = messageUrl.replace(/\/[^/]+\.php$/i, "");
  return u.replace(/\/$/, "") || DEFAULT_BASE;
}

export function resolveHyperionPoolPriceHistoryUrl(): string {
  return (
    process.env.YIELDAI_HYPERION_POOL_PRICE_HISTORY_URL?.trim() ||
    `${phpBaseUrl()}/hyperion_pool_price_history.php`
  );
}

export function resolveHyperionPoolPriceSnapshotUrl(): string {
  return (
    process.env.YIELDAI_HYPERION_POOL_PRICE_SNAPSHOT_URL?.trim() ||
    `${phpBaseUrl()}/hyperion_pool_price_snapshot.php`
  );
}

export function resolveHyperionPoolPriceUpsertUrl(): string {
  return (
    process.env.YIELDAI_HYPERION_POOL_PRICE_UPSERT_URL?.trim() ||
    `${phpBaseUrl()}/hyperion_pool_price_upsert.php`
  );
}

export type HyperionPoolPriceUpsertItem = {
  poolKey: string;
  unixTime: number;
  tick: number;
  price?: number;
  value?: number;
};

/** Optional fallback write when PHP Aptos fetch is down; primary path is PHP cron snapshot. */
export async function postHyperionPoolPriceUpsert(params: {
  items: HyperionPoolPriceUpsertItem[];
  retentionDays?: number;
  timeoutMs?: number;
}): Promise<{
  ok: boolean;
  status?: number;
  stored: number;
  trimmed: number;
  error?: string;
  raw?: unknown;
}> {
  const secret =
    process.env.YIELDAI_API_SECRET?.trim() ||
    process.env.YIELDAI_MESSAGE_API_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      stored: 0,
      trimmed: 0,
      error: "YIELDAI_API_SECRET / YIELDAI_MESSAGE_API_SECRET is not configured",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 20_000);
  try {
    const res = await fetch(resolveHyperionPoolPriceUpsertUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-secret": secret,
      },
      body: JSON.stringify({
        items: params.items,
        retentionDays: params.retentionDays ?? 30,
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as {
      success?: boolean;
      stored?: number;
      trimmed?: number;
      error?: string;
    } | null;

    const stored = typeof json?.stored === "number" ? json.stored : 0;
    const trimmed = typeof json?.trimmed === "number" ? json.trimmed : 0;
    if (!res.ok || !json?.success) {
      return {
        ok: false,
        status: res.status,
        stored,
        trimmed,
        error: json?.error || `PHP upsert failed (${res.status})`,
        raw: json,
      };
    }
    return { ok: true, status: res.status, stored, trimmed, raw: json };
  } catch (e) {
    return {
      ok: false,
      stored: 0,
      trimmed: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timeout);
  }
}
