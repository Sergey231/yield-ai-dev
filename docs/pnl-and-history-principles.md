# PnL + APR + History: Principles

This document defines how we compute and present **PnL**, **APR**, and **cashflow history** across protocols on Aptos.

The goal is consistency: the same inputs should always produce the same results, and users should be able to verify calculations by following links to on-chain transactions.

## Scope

- **Supported networks**: Aptos mainnet (current).
- **Asset model**: fungible assets (FA metadata addresses) and coins (coin types).
- **Protocols**: Yield AI Agent (implemented) and future protocols (e.g. APTree).

## Core definitions

### Cashflow entry

A cashflow entry is a user-facing deposit/withdraw action that changes the user's invested principal in a protocol position.

Each entry MUST include:

- **timestamp**: ISO-8601 time of the on-chain transaction
- **direction**: `deposit` or `withdraw`
- **amountRaw**: integer in base units
- **amount**: human-readable decimal string (using token decimals)
- **assetId**: asset identifier
  - for FA: metadata object address (e.g. `0xbae2...f3b` for USDC)
  - for coin: coin type (e.g. `0x1::aptos_coin::AptosCoin`)
- **txId**: transaction identifier used for explorer links
  - Aptos explorer supports `txn/<version>` and `txn/<hash>`

Optional fields:

- **source**: `indexer` | `events` | `protocol_adapter`
- **protocolKey**: e.g. `yield-ai`, `aptree`
- **notes**: e.g. “vault::deposit”, “moneyfi_adapter::Withdraw”

### Net deposits (principal)

\[
\text{netDeposits} = \sum(\text{deposits}) - \sum(\text{withdrawals})
\]

All sums are per-asset (do not mix assets unless converted via a price oracle and explicitly labeled as an estimate).

### Current value

Current value is the protocol position’s current mark-to-market value at the time of calculation.

For a protocol position this can include:

- wallet/safe balances
- adapter positions / shares / LP value
- claimable rewards (if we choose to include them)

The **component breakdown** should be documented per protocol.

### PnL

\[
\text{PnL} = \text{currentValue} - \text{netDeposits}
\]

For 1-asset strategies where value is naturally denominated in that asset (e.g. USDC-only, USDT-only), `currentValue` is expressed in that asset units.

If `currentValue` is expressed in USD, then `netDeposits` must be expressed in USD as well (requires pricing at entry times or treating deposits as USD stable at par).

## APR (annualized return) method

We use **Modified Dietz** (cashflow-aware, approximates time-weighted return without requiring full NAV time-series).

### Inputs

- `entries[]`: cashflows (deposit/withdraw) in chronological order
- `currentValue`: current mark-to-market value
- `firstTimestamp`: timestamp of the first cashflow entry
- `now`: current time

### Steps

1) Compute `PnL = currentValue - netDeposits`.

2) Reconstruct a running principal balance over time:

- start `balance = 0`
- for each entry:
  - deposit: `balance += amount`
  - withdraw: `balance -= amount`

3) Compute dollar-days (capital × time) by summing over intervals between events:

\[
\text{dollarDays} = \sum_{i} (\text{balance}_i \times \Delta \text{days}_i)
\]

4) Compute total days:

\[
\text{totalDays} = \frac{\text{now} - \text{firstTimestamp}}{86400s}
\]

5) Average capital:

\[
\text{avgCapital} = \frac{\text{dollarDays}}{\text{totalDays}}
\]

6) Annualize:

\[
\text{APR} = \left(\frac{\text{PnL}}{\text{avgCapital}}\right) \times \left(\frac{365}{\text{totalDays}}\right) \times 100\%
\]

### Display rules

- **APR is shown only when** `holdingDays >= 7`.
- If `totalDays < 1` or `avgCapital` is near zero → APR is not shown.

## History UI principles

### What users must see

- A list of cashflows with:
  - time
  - direction
  - amount + asset symbol (or assetId if symbol unknown)
  - link to explorer transaction

### “Show your work”

To make APR verifiable, the UI SHOULD optionally show a compact “capital timeline”:

- intervals `(from → to)`
- `days × runningBalance = contribution`

This matches the Modified Dietz computation and explains how APR is derived from history.

## Data sources and extraction strategy

### Preferred: protocol-native events (when available)

If a protocol emits explicit deposit/withdraw events including the asset identifier (e.g. `asset.inner`, `token`, `metadata`), we prefer those.

Reason: `0x1::fungible_asset::Deposit/Withdraw` events are often internal bookkeeping and may not uniquely identify the user cashflow or the asset.

### Alternative: Aptos Indexer GraphQL (fungible_asset_activities)

Indexer can provide a universal “ledger” of balance changes, but it must be filtered carefully:

- `owner_address` must match the account/position address whose balance changes we want to track
- `asset_type` must match the target assetId
- filter by `entry_function_id_str` (when a single entry function uniquely represents a user deposit/withdraw for the protocol)

This works well for Yield AI Agent because user cashflows map cleanly to:

- `vault::deposit`
- `vault::withdraw`

For other protocols (e.g. APTree), entry functions may be bridge-like (`bridge::deposit/withdraw`) and internal swaps/LP operations can produce extra FA activities. In those cases, protocol-native events are the source of truth.

## Protocol-specific notes

### Yield AI Agent

- Cashflows:
  - `0x333d...::vault::deposit` → deposit
  - `0x333d...::vault::withdraw` → withdraw
- Asset:
  - USDC FA metadata: `0xbae2...f3b`
- Implementation: `/api/protocols/yield-ai/deposit-history` (includes PnL + APR)

### APTree (planned)

- Prefer protocol events such as:
  - `...::vault::DepositedEvent` (deposit)
  - `...::vault::WithdrawnEvent` (withdraw)
  - `...::moneyfi_adapter::Deposit/Withdraw` (often repeats the same asset+amount; useful as cross-check)
- Extract assetId from:
  - `event.data.asset.inner` OR `event.data.token`

## Known limitations / disclaimers

- APR is **annualized** from a finite time window; for short histories it is noisy.
- If we include rewards in `currentValue`, APR/PnL includes rewards mark-to-market.
- If the asset is not a stablecoin, converting PnL to USD requires pricing assumptions (out of scope for “principal-only” cashflow APR).

