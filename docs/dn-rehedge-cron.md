## DN-LP auto-rehedge cron

Periodic delta-restore for **delta-neutral LP-hedge** cycles: per open DN-LP cycle, resize ONLY
the perp short back to the live LP base amount when drift exceeds the band. No swap, no LP change —
this is the short-only counterpart of the manual rehedge (`lpDeltaNeutralRehedge.ts`).

Reuses the proven `rehedgeLpDeltaNeutralCore` (manage-auth-free — the executor signs on-chain;
the only thing dropped vs the manual path is the app-level owner consent gate, so this endpoint
**must stay secret-gated**). Safe discovery via `resolveDnLpSafes()` (shared with autoclaim).

### Telegram notification (2026-07-03)

After every LIVE grow/reduce **or** margin-skip (never for dry-run/observe passes, including a
cycle forced dry by `maxActionsPerRun`), the cron best-effort notifies the safe's **owner** wallet
via Telegram. This was the first caller of a reusable, cross-cron primitive — see
**`docs/telegram-notifications.md`** for the full architecture (two-repo relay, both secrets,
message formatting conventions, and how to wire the same thing into another cron).

Validated end-to-end pre-merge (2026-07-03): PHP's `config.php` was temporarily pointed at this
branch's preview URL, a test message was sent to the test wallet's Telegram subscriber, delivery
confirmed, then `config.php` reverted to production before merging.

### Endpoint

- **Methods:** `GET` (Vercel Cron) or `POST` (manual)
- **Path:** `/api/protocols/decibel/dn-rehedge/cron`

### Authentication

| Header | Value |
|--------|--------|
| `x-cron-secret` | `YIELD_AI_CRON_SECRET` |
| `Authorization` | `Bearer <YIELD_AI_CRON_SECRET>` (Vercel Cron default) |

Accepts **either** `YIELD_AI_CRON_SECRET` or `CRON_SECRET`.

### Schedule (vercel.json)

Every hour at **:45** — `45 * * * *` — staggered after LP claim (`:00`), recenter (`:15`) and
autoclaim (`:30`) so it never overlaps them on a safe. Times are **UTC**.

Rehedge timescale is hours/days (LP base drifts slowly with price); hourly is ample. The 15% band
is the real gate, not the cadence.

### Live vs observe-only

`dryRun` defaults **TRUE**: the wired schedule logs the would-be decision per cycle (`in-band`,
`grow-short`, `reduce-short`, `margin-skip`) without trading. To go live, append the query in
`vercel.json`:

```
/api/protocols/decibel/dn-rehedge/cron?dryRun=false&maxActionsPerRun=3
```

### How it decides (per cycle)

1. `delta = liveLpBase − liveShort`. Act only if `|delta| ≥ band` (default **15%** of LP base, or
   the market min order, whichever is larger).
2. `delta > 0` (LP holds more base, e.g. price down) → **grow-short** (additional SELL).
   `delta < 0` (price up) → **reduce-short** (reduce-only BUY, capped so it never flips to long).
   LP above range → all-USDC → short closes out.
3. Adjustment snapped down to the market lot; below min order → `in-band` (no-op).
4. Records `strategy_journal::record_action(REHEDGE, …)`.

### Margin guard (grow only)

Growing the short consumes collateral, so before a **grow** the core checks the subaccount's free
collateral (`/api/v1/account_overviews` → `cross_available_to_trade`). If it's below the added
margin × `(1 + marginBufferPct)` (default **+20%**), the grow is **skipped** (`margin-skip`) — never
forced — so automation can't push the perp toward liquidation. The position simply runs slightly
under-hedged until margin is topped up or the user closes manually. Reduce-short frees margin and
is never gated.

> This guard is the seed of any future **auto-close / de-risk** safety valve: an auto-close should
> trigger on the *same* margin-health signal (a hard danger threshold, wide buffer), not on funding
> or transient range exits — those stay alerts + manual.

### Rollout state

**Live (as of 2026-07-03).** `vercel.json` runs
`?dryRun=false&maxActionsPerRun=3&bandBps=1500&marginBufferPct=0.2` hourly at `:45` — resizes the
short when drift exceeds the 15% band (margin guard still applies to grows). Scope in practice:
only safes with an open DN-LP cycle, today limited to the private-beta allowlist (see
`dn-lp-hedge.md` → "LP-DN private beta").

