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

---

## Authorization note (future-proofing)

Today the contract may allow **safe owner OR safe executor** to mutate tags.

This is a **policy decision**, not an ABI requirement. A compatible upgrade can later restrict tag writes to **owner-only** without changing function signatures.

If/when that happens, we should migrate UI to user-signed writes, and treat executor-only tag writes as deprecated.

---

## References

- Strategy Registry + Delta Neutral V2 integration guide: `docs/strategy-registry-and-dn-v2.md`
- Cron engine notes: `docs/yield-ai-cron.md`
