# Hyperion LP — frontend integration spec (handoff)

Status (2026-06-04): **Hyperion LP is feature-complete on branch `feat/hyperion-lp-frontend`
(verified on mainnet).** Shipped: `hyperion_lp` strategy + create/attach (`?strategy=hyperion`);
user manage UI (zap + dual open, add-to-existing dual, claim, close, close→USDC) with owner-signature
auth; on-chain fees/rewards + per-position pool-APR + real PnL since deposit (uses Hyperion
`fetchFeeHistory`/`fetchRewardHistory`); pool registry (WBTC/USDC live; APT/USDC is registry-only
until the vault supports Hyperion coin/FA pools; xBTC/USDt/USD1 registry-only); range by ±%/price
(default ±10%) with live chart;
auto-claim cron (`action:"claim"` — claim fees + swap APT→USDC, fees kept) and re-center cron
(`action:"recenter"`, not scheduled); Total-assets + sidebar AI-agent card include LP value;
first-open risk-ack modal (localStorage). Docs: this file + `HYPERION_LP_RISKS.md`.

**Open / next:** (a) merge `feat/hyperion-lp-frontend` → main; (b) schedule the cron; (c) per-safe
keep/compound setting; (d) contract upgrade for APT/USDC coin/FA LP support; (e) homepage
"Create Hyperion LP agent" idea card (3-card block like `decibel-ideas-block.tsx`);
(f) SingleKey/Keyless wallet support in owner-auth if needed.

Previously: plumbing + admin "secret button"; then tasks (а)–(г); then the UI/UX batch.

---

## 0. What to start the new chat with

> "Continue the Hyperion LP frontend in `C:\work\yield-ai` on branch `feat/hyperion-lp-frontend`
> (already checked out in the worktree). Read `docs/HYPERION_LP_FRONTEND.md` (status + §7) and
> `docs/HYPERION_LP_RISKS.md` first — the feature is complete and mainnet-verified; pick up from the
> "Open / next" list. Verify with `npx tsc --noEmit --skipLibCheck`; commit/push per-feature."

Key files: `src/components/protocols/manage-positions/protocols/yield-ai/HyperionLpStrategyView.tsx`,
`src/lib/protocols/yield-ai/hyperionLpEvents.ts`, `src/app/api/protocols/yield-ai/hyperion-lp/positions/route.ts`
(panel), `src/lib/protocols/yield-ai/hyperionLp.ts` + `hyperionLpActions.ts` (math/actions),
`vaultExecutor.ts` (entries), `src/app/api/protocols/yield-ai/hyperion-lp/**` (routes: manage/{open,
add,claim,close}, cron, pool, positions), `src/lib/constants/yieldAiVault.ts`
(`YIELD_AI_HYPERION_POOLS`), `SafePositionsCard.tsx` (sidebar rows).

Then point it at the **existing pieces** (§3) and the **UI plan** (§4).

---

## 1. Deployed contract facts (mainnet)

- Vault package: `0x333d1890e0aa3762bb256f5caeeb142431862628c63063801f44c152ef154700`
- Hyperion LP adapter (whitelisted): `0xe962ebafd209b0106ba9a1c23cde4cd79ef34158ce9a600f120eff9369aac3f5`
- Hyperion DEX (`dex_contract`): `0x8b4a2c4bb53857c718a04c020b98f8c2e1f99a68b0f57389a8bf5434cd22e05c`
- USDC FA: `0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b`
- WBTC FA: `0x68844a0d7f2587e726ad0579f3d640865bb4162c08a4589eeda3f9689ec52a3d`
- APT native coin: `0x1::aptos_coin::AptosCoin` (Hyperion represents the APT/USDC pool as
  coin/FA, not FA/FA)
- WBTC/USDC pool: `0xa7bb8c9b3215e29a3e2c2370dcbad9c71816d385e7863170b147243724b2da58`,
  fee tier `1` (0.05%), tick spacing `10`, **pool order: token_a = WBTC, token_b = USDC**.

### Two entry modes (both deployed + mainnet-verified)

The contract supports **two ways to open/add an LP position** — the UI should offer a toggle:

| Mode | Entry (open / add) | Input | Swap? | Limits |
|---|---|---|---|---|
| **Zap (1 asset)** | `execute_hyperion_open_zap_usdc` / `execute_hyperion_add_zap_usdc` | USDC only | yes — contract swaps `swap_amount_in` USDC → non-USDC leg | charges `VaultFaSwapConfig` USDC-notional limits |
| **Dual (2 assets)** | `execute_hyperion_open_dual` / `execute_hyperion_add_dual` | both legs from the safe | no | **not** charged (no swap) — `principal_usdc` tracks the USDC leg only |

