# Telegram notifications (wallet-addressed, cross-cron)

Reusable primitive for **any** cron/executor action in this app to notify a wallet owner over
Telegram — not specific to DN-LP rehedge (that was just the first caller). Use this doc when wiring
a notification into another cron (autoclaim, LP claim, etc.).

## Status (2026-07-03) — wired so far

| Cron | Event | Kind | File |
|---|---|---|---|
| `dn-rehedge` | grow-short / reduce-short / margin-skip | ACTION / ALERT | `dnRehedgeCron.ts` |
| `dn-rehedge` | DN-LP position out of range | ALERT | `dnRehedgeCron.ts` |
| `hyperion-lp` (`action=recenter`, all pools) | position out of range | ALERT | `hyperionLpCron.ts` |
| `hyperion-lp` (`action=recenter`/`recenter-dual`) | live re-center executed | ACTION | `hyperionLpCron.ts` |
| `yield-ai/cron/run` (stablecoin compound) | claim action executed | ACTION | `yieldAiVaultWorker.ts` |
| `hyperion-lp` (`action=claim`) — **covers both DN-LP autoclaim (`dn-autoclaim/cron`) and plain Hyperion-LP autoclaim (`hyperion-lp/cron`)**, same code path via `runHyperionAutoClaim`, just a different safe list | fee/reward claim | ACTION | `hyperionLpCron.ts` |

The worked example further down (`### Example: adding it to dn-autoclaim`) predates this — it's
now historical/illustrative of the *pattern* only; the real implementation landed directly in the
`claim` branch of `runHyperionLpCronPass`, one message per safe (not per position).

## Why two repos

Yieldai's Telegram bot lives in a **separate PHP repo**, `Yieldai-API`
(`C:\work\Yieldai-API`, private, `github.com/Waplink/Yieldai-API`) — MySQL-backed subscriber list
(`001_subscribe`: wallet address → chat_id/bot; `001_chatbot`: bot tokens), independent deploy from
this Next.js app. This app never touches chat IDs, bot tokens, or the subscriber DB directly — PHP
owns all of that. This app's job is just: *tell PHP which wallet, and what to say*.

A wrinkle: **the PHP host cannot reach `api.telegram.org` directly** (network-blocked). So the
actual Telegram API call is relayed back through *this* app. The full loop for one notification:

```
this app (cron/executor)                Yieldai-API (PHP)                  Telegram
────────────────────────                ──────────────────                 ────────
notifyWalletTelegram({address, message})
  │
  ├─ POST https://yieldai.aoserver.ru/message.php
  │     header: x-api-secret = YIELDAI_MESSAGE_API_SECRET
  │     body:   { address, message }
  │                                     ──▶ TGMessaging::sendCustomMessage()
  │                                         · detects Aptos/Solana address
  │                                         · looks up 001_subscribe (deleted=0)
  │                                         · resolves chat_id + bot_token
  │                                         · baseFunction::sendData()
  │                                            (relay configured → sendDataViaRelay)
  │                                     ◀── POST https://yieldai.app/api/telegram/send
  │                                             header: x-telegram-relay-secret = TELEGRAM_RELAY_SECRET
  │                                             body:   { chat_id, text, bot_token }
  ▼
/api/telegram/send (THIS app)
  · validates x-telegram-relay-secret
  · POST https://api.telegram.org/bot{bot_token}/sendMessage ──────────────▶ delivered
  · returns Telegram's raw {ok,...} response back to PHP, unmodified
```

Two hops, two different secrets, two different directions — don't confuse them:

| Secret | Direction | Who validates it |
|---|---|---|
| `YIELDAI_MESSAGE_API_SECRET` | this app → PHP (`message.php`) | PHP (`config.php` → `api.message_secret`, must be the SAME string) |
| `TELEGRAM_RELAY_SECRET` | PHP → this app (`/api/telegram/*` relays) | this app (`process.env.TELEGRAM_RELAY_SECRET`) |

Both are already set on Vercel (Preview + Production, since 2026-07-03).

## The two pieces on this side

### 1. Inbound relays (`/api/telegram/*`) — PHP → Telegram Bot API

Shared helper: `src/lib/telegram/relayToBotApi.ts` (secret check + forward + verbatim Telegram JSON).

