# Hyperion LP — earnings summary + stable pool price chart (MVP spec)

Status: draft for implementation  
Audience: frontend + backend dev  
UI surface: **Yield AI → Manage positions → Hyperion LP** (`HyperionLpStrategyView`)

## v1 scope (shipping first)

**Ship only:** **Yesterday earned** (`profitYesterdayUsd`) in the Open positions header.

**Deferred to v2:** Invested, Total profit, eye toggle, per-position yesterday breakdown, stable pool price chart cron.

---

## 1. UI placement (confirmed)

### Where

**Section:** `Open positions (N)` — collapsible header in `HyperionLpStrategyView.tsx`.

This is the block surfaced **on top** when the safe already has LP positions. Today the header meta row shows:

| Existing | Label in code |
|----------|----------------|
| LP value | `openPositionsSummary.totalUsd` |
| Earned | `totalEarnedUsd` (claimed + unclaimed) |
| PnL | `totalPnlUsd` |
| APR | `avgApr` |

**Add here** (same `sectionMetaRow`, same visual pattern as LP value / PnL / APR):

| Metric | EN label | v1 |
|--------|----------|-----|
| Profit yesterday | **Yesterday** | **yes** |
| Invested | **Invested** | v2 |
| Total profit | **Total profit** | v2 |

**v1 order:** `Yesterday | LP value | Earned | PnL | APR`

Reference layout (competitor): three KPIs in a row + optional eye toggle to hide amounts.

### Where NOT (MVP)

- Not on the main dashboard home
- Not inside each `HyperionPositionRow` card (unless phase 2 per-position breakdown)
- Not in `YieldAIPositions.tsx` global safe header (Hyperion-only scope for v1)

### Tooltip (Profit yesterday)

> Includes only fees and rewards **actually claimed to your safe** during the previous UTC calendar day. Does not include uncollected fees, position value changes, or impermanent loss.

### Eye toggle (optional v1.1)

Hide/show dollar amounts in the Open positions summary row (localStorage per safe).

---

## 2. Earnings metrics — definitions

Applies to **all** whitelisted Hyperion pools on the safe (stable + volatile), aggregated across open positions unless noted.

### 2.1 Invested (`investedUsd`)

**Meaning:** capital currently at work in open LP positions (cost basis).

**Formula (per open position):**

```text
basisUsd = basis from vault HyperionLp* events (net deposited legs, spot USD)
         OR max(eventsBasis, principal_usdc) for open positions (see fix/hyperion-pnl-basis-add)

investedUsd = Σ basisUsd over all open positions
```

**Excludes:** idle USDC in safe, unclaimed fees still inside LP.

### 2.2 Total profit (`totalProfitUsd`)

**Meaning:** cumulative **realized** earnings already claimed to the safe (cash basis).

**Formula:**

```text
totalProfitUsd = Σ claimedUsd over all open positions
```

Where `claimedUsd` = USD value of all historical `HyperionLpFeesClaimed` + `HyperionLpRewardClaimed` events for that position (already computed in `GET …/hyperion-lp/positions`).

**Excludes:**

- `feesUsd` / `rewardsUsd` still uncollected in the position
- `pnlUsd` (includes IL and mark-to-market)
- principal returned on close

**Note:** Differs from current header **Earned** (`claimed + uncollected`). Keep both or rename:

| Field | Definition |
|-------|------------|
| Earned (existing) | claimed + uncollected (accrued) |
| Total profit (new) | claimed only (realized / paid) |

### 2.3 Profit yesterday (`profitYesterdayUsd`)

**Meaning:** realized earnings that **hit the safe yesterday** (UTC calendar day).

**Window:**

```text
yesterdayStart = UTC 00:00:00 of (today - 1 day)
yesterdayEnd   = UTC 00:00:00 of today  — exclusive upper bound
```

**Formula (cash basis — required for MVP):**