- **Dual is for safes that already hold both tokens** (e.g. WBTC left over from a prior exit + USDC).
  No internal swap → no slippage on entry; leftovers from `add_liquidity` still return to the safe.
- `min_a = min_b = 0` for dual too (CLMM rounding). The frontend computes the desired `amount_a` /
  `amount_b` split off-chain from the live tick (same range math as zap), then submits raw base units.
- Dual deployed in mainnet upgrade `0xcd66f0cafcb153f01b91bc208f0ac5d60349333100dd2a59429a3a674acbc44c`;
  verified open `0xa13e258fc687319434ee92883fd3d7f536b0703aa8ad8e63a939ff8403a604f6` (two-sided active)
  + `remove_all` `0xcf9262b8c0f207418e47487e6b17cc53b6247c6b501c581992f0908b3cc00fc5`.
- **Backend wiring DONE** (open path only): `executeHyperionOpenDual` in `vaultExecutor.ts`,
  `executeHyperionOpenDual/AddDual` ids in `YIELD_AI_VAULT_ENTRYPOINTS`, `runHyperionOpenDual` in
  `hyperionLpActions.ts`, and a `mode: "zap" | "dual"` branch in `manage/open` (dual carries
  `amountABaseUnits`/`amountBBaseUnits`, skips the quote, signs `mode:"dual"` auth fields).
  Frontend: Zap/Dual toggle with Auto-split (B, derives both legs from balances at the range ratio)
  and Manual (A, edit both legs). Add-to-existing (dual) is also wired:
  `runHyperionAddDual` + `manage/add` route (`hyperion_lp_manage_add` auth) + per-position inline
  "Add" form (both legs from the safe, position's own range). **TODO:** zap add-to-existing UI
  (`executeHyperionAddZapUsdc` wrapper exists; no route/UI yet).

### Gotchas (learned on testnet + mainnet — do not relearn the hard way)

1. **Tick race.** Compute `tick_lower/tick_upper/swap_amount_in` from the **live** current tick right
   before submitting. A range computed seconds earlier can already be out of range (we hit this — a
   ±1% range went inactive immediately). Use a wide range for manual, narrow only with just-in-time
   compute. `planHyperionOpen()` already reads the live tick.
2. **`add_liquidity` mins are 0 on-chain** (CLMM rounding) — slippage is enforced on the balancing
   **swap** via `swap_amount_out_min`, not on the add.
3. **`remove_liquidity` auto-claims accrued fees to the safe, bypassing the protocol perf cut.** To
   take perf, call `execute_hyperion_claim_fees` **before** remove. The close route already does
   `claim → remove`.
4. **USDC-leg only** (MVP). Pools must have a USDC leg. For pools where **USDC is token_a** (not the
   WBTC/USDC case), `computeZapSwapAmountIn` needs a `usdcIsTokenA` branch (currently assumes USDC =
   token_b).
5. **Single-token zap returns leftovers to the safe**, so an approximate swap split is safe — dust
   just comes back. Closing a two-sided position returns BOTH legs; converting the non-USDC leg back
   to USDC is a separate, explicit swap (and must swap only the position's delta, not pre-existing
   holdings in the safe).
6. **Zap swap moves the tick → `pool_v3::EAMOUNT_B_INPUT_LESS`.** The balancing swap (USDC→non-USDC)
   nudges the pool price, so by the time `add_liquidity` runs the position needs slightly more USDC
   (token_b) than the exact split left — Hyperion aborts. Seen on mainnet: a 9-USDC open aborted with
   `EAMOUNT_B_INPUT_LESS` while a 4-USDC open (smaller absolute mismatch) passed. Fix: swap a touch
   LESS than the exact split (`ZAP_SWAP_SAFETY_BPS`, 2%) so USDC stays the long side; the extra USDC
   returns to the safe. Larger opens are most affected — don't tune this out.
7. **Dual add does NOT scale down to the smaller leg — `EAMOUNT_B_INPUT_LESS` again.** Hyperion
   sizes the added liquidity from `amount_a` and requires the matching `amount_b` at the execution
   tick; `min = 0` only lets the token_b SURPLUS return as leftover. Passing raw safe balances for
   both legs ("Max" on both) aborts whenever the safe's ratio is shorter on token_b than the
   position's range ratio. Seen on mainnet (`0x08770844…fdd6`): 0.00074521 WBTC (~$46) + 8.62 USDC
   against a ±10% in-range position needing ~$52 USDC. Fix: the per-position Add dialog pairs the
   legs at the position's range ratio (edit one leg → derive the other; "max" fills the largest
   coverable pair, token_b padded 1% via `ADD_B_PAD`), and `runHyperionAddDual` re-checks the ratio
   on the live tick server-side to fail with a readable error instead of a Move abort.
   The recenter-dual REOPEN has the same exposure but worse consequences (the close has already
   happened — an abort strands both legs idle in the safe with no retry), so
   `runHyperionRecenterDual` caps token_a to what the recovered token_b can pair with at the live
   tick (`DUAL_REOPEN_B_PAD`, 1%); the shaved token_a dust stays in the safe.