| Route | Telegram method | Body (beyond `bot_token`) |
|---|---|---|
| `POST /api/telegram/send` | `sendMessage` | `chat_id`, `text`, optional parse/markup fields |
| `POST /api/telegram/getWebhookInfo` | `getWebhookInfo` | (none) |
| `POST /api/telegram/setWebhook` | `setWebhook` | `url` (required), optional Telegram webhook fields |
| `POST /api/telegram/deleteWebhook` | `deleteWebhook` | optional `drop_pending_updates` |

Auth for all: header `x-telegram-relay-secret` = `TELEGRAM_RELAY_SECRET`. Responses are Telegram's
`{ok, result}` / `{ok, description}` **verbatim** (not this app's usual `{success,data}` envelope).

**Subscribe / 1018:** PHP `TGData` calls `getWebhookInfo` then maybe `setWebhook` while creating a
subscription. Those used to hit `api.telegram.org` from the Russian host and failed →
`Server error 1018`. With relay enabled they go through the routes above.

### 2. `notifyWalletTelegram()` — outbound call (what you actually call from a cron)

`src/lib/notifications/telegramWalletNotify.ts`:

```ts
import { notifyWalletTelegram } from "@/lib/notifications/telegramWalletNotify";

const result = await notifyWalletTelegram({
  address: ownerAptosAddress, // the WALLET, not the safe
  message: "🔔 Something happened…",
});
// result: { ok: boolean, status?: number, error?: string }
```

- Reads `YIELDAI_MESSAGE_API_SECRET` server-side only — never throws, never blocks.
- A wallet with no active Telegram subscription is a **silent no-op** (`ok:false`, PHP said
  "Active subscriber not found") — not an error worth alerting on.
- `YIELDAI_MESSAGE_API_URL` env override exists if the PHP endpoint ever moves (defaults to
  `https://yieldai.aoserver.ru/message.php`).

### Owner lookup: safe address → wallet address

Crons operate on **safe addresses**; Telegram subscribers are keyed by **owner wallet address**
(`001_subscribe.address_aptos`). These are different addresses — resolve before notifying:

```ts
import { resolveSafeOwners } from "@/lib/protocols/yield-ai/hyperionLpCron";

const owners = await resolveSafeOwners([...new Set(safeAddresses)]); // Map<safe, owner>
```

One full vault-registry scan (`get_safes_range_info`), filtered to the safes you pass in — batch
this once per cron pass across all affected safes, not per-position.

### 3. Shared emoji taxonomy + formatter

Also in `telegramWalletNotify.ts` — **use these, don't invent ad-hoc emoji in a new caller**:

```ts
import { NOTIFY_EMOJI, formatTelegramNotification, shortAddr } from "@/lib/notifications/telegramWalletNotify";

formatTelegramNotification(NOTIFY_EMOJI.claim, "Title", ["line 1", "line 2", falsyLinesAreDropped]);
// -> "💰 Title\nline 1\nline 2\nhttps://yieldai.app/"
```

Two categories, both use the same `formatTelegramNotification` helper — the distinction is which
emoji you pass, not a different function:

| Category | Meaning | Emoji key(s) |
|---|---|---|
| **ACTION** | the agent DID something — a real tx landed | `claim` 💰, `rehedge` 🔄, `recenter` 🎯, `open` 🟢, `close` 🔴 |
| **ALERT** | nothing was done, but the user should know | `alert` ⚠️ (always this one, regardless of cron) |

Add a new action kind to `NOTIFY_EMOJI` rather than hardcoding an emoji string in a new caller.
`shortAddr(addr)` shortens a `0x…` for compact display inside a message.

`formatTelegramNotification` appends `https://yieldai.app/` as its own trailing line on **every**
message, unconditionally — it's not something you opt into per caller. Telegram auto-links a bare
`https://…` in plain text regardless of `parse_mode` (which this chain doesn't set anyway), so this
needs no Markdown escaping and no PHP-side change. Every message built through this helper is
either ACTION or ALERT, i.e. always something worth following up on in the app.

**Reference the safe, not the position/cycle-internal address.** A user recognizes their safe, not
a CLMM position object (whose address changes on every re-center) or an internal id. Put
`` `Safe ${shortAddr(safeAddress)}` `` as its own line (see `formatRehedgeMessage` / the
Hyperion-LP formatters for the pattern) rather than a position address — if a message covers
several positions in one safe (e.g. a multi-position autoclaim), distinguish them by index
(`Position 1: …`, `Position 2: …`), not by address.

### Gating: when to actually send

Two different rules, and they are **not** interchangeable — pick based on what the cron's `dryRun`
flag actually means for that code path:

- **Most crons**: `dryRun=false` is the live production setting; `dryRun=true` is only ever a
  manual/test invocation. Gate on the **per-item** dry flag the executor actually ran with (not
  just the pass-level option — a cycle/position forced dry by a `maxActionsPerRun` cap must stay
  silent too). This is what `dn-rehedge` and `hyperion-lp`'s `recenter-dual` do.
- **The plain Hyperion-LP legacy "recenter" monitor** (`action=recenter`, no `poolKeys` filter) is
  the one exception: its production schedule runs **permanently** `dryRun=true` (see
  `vercel.json`'s bare-path cron entry) — it never executes trades for most pools, by design. Its
  job IS the alert. Gating an out-of-range message on `!dryRun` there would mean it never fires in
  production. So for THIS pass specifically, the out-of-range ALERT fires regardless of `dryRun`
  (`dryRun` only gates whether a *live recenter* ACTION message fires instead, when the position
  falls in a live-enabled pool and a real re-open happens).

If you add a new "read-only monitor that's permanently dry in prod" cron, follow the second rule
for its alerts. If you add a new action-executing cron (claim/rehedge/etc.), follow the first.

### No dedup / no persisted state (accepted tradeoff, 2026-07-03)

Out-of-range ALERTs (both DN-LP and plain Hyperion-LP) re-fire on **every** cron run while the
position stays out of range — there is no KV/DB in this app to remember "already alerted for this
range-exit." Explicitly accepted rather than adding new infra (Vercel KV/Upstash) for a v1. If this
becomes annoying, the fix is a small persisted "last alerted state" per position/cycle — cheap for
DN-LP (a `strategy_journal` cycle extra, same mechanism as `decibel_margin_open`), but plain
Hyperion-LP positions have no on-chain journal record to attach one to, so that side would need
actual KV/DB infra.

## How to wire a notification into another cron

Pattern used in `dnRehedgeCron.ts` (`notifyRehedgeResults` / `formatRehedgeMessage`) — copy this
shape for a new caller (e.g. dn-autoclaim):

1. **Gate on "did something real happen"** — see "Gating: when to actually send" above for the two
   rules (action-executing cron vs. permanently-dry monitor). For an action-executing cron like
   `dn-autoclaim`, that means checking the *per-item* result (e.g. only `action: "claimed"`, not
   `"skip-below-threshold"`) and the per-item dry flag, not just the pass-level option.
2. **Batch-resolve owners once** after building the per-cycle results (`resolveSafeOwners`), not
   inside the main loop — keep the RPC scan out of the hot path.
3. **Format a short, single-purpose message per event.** Include: what happened (claimed/rehedged/
   skipped), the asset/cycle id, the key number (amount claimed, short delta, etc.), and a
   shortened safe address for reference. Keep it under a few lines — this is a push notification,
   not a report.
4. **Wrap the whole notify pass in try/catch at the call site** (`runAndLog`/`runXCronPass`) so a
   Telegram hiccup — network error, missing secret, PHP down — can **never** affect the cron's own
   result or the (already-executed) on-chain action it's reporting on. Notifications are always
   the last, most disposable step.
5. **Don't await notifications one-by-one in a loop** if there could be several — `Promise.all` over
   the notifiable subset (each call already has its own short timeout).

### Example: adding it to dn-autoclaim

```ts
// after runHyperionAutoClaim(...) results are built, before returning:
const claimed = results.filter((r) => r.action === "claimed");
if (claimed.length > 0) {
  try {
    const owners = await resolveSafeOwners([...new Set(claimed.map((r) => r.safeAddress))]);
    await Promise.all(
      claimed.map(async (r) => {
        const owner = owners.get(normalizeAddress(toCanonicalAddress(r.safeAddress)));
        if (!owner) return;
        await notifyWalletTelegram({
          address: owner,
          message: `💰 Autoclaim — cycle #${r.cycleId}\nClaimed $${r.feesUsd.toFixed(2)} fees` +
            `${r.rewardsUsd ? ` + $${r.rewardsUsd.toFixed(2)} rewards` : ""}, held in the safe.`,
        });
      })
    );
  } catch (err) {
    console.warn("[DN-Autoclaim] notify pass failed; continuing", err);
  }
}
```

(Illustrative — adapt field names to `dn-autoclaim`'s actual result shape before using.)

## Testing without merging to main

Both secrets are already configured for **Preview** as well as Production, so a feature branch's
preview deploy has everything it needs — no env setup required. The one thing that needs care:
PHP's outbound relay target is a **live config file on the PHP server** (`config.php`, not in git),
and it normally points at `https://yieldai.app` (production). To test a *new*
relay/notify/webhook code path before merging:

