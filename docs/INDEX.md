# Yield AI docs — INDEX (source-of-truth map)

This file is the **map**, not the content. There is no single document that holds all truth —
truth in Yield AI is **layered**. This index says, for each topic, **which artifact is canonical**
and which doc is only a description of it.

> **Rule of thumb:** if a number can change at runtime (funding, borrow APR, spread, TVL), the
> **code/monitor/chain is the truth** and any doc showing that number is a dated *example*. Docs must
> **link** to the live source, never freeze numbers as fact. (See the stale-snapshot trap in
> [echelon-stable-looping-strategy.md](./echelon-stable-looping-strategy.md), whose rate tables are a
> 2026-06-15 snapshot.)

---

## Truth layers — what is canonical for what

| Layer | Canonical source of truth | Docs that *describe* it (not authoritative) |
|------|---------------------------|---------------------------------------------|
| **Position state** (what a safe is doing) | On-chain: `strategy_registry` tags + `delta_neutral` V2 records | [strategy-registry-and-dn-v2](./strategy-registry-and-dn-v2.md), [delta-neutral-v1](./delta-neutral-v1.md) |
| **Formulas / economics** | Code: `deltaNeutralSpread.ts`, `fundingServer.ts`, `dnSpreadMonitor.ts` | [dn-spread-economics-research](./dn-spread-economics-research.md) |
| **Live rates** (funding, borrow, spread, quotes) | Runtime: DN spread monitor + protocol APIs (Decibel / Echelon / Hyperion / Aave) | [dn-spread-monitor-cron](./dn-spread-monitor-cron.md) |
| **PnL / accounting / history** | On-chain DN V2 records + event ledger | [pnl-and-history-principles](./pnl-and-history-principles.md), [delta-neutral-v1](./delta-neutral-v1.md) |
| **Engine behavior** (when the bot acts) | Config JSON + cron code | [strategy-config-schema](./strategy-config-schema.md), [yield-ai-cron](./yield-ai-cron.md) |
| **Product / strategy intent** (what a strategy *is*, for users) | **The strategy spec doc itself** ← docs *are* canonical here | per-strategy docs below |

A doc can be the single source of truth **only for the "product intent" layer**. For everything else it
points at chain/code/runtime.

---

## Strategy specs (product-intent layer — docs ARE canonical here)