8. **APT/USDC is not currently openable by the agent.** The canonical Hyperion APT/USDC pool is
   coin/FA (`AptosCoin` + USDC). The deployed vault LP entrypoints are address-based FA/FA paths:
   `execute_hyperion_open_zap_usdc`, `execute_hyperion_add_zap_usdc`,
   `execute_hyperion_open_dual`, `execute_hyperion_add_dual`. APT/USDC therefore aborts before a
   usable LP position is opened. This is not a balance, preview, or slippage issue. Keep
   `apt_usdc.uiEnabled = false` until the contract upgrade below is deployed and verified.

### Contract fix needed for APT/USDC

Frontend-only support is not enough. Add a coin-aware Hyperion LP path in
`C:\work\yield-ai-agent-smart`:

1. Add vault entrypoints for the APT/USDC coin/FA pool, either hardcoded to APT or generic over a
   coin type, for example:
   - `execute_hyperion_open_zap_usdc_to_apt_coin`
   - `execute_hyperion_add_zap_usdc_to_apt_coin`
   - `execute_hyperion_open_dual_apt_coin`
   - `execute_hyperion_add_dual_apt_coin`
2. In the adapter, call Hyperion coin functions for the APT leg instead of FA/FA functions:
   - swap USDC FA -> APT coin via the coin-aware exact-input/asset route
   - open/add liquidity via `open_position_coin<AptosCoin>` / `add_liquidity_coin<AptosCoin>` (or
     the equivalent non-entry internal functions exposed by Hyperion)
3. Update remove/claim paths so APT returned from liquidity, fees, or rewards is accounted as a
   coin balance, while USDC remains FA.
4. Emit the same LP events (`used_a/b`, `got_a/b`, fees, rewards), but use a stable asset identifier:
   `0x1::aptos_coin::AptosCoin` for APT and USDC FA metadata for USDC.
5. After mainnet verification, re-enable `apt_usdc.uiEnabled = true` and route APT/USDC through the
   new coin-aware entrypoints only.

---

## 2. Wallet-signed vs executor-signed (critical architecture)

| Action | Signer | How |
|---|---|---|
| Create safe (`init_vault_v2`) | **owner (wallet)** | `buildInitVaultPayload` (client) |
| Deposit assets into safe | **owner (wallet)** | `buildVaultDepositPayload` (client) |
| Withdraw from safe | **owner (wallet)** | `buildVaultWithdrawPayload` (client) |
| Attach/detach strategy tag | executor **or** owner | strategy_registry entrypoints |
| Open / add LP position | **executor (server)** | `/api/protocols/yield-ai/hyperion-lp/open` |
| Close (claim+remove) | executor (server) | `/api/protocols/yield-ai/hyperion-lp/close` |
| Swap WBTC→USDC | executor (server) | `executeSwapFaToFa` |
| Automation | executor (server cron) | `engine/` |

**Implication for task (а):** "create safe with strategy" = a wallet tx (`init_vault_v2`) **then**
`attach_strategy`. The server executor cannot create a safe for a user (owner signature required).

---

## 3. Existing pieces to reuse (already built — do NOT rebuild)

### Backend / lib (this branch)
- `src/lib/constants/yieldAiVault.ts` — `YIELD_AI_VAULT_ENTRYPOINTS.executeHyperion*`,
  `YIELD_AI_HYPERION_VIEWS`, `YIELD_AI_HYPERION_ADAPTER_ADDRESS`, `HYPERION_DEX_ADDRESS`,
  `HYPERION_POOL_VIEWS`, `YIELD_AI_HYPERION_POOLS` (pool registry), `HyperionPoolKey`.
- `src/lib/protocols/yield-ai/hyperionLp.ts` —
  `getPoolCurrentTick`, `computeCenteredRange`, `computeZapSwapAmountIn`, `isPositionActive`,
  `planHyperionOpen` (live-tick planner → returns `{tickLower, tickUpper, swapAmountIn, currentTick}`),
  `readSafeHyperionPositions` (live composition + active flag).
- `src/lib/protocols/yield-ai/vaultExecutor.ts` —
  `executeHyperionOpenZapUsdc`, `executeHyperionAddZapUsdc`, `executeHyperionClaimFees`,
  `executeHyperionRemoveAll`.
- `src/lib/protocols/yield-ai/engine/hyperionQuote.ts` — `getHyperionAmountOut/In` (REST quotes).

