## DN-LP autoclaim cron

Periodic harvest for **delta-neutral LP-hedge** safes: claims Hyperion LP fees + farm rewards
above a USD threshold, swaps claimed APT rewards → USDC, and **leaves the proceeds in the safe**
as a stable buffer. No reinvest into LP, no compounding (see *Policy* below).

Reuses the existing `runHyperionAutoClaim` engine (`hyperionLpActions.ts`) via
`runHyperionLpCronPass({ action: "claim" })`. The only DN-specific part is **safe discovery**:
`resolveDnLpSafes()` enumerates safes that hold an open `strategy_journal` cycle with a Hyperion
LP leg (`lp_position != 0x0`) — these run the DN strategy, so the registry filter
`isHyperionSafe` (active strategy == `hyperion_lp`) skips them.

### Endpoint

- **Methods:** `GET` (Vercel Cron) or `POST` (manual)
- **Path:** `/api/protocols/decibel/dn-autoclaim/cron`

### Authentication

| Header | Value |
|--------|--------|
| `x-cron-secret` | `YIELD_AI_CRON_SECRET` |
| `Authorization` | `Bearer <YIELD_AI_CRON_SECRET>` (Vercel Cron default) |

Accepts **either** `YIELD_AI_CRON_SECRET` or `CRON_SECRET`.

### Schedule (vercel.json)

Every hour at **:30** — `30 * * * *` — between the LP claim cron (`:00`) and recenter (`:15`),
so it never overlaps them (all three share `HYPERION_LP_CRON_LOCK_KEY`; an overlap returns 429).

Fees on these positions accrue over hours/days, so hourly is ample; the $0.1 threshold prevents
dust claims (gas + swap slippage would otherwise eat small harvests). Times are **UTC**.

### Live vs observe-only

`dryRun` defaults **TRUE** (observe-only): the wired schedule logs what it *would* claim without
sending any tx. To go live, append the query in `vercel.json`:

```
/api/protocols/decibel/dn-autoclaim/cron?dryRun=false&maxActionsPerRun=5
```

### Rollout state

**Live (as of 2026-07-03).** `vercel.json` runs
`?dryRun=false&maxActionsPerRun=5&minClaimUsd=0.1` hourly at `:30` — claims fees/rewards above the
$0.1 threshold and swaps rewards to USDC. Scope in practice: only safes that have an open DN-LP
cycle, which today is only the private-beta allowlist (see `dn-lp-hedge.md` → "LP-DN private beta").

**`minClaimUsd` is explicit in the query string on purpose (2026-07-04 fix).** The route's `num()`
parser had a bug: `URLSearchParams.get()` returns `null` for an omitted param, and `Number(null)`
is `0` (finite) — so a missing `minClaimUsd` silently became an explicit `0`, not "use the $0.1
default" (`??` only falls through on `null`/`undefined`, not `0`). Real impact: the cron claimed
*any* nonzero fee/reward instead of the intended $0.1 floor — e.g. a $0.006 reward swap. Fixed in
`parseOptionalNumber()` (`lib/utils/http.ts`); `minClaimUsd=0.1` is now spelled out here too as
defense-in-depth so this can't silently regress again.

### Validation (dry-run, 2026-06-28)

Verified end-to-end against the PR #219 preview deploy
(`yield-ai-git-feat-dn-lp-hedge-edbiz.vercel.app`), `POST {"dryRun":true}`, HTTP 200 in ~4.7s:

```jsonc
{ "action": "claim", "dryRun": true, "safesProcessed": 1, "actedPositions": 0,
  "results": [ { "safeAddress": "0x23b3…7617d", "positions": [
    { "position": "0xd5ad…fdd",  "feesUsd": 0.0369, "rewardsUsd": 0.0011, "action": "skip-below-threshold" },
    { "position": "0x8458…f9a9", "feesUsd": 0.0047, "rewardsUsd": 0,      "action": "skip-below-threshold" }
  ], "rewardSwap": null } ] }
```

Confirms: (1) `resolveDnLpSafes()` discovers the DN-LP safe via its open journal cycle — the
registry filter `isHyperionSafe` would have skipped it; (2) the claim engine + $0.1 threshold gate
dust correctly (both positions below threshold → `skip-below-threshold`, no tx even if live). A
live claim simply has nothing to show until accrued fees exceed $0.1.

### Parameters

| Param (query / body) | Default | Meaning |
|---|---|---|
| `dryRun` | `true` | Observe-only; `false` to actually claim |
| `minClaimUsd` | `0.1` (`DEFAULT_AUTO_CLAIM_MIN_USD`) | Skip a position whose claimable fees/rewards are below this |
| `maxActionsPerRun` | `0` (unlimited) | Cap claimed positions per run |
| `safeAddresses` (POST only) | discovered | Override safe discovery with an explicit list |

### Logs

Search Vercel logs for `[DN-Autoclaim]`. One `summary` line per run + one line per position
(`action`, `feesUsd`, `rewardsUsd`, claim tx hashes).

### Manual dry-run

```bash
curl -s -X POST "https://yieldai.app/api/protocols/decibel/dn-autoclaim/cron" \
  -H "x-cron-secret: $YIELD_AI_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"dryRun":true}'
```

Add `"safeAddresses":["0x…"]` to scope to one safe; set `"dryRun":false` to claim for real.

### Fee-leg conversion (2026-07-04)

The DN-autoclaim pass sets `convertFeesToUsdc: true`: claimed **volatile** fee legs (WBTC, APT —
any non-stable pool's `token_a`) are swept → USDC right after the claim, delta-measured the same
way as the APT reward swap (only what THIS pass claimed; pre-existing balances and dust below the
threshold are never touched). Without this, WBTC fees from the wbtc_usdc pool accumulated as
unconvertible dust in the safe (below the $1 UI visibility floor, so even the manual Convert
button was unreachable). Stable legs (USDt/USD1, tickSpacing-1 pools) are excluded — already ≈$1,
swapping is pure fee churn. **DN-only:** plain Hyperion-LP autoclaim (`hyperion-lp/cron`) does NOT
set the flag — its policy keeps claimed fees as-is.

### Policy — why USDC-hold, not reinvest

Claimed funds stay in the safe (USDC after the reward swap) instead of being re-added to the LP:

- Re-adding grows the LP base leg → unbalances the hedge → forces a rehedge on every claim
  (and rehedge automation is a separate, not-yet-built piece).
- The Hyperion adapter zap is broken (`zap_split` 0-fill — see `dn-lp-hedge.md`); reinvest would
  need the dual-swap workaround = extra swaps + slippage + gas on each small harvest.
- USDC buffer is exactly what the strategy needs on hand (perp funding/margin, gas, rehedge/close
  costs) and keeps realized-yield accounting trivial.

**Re-deploy into LP is a deliberate manual batch action**, not part of autoclaim.

### Required env

| Variable | Purpose |
|----------|---------|
| `YIELD_AI_CRON_SECRET` / `CRON_SECRET` | Cron auth |
| `APTOS_API_KEY` | Aptos fullnode reads (safe enumeration, cycles, balances) |

### Related

Strategy & on-chain facts: **`docs/dn-lp-hedge.md`**. Claim engine + thresholds:
`runHyperionAutoClaim` in `src/lib/protocols/yield-ai/hyperionLpActions.ts`.
