# AI Agent Strategies (Safe + Strategy Tags)

This document explains how **Yield AI “AI agents”** work conceptually and how they map to the on-chain **Strategy Registry** and the off-chain **cron engine**.

It is intended for engineers and PMs who need a shared mental model across:
- frontend UX and copy,
- executor behavior,
- cron automation,
- on-chain state (Strategy Registry + Delta Neutral V2).

---

## Glossary

### Safe (AI agent wallet)
An on-chain **safe object address** created via the Yield AI vault. A safe is the unit of isolation:
- balances live on the safe,
- strategy tags attach to the safe,
- automation rules apply per safe.

In the UI, a safe is shown as an “AI agent wallet”.

### AI agent (product concept)
In this codebase, an “AI agent” is not a single contract. It is a **bundle**:
- **Safe** (wallet container for funds)
- **Strategy tags** (on-chain intent / mode)
- **Automation/executor behavior** (off-chain behavior driven by tags)
- **UI** (what the user sees and what actions are offered)

Think of it as: **Safe + Active Strategy = AI agent type**.

### Strategy tag (on-chain)
A **strategy tag** is a UTF‑8 id stored on-chain in `{pkg}::strategy_registry`.

Tags answer the question: **“What is this safe supposed to do?”** without relying on heuristics from balances.

### Strategy implementation (off-chain engine)
An on-chain tag is deliberately **not** tied 1:1 to a specific implementation.

Example: the user wants “stablecoin compounding”, while the current implementation might be “USD1 + Echelon compounding”.

This indirection lets us replace or upgrade the stablecoin strategy without changing existing safe tags.

---

## Canonical AI agent types (current)

### 1) `stablecoin_compound`
**User intent:** farm stablecoin yield.

**On-chain tag:** `stablecoin_compound` (UTF‑8 bytes).

**Current concrete implementation (cron engine):** `usd1_echelon_compound`  
Configured in `config/strategy-usd1-echelon-compound.json`.

**Automation:** enabled by default (if the registry is not initialized or no tags are attached, we treat the safe as `stablecoin_compound`).

### 2) `decibel_delta_neutral`
**User intent:** manage delta-neutral positions (spot on safe + perp on Decibel).

**On-chain tag:** `decibel_delta_neutral` (UTF‑8 bytes).

**Automation:** no stablecoin-compound cron actions should run for this safe. The executor performs explicit open/close flows.

### 3) `hyperion_lp`
**User intent:** manage Hyperion concentrated-liquidity LP positions from a safe.

**On-chain tag:** `hyperion_lp` (UTF-8 bytes).

**Automation:** handled by the Hyperion LP cron, not the stablecoin-compound worker. Current actions are claim and optional re-center. Future actions can add or remove liquidity in slices when the range, fees, and execution price make that attractive.

---

## Default behavior (important)

If a safe has **no active strategy tags**, the product treats it as:
- **`stablecoin_compound`** (default AI agent type)
- with the current engine implementation: **`usd1_echelon_compound`**

Rationale: keep the UX “zero configuration” and preserve backward-compatible behavior for older safes.

---

## How tags drive UX and behavior

### Frontend (UX)
Frontend reads the safe’s tags and uses them to:
- show a **strategy badge** on the safe (e.g. “Stablecoin compound”),
- decide which actions to **highlight** (compound vs delta-neutral),
- show/hide “automation” messaging.

### Backend executor (writes)
The current UX uses **backend endpoints** that submit transactions as the executor:
- attach/detach strategy tags
- optionally set tag state (ACTIVE/PAUSED/DETACHED)

This is intentionally replaceable with user-signed writes later.

### Cron worker (automation)
The cron worker discovers safes and runs the compounding engine per safe.

With strategy tags enabled:
- if `decibel_delta_neutral` is ACTIVE → the cron run **skips** that safe
- else → the cron runs the stablecoin-compound engine as usual

---

## Multi-safe model