1. Push the branch, get its preview URL.
2. On the PHP server, temporarily set in `config.php`:
   ```php
   'vercel' => [
       'env' => 'test',
       'relay_secret' => '<same value as TELEGRAM_RELAY_SECRET on Vercel>',
       'telegram_send' => [
           'path' => '/api/telegram/send',
           'production_domain' => 'https://yieldai.app',
           'test_domain' => 'https://<branch>-edbiz.vercel.app',
       ],
   ],
   // or explicitly:
   // 'telegram' => [
   //     'relay_base' => 'https://<branch>-edbiz.vercel.app',
   //     'relay_secret' => '<same value as TELEGRAM_RELAY_SECRET on Vercel>',
   // ],
   ```
   (`telegram.relay_base` / `telegram.relay_url` override the default `vercel.*` domain
   resolution — see Yieldai-API `appConfig.php`.)
3. Smoke-test relays (never paste the real secret into chat logs):
   ```bash
   curl -sS -X POST "https://<preview>/api/telegram/getWebhookInfo" \
     -H "Content-Type: application/json" \
     -H "x-telegram-relay-secret: $TELEGRAM_RELAY_SECRET" \
     -d '{"bot_token":"<bot token>"}'
   ```
4. Trigger subscribe (`index.php?subscribe`) or notify path; confirm no 1018 and webhook URL is set.
5. **Revert `config.php`** back to production before merging.

