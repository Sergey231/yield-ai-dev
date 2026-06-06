# Frontend integration guide: Strategy Registry + Delta-Neutral Decibel V2

This document is for frontend engineers integrating the Yield AI Aptos package with:

- **Strategy Registry** (`{pkg}::strategy_registry`) — per-safe strategy tags (attach/detach/pause, extras).
- **Delta-Neutral Decibel V2** (`{pkg}::delta_neutral`) — per-market open/close bookkeeping, close proceeds persisted on-chain.

If you need a product-level mental model (Safe + tags + automation), start here:
- `docs/ai-agent-strategies.md`

If you need V1 limitations and the best-effort heuristic for estimating spot close output:
- `docs/delta-neutral-v1.md`

> Conventions:
> - `{pkg}` = your deployed Yield AI package address (e.g. `VITE_MODULE_ADDRESS`).
> - `safe_address` is the **safe object address** returned by `vault::get_safe_address(owner, index)`.
> - Strategy ids are **UTF-8 bytes** (e.g. `"dn-decibel-btc"` → `vector<u8>`).
> - All code, identifiers, and payload formats below are in **English**.

---

## What changed (high level)

### 1) Strategy tags are now explicit on-chain

Instead of inferring “what a safe is doing” from balances and adapter principals, the app and executor can read strategy tags on-chain:

- `attach_strategy(safe, strategy_id)`
- `detach_strategy(safe, strategy_id)`
- `set_strategy_state(safe, strategy_id, ACTIVE|PAUSED|DETACHED)`
- optional numeric metadata: `set_strategy_extra_u64(safe, strategy_id, key, value)`

There is **no on-chain allowlist of strategy ids**. The canonical list of ids and their meaning is an **off-chain convention** shared by:

- frontend (UI labels, routing, parameters),
- executor (which entries it calls and when),
- indexer (optional) for richer history views.

### 2) Delta-neutral bookkeeping is now per-market (V2)

V1 had a single slot per safe. V2 tracks positions **per market**:

- open/close is keyed by `(safe_address, perp_market)`
- you can have multiple markets on the same safe (e.g. BTC + APT) simultaneously
- `usdc_received_on_close` is persisted on-chain in the V2 state
- forward-compatible numeric fields live in `extras_u64`

---

## Preconditions (gate features on views)

Before offering UI actions, check the registries are initialized (admin one-time init after publish).

### Strategy registry initialized

- **View**: `{pkg}::strategy_registry::strategy_registry_initialized() -> bool`

### Delta-neutral V2 registry initialized

- **View**: `{pkg}::delta_neutral::delta_neutral_registry_v2_initialized() -> bool`

If either returns `false`, frontend should:

- hide/disable the corresponding UI controls, and/or
- show an “admin setup required” banner.

---

## Strategy Registry: payloads and flows (user-signed)

All **writes** below require a signer authorized for the safe.

Today the on-chain auth model is:

- **safe owner OR safe executor** may mutate strategy tags.

> Important: This is **business-logic**, not ABI. A future compatible upgrade can restrict this to **owner-only** without changing function signatures.

### 1) Attach (enable) a strategy tag

- **Entry**: `{pkg}::strategy_registry::attach_strategy`
- **Signer**: user wallet (safe owner) recommended
- **Args**:
  - `safe_address: address`
  - `strategy_id_bytes: vector<u8>` (UTF-8, length 1..64)

Behavior:

- idempotent: if already ACTIVE, it is a no-op
- creates or re-activates the entry and emits `StrategyAttachedEvent`

### 2) Detach (disable) a strategy tag

- **Entry**: `{pkg}::strategy_registry::detach_strategy`
- **Signer**: user wallet
- **Args**:
  - `safe_address: address`
  - `strategy_id_bytes: vector<u8>`

Behavior:

- idempotent: if already DETACHED, it is a no-op
- keeps history; entry remains in the safe’s append-only id list

### 3) Pause / resume (state transitions)

- **Entry**: `{pkg}::strategy_registry::set_strategy_state`
- **Signer**: user wallet
- **Args**:
  - `safe_address: address`
  - `strategy_id_bytes: vector<u8>`
  - `new_state: u8` (one of: DETACHED, ACTIVE, PAUSED; see your UI enum mapping)

Use this when you want to keep the tag but mark it temporarily inactive.

### 4) Attach numeric metadata (optional)