### API routes (this branch)
- `POST /api/protocols/yield-ai/hyperion-lp/open` — body `{ safeAddress, usdcAmountInBaseUnits,
  poolKey?, halfWidthTicks?, slippageBps?, dryRun? }`, header `x-cron-secret`. Plans range + swap
  off the live tick, computes `swap_amount_out_min` via quote, submits open.
- `POST /api/protocols/yield-ai/hyperion-lp/close` — body `{ safeAddress, position, claimFirst?,
  dryRun? }`, header `x-cron-secret`. `claim_fees → remove_all`.
- `GET /api/protocols/yield-ai/hyperion-lp/positions?safe=0x...` — read-only, no secret.

### Existing client builders / modals to reuse for the user UI
- `src/lib/protocols/yield-ai/vaultDeposit.ts` — `buildInitVaultPayload`, `buildVaultDepositPayload`,
  `buildVaultWithdrawPayload`, `buildSetFaSwapLimitsPayload`, etc. (wallet-signed).
- `src/lib/protocols/yield-ai/strategyRegistry.ts` — `AI_AGENT_STRATEGIES`, `attach`/`detach` views &
  entrypoints, `strategyIdArg` helper (pass plain UTF-8 string to the wallet adapter).
- Strategy mutation API routes: `/api/protocols/yield-ai/strategy/{attach,detach,setState,active}`.
- Modals: `deposit-modal.tsx`, `swap-and-deposit-modal.tsx`, `yield-ai-withdraw-modal.tsx`,
  `yield-ai-safe-settings-form.tsx`. The big card lives in
  `src/components/protocols/manage-positions/protocols/YieldAIPositions.tsx` (~5358 lines).
- Admin "secret button" already shipped: `src/app/admin/yield-ai/hyperion-lp/page.tsx`
  (open dry-run/live, list positions, close). Use it as the reference flow for the user UI.

---

## 4. Tasks to build (а–г)

### (а) Hidden button: create safe + attach Hyperion strategy
The strategy tag is **pool-agnostic** (`hyperion_lp`, not per-pair). A safe may hold several CLMM
LP positions across the whitelisted USDC-leg pools; the pool is chosen at open time (`poolKey`), not
baked into the strategy id. (Decided 2026-05-30 — see §5.)
1. Register strategy id in `AI_AGENT_STRATEGIES` (`strategyRegistry.ts`):
   `hyperion_lp` → label "Hyperion CLMM LP". Extend `AiAgentStrategyId` union and
   `resolveActiveAiAgentStrategy` (done).
2. Hidden entry point — **query flag `?strategy=hyperion`** that exposes the option in the existing
   create-safe strategy selector and runs:
   `signAndSubmitTransaction(buildInitVaultPayload(...))` → on success call
   `attach_strategy(safe, "hyperion_lp")` (wallet-signed, 2 tx, via Gas Station — same pattern as
   `yield-ai-safe-settings-form.tsx` / `decibel-agent-wizard.tsx`).
3. Surface the new safe with its strategy card.

### (б) Manage UI: deposit + create position with auto-tuned swap
- Deposit USDC and any swappable asset into the safe (reuse `buildVaultDepositPayload` /
  `swap-and-deposit-modal`). Non-USDC deposits can be swapped to USDC first (existing swap flow) or
  the open route handles only USDC — keep deposits in USDC for MVP.
- "Open position" calls the open route. **Auto-tune** = the route's `planHyperionOpen` already
  computes `swap_amount_in` from the live tick; expose `halfWidthTicks` (range width) and a preview
  (dry-run) in the modal. Show the computed range + swap split before confirming.
- **Add a Zap / Dual toggle** (see §1 "Two entry modes"):
  - *Zap (1 asset)* — current default. User provides USDC; backend computes the swap split.
  - *Dual (2 assets)* — for safes already holding both legs. Compute the `amount_a` / `amount_b`
    split off-chain from the live tick (reuse the range math; for a centered range the value
    fraction `R` from `computeZapValueFractionToNonUsdc` gives the non-USDC share), let the user
    confirm, submit raw base units with `min_a = min_b = 0`. No swap, no swap-limit charge.
  - Backend TODO for this: add `executeHyperionOpenDual / AddDual` to `vaultExecutor.ts`, add
    `executeHyperionOpenDual / AddDual` ids to `YIELD_AI_VAULT_ENTRYPOINTS`, and branch the open
    route on `mode` (`"zap"` uses USDC + swap; `"dual"` takes `amountA`/`amountB`, skips the quote).

### (в) Close / convert / claim
- "Claim fees" → `execute_hyperion_claim_fees` (add a thin route or extend close with `removeAfter:
  false`). Perf cut is taken on-chain.
