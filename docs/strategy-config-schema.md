# Strategy Configuration Schema

This document describes the JSON configuration format used by the Yield AI agent engine to drive automated DeFi strategies on Aptos.

Reference implementation: `config/strategy-usd1-echelon-compound.json`.

## Overview

The configuration is a single JSON file that contains everything the off-chain worker (and optionally the frontend dashboard) needs to understand **what** to do, **when**, and **with what constraints**.

Architecture:

```
globalConfig (addresses, assets, DEX defaults)
  └── strategies (action graph + thresholds + risk limits)
        └── safes (per-safe overrides, priority, enable/disable)
```

The worker reads this file, computes **state** (balances, claimable amounts) off-chain, evaluates **conditions** against that state, and executes **actions** in dependency order.

## Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `version` | `number` | Schema version; bump on breaking changes. |
| `network` | `string` | Target network: `"mainnet"`, `"testnet"`, `"devnet"`. |
| `global` | `object` | Shared addresses, assets, protocol configs, DEX defaults. |
| `scheduler` | `object` | Execution cadence and concurrency controls. |
| `strategies` | `object` | Named strategy definitions (keyed by strategy ID). |
| `safes` | `array` | Per-safe assignments and overrides. |

## `global`

| Field | Type | Description |
|-------|------|-------------|
| `package` | `address` | Yield AI package address on-chain. |
| `rpcUrl` | `string` | Aptos fullnode REST endpoint. |
| `assets` | `Record<string, Asset>` | Named asset registry (used as keys throughout the config). |
| `protocols` | `Record<string, Protocol>` | Protocol-specific addresses and identifiers. |
| `dexDefaults` | `object` | Default slippage and deadline for swaps. |

### Asset object

| Field | Type | Description |
|-------|------|-------------|
| `metadata` | `address` | FA metadata object address (`Object<Metadata>`). |
| `decimals` | `number` | Decimal places for human-readable formatting. |
| `coinType` | `string \| null` | Full Move type path (e.g. `0x1::aptos_coin::AptosCoin`). Required for Echelon `claim_reward<T>` type arg. `null` for pure FA assets (USDC, USD1). |

### Protocol object

| Field | Type | Description |
|-------|------|-------------|
| `packageAddress` | `address` | Protocol's on-chain package address. |
| `adapterAddressView` | `string` | View function (relative to `global.package`) to resolve adapter object address. |
| `poolId` | `number` | *(Moar only)* Pool identifier (0 = APT, 1 = USDC). |

### dexDefaults

| Field | Type | Description |
|-------|------|-------------|
| `slippageBps` | `number` | Default slippage tolerance in basis points. |
| `deadlineSecs` | `number` | Default transaction deadline in seconds from now. |

## `scheduler`

Controls how the agent loops over safes.

| Field | Type | Description |
|-------|------|-------------|
| `intervalSecs` | `number` | Seconds between full strategy runs (external scheduler responsibility in production). |
| `maxConcurrentSafes` | `number` | Max safes processed in parallel (rate-limit protection). |
| `timeoutPerSafeSecs` | `number` | Per-safe timeout; skip if exceeded. |

## `strategies`

A map of `strategyId → StrategyDefinition`. Each strategy is a self-contained action graph with defaults, risk limits, and execution rules.

### Strategy fields

| Field | Type | Description |
|-------|------|-------------|
| `strategyVersion` | `number` | Internal version for this strategy definition. |
| `description` | `string` | Human-readable summary. |
| `context` | `object` | Protocol-specific parameters (market objects, farming IDs). |
| `defaults` | `object` | Threshold values referenced by action conditions. |
| `execution` | `object` | Run-level controls. |
| `riskLimits` | `object` | Hard guardrails applied before signing any transaction. |
| `actions` | `Action[]` | Ordered list of actions with dependency graph. |

### `context`

Provides protocol-specific identifiers used by actions via `*Ref` fields.

#### `context.echelon`

| Field | Type | Description |
|-------|------|-------------|
| `marketObj` | `address` | Echelon lending market object for the target asset (e.g. USD1). |
| `farmingId` | `string` | Opaque farming identifier from `farming::Staker.user_pools` (e.g. `@0xbb8f...200`). |

#### `context.moar`

| Field | Type | Description |
|-------|------|-------------|
| `rewardId` | `string` | Reward token identifier for Moar farming claim (e.g. `"APT"`). |
| `farmingIdentifier` | `string` | Moar farming identifier or `"auto"` (resolved off-chain from Moar resources). |

### `defaults`

Threshold values used in action conditions. Per-safe overrides can change any of these.