- **Entry**: `{pkg}::strategy_registry::set_strategy_extra_u64`
- **Signer**: user wallet (or executor if you allow)
- **Args**:
  - `safe_address: address`
  - `strategy_id_bytes: vector<u8>`
  - `key_bytes: vector<u8>` (UTF-8, length 1..64)
  - `value: u64`

Typical use: show “funding paid”, “health factor snapshot”, etc. without changing on-chain structs.

---

## Strategy Registry: views (read-only)

Use these for authoritative UI state (no indexer needed).

### Is a specific strategy ACTIVE?

- **View**: `{pkg}::strategy_registry::is_strategy_active(safe_address, strategy_id_bytes) -> bool`

### Does the safe have any active strategies?

- **View**: `{pkg}::strategy_registry::has_any_active_strategy(safe_address) -> bool`

### Get a single strategy entry (exists/state/timestamps)

- **View**: `{pkg}::strategy_registry::get_strategy_entry(safe_address, strategy_id_bytes) -> StrategyEntryView`

### List all strategies ever attached to a safe (history order)

- **View**: `{pkg}::strategy_registry::get_safe_strategies(safe_address) -> vector<StrategyTagView>`

### List active strategy ids only

- **View**: `{pkg}::strategy_registry::get_safe_active_strategies(safe_address) -> vector<vector<u8>>`

### Read an extra u64 value

- **View**: `{pkg}::strategy_registry::get_strategy_extra_u64(safe_address, strategy_id_bytes, key_bytes) -> ExtraU64View`
  - returns `{ found: bool, value: u64 }`

---

## Delta-Neutral Decibel V2: payloads and flows (executor-signed, plus optional user tagging)

### Key idea

Delta-neutral V2 is **bookkeeping** only:

- it does not move funds itself
- it records what your executor already did (open/close legs) so UI can render state without scraping the indexer

### Open flow (typical)

Recommended sequencing:

1) Executor performs the spot leg action(s) (e.g. swap inside the safe).
2) Executor calls `{pkg}::delta_neutral::record_open_v2(...)`.
3) **User** (or executor) calls `{pkg}::strategy_registry::attach_strategy(safe, "dn-decibel-<asset>")`.

#### Spot hedge sizing caveat

The current executor estimates the spot leg with a Hyperion exact-out quote, but the vault executes the swap via `vault::execute_swap_fa_to_fa`, which is an exact-input path. In practice:

- target output is derived from the filled Decibel short size, e.g. `filled_short_size` in WBTC base units
- `amount_in` is `Hyperion exact-out amountIn + INPUT_BUFFER_BPS`
- `amount_out_min` is only a lower safety floor, not a cap on how much spot can be bought
- any input buffer or favorable tick movement is converted into extra spot inventory

Observed WBTC result: a target short around `0.00127000 BTC` produced a safe spot balance around `0.00128256 WBTC`, roughly a 1% over-hedge. This is technically safe from an under-hedge perspective, but it is not a clean delta-neutral match.

For V2 production behavior, prefer one of:

1) Reduce or disable `INPUT_BUFFER_BPS` for WBTC and add an executor-side exact-in preflight quote immediately before submit, so expected output stays close to `filled_short_size`.
2) Add a true exact-output swap path in the vault/adapter and record the exact input/output amounts.
3) If exact-input remains the only available path, store both `target_spot_out` and `actual_spot_out` in V2 so UI and PnL can explicitly show the hedge mismatch.

#### record_open_v2

- **Entry**: `{pkg}::delta_neutral::record_open_v2`
- **Signer**: safe executor (or owner)
- **Args** (conceptual):
  - `safe_address: address`
  - `decibel_subaccount: address`
  - `perp_market: address` (market identifier, used as the per-market key)
  - `spot_asset_metadata: address` (spot token metadata object address)
  - `filled_short_size: u64`
  - `usdc_swapped_in: u64`
  - `decibel_tx_version: u64`
  - `client_order_id_bytes: vector<u8>` (UTF-8, length 0..128)

> Frontend tip: validate client-order-id length using the view:
> `{pkg}::delta_neutral::max_client_order_id_bytes()`.

### Close flow (typical)

Recommended sequencing:

1) Executor performs the close-side spot swap (spot → USDC) inside the safe.
2) Executor computes `usdc_received_on_close` as a **balance delta** on the safe’s USDC FA store.
3) Executor calls `{pkg}::delta_neutral::record_close_v2(...)` passing `usdc_received_on_close`.
4) **User** (or executor) calls `{pkg}::strategy_registry::detach_strategy(safe, "dn-decibel-<asset>")`.

#### record_close_v2

- **Entry**: `{pkg}::delta_neutral::record_close_v2`
- **Signer**: safe executor (or owner)
- **Args** (conceptual):
  - `safe_address: address`
  - `perp_market: address`
  - `close_decibel_tx_version: u64`
  - `usdc_received_on_close: u64`
  - `close_swap_tx_version: u64`

### Delta-neutral V2 views (read-only)

Frontend can render state directly from views:

- `{pkg}::delta_neutral::is_delta_neutral_open_v2(safe_address, perp_market) -> bool`
- `{pkg}::delta_neutral::is_any_delta_neutral_open_v2(safe_address) -> bool`
- `{pkg}::delta_neutral::get_open_markets_v2(safe_address) -> vector<address>`
- `{pkg}::delta_neutral::get_all_markets_v2(safe_address) -> vector<address>`
- `{pkg}::delta_neutral::get_delta_neutral_position_v2(safe_address, perp_market) -> DeltaNeutralPositionViewV2`
- `{pkg}::delta_neutral::get_extra_u64_v2(safe_address, perp_market, key_bytes) -> ExtraU64View`

---

## Vault adapter note: Moar deposits disabled

Moar protocol is considered shut down. The contract logic now blocks routing **deposits** into Moar via:

- `{pkg}::vault::execute_deposit(...)`

Specifically:

- allowlist check still applies (must be allowlisted in `{pkg}::protocol`)
- the vault’s internal dispatch for `execute_deposit` is limited to the mock adapter route (Moar deposit path is blocked)

Withdraw/claim paths may still exist for emergency exits, depending on your deployment version.

---

## Frontend backlog: DN position chart (Phase 2 follow-ups)