**`bandBps`/`marginBufferPct` are explicit in the query string on purpose (2026-07-04 fix).** The
GET handler's `num()` parser had a bug: `URLSearchParams.get()` returns `null` for an omitted
param, and `Number(null)` is `0` (finite) — so the omitted `bandBps`/`marginBufferPct` on the
*deployed* cron path silently became explicit `0`s, not "use the 1500/0.2 defaults" (`??` only
falls through on `null`/`undefined`, not `0`). Real impact: the LIVE cron ran with band ≈ 0 (just
the market's min-order floor) — far more frequent rehedges than the documented 15% band — and a
0% margin-buffer cushion (guard still checked bare headroom, just without the 20% safety margin).
**Only the GET/query-string path was affected** — every manual `POST {json body}` test in this
session (including the validation log below) passed through fine, since a missing JS object
property is `undefined`, not `null`, and was never mis-parsed. Fixed in `parseOptionalNumber()`
(`lib/utils/http.ts`); both params are now spelled out here too as defense-in-depth.

### Validation (dry-run, 2026-06-28)

Verified end-to-end against the PR #219 preview deploy, `POST {"dryRun":true}`, HTTP 200:

```jsonc
{ "dryRun": true, "safesProcessed": 1, "cyclesProcessed": 2, "actedCycles": 0, "results": [
  { "cycleId": "7", "marketName": "APT/USD", "targetAptHuman": 15.867, "currentShortHuman": 16.9,
    "deltaApt": -1.033, "bandApt": 2.380, "action": "in-band" },   // drift 6.5% < 15%
  { "cycleId": "8", "marketName": "BTC/USD", "targetAptHuman": 0.0001869, "currentShortHuman": 0.00019,
    "deltaApt": -0.0000031, "bandApt": 0.0000280, "action": "in-band" } // drift 1.7%
] }
```

Confirms the full pipeline (safe discovery → cycle enumeration → pinned subaccount → live
market/LP/short reads → band decision) and that the 15% gate correctly no-ops sub-band drift
(`actedCycles: 0`). Drift here had flipped to over-hedged (short > LP base) as APT rose — a real
rehedge would have been a `reduce-short` (not margin-gated).

### Parameters

| Param (query / body) | Default | Meaning |
|---|---|---|
| `dryRun` | `true` | Observe-only; `false` to actually resize the short |
| `bandBps` | `1500` (15%) | Act only when drift exceeds this fraction of the LP base |
| `marginBufferPct` | `0.2` | Headroom over added margin required to grow; negative disables the guard |
| `maxActionsPerRun` | `0` (unlimited) | Cap live orders per run; once hit, remaining cycles run observe-only |
| `safeAddresses` (POST only) | discovered | Override safe discovery with an explicit list |

### Logs

Search Vercel logs for `[DN-Rehedge]`. One `summary` line + one line per cycle (`action`, live
`target`/`short`/`delta`, `adj`, `note`).

### Manual dry-run

```bash
curl -s -X POST "https://yieldai.app/api/protocols/decibel/dn-rehedge/cron" \
  -H "x-cron-secret: $YIELD_AI_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"dryRun":true}'
```

Add `"safeAddresses":["0x…"]` to scope to one safe; set `"dryRun":false` to resize for real.

### Required env

| Variable | Purpose |
|----------|---------|
| `YIELD_AI_CRON_SECRET` / `CRON_SECRET` | Cron auth |
| `APTOS_API_KEY` | Aptos reads (safe enumeration, cycles, LP positions) |
| `DECIBEL_API_BASE_URL` (mainnet) | Markets, prices, positions, collateral; rehedge is mainnet-only |

### Related

Manual rehedge + on-chain facts: **`docs/dn-lp-hedge.md`**. Sibling harvest cron:
**`docs/dn-autoclaim-cron.md`**. Core: `rehedgeLpDeltaNeutralCore` in
`src/lib/protocols/decibel/lpDeltaNeutralRehedge.ts`.
