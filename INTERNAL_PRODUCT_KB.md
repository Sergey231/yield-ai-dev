# Product Overview

- **Scope**: DeFi dashboard + tx toolkit on **Aptos**; includes **Solana** bridge/lending modules.
- **Core value**: discover yields; track balances/positions; execute deposit/withdraw/claim/swap where supported.
- **Privacy line**: **Solana → Aptos USDC** flow (privacy pool + Circle CCTP + derived Aptos accounts).
- **Tech shape**: Next.js App Router; API routes `src/app/api/**/route.ts`; data via Panora + Aptos fullnode/indexer.

# Features

- **Tracking**: `/api/protocols/*/userPositions`; portfolio balances with USD pricing (Panora); small-asset hide threshold.
- **Discovery**: pools via `/api/protocols/*/pools` + `/api/aptos/pools`; compares APY/opportunities.
- **Execution**: protocol tx builders (`BaseProtocol`); native vs external deposit; swaps via `/api/panora/*`.
- **Gasless/AA**: Aptos Gas Station sponsorship + optional fee payer; Yield AI vault “safe” with executor-limited automation.

# User Flows

- **Discover → deposit**: browse pools/ideas → (optional Panora swap) → protocol deposit (native tx or external redirect).
- **Manage**: open protocol → load positions → withdraw/claim if supported; lending UIs show risk metrics (e.g., Echelon HF/LTV).
- **Yield AI safe**: list safes `/api/protocols/yield-ai/safes` → inspect `/safe-contents` → owner deposit/withdraw; executor runs claim→swap→deposit (cron).
- **Privacy bridge**: Solana privacy pool deposit → temp Solana wallet → CCTP burn/mint → receive on Aptos (derived account) → optionally deposit into Aptos DeFi.

# Strategies

- **Vault automation (implemented)**: Moar rewards APT → claim → swap APT→USDC → deposit USDC to Moar adapter (skip paused/non-existent safes).
- **Vault guards (implemented)**: thresholds (0.1 APT / 0.1 USDC); per-run caps (`maxTxPerRun`, `maxSafesProcessedPerRun`); page+concurrency env knobs.
- **Perps hedge helpers (implemented)**: compute hedge affordability + swap prefills (buffer bps + fixed USDC) for Decibel workflows.
- **Rebalancing**: referenced as future work; no confirmed automated rebalance engine in core modules reviewed.

# Protocols

- **Aptos (tracked/executed)**: Echelon, Joule, Aries, Meso, Auro, Moar, Aave, Hyperion, Tapp, Earnium, Thala, Echo, Amnis, Kofi, APTree, Decibel, Panora, Yield AI Vault.
- **Solana (modules)**: Jupiter Lend; Kamino; Circle CCTP (USDC bridge primitive).
- **Protocol metadata source**: `src/lib/data/protocolsList.json` (depositType, isDepositEnabled, managedType, contractAddresses).
- **Tx history mapping**: `contractAddresses` used to map Aptoscan “platform” → protocol key.

# Technical Notes

- **Protocol interface**: `BaseProtocol` tx builders (`buildDeposit` + optional withdraw/claim); protocol registry driven by `protocolsList.json`.
- **Gasless**: Aptos Gas Station submitter (client-only init) + `withFeePayer` builds; failures include missing sponsorship rules (“Rule not found”).
- **Yield AI vault**: on-chain views enumerate safes; endpoints `/api/protocols/yield-ai/safes` + `/safe-contents`; cron `/api/protocols/yield-ai/cron/run` (secret + in-memory lock) uses `YIELD_AI_EXECUTOR_PRIVATE_KEY`.
- **Privacy bridge**: server `/api/privacy-bridge/burn` requires `SOLANA_PAYER_WALLET_PRIVATE_KEY`; Solana RPC URL/key handling appends `api-key` param when needed.

# Yield AI Strategy Engine (config-driven)

We refactored the Yield AI vault cron worker from a hardcoded sequential script into a config-driven strategy engine.

- **Strategy config**: `config/strategy-usd1-echelon-compound.json`
  - Defines global settings (RPC, assets, protocol package addresses/defaults) and a set of strategies.
  - Each strategy is a **DAG** of actions with `dependsOn`, `enabled`, and conditions.
  - Safe-specific overrides are supported via `safes[].overrides` (defaults/actions/riskLimits).
- **Engine implementation**: `src/lib/protocols/yield-ai/engine/**`
  - **Types/schema**: `engine/types.ts`
  - **Config loader / run context**: `engine/configLoader.ts`
  - **State computation** (off-chain): `engine/stateComputer.ts` (balances, excess amounts, claimable rewards)
  - **Condition evaluation**: `engine/conditionEvaluator.ts`
  - **DAG execution**: `engine/dagExecutor.ts` (topological execution, per-action results, stop/continue on error)
  - **Action dispatch**: `engine/actionHandlers.ts` → calls `vaultExecutor` entrypoints
- **Orchestrator**: `src/lib/protocols/yield-ai/yieldAiVaultWorker.ts`
  - Discovers safes on-chain using `vault::get_total_safes` + `vault::get_safes_range_info`.
  - Supports running a subset of safes via `safeAddresses[]` (manual targeting).
  - Supports **dry run** (`dryRun: true`) to simulate tx building without submitting.
  - Enforces per-run caps: `maxSafesProcessedPerRun`, `maxTxPerRun`.

## Hyperion swap quote reliability (REST fallback)

Hyperion SDK quotes previously failed due to a GraphQL schema mismatch (`getSwapInfo` missing). We implemented a robust quote source by calling Hyperion REST directly.

- **Quote function**: `src/lib/protocols/yield-ai/engine/hyperionQuote.ts`
  - Calls `GET https://api.hyperion.xyz/base/rate/getSwapInfo?amount=...&from=...&to=...&safeMode=true&flag=in`
  - Parses `amountOut` and returns it as `bigint` for `amountOutMin` calculation.
  - This avoids upgrading `@hyperionxyz/sdk` to v0.0.25 (which pulls in `@aptos-labs/script-composer-sdk` and can break Next.js webpack bundling via WASM).

## Cron run endpoint usage (manual safe targeting)

Endpoint: `POST /api/protocols/yield-ai/cron/run` (requires header `x-cron-secret` == `YIELD_AI_CRON_SECRET`)

- **Dry run example**:

```bash
curl -X POST "http://localhost:3000/api/protocols/yield-ai/cron/run" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $YIELD_AI_CRON_SECRET" \
  -d '{"dryRun":true,"safeAddresses":["0x..."]}'
```

- **Live run example**:

```bash
curl -X POST "http://localhost:3000/api/protocols/yield-ai/cron/run" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $YIELD_AI_CRON_SECRET" \
  -d '{"dryRun":false,"safeAddresses":["0x..."]}'
```

Notes:
- `dryRun: true` returns the same action counts as live runs, but does not submit transactions (no tx hashes).
- The engine returns a structured summary (`txCountByKind`, `processedSafes`, `txHashes`) for observability.

# Risks

- **Secrets**: server executor key (`YIELD_AI_EXECUTOR_PRIVATE_KEY`) and Solana fee payer key (`SOLANA_PAYER_WALLET_PRIVATE_KEY`) are high-impact compromise points.
- **Gasless fragility**: Gas Station env + per-function sponsorship rules required; missing rules break sponsored UX or force user gas.
- **Automation concurrency**: cron lock is in-process; multi-instance deploys can double-run without distributed locking; misconfig can spike tx volume.
- **Privacy limits**: correlation via timing/amount/provider logs remains possible even with temp wallets + pooling.