- "Close" → close route (`claim → remove`). Funds return to safe as WBTC + USDC.
- "Convert" → swap the position's WBTC delta to USDC (or to a chosen asset) via `executeSwapFaToFa`.
  **Only swap the delta from the close**, never pre-existing safe holdings (compute delta = post − pre
  balance, as done manually in mainnet testing).

### (г) Automation
- Add a rule to the `engine/` DAG (or a dedicated cron) that, per active LP position:
  - reads live tick + position range (`readSafeHyperionPositions`);
  - if out of range (or within N% of an edge): `claim_fees → remove_all → planHyperionOpen →
    open` (re-center). Throttle by time and a cost-vs-fees check.
  - periodically `claim_fees` so the perf cut is captured (Hyperion auto-claims on remove otherwise).
- Wire into the existing cron entrypoint `/api/protocols/yield-ai/cron/run`.

---

## 5. Adding more pools

Per new **USDC-leg** pool: (1) probe canonical token order + `fee_tier` u8 + `tick_spacing` via
`pool_v3::liquidity_pool_address_safe` / pool resource; (2) add one entry to
`YIELD_AI_HYPERION_POOLS`; (3) admin tx `protocol::set_hyperion_pool(tokenA, tokenB, feeTier, true,
minNotional)`; (4) add a pool dropdown in the UI. If USDC is token_a in that pool, add the
`usdcIsTokenA` branch to `computeZapSwapAmountIn`. Non-USDC pools need a contract change (roadmap).

---

## 6. Env vars (already configured for existing executor/strategy flows)
- `YIELD_AI_EXECUTOR_PRIVATE_KEY` — executor signer (server).
- `YIELD_AI_CRON_SECRET` — gate for executor mutation routes (`x-cron-secret`).
- `APTOS_API_KEY` — optional fullnode auth.

Contract-side reference: `C:\work\yield-ai-agent-smart\docs\HYPERION_LP_DESIGN.md` and
`docs/MAINNET_DEPLOY.md` (Step 3d).

---

## 7. Implementation map (what shipped for а–г)

### Shared executor actions (one impl for routes + cron)
- `src/lib/protocols/yield-ai/hyperionLpActions.ts` —
  `runHyperionOpen`, `runHyperionClaim`, `runHyperionClose`, `runHyperionCloseConvert`
  (delta-only convert: swaps `post − pre` non-USDC balance, never pre-existing holdings),
  `runHyperionRecenter` (per-position out-of-range / near-edge → close+convert → re-open with the
  exact USDC recovered).

### (а) Strategy + create/attach
- `strategyRegistry.ts` — `hyperion_lp` added to `AiAgentStrategyId`, `AI_AGENT_STRATEGIES`,
  `resolveActiveAiAgentStrategy` (highest priority over DN/stable).
- `src/components/ui/yield-ai-safe-settings-form.tsx` — attach logic generalized to any non-default
  strategy; Hyperion option shown only when `?strategy=hyperion`. Create safe → attach (2 wallet txs
  via Gas Station).

### (б)+(в) User-facing UI + proxy routes
- UI panel: `src/components/protocols/manage-positions/protocols/yield-ai/HyperionLpStrategyView.tsx`,
  injected into `YieldAIPositions.tsx` when `activeStrategyId === 'hyperion_lp'`. Deposit USDC uses
  the existing safe `DepositModal`; panel does open (with **Preview range** dry-run), claim, close,
  close→USDC.
- Positions hook: `src/lib/query/hooks/protocols/yield-ai/useHyperionLpPositions.ts`.
- Proxy routes (NO cron secret in browser; authorized by the on-chain `hyperion_lp` tag — see
  `manage/_guard.ts`): `POST manage/open`, `manage/claim`, `manage/close` (`convert?: true`).
- The original secret-gated `open`/`close` routes now delegate to the shared actions lib.

### (г) Automation
- `POST /api/protocols/yield-ai/hyperion-lp/cron` (`x-cron-secret`, single-flight) — enumerates
  `hyperion_lp` safes (or takes explicit `safeAddresses`). Body `action`:
  - **`"claim"` (default)** → `runHyperionAutoClaim`: per open position, claim fees and rewards
    independently once each side reaches its USD threshold (default $0.1). This avoids claiming tiny
    rewards just because fees crossed the threshold.
    claimed **fees stay in the safe** (keep), claimed **APT rewards are swapped → USDC** (delta only,
    `execute_swap_apt_to_fa`) only when the claimed reward delta also meets the reward swap threshold
    (default $0.1). No re-center, no compounding. Knobs: `minClaimUsd`, `minRewardClaimUsd`,
    `minRewardSwapUsd`, `swapRewardsToUsdc`.
  - `"recenter"` → `runHyperionRecenter` (out-of-range close→reopen). Knobs: `halfWidthTicks`,
    `edgeBufferTicks`, `slippageBps`, `minReopenUsdcBaseUnits`.