| Field | Type | Description |
|-------|------|-------------|
| `minClaimBaseUnits` | `number` | Minimum claimable amount (in base units) to trigger a claim action. |
| `minSwapRewardBaseUnits` | `number` | Minimum reward balance (in base units) to trigger a swap. |
| `minUsdcSwapToUsd1` | `number` | Minimum USDC balance (base units, 6 decimals) to swap into USD1. |
| `minUsd1DepositToEchelon` | `number` | Minimum USD1 excess to deposit into Echelon. |
| `usd1ReserveInSafe` | `number` | USD1 amount to keep in the safe (not deposited). `excessBalance = balance - reserve`. |

### `execution`

| Field | Type | Description |
|-------|------|-------------|
| `stopOnFailure` | `boolean` | If `true`, abort the entire run on any action failure. |
| `maxActionsPerRun` | `number` | Hard cap on total actions executed per safe per run. |

### `riskLimits`

| Field | Type | Description |
|-------|------|-------------|
| `maxSingleActionUsd` | `number` | Max USD value for any single action (swap, deposit). |
| `allowedAssets` | `string[]` | Whitelist of asset keys that the strategy may touch. |
| `maxSlippageBps` | `number` | Max slippage in basis points; overrides `dexDefaults` if stricter. |

## Actions

Each action represents a single on-chain operation. Actions form a DAG (directed acyclic graph) via `dependsOn`.

### Action fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique action identifier (referenced by `dependsOn`). |
| `type` | `string` | Action type (see table below). |
| `description` | `string` | Human-readable label. |
| `enabled` | `boolean` | Can be overridden per-safe. |
| `dependsOn` | `string[]` | IDs of actions that must complete first. |
| `params` | `object` | Type-specific parameters (entry function, assets, refs). |
| `condition` | `Condition` | When to execute (evaluated against computed state). |
| `onError` | `"continue" \| "halt"` | `continue`: skip and proceed; `halt`: stop the entire run for this safe. |

### Action types

| Type | Entry function | Description |
|------|----------------|-------------|
| `claimMoarReward` | `vault::execute_claim_apt` | Claim APT reward from Moar farming. |
| `claimEchelonReward` | `vault::execute_claim_echelon<T>` | Claim a single reward token from Echelon farming. Requires `rewardCoinType` (type arg) and `rewardMetadata`. |
| `swapFaToFa` | `vault::execute_swap_fa_to_fa` | Swap FA → FA via on-chain swap integration (USDC-hub allowlist). |
| `depositEchelonFa` | `vault::execute_deposit_echelon_fa` | Deposit FA into Echelon lending market. |
| `withdrawMoarFull` | `vault::execute_withdraw_full` | Full withdraw from Moar pool. |
| `depositMoar` | `vault::execute_deposit` | Deposit to Moar pool. |

### `params` by action type

#### `claimEchelonReward`

`rewardName` is required because Echelon's view API expects a human string:
`farming::claimable_reward_amount(user, rewardName, farmingId)`.

| Field | Description |
|-------|-------------|
| `rewardAsset` | Asset key from `global.assets`. |
| `rewardName` | Echelon reward name string (e.g. `"Aptos Coin"`, `"Thala APT"`, `"Echelon Token"`). |
| `rewardCoinType` | Full Move type argument for `<RewardCoinType>`. |
| `rewardMetadata` | FA metadata address for the reward token. |
| `farmingIdRef` | Reference path to farming ID (e.g. `"context.echelon.farmingId"`). |

#### `swapFaToFa` swap parameter resolution (v1)

The on-chain entry function requires per-swap parameters that are not stored in the JSON config:

- `fee_tier: u8`
- `sqrt_price_limit: u128`
- `amount_out_min: u64`
- `deadline: u64` (derived from `dexDefaults.deadlineSecs`)

For v1:

- `fee_tier` and `sqrt_price_limit` are selected from a hardcoded lookup table keyed by `(fromMetadata, toMetadata)`.
- `amount_out_min` is computed from a quote source (Hyperion SDK quote) and `slippageBps` (capped by `riskLimits.maxSlippageBps`).
- If a pair is not present in the hardcoded table, the worker should skip the action rather than guessing.

## Conditions

Conditions gate whether an action executes. Evaluated against pre-computed state.

### Reference paths

| Prefix | Resolves to |
|--------|-------------|
| `state.safeBalance.<ASSET>` | FA balance of the safe for the named asset (base units). |
| `state.excessBalance.<ASSET>` | `safeBalance - reserve` (computed by worker). |
| `state.moarClaimableApt` | Claimable APT from Moar farming (base units). |
| `state.echelonClaimable.<ASSET>` | Claimable reward from Echelon farming for the named asset key (base units). |
| `defaults.<key>` | Value from `strategy.defaults` (possibly overridden per-safe). |
| `context.<protocol>.<field>` | Value from `strategy.context`. |