This was the exact process used to validate the rehedge notification (2026-07-03) — see
`dn-rehedge-cron.md` for that specific test log.

## Gotchas

- **A near-duplicate of the relay was built independently on `feature/fix_tgbot`** (yield-ai repo,
  2026-06-19) but that branch was never merged and is now dozens of files stale (missing DN-LP,
  Exponent, journal, etc.) — don't resurrect it; the current relay (built 2026-07-03, on top of
  current `main`) supersedes it.
- **The subscribe flow is exposed in Tools** — `/api/tg-subscribe` (RSA-OAEP encrypted payload +
  Telegram deep link, calls PHP's `index.php?subscribe`) is wired to a `Telegram Alerts` button in
  `ChatPanel`. The button is shown only after `/api/protocols/yield-ai/safes` confirms that the
  connected Aptos owner has at least one AI agent safe.
- **Active subscription status is not readable from this app yet** — PHP owns `001_subscribe`, and
  this app currently only creates pending subscribe links and sends wallet-addressed messages. To
  show "subscribed" vs "enable" in the UI, add a PHP read endpoint that returns whether
  `001_subscribe.deleted=0` exists for the wallet, then proxy it through a Next.js route.
- **`Server error 1018` during subscribe is PHP-side webhook setup** — thrown by
  `TGData::getData()` when `getWebhookInfo` does not return `{ ok: true }` (network/relay failure
  or bad bot token). Fix: enable Telegram relay on PHP (`vercel.relay_secret` + domain) so
  `getWebhookInfo` / `setWebhook` go through this app; deploy the webhook relay routes on the
  target Vercel env. Pending token is not inserted before this check, so Next.js cannot ignore 1018
  and still return a working deep link.
- Message text has no Markdown/HTML escaping applied on this side — PHP sends with
  `parse_mode: 'Markdown'` for its own portfolio digest, but the relay forwards `text` as-is; keep
  new messages plain-text-safe (or pass an explicit `parse_mode` through `notifyWalletTelegram` if
  you extend its signature) to avoid Telegram rejecting malformed Markdown.