- `yieldAiVaultWorker.ts` **skips** `hyperion_lp` safes for stablecoin compounding, but the primary
  `/api/protocols/yield-ai/cron/run` entrypoint now runs the Hyperion LP **claim** pass after the
  stablecoin worker so the external scheduler has one hourly entrypoint.
- **Policy (current):** keep fees in safe + swap APT rewards to USDC. Per-safe choice
  (keep vs compound) to be added to safe settings later.

### Open items / follow-ups
- **Auth hardening:** `manage/*` routes authorize by the on-chain strategy tag only. Add an
  owner-signature challenge so only the safe owner can trigger executor LP actions (funds can't leave
  the safe today, so the surface is bounded). Tracked as `TODO(auth)` in `manage/_guard.ts`.
- **Cron scheduling:** hourly claim is wired through `cron/run`. Keep `recenter` on the dedicated
  `hyperion-lp/cron` endpoint until throttle/persistence is added so a flapping tick doesn't
  re-center repeatedly.
- **Manual mainnet pass:** run open (dry-run → live), claim, close, close→USDC, and a forced
  out-of-range re-center on a real safe.
- **USDC-only MVP:** all pools must keep a USDC leg with `usdcIsTokenA: false`; the convert/zap math
  assumes it. Revisit when adding non-WBTC/USDC pools (see §5).
- **PnL (events-first):** see §8 — `GET …/positions` reads vault `HyperionLp*Event` streams.
- **Closed-position history:** see §9 — same events; `principal_usdc` in the view is not used for PnL.

---

## 8. PnL — events-first (implemented)

**Status:** shipped in `src/lib/protocols/yield-ai/hyperionLpEvents.ts` +
`src/app/api/protocols/yield-ai/hyperion-lp/positions/route.ts`.

### Why not `principal_usdc`?

`get_hyperion_position.principal_usdc` is **gross USDC notional** for swap limits — not LP cost basis:

| Mode | `principal_usdc` | Correct LP basis |
|---|---|---|
| **Zap** | Full USDC input (e.g. 10) | `used_a` + `used_b` from open/add events (~9.82 deployed; ~0.18 leftover in safe) |
| **Dual** | USDC leg only | `used_a` + `used_b` (both legs) |

On full close the view **zeros** `principal_usdc` — useless for historical PnL.

### Vault events (already emitted — `sources/vault.move`)

| Event | PnL fields | Notes |
|---|---|---|
| `HyperionLpOpenedEvent` | `used_a`, `used_b` | Actual legs deployed at open. `usdc_notional` = gross USDC — **do not** use for PnL. |
| `HyperionLpAddedEvent` | `used_a`, `used_b` | Additive on top-up. |
| `HyperionLpRemovedEvent` | `got_a`, `got_b` | Proceeds returned to safe on remove. |
| `HyperionLpFeesClaimedEvent` | `fee_a`, `fee_b` | Gross fees to safe (`perf_*` = treasury cut). |
| `HyperionLpRewardClaimedEvent` | `reward_metadata`, `amount` | Farm rewards to safe. |

### API aggregation (`loadHyperionLpEventTotalsBySafe`)

Per position, cumulative base units:

```text
depositedA/B  = Σ Opened.used_* + Σ Added.used_*
removedA/B    = Σ Removed.got_*
feesClaimed   = Σ FeesClaimed.fee_*
rewardsClaimed = Σ RewardClaimed (by FA metadata)
```

Fetched by scanning executor-signed Hyperion vault entry calls:

1. Indexer GraphQL `account_transactions` on the yield-ai executor, filtered by
   `execute_hyperion_*` entry functions (`indexer.mainnet.aptoslabs.com`).
2. Fullnode `GET /transactions/by_version/{version}` for each match; parse
   `HyperionLp*` events and filter by `safe_address`.

The legacy Aptos `events` table and `/v1/events/{type}` stream are deprecated and
return empty on mainnet. Move to a dedicated No-Code Indexer when Hyperion LP volume
grows enough that scanning all executor txs per request is too slow.

### PnL formulas (variant B — LP-only, spot USD via Panora)

**Open position:**

```text
basis_usd   = USD(netDepositedA, netDepositedB)
            where net = deposited − removed (partial remove supported)
claimed_usd = USD(feesClaimed) + USD(rewardsClaimed)
pnl_usd     = value_usd + uncollected_fees + uncollected_rewards + claimed_usd − basis_usd
```

**Closed position:**

```text
basis_usd   = USD(depositedA, depositedB)   // full cumulative deploy
exit_usd    = USD(removedA, removedB)
pnl_usd     = exit_usd + claimed_usd − basis_usd
```