```text
profitYesterdayUsd = Σ USD value of all fee + reward claim events
                     where event.timestamp ∈ [yesterdayStart, yesterdayEnd)
                     for all open (and optionally closed-yesterday) positions on this safe
```

**Excludes:**

- Δ position `valueUsd` (BTC move, IL)
- Unclaimed fees that accrued but were not claimed
- Remove/close principal (`got_a` / `got_b`)
- Swap proceeds unless explicitly tagged as reward conversion (phase 2)

**If no claims yesterday:** `0` (not null).

**Auto-claim:** hourly cron means yesterday ≈ sum of up to ~24 claim batches — correct for “paid profit”.

---

## 3. Valuing claim legs in USD (stable vs WBTC)

Each claim event has token legs. Convert to USD per leg.

### 3.1 Stable pools (USDt/USDC, USD1/USDC)

- USDC / USDt / USD1 legs: `amount × $1` (spot).
- Historical price optional; error negligible at ±0.1% peg.

### 3.2 Volatile pools (WBTC/USDC, xBTC/USDC)

Claims often include **WBTC + USDC**.

**Pricing rule (implement both, prefer A when available):**

| Priority | Rule | When |
|----------|------|------|
| **A** | `usdAtClaim` — price at `transaction_timestamp` | v2 / when indexing ledger |
| **B** | `spotNow` — Panora spot at query time | MVP fallback |

```ts
legUsd = amountHuman × (usdAtClaim ?? spotNow)
```

**`usdAtClaim` sources (v2):**

1. **Birdeye** `history_price` — nearest candle to `transaction_timestamp` (reuse `/api/birdeye/history`).
2. Persist `usd` on ledger row at index time (preferred long-term).

**MVP acceptance:** spot pricing for WBTC fee legs is OK — fee amounts are small; document ~few % BTC daily move as minor absolute error on fees.

**Do NOT** use “yesterday’s WBTC price” for the whole position — only for **WBTC amounts inside yesterday’s claim transactions**.

### 3.3 Reward tokens (APT farm)

Same rule: `usdAtClaim ?? spotNow` via APT FA / `APTOS_COIN_TYPE` mapping (already in positions route).

---

## 4. Backend — earnings summary API

### Endpoint

`GET /api/protocols/yield-ai/hyperion-lp/earnings-summary?safe=0x...`

Public read-only (no cron secret).

### Response

```json
{
  "success": true,
  "data": {
    "safe": "0x…",
    "asOf": "2026-06-17T12:00:00.000Z",
    "investedUsd": 3792.42,
    "totalProfitUsd": 66.80,
    "profitYesterdayUsd": 0.20,
    "profitYesterdayWindow": {
      "start": "2026-06-16T00:00:00.000Z",
      "end": "2026-06-17T00:00:00.000Z"
    },
    "pricing": {
      "mode": "spot",
      "note": "WBTC/APT legs use Panora spot; v2 will use usdAtClaim per tx"
    },
    "breakdown": {
      "openPositionCount": 2,
      "claimsYesterdayCount": 3
    }
  }
}
```

### Implementation modules

| Module | Responsibility |
|--------|----------------|
| `src/lib/protocols/yield-ai/hyperionLpClaimLedger.ts` (new) | Parse claim events with `{ ts, position, poolKey, legs[], usd }` |
| Extend `hyperionLpEvents.ts` | Optional: shared tx fetch; today only cumulative totals |
| `earnings-summary/route.ts` (new) | Aggregate invested, total profit, yesterday |

### Claim ledger — data sources

**Phase 1 (fast):** Aptos indexer `fungible_asset_activities` on safe address, filter:

- `execute_hyperion_claim_fees`
- `execute_hyperion_claim_rewards`

Group by `transaction_version`, use `transaction_timestamp`, sum inflows (same pattern as `stablecoin-compound-history/route.ts`).

**Phase 2 (accurate):** Parse `HyperionLpFeesClaimedEvent` / `HyperionLpRewardClaimedEvent` from executor txs (same pipeline as `loadHyperionLpEventTotalsBySafe`) and attach exact `fee_a` / `fee_b` / `amount` fields.