| Strategy | Canonical doc | Hedge / risk model | Status |
|----------|---------------|--------------------|--------|
| AI-agent concept (Safe + tags + automation) | [ai-agent-strategies](./ai-agent-strategies.md) | — (umbrella model) | live |
| Stablecoin compound (`usd1_echelon_compound`) | [strategy-config-schema](./strategy-config-schema.md) (config) + [ai-agent-strategies](./ai-agent-strategies.md) | none (stable) | live (default) |
| Echelon stable **looping** (USD1 collat / USDt debt) | [echelon-stable-looping-strategy](./echelon-stable-looping-strategy.md) | leveraged lending, depeg/rate risk | spec / not automated |
| Stable/stable **LP** (DN-by-construction, no perp) | [HYPERION_LP_FRONTEND](./HYPERION_LP_FRONTEND.md) (LP feature); follow-ups in [backlog](./backlog.md) | narrow-range stable LP, **no hedge needed** | shipped (PRs #153/#154/#156); user-facing enablement in backlog |
| **Decibel delta-neutral** (spot + ~1× short) | [dn-multi-chain-architecture](./dn-multi-chain-architecture.md) (arch) + [ai-agent-strategies](./ai-agent-strategies.md) | spot long + perp short = delta 0 | live (Aptos) / multi-chain draft |
| GOLD DN pilot ($200) | [dn-pilot-gold](./dn-pilot-gold.md) | DN execution log | pilot |
| **Hedged LP** (Hyperion LP + Decibel short, hedge dial) | [hedged-lp-strategy](./hedged-lp-strategy.md) | LP delta hedged by short; dial neutral↔bearish | spec / **not built** (net-new combo of `hyperion_lp` + `decibel_delta_neutral`) |

> **Note on overlap:** the "Decibel delta-neutral" model is currently described across *four* docs
> (ai-agent-strategies, dn-multi-chain-architecture, dn-spread-economics-research,
> strategy-registry-and-dn-v2). Until consolidated, treat **ai-agent-strategies** as the product entry
> point and the others as deep-dives per layer (arch / economics / on-chain).

### Delta-neutral reading order
1. [ai-agent-strategies](./ai-agent-strategies.md) — what an AI agent is (Safe + tags).
2. [dn-multi-chain-architecture](./dn-multi-chain-architecture.md) — how DN is structured (draft).
3. [dn-spread-economics-research](./dn-spread-economics-research.md) — economics, break-even, case studies.
4. [dn-spread-monitor-cron](./dn-spread-monitor-cron.md) — live data source + log fields.
5. [strategy-registry-and-dn-v2](./strategy-registry-and-dn-v2.md) — on-chain tags + V2 accounting.
6. [delta-neutral-v1](./delta-neutral-v1.md) — V1 limitations + history reconstruction (legacy).

---

## On-chain / contracts / accounting

| Doc | Canonical for |
|-----|---------------|
| [strategy-registry-and-dn-v2](./strategy-registry-and-dn-v2.md) | Strategy Registry tags + DN V2 open/close records (close proceeds on-chain) |
| [delta-neutral-v1](./delta-neutral-v1.md) | DN V1 view, its limitations, off-chain history reconstruction |
| [pnl-and-history-principles](./pnl-and-history-principles.md) | PnL / APR / cashflow-history computation rules |
| [health-factor](./health-factor.md) | Health Factor definition + where it's shown |

## Automation / engine / cron

| Doc | Canonical for |
|-----|---------------|
| [strategy-config-schema](./strategy-config-schema.md) | JSON config format driving the engine |
| [yield-ai-cron](./yield-ai-cron.md) | Main vault cron worker (claim→swap→deposit + LP auto-claim) |
| [dn-spread-monitor-cron](./dn-spread-monitor-cron.md) | Read-only DN spread/funding monitor (live signal source) |
| [dn-autoclaim-cron](./dn-autoclaim-cron.md) | DN-LP harvest cron — claim fees/rewards → USDC, held in safe (no reinvest) |
| [dn-rehedge-cron](./dn-rehedge-cron.md) | DN-LP auto-rehedge cron — short-only delta-restore, 15% band, margin guard |
| [telegram-notifications](./telegram-notifications.md) | Cross-cron wallet-addressed Telegram alerts — architecture (Yieldai-API PHP relay), how to wire a new cron into it |
| [backlog](./backlog.md) → "Per-safe Hyperion LP automation params" | Per-safe LP automation params on-chain (design idea, not built) |

## Hyperion LP (feature)

| Doc | Canonical for |
|-----|---------------|
| [HYPERION_LP_FRONTEND](./HYPERION_LP_FRONTEND.md) | `hyperion_lp` feature spec — open/manage/claim/recenter, pool registry, PnL |
| [HYPERION_LP_RISKS](./HYPERION_LP_RISKS.md) | User-facing LP risk acknowledgment + risk copy (IL, out-of-range, principal at risk) |

## Decibel integration

| Doc | Canonical for |
|-----|---------------|
| [decibel-builder-integration](./decibel-builder-integration.md) | Decibel's official Builder Codes spec (upstream) |
| [decibel-builder-fee](./decibel-builder-fee.md) | Yield-AI-specific builder-fee usage + DN integration gap/plan |
| [decibel-referral-dashboard](./decibel-referral-dashboard.md) | Referral analytics aggregation (volume, AMPS, levels) |

## Protocol integrations (mostly Solana reads)

| Doc | Chain | Scope |
|-----|-------|-------|
| [jupiter-lend-and-swap](./jupiter-lend-and-swap.md) | Solana | Jupiter Lend (Earn/Borrow) + Swap (gasless option) |
| [swap-integration](./swap-integration.md) | Aptos + Solana | **Swap modal** — Panora (Aptos) + Jupiter v2/v1 (Solana), routes, env, flow |
| [kamino-integration](./kamino-integration.md) | Solana | KLend obligations + KVaults + farms (server-built tx) |
| [exponent-integration](./exponent-integration.md) | Solana | PT/YT markets + Strategy Vaults (read positions; planned) |
| [meteora-integration](./meteora-integration.md) | Solana | DLMM positions (view-only) |
| [orca-integration](./orca-integration.md) | Solana | Whirlpool positions + claim/close |
| [tramplin-wallet-data](./tramplin-wallet-data.md) | Solana | Tramplin staking/rewards reads |

## Public API / external data

| Doc | Canonical for |
|-----|---------------|
| [public-wallet-api](./public-wallet-api.md) | External read-only HTTP API (Aptos+Solana balances/positions) |
| [defillama-adapter-spec](./defillama-adapter-spec.md) | DefiLlama TVL adapter for the vault |
| [panora-token-list](./panora-token-list.md) | Updating the cached Panora token list |
| [swap-integration](./swap-integration.md) | Panora + Jupiter swap architecture (Tools modal, Swap & Deposit) |

## Frontend / UI patterns

| Doc | Canonical for |
|-----|---------------|
| [README](./README.md) | Swap Modal design handoff (⚠️ misnamed — it is NOT the docs index; this file is) |
| [protocol-card-usequery-mini-guide](./protocol-card-usequery-mini-guide.md) | ProtocolCard + useQuery data pattern (sidebar/portfolio) |
| [lending-protocol-card-migration-guide](./lending-protocol-card-migration-guide.md) | Migrating Manage Positions to `LendingProtocolCard` |
| [token-yield-badges](./token-yield-badges.md) | Yield badges next to wallet assets |

## Planning

| Doc | Canonical for |
|-----|---------------|
| [backlog](./backlog.md) | Backlog + DN phased rollout (Phase 1–4) |

---

## Maintenance rules

1. **New strategy → new spec doc → register it here** in the Strategy specs table. One strategy = one
   canonical doc.
2. **Never freeze live numbers as fact.** Show rates as dated examples and link to the monitor/API.
3. **Resolve overlap by pointing, not copying.** If two docs cover the same thing, the non-canonical
   one gets a one-line "canonical doc: X" link at its top.
4. **Primary goal lens** (see project memory): evaluate any strategy first by *grows Yield AI TVL* +
   *clear user value*; Decibel trade volume is a bonus, not the selection criterion.