The Position Summary block on Manage Position now embeds a Decibel candlestick chart (TradingView's `lightweight-charts` v5) collapsed by default, with the position's entry price drawn as a horizontal line. Source code: `src/components/decibel/decibel-chart.tsx`. Open items for future iterations:

- **2.2 — Funding APR overlay.** Add a second pane below the price chart with funding rate history pulled from `/api/protocols/decibel/fundingRateHistory`. Lets the user see whether they entered when funding was rich and whether the trend is still favorable. Requires a `useDecibelFundingHistory(market, fromSec)` hook + a `LineSeries` with its own price scale on lightweight-charts. Estimate: 3-4h.
- **2.3 — Open-time marker.** Use `createSeriesMarkers(series, [{ time, position: 'aboveBar', shape: 'arrowDown', color, text: 'Open' }])` (v5 helper) to anchor the entry visually. The horizontal entry-price line gives the price; the marker gives the moment. Estimate: 30 min.
- **2.4 — Crosshair → unrealized PnL tooltip.** On `chart.subscribeCrosshairMove`, compute `(crosshairPrice − entry) × shortSize − (crosshairPrice − entry) × spotAmount` (≈ funding only, since it's a sized DN) and surface in a small overlay. Educational: shows the user "what would my PnL have been if I'd closed at this point." Estimate: 2-3h.
- **2.5 — Timeframe toggles.** `1h / 4h / 1d / All` buttons that swap the `interval` and adjust `startTime`. Trivial — extend `DecibelChart` with an optional segmented control. Estimate: 1h.
- **2.6 — Chart inline in close-position confirmation modal.** Same component, smaller footprint (200px), shows the user the price they're closing into. Builds confidence before signing. Estimate: 1h.

All five items are additive — none need contract changes. The data sources (`/candlesticks`, `/fundingRateHistory`) already proxy through to Decibel's REST API.

---

## Future change: combined `init_vault_with_strategy` (one-tx onboarding)

**Problem.** The Decibel AI agent onboarding currently requires the user to sign **two transactions**:

1. `vault::init_vault_v2(...limits)` — creates the safe; the safe address is derived from `(owner, index)` and only becomes known after the tx executes.
2. `strategy_registry::attach_strategy(safe_addr, strategy_id)` — tags the new safe as `decibel_delta_neutral`.

Between (1) and (2) the frontend has to poll the indexer until the safe is observable so it can pass the freshly created `safe_addr` into `attach_strategy`. This adds latency, a second wallet popup, and a partial-failure mode where (1) succeeds but (2) is rejected/abandoned, leaving an untagged safe.

**Proposal.** Add a new entry function on the Yield AI vault package that bundles both steps:

```move
public entry fun init_vault_with_strategy(
    owner: &signer,
    // existing init_vault_v2 limits
    max_per_tx_usdc_base_units: u64,
    max_daily_usdc_base_units: u64,
    swap_max_per_tx_usdc_base_units: u64,
    swap_max_daily_usdc_base_units: u64,
    // new
    strategy_id: vector<u8>,
)
```

Inside the function:

1. Create the safe resource account exactly as `init_vault_v2` does.
2. Compute `safe_addr` from the just-created resource account.
3. Call `strategy_registry::attach_strategy(safe_addr, strategy_id)` directly (same package or via friend, so no external call from the user).

**Frontend impact (after deploy).** In `src/components/ui/yield-ai-safe-settings-form.tsx` the
`handleCreateSafe` flow can be simplified to a single `signAndSubmitTransaction` call when
`fixedStrategy` is set; the indexer-polling loop and the second tx branch become unreachable. The
2-step progress UI (`Step 1/2 → Step 2/2`) and the “you will sign 2 transactions” copy become
obsolete and can be removed.

**Compatibility.** Pure additive change — `init_vault_v2` and `attach_strategy` keep their current signatures and remain callable for legacy flows.

**Open question.** Whether the same entry should also accept `extras_u64` map upfront, so DN-specific numeric metadata (e.g. preferred market) can be set in the same tx. Probably yes; cheap to add.

---

## Future change: server-enforced safe-balance pre-check for DN open (M2)

**Problem.** When the executor calls `delta_neutral::record_open` followed by the safe's swap path, the swap can revert with `EINSUFFICIENT_BALANCE` after the Decibel short has already been opened. The user sees a confusing partial state (short open on Decibel, no spot leg in the safe) and the recovery path requires the force-close flow we ship now.

Root cause: Decibel lot-rounding + 50 bps pool fee + 20 bps input buffer + tick drift can make the swap input exceed the safe's USDC balance even when the executor's `availableToTradeUsdc` math passes. The Yield AI vault contract doesn't validate the swap input vs. the safe balance before submitting the inner swap call.

**Proposal.** Add a safe-balance precondition inside the vault entry that wraps the swap (e.g. `vault::execute_swap_fa_to_fa` or its successor in V2):

- Read the safe's USDC balance.
- Require `safe_usdc_balance >= amount_in + small_dust_buffer` (e.g. 50_000 base units = $0.05).
- Abort with a dedicated error code (e.g. `EVAULT_SAFE_INSUFFICIENT_BALANCE`) **before** any state changes happen on the safe or downstream protocols.

**Why on-chain and not just executor-side.** The executor already estimates input size with a buffer, but the chain is the only source of truth for the safe's exact balance at execution time, and the abort needs to land before the swap call to avoid the partial-state outcome. With this guard the worst case is a clean revert, which the executor already handles by retrying or surfacing a friendly error.

**Frontend impact.** Map the new error code in `parseTransactionError` so users see a clear "Safe doesn't have enough USDC for this swap; try a smaller size" instead of the generic `EINSUFFICIENT_BALANCE`. The current 2.5% reserve heuristic in `YieldAIPositions.maxSizeUsd` can stay as a UX guardrail.

**Open question.** Should the same check live in `delta_neutral::record_open` to also block the Decibel short when the eventual swap would fail? That requires the contract to know the swap's `amount_in`, which V1 doesn't pass through. V2's `record_open_v2` could accept it as a parameter so the whole open is atomic.

---

## Future change: disable executor strategy changes (compatible upgrade)

You can later restrict strategy modifications to **owner-only** without breaking ABI:

- Do **not** change any entry function signatures.
- Only tighten the authorization predicate inside `strategy_registry` (e.g. `caller == owner`).

This is ABI-compatible (same payloads), but it is a **behavioral breaking change** for any off-chain system that relied on the executor attaching/detaching strategies.

Recommended rollout options:

1) UI-only strategy management (user signs attach/detach/state), executor reads tags.
2) Add an admin-controlled toggle in protocol config (executor allowed: true/false), then flip it off later without further upgrades.