### Invested / total profit reuse

- Call existing position enrichment logic or internalize `basisUsd` / `claimedUsd` from `positions/route.ts` — **do not duplicate formulas**.

---

## 5. Frontend wiring

### File

`src/components/protocols/manage-positions/protocols/yield-ai/HyperionLpStrategyView.tsx`

### Data fetching

New hook: `useHyperionLpEarningsSummary(safeAddress)`  
Query key: `queryKeys.protocols.yieldAi.hyperionLpEarningsSummary(safe)`

Stale time: align with positions (`STALE_TIME.POSITIONS`).

### UI changes in Open positions header

Extend `openPositionsSummary` **or** parallel `earningsSummary` from new API.

**Suggested meta row order:**

```text
Invested | Total profit | Profit yesterday | LP value | Earned | PnL | APR
```

Or replace **Earned** with clearer labels — product call:

- Keep **Earned** = accrued (claimed + uncollected)
- **Total profit** = realized only

Color **Total profit** / **Profit yesterday** green if `> 0`, red if `< 0`, muted if `0`.

### Loading / empty

- While loading: show `—` or skeleton in meta row
- Safe with no positions: hide Open positions section (unchanged)
- Positions exist but ledger empty: `profitYesterdayUsd: 0`, `totalProfitUsd: 0`

---

## 6. Stable pool price chart (related MVP — separate but same epic)

See prior discussion: Birdeye is flat for stables; use **cron snapshot of pool tick**.

- Cron: `action=snapshot-pool-price` every 15 min
- API: `GET …/hyperion-lp/pool-price-history?poolKey=usdt_usdc`
- `BinChart` prop `priceSource="hyperion-pool"` for `poolUi.isStable`

Not part of earnings summary UI, but same Hyperion LP manage surface.

---

## 7. Acceptance criteria

### Earnings summary

- [ ] Open positions header shows **Invested**, **Total profit**, **Profit yesterday** next to LP value / PnL / APR
- [ ] **Profit yesterday** counts only claim txs in previous UTC day
- [ ] **Total profit** = cumulative claimed USD (not uncollected)
- [ ] **Invested** = sum of `basisUsd` for open positions
- [ ] WBTC pool included; WBTC legs valued at Panora spot (MVP)
- [ ] Tooltip on Profit yesterday matches cash-basis definition
- [ ] Works with hourly auto-claim cron

### Non-goals (v1)

- [ ] Per-position yesterday breakdown in table rows
- [ ] `usdAtClaim` historical pricing (v2)
- [ ] Accrual-based “earned yesterday” without claim

---

## 8. File touch list

| Area | Path |
|------|------|
| UI | `HyperionLpStrategyView.tsx` — Open positions `sectionMetaRow` |
| API | `src/app/api/protocols/yield-ai/hyperion-lp/earnings-summary/route.ts` |
| Lib | `src/lib/protocols/yield-ai/hyperionLpClaimLedger.ts` |
| Hook | `src/lib/query/hooks/protocols/yield-ai/useHyperionLpEarningsSummary.ts` |
| Keys | `src/lib/query/queryKeys.ts` |
| Reference | `positions/route.ts`, `stablecoin-compound-history/route.ts`, `hyperionLpEvents.ts` |

---

## 9. Estimate

| Task | Days |
|------|------|
| Claim ledger + earnings API | 1 |
| UI meta row + hook | 0.5 |
| WBTC spot valuation + tests | 0.5 |
| **Total** | **~2 dev-days** |

Pool price chart cron (if same epic): +2 dev-days.

---

## 10. Open product questions

1. Show **Invested** for closed positions history or only open?
2. Replace or keep **Earned** in header (accrued vs realized duplication)?
3. Include closed positions’ yesterday claims if position closed yesterday?

**Default answers for MVP:** open positions only; keep Earned + add Total profit; yes include claims from positions that were open during yesterday even if closed today.
