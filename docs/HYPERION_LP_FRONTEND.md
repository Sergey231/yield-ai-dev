# Hyperion LP — frontend integration spec (handoff)

Status: **tasks (а)–(г) implemented (2026-05-30): `hyperion_lp` strategy registered, create+attach
via `?strategy=hyperion`, user-facing manage UI (deposit→open / claim / close / close→USDC), and the
re-center cron. Pending: manual mainnet verification + owner-signature auth hardening (see §2/§7).**

Previously: plumbing built + admin "secret button" shipped.

This is the brief for finishing the Hyperion CLMM LP strategy in the `yield-ai` frontend. The vault
contract is **deployed and mainnet-verified** (open/claim/remove full cycle on the real WBTC/USDC
pool). This doc captures everything needed to build tasks (а)–(г) without re-deriving context.

---

## 0. What to start the new chat with

> "Continue the Hyperion LP frontend in `C:\work\yield-ai`. Read `docs/HYPERION_LP_FRONTEND.md`
> first — the contract is deployed and the backend plumbing + admin button already exist on branch
> `feat/hyperion-lp-frontend`. Implement tasks а–г from that doc."

Then point it at the **existing pieces** (§3) and the **UI plan** (§4).

---

## 1. Deployed contract facts (mainnet)

- Vault package: `0x333d1890e0aa3762bb256f5caeeb142431862628c63063801f44c152ef154700`
- Hyperion LP adapter (whitelisted): `0xe962ebafd209b0106ba9a1c23cde4cd79ef34158ce9a600f120eff9369aac3f5`
- Hyperion DEX (`dex_contract`): `0x8b4a2c4bb53857c718a04c020b98f8c2e1f99a68b0f57389a8bf5434cd22e05c`
- USDC FA: `0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b`
- WBTC FA: `0x68844a0d7f2587e726ad0579f3d640865bb4162c08a4589eeda3f9689ec52a3d`
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