We expect users to create **multiple safes**, each representing a different “AI agent instance”:
- different strategies (compound vs delta-neutral),
- different risk limits / configuration,
- different assets / markets (in delta-neutral V2).

### Safe switcher
The UI should allow:
- selecting the active safe,
- creating a new safe even if one already exists,
- remembering the last selected safe.

---

## Strategy lifecycle (high-level)

### Stablecoin compound lifecycle
1) User creates a safe
2) (Optional) Tag is explicitly attached: `stablecoin_compound`
3) User deposits funds into the safe
4) Cron runs periodically (claim/swap/deposit flows) based on config

### Decibel delta-neutral lifecycle
1) User creates a safe
2) Tag is attached: `decibel_delta_neutral`
3) User completes Decibel delegation / executor setup
4) Executor opens a delta-neutral position (spot + perp)
5) UI monitors position and allows closing
6) Executor closes the position and records results (in Delta Neutral V2)
7) Tag can be detached when strategy is no longer used

### Hyperion LP lifecycle
1) User creates a safe
2) Tag is attached: `hyperion_lp`
3) User deposits USDC and/or LP legs into the safe
4) Executor opens a Hyperion LP position
5) Cron may claim rewards/fees, re-center the range, or later add/remove liquidity in slices
6) Executor closes or converts the position and event history is used for PnL

---

## Roadmap: incremental position management

The intended agent behavior is not limited to one large open and one full close. For both
delta-neutral and LP strategies, the agent should be able to act in smaller slices when conditions
are attractive.

### Delta-neutral slice actions

Examples:

- **Add $100** when Decibel funding is attractive and the Hyperion spot hedge quote is acceptable.
  The executor opens/increases the Decibel short and buys the matching spot leg inside the safe.
- **Reduce $100** when closing is favorable, funding turns unattractive, or the spot/perp basis
  creates a good exit. The executor closes part of the Decibel short and sells only the matching
  spot delta from the safe.
- **Rebalance only** when the existing hedge is materially off target. The executor buys/sells a
  small spot delta or adjusts the perp leg, subject to max drift and max execution loss limits.

Decision inputs:

- Decibel funding APR and expected carry over the next window
- Decibel mark/index price vs Hyperion spot quote
- Hyperion quote loss/slippage in USD and bps
- current hedge mismatch (`actual_spot_out` vs `filled_short_size`)
- min notional per slice, max daily turnover, and max allowed execution loss

Accounting requirement:

- Each slice must be recorded as its own event/ledger row: `increase`, `decrease`, `rebalance`, or
  `close`.
- For each row store the actual spot input/output, Decibel filled size, Decibel tx version, spot tx
  version, estimated execution loss, and resulting position size.
- PnL should be computed from cumulative costs/proceeds, not from a single "position opened at"
  number. This is the same model used for LP event totals.

### Hyperion LP slice actions

The same product pattern should extend to LP positions:

- **Add liquidity** when the range is active, projected fees justify the swap cost, and the zap/dual
  preview loss is under the configured limit.
- **Remove partial liquidity** when the range is unattractive, price approaches an edge, or converting
  the withdrawn leg is favorable.
- **Re-center** by closing/removing, converting only the delta returned by that action, then opening a
  new range.

The implementation should share the same guardrails as delta-neutral: per-slice notional, max
slippage/loss, cooldowns, and event-based PnL. This avoids building separate accounting models for
Decibel and Hyperion.

---

## Authorization note (future-proofing)

Today the contract may allow **safe owner OR safe executor** to mutate tags.

This is a **policy decision**, not an ABI requirement. A compatible upgrade can later restrict tag writes to **owner-only** without changing function signatures.

If/when that happens, we should migrate UI to user-signed writes, and treat executor-only tag writes as deprecated.

---

## References

- Strategy Registry + Delta Neutral V2 integration guide: `docs/strategy-registry-and-dn-v2.md`
- Hyperion LP frontend/automation handoff: `docs/HYPERION_LP_FRONTEND.md`
- Cron engine notes: `docs/yield-ai-cron.md`
