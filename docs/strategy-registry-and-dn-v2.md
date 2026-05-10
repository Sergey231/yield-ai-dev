# Frontend integration guide: Strategy Registry + Delta-Neutral Decibel V2

This document is for frontend engineers integrating the Yield AI Aptos package with:

- **Strategy Registry** (`{pkg}::strategy_registry`) — per-safe strategy tags (attach/detach/pause, extras).
- **Delta-Neutral Decibel V2** (`{pkg}::delta_neutral`) — per-market open/close bookkeeping, close proceeds persisted on-chain.

If you need a product-level mental model (Safe + tags + automation), start here:
- `docs/ai-agent-strategies.md`

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

## Future change: disable executor strategy changes (compatible upgrade)

You can later restrict strategy modifications to **owner-only** without breaking ABI:

- Do **not** change any entry function signatures.
- Only tighten the authorization predicate inside `strategy_registry` (e.g. `caller == owner`).

This is ABI-compatible (same payloads), but it is a **behavioral breaking change** for any off-chain system that relied on the executor attaching/detaching strategies.

Recommended rollout options:

1) UI-only strategy management (user signs attach/detach/state), executor reads tags.
2) Add an admin-controlled toggle in protocol config (executor allowed: true/false), then flip it off later without further upgrades.