**Close → USDC:** add the convert swap output separately (parse `execute_swap_fa_to_fa` tx / FA
events) — not in `HyperionLp*` events.

**Pricing note:** basis/exit are valued at **spot** Panora prices at query time. Historical
open/close timestamps → optional future improvement for IL attribution.

**Fallback:** if no `HyperionLpOpenedEvent` / `AddedEvent` for a position → `pnlUsd: null`,
`pnlUnavailableReason: "No vault deployment events indexed for this position"`.

### Optional future vault upgrade (not required for PnL)

Mirror event totals in `get_hyperion_position` as `cost_amount_a/b` for live reads without event
pagination. Events remain the source of truth for **closed** positions. See
`C:\work\yield-ai-agent-smart\sources\vault.move`.

---

## 9. Close bookkeeping & post-factum PnL

### View after close

`execute_hyperion_claim_fees` → `execute_hyperion_remove_all`. Then `get_hyperion_position` shows
`closed: true`, `principal_usdc: 0`, `amount_a/b: 0`. **Use events, not the view.**

Example safe `0x2822696e70a22d2a4bd8aa12444a8293b9a84839122632e162a22da41f18b203` (2026-06-05):

| Position | View `principal_usdc` | Events still have |
|---|---|---|
| `0x28387a27…` (closed) | 0 | `used_*` at open, `got_*` on remove, fee claims |
| `0xf634123a…` (open) | 11.29 USDC gross | `used_*` for true LP basis |

Verified remove tx `5580217459` — `HyperionLpRemovedEvent`: `got_a: 10880`, `got_b: 0`.

### Post-factum PnL — events are sufficient

| Leg | Source | Upgrade needed? |
|---|---|---|
| **Entry (deploy)** | `HyperionLpOpenedEvent` + `HyperionLpAddedEvent` (`used_a/b`) | **No** |
| **Exit (remove)** | `HyperionLpRemovedEvent` (`got_a/b`) | **No** |
| **Fees / rewards** | `HyperionLpFeesClaimedEvent` + `HyperionLpRewardClaimedEvent` | **No** |
| **USD conversion** | Panora (off-chain) | **No** |
| **Convert on close** | `execute_swap_fa_to_fa` tx (separate) | **No** (parse tx) |

```text
realized_pnl = USD(got_a, got_b) + USD(claims) − USD(Σ used_a, Σ used_b)
```

No Move change required for end-to-end closed PnL if the event indexer covers the position's
lifetime.

### Implementation map

- `src/lib/protocols/yield-ai/hyperionLpEvents.ts` — event pagination + per-position totals.
- `src/app/api/protocols/yield-ai/hyperion-lp/positions/route.ts` — PnL from events; exposes
  `basisUsd`, `claimedUsd`, `pnlUsd` for open **and** closed positions.
- UI: `HyperionLpStrategyView` `PositionRow` — shows `pnlUsd` / `PnL n/a` from the positions API.

### Follow-ups

- Indexer with `safe_address` / `position` filters (replace full event stream pagination).
- Historical pricing at event timestamps.
- Parse convert-swap proceeds into closed PnL when `close→USDC` is used.

---

## 10. Stablecoin re-center algorithm (swap-free dual, `recenter-dual`)

The hourly automation that keeps stable-pair positions (USDt/USDC, USD1/USDC) in a tight
±0.1% band. Implemented in `runHyperionRecenterDual` (`src/lib/protocols/yield-ai/hyperionLpActions.ts`),
driven by the `recenter-dual` cron action. This is the swap-light path: it removes both legs,
rebalances only the leg imbalance, and re-adds via `dual` (no full USDC round-trip), so on stable
pairs the slippage cost of re-centering is ~one pool fee on half the position.

### Trigger / scheduling

`vercel.json` cron, minute 15 each hour:

```
/api/protocols/yield-ai/hyperion-lp/cron?action=recenter-dual&dryRun=false
  &poolKeys=usdt_usdc,usd1_usdc&halfWidthTicks=10&minPositionAgeSeconds=3600
  &minFeesUsd=0.05&maxActionsPerRun=10
```

`runHyperionLpCronPass` resolves every `hyperion_lp` safe, then per safe calls
`runHyperionRecenterDual`. Once `maxActionsPerRun` live re-centers have happened in a pass, the
remaining safes run **observe-only** (`dryRun`) — bounds tx count and the 300s function budget.
The minute-0 no-query cron stays a read-only monitor for everything (incl. volatile pools).

### Per-position steps

For each open position in the safe:

0. **Pool filter** — position's pool not in `poolKeys` → `skip-pool-filter`. (Stable cron never
   touches WBTC/USDC.)
