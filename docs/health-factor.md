# Health Factor (Account Health)

This document explains how **Health Factor** (a.k.a. **Account Health**) is defined and displayed in Yield AI, and where it is available.

## What it means

Health Factor is a **risk metric for borrow / leveraged accounts**. Higher is safer.

- If Health Factor **drops below 1.0**, the position is typically **liquidatable** (protocol-specific mechanics apply).
- The UI also shows:
  - **Collateral** (USD): the collateral value used by the position/account
  - **Liabilities** (USD): the borrowed value / total debt

## UI grading (colors + labels)

We grade Health Factor in the shared UI component `AccountHealthSummary`:

- **Safe (green)**: \(HF \ge 1.5\)
- **Risky (yellow)**: \(1.2 \le HF < 1.5\)
- **Danger (red)**: \(HF < 1.2\)

Note: **liquidation is typically around \(HF < 1.0\)**, but we start showing “Danger” earlier to provide a buffer.

## How we compute it (by protocol)

Health Factor is computed as a ratio between a **liquidation-value** of collateral and the **current liabilities**. Exact inputs vary per protocol integration.

### Jupiter (Solana) — Managed Borrow / Vault positions

We compute a per-position Health Factor using the **liquidation threshold (LT)**:

\[
HF = \frac{(\text{supplyUsd} \times LT)}{\text{borrowUsd}}
\]

Where:
- `supplyUsd`: supplied/collateral value in USD
- `borrowUsd`: borrowed value in USD
- `LT`: liquidation threshold (as a fraction, e.g. 0.75)

We prefer this **LT-based computation for display** because SDK-provided health fields have been observed to disagree with the Jupiter UI for some vaults.

Additionally, we compute:

\[
\text{liquidationPct} = \min\left(999,\ \frac{\text{borrowUsd}}{(\text{supplyUsd} \times LT)} \times 100\right)
\]

### Kamino (Solana) — Lend obligations

For Kamino Lend, we use the refreshed obligation stats and compute:

\[
HF = \frac{\text{borrowLiquidationLimit}}{\text{userTotalBorrow}}
\]

Where both values come from Kamino’s `refreshedStats`.

### Echelon (Aptos) — Borrow accounts

For Echelon, we compute an account-level “margin” as:

\[
\text{accountMargin} = \sum_i (\text{collateralValueUsd}_i \times LT_i)
\]

and total liabilities as:

\[
\text{totalLiabilities} = \sum_j (\text{borrowValueUsd}_j)
\]

Then:

\[
HF = \frac{\text{accountMargin}}{\text{totalLiabilities}}
\]

If an LT is not available for a collateral token in the current Echelon data set, we use a fallback \(LT = 0.75\).

## Where it is available in Yield AI

As of now, Health Factor / Account Health is shown in **Manage Positions** for:

- **Jupiter** (Solana): borrow/vault-managed positions
- **Kamino** (Solana): lend obligations
- **Echelon** (Aptos): supply/borrow accounts

If a protocol has no borrow component (or borrow data is unavailable), Health Factor is not shown.

