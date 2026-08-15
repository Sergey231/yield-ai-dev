# LP-hedge delta-neutral (Hyperion LP + Decibel short)

Status: **merged to `main`, live on mainnet, gated to a private beta allowlist** (2026-07-03).
Autoclaim + auto-rehedge crons are live (not observe-only). Open→rehedge→close proven manually on
APT/USDC #4/#6/#7/#9 and WBTC/USDC #8, real funds. Was branch `feat/dn-lp-hedge` → PR #219.
Worktree: `C:\work\yield-ai\.worktrees\dn-lp`. Build: eslint is ignored in `next build`; gate is
`tsc` (green). Test safe: `0x23b329bff0ad2f462c7b212458cc0d1b20019af03766cde48bdc9f9d0a17617d`.

## LP-DN private beta (opening new positions)

Opening a **new** LP-DN cycle is restricted to an owner allowlist — the feature is live and the
crons operate on real positions, but general users can't create new LP-DN cycles yet.

- **Server-side (real gate, fail-closed):** `executor-open-delta-neutral` (`mode:"lp"` branch)
  checks `owner` against `NEXT_PUBLIC_LP_DN_ALLOWLIST` (comma-separated owner addresses). Empty/unset
  → nobody can open (opposite default from the spot-DN allowlist, which is open-by-default).
- **Client-side (UX only):** the "LP APT/USDC" / "LP WBTC/USDC" toggle buttons in
  `YieldAIPositions.tsx` are hidden unless the connected wallet is in the same list. Addresses
  aren't secret, so the one `NEXT_PUBLIC_` var serves both.
- **Gated:** new opens AND USDC top-ups (`executor-add-delta-neutral` `mode:"lp"` checks the same
  list). **Not gated:** Details/Rehedge/Close of an already-open cycle.
- **Configured today:** `0x56ff2fc971deecd286314fe99b8ffd6a5e72e62eacdc46ae9b234c5282985f97` (the
  owner of the test safe). Add teammates by editing the Vercel env var — no redeploy of code
  needed, just a new deploy to pick up the env change.

## What it is
A delta-neutral strategy where the LONG leg is a **Hyperion CLMM LP** (APT/USDC or WBTC/USDC) held
in the user's safe, hedged by a **Decibel perp short** of the LP's base-asset amount. Earns LP fees
+ farm + (positive) funding; price PnL ≈ 0 by design. Built on the on-chain `strategy_journal`
cycle model (see `docs/dn-journal-migration.md` and the [[strategy-journal-dn-lp]] memory).