1. **Read live tick** — `getPoolCurrentTick`, cached per pool address for the pass.
2. **Gates** (all skipped when `forceRerange: true`):
   - in range **and** not within `edgeBufferTicks` of an edge → `skip-in-range` (the normal hour);
   - `ageSeconds < minPositionAgeSeconds` (age from the position's `openedAt`; a re-center opens a
     fresh position, so this is the throttle) → `skip-too-young`;
   - uncollected `feesUsd < minFeesUsd` (priced via Panora) → `skip-below-cost-gate` — the cost gate
     that stops flapping from eating the yield.
   Only an **out-of-range** position that clears age + fees proceeds.
3. **Snapshot balances BEFORE** — safe balance of the non-USDC leg and of USDC. Everything below is
   measured as a **delta** from here, so pre-existing idle holdings in the safe are never redeployed.
4. **Close** (`runHyperionClose`, `claimFirst: true`) — two txs:
   `execute_hyperion_claim_fees` (perf cut taken) → `execute_hyperion_remove_all` (both legs land in
   the safe). Claiming first stops `remove` from sweeping fees past the perf cut.
5. **Snapshot AFTER** → `recoveredNon`, `recoveredUsdc` (post − pre). Both ≤ 0 → `skip-dust`.
6. **Plan the new range** — `planHyperionOpen(halfWidthTicks)` centers `[tickLower, tickUpper]` on
   the live tick. Stable `tickSpacing = 1`, so `halfWidthTicks = 10` ⇒ **±0.1%**.
7. **Rebalance the imbalance only** (when `rebalance !== false`, default on):
   - target non-USDC value fraction `R = computeZapValueFractionToNonUsdc(newRange)` (≈ 0.5 centered);
   - `targetNonVal = R × (USD value of both recovered legs)`;
   - swap **only the delta** to reach the ratio, gated by `MIN_REBALANCE_USD = 1`:
     non-USDC surplus > $1 → swap nonUSDC→USDC; shortfall > $1 → swap USDC→nonUSDC;
   - `submitSwapFaToFaWithFallbackLimits` with a **direction-aware** sqrt-price limit (zeroForOne vs
     oneForZero — a single fixed limit aborts one direction with vault `0xe`) and `amountOutMin` from
     `slippageBps` (default 50 bps for the rebalance).
8. **token_a haircut before reopen** (`DUAL_REOPEN_B_PAD = 1%`) — the anti-`EAMOUNT_B_INPUT_LESS`
   guard. The rebalance swap leaves token_b short of the exact split (fee + slippage + tick drift),
   and Hyperion sizes liquidity from `amount_a`, so it would abort on a token_b shortfall — **after**
   the close already happened. Re-read the tick (the swap moved it), then:
   - tick ≥ upper → `amountA = 0` (USDC-only side); tick ≤ lower → `amountB = 0` (token_a-only side);
   - in range → cap `amountA` to what the recovered `amountB` can pair with at `bPerA × 1.01`. USDC
     stays the long leg; the shaved token_a dust stays in the safe.
9. **Reopen** — `runHyperionOpenDual` with explicit ticks, `min_a = min_b = 0`. New position object;
   any leftover returns to the safe.
10. **Record** `action: "recenter"` + claim/remove/swap/reopen hashes for the `[hyperion-monitor]`
    log line.

### Constraints & failure modes

- **Not atomic** — 4 separate txs (claim → remove → swap → open). A failure at step 7–9 leaves both
  legs idle in the safe with **no auto-retry** until the next pass; the step-8 haircut exists
  specifically to make the reopen unfailable on a token_b shortfall.
- **USDC must be token_b** (`usdcIsTokenA: false`). The split/rebalance math assumes it.
- **Depeg is realized by the swap** — the new range centers on the *market* price, not $1, so the
  rebalance sells half of the depegged leg. Symmetric bet (protects on a deepening depeg, gives up
  on a re-peg); magnitude is bounded by half the position × the deviation.
- **One parameter set per cron URL** — width/gates are not stored per position or per safe; they come
  from the query string. Stables and volatile pools therefore need separate cron entries. The
  per-safe on-chain params design (see "Per-safe Hyperion LP automation params" in `docs/backlog.md`) replaces this.
- **Idle funds are not redeployed** (delta-only). The token_a dust shaved in step 8 stays in the
  safe until an auto-compound / manual add picks it up.
- **`forceRerange: true`** bypasses every gate and re-ranges all open positions to `halfWidthTicks`,
  even in range — for an on-demand band-width change.

### Knobs (cron body / query)

`halfWidthTicks`, `edgeBufferTicks`, `minPositionAgeSeconds`, `minFeesUsd`, `slippageBps`,
`maxActionsPerRun`, `poolKeys`, `forceRerange`, `rebalance`, `dryRun`.