**Split custody:** LP capital lives in the safe; perp margin lives in the user's Decibel subaccount.
The executor can't move safe funds to Decibel — margin is the user's responsibility. Margin at
open ≈ 0.5× size (the short covers the base leg 1:1 at 1×); the safe **worst-case** pre-fund
(price falls all the way to the range's lower bound) is `margin_atOpen × (√r + 1) / r` where
`r = 1 + rangePct/100` — ≈1.75× at ±20% (narrower ranges need a HIGHER multiple, not lower — e.g.
±10% ≈1.86×). See `lpHedgeWorstCaseMarginMultiple()` in `YieldAIPositions.tsx`, shown live in the
LP-hedge open preview. Capital ≈ LP + margin.

## Files (all in PR #219)
| File | Role |
|---|---|
| `lib/protocols/decibel/lpDeltaNeutralOpen.ts` | open: LP-first (router swap + open_dual) → short → open_cycle. Pool-parameterized. |
| `lib/protocols/decibel/lpDeltaNeutralRehedge.ts` | rehedge: short-only resize to the live LP base amount + record_action(REHEDGE). |
| `lib/protocols/decibel/lpDeltaNeutralAdd.ts` | add (USDC top-up): dual-swap add into the cycle's own range → grow short via rehedge core (bandBps=0) → ONE record_action(LIQUIDITY_ADD, usdc_delta) → bump `spot_usdc` + `decibel_margin_open` extras. Beta-gated like open. |
| `app/api/protocols/decibel/executor-{open,rehedge,close}-delta-neutral/route.ts` | routes (open has `mode:"lp"`; close has an LP branch). |
| `app/api/protocols/yield-ai/delta-neutral-cycles/route.ts` | per-cycle valuation: LP leg, range APR, claimable+claimed fees/rewards (Hyperion `amountUSD`), funding APR. |
| `lib/protocols/yield-ai/hyperionLpActions.ts` | `runHyperionOpenViaDualSwap` (the zap workaround) + `runHyperionCloseConvert(claimRewardsFirst)`. |
| `lib/protocols/yield-ai/hyperionRangeApr.ts` | `rangeAdjustedApr` / `…FromTicks` (concentration math, shared with HyperionLpStrategyView). |
| `components/.../YieldAIPositions.tsx` | UI: Spot/LP-APT/LP-WBTC toggle, hedge gauge, position card, PnL tooltip, AMPs badge. |
| `components/decibel/delta-neutral-price-funding-chart.tsx` | chart range-bound lines + entry line. |

## Lifecycle (executor-signed; manage-auth from the owner per action)
1. **Open** (`mode:"lp"`): swap ~half USDC→base via the **proven router path** (`execute_swap_fa_to_fa`
   + `submitSwapFaToFaWithFallbackLimits`) → `open_dual` (USDC kept surplus) → short the live base
   amount (1×) → `strategy_journal::open_cycle(deposit_mode=usdc_zap, lp_position, perp_market,
   spot_metadata, base_exposure, perp_short_size, usdc_notional_open)` → set extras (subaccount,
   spot_usdc = actual deployed).
2. **Add** (`executor-add-delta-neutral`, `mode:"lp"`): swap the range-split USDC→base (router
   path) → `add_dual` into the SAME position (its own range, no re-range) → grow the short to the
   new live base via the rehedge core with `bandBps=0` (margin guard still applies; a `margin-skip`
   leaves the add under-hedged — surfaced in the UI toast) → ONE
   `record_action(LIQUIDITY_ADD, usdc_delta = actual added LP value)` → `spot_usdc` and
   `decibel_margin_open` extras incremented. NOT a re-range: if price sits near a range edge,
   close+reopen around the current price may be the better deal.
3. **Rehedge**: read live LP base vs short; band 15%; reduce/grow short to match + `record_action`.
4. **Close**: close short → `runHyperionCloseConvert(claimFirst, claimRewardsFirst)` (claim fees →
   claim rewards → remove all → base→USDC convert) → `close_cycle`.

## Key decisions & gotchas (READ before changing)
- **Margin anchor tracks committed margin.** `decibel_margin_open` extra = margin actually locked
  under the short, adjusted by ±resize notional on EVERY short resize (rehedge core does it; the
  add flow must NOT bump it separately — double count). Without this the anchor drifted on every
  reduce↔grow cycle (observed on #9: anchor $26.44 vs $18.43 live). Legacy cycles without the
  extra stay on the live-margin fallback — never write an anchor for them mid-flight.
- **Adapter zap is broken — do NOT use it.** `adapter_hyperion_lp::zap_split` calls `pool_v3::swap`
  with a hardcoded `a2b`/sqrt-limit that delivers a **0-fill** for USDC→base on these pools (proved
  via mainnet simulate: `min=1` aborts E_HYPERION_SLIPPAGE/0x25, `min=0` opens a base-less position).
  Never hit before because prior LP tests used `open_dual` (no swap). Open routes via the **dual-swap
  workaround** (`runHyperionOpenViaDualSwap`). The router path (`execute_swap_fa_to_fa`, first sqrt
  limit `MAX_SIDE_SQRT_PRICE_LIMIT = 6e20`) DOES deliver. **TODO:** fix `zap_split` on-chain.
- **PnL = price + funding + (claimable+claimed) fees + (claimable+claimed) rewards.** Fees/rewards
  valued by Hyperion's per-position feed `fees`/`farm` = `{claimed, unclaimed}` each with `amountUSD`
  (`sdk.Position.fetchAllPositionsByAddress`). Including `claimed` keeps PnL stable across claims.
  Header PnL has a breakdown tooltip. `rewardCount` counts only non-zero `unclaimed` entries.
- **`usdc_notional_open` / `spot_usdc` extra = ACTUAL deployed LP value** (APT@mark + USDC leg), NOT
  the intended zap amount — open_dual returns surplus USDC to the safe, so the intended figure
  overstated the position and showed a phantom ~$1 open loss. Cost basis reads `spot_usdc` extra FIRST.
- **Pool-parameterized**: `LP_DN_CONFIG` in lpDeltaNeutralOpen maps `apt_usdc → {APT, dn-decibel-apt-lp}`,
  `wbtc_usdc → {BTC, dn-decibel-wbtc-lp}`. APT and WBTC are both **8dp**, so rehedge/close were already
  pool-agnostic. Manage-auth fields for LP open: `{safeAddress, subaccount, poolKey, sizeUsd, rangePct}`
  (client + server must match order). Cycles route matches each LP position to its pool via tokens.
- **Rehedge band = 15%** (kept). Gauge is 3-zone: Balanced <7.5% · Drifting 7.5–15% (amber) · Rehedge
  >15% (red). At ~15% the rehedge no-ops ("Already balanced") — by design.
- **Card "LP:" / Net Δ use the LIVE LP base** (`lpLeg.aptHuman`), not `base_exposure` (open snapshot).
- **Hedge gauge / "Short:" use the LIVE Decibel short** (`liveShortSizeHuman`), falling back to the
  journal's `perp_short_size` only when live is unavailable. The journal can lag by a lot: a rehedge
  order and its `record_action` are two separate txs — if the order lands but the record fails, the
  journal keeps the pre-rehedge size until the next successful action overwrites it (absolute
  values, self-correcting). Observed 2026-07-04 on BTC #8: live 0.00016 vs recorded 0.00017 → the
  gauge falsely showed −19% "Rehedge needed" while the (live-based) cron correctly saw −12% in-band.

## On-chain facts (mainnet)
- yield_ai pkg `0x333d…4700`; Hyperion dex `0x8b4a…2e05c`; USDC `0xbae2…6f3b`; APT FA `0xa`;
  WBTC FA `0x68844a0d…52a3d`.
- Pools (fee_tier 1): APT/USDC `0x9256…00d8`, WBTC/USDC `0xa7bb…da58`.
- Decibel markets: APT-USD `0xda86…62e3` (min 1 APT, lot 0.1); BTC-USD `0x5e0e…4861` (min 2e-5 BTC,
  lot 1e-5). Funding (shorts receive when positive): APT ≈ 0, **BTC ≈ +10%/yr** → WBTC carry better.
- Allowlists verified true for both pools + both swap tokens + USDC pairs. `strategy_journal` +
  `delta_neutral` V1 initialized; DN V2 registry NOT initialized (LP uses the journal, not V2).

## TODO / not done
- **Contract fix**: `adapter_hyperion_lp::zap_split` (route via router or fix the sqrt limit) so the
  contract zap works directly — would let open use the single-tx zap entry again.
- ~~**Autoclaim cron**~~ **DONE, LIVE**: `/api/protocols/decibel/dn-autoclaim/cron` (`30 * * * *`,
  `dryRun=false`) claims fees+rewards over $0.1, APT rewards→USDC, held in the safe (no reinvest).
  Safe discovery via `resolveDnLpSafes()`. See `docs/dn-autoclaim-cron.md`.
- ~~**Rehedge automation cron**~~ **DONE, LIVE**: `/api/protocols/decibel/dn-rehedge/cron`
  (`45 * * * *`, `dryRun=false`). Manage-auth-free `rehedgeLpDeltaNeutralCore` + margin guard (skips
  an under-funded grow). Safe discovery `resolveDnLpSafes()`. See `docs/dn-rehedge-cron.md`.
  TODO: per-cycle cooldown (currently band+hourly cadence are the only churn guards).
- **Realized APR from basis**: MtM `(equity + claimable + claimed − deployed)/deployed × 365/age`;
  full historical needs persisted equity snapshots (DB/indexer).
- Minor: rehedge handler could add a delayed refetch (record_action settles ~1–2s after the order,
  so the card briefly shows the pre-rehedge short).
