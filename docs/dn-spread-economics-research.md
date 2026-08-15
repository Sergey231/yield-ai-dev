# Delta-neutral spread economics — research notes

Living document for **Phase 1** (monitor-only data collection) while designing a future **multi-chain DN strategy** (Solana spot via Jupiter + Decibel perp). See also `docs/backlog.md` (DN phased rollout) and `docs/dn-spread-monitor-cron.md` (cron + log fields).

**Status:** research / not execution guidance. Numbers below use production monitor snapshots (June 2026); re-validate before any live entry.

---

## Capital model

Standard DN sleeve assumed for all examples:

| Label | Spot leg (Jupiter ExactIn) | Short leg (Decibel perp, ~1×) | Total DN capital |
|-------|------------------------------|--------------------------------|------------------|
| **$1k DN** | $500 | $500 notional | $1,000 |
| **$10k DN** | $5,000 | $5,000 notional | $10,000 |

Monitor quotes each leg at `sizeUsd` ∈ {500, 5000}. Funding accrues on **short notional only**. Entry P&L is applied to the **quoted spot leg** using `netEntryEdgeBps`.

---

## Formulas (match monitor code)

From `src/lib/protocols/decibel/deltaNeutralSpread.ts` and `dnSpreadMonitor.ts`:

```
spreadBps = (spotPrice / decibelMark - 1) × 10_000
netEntryEdgeBps = -spreadBps - 34          // Jupiter quote path; swap fees in quote
entryUsd = sizeUsd × max(0, -netEntryEdgeBps) / 10_000   // drag when net edge < 0
entryGainUsd = sizeUsd × max(0, netEntryEdgeBps) / 10_000 // gain when net edge > 0
fundingUsd(N days) = sizeUsd × (fundingApr24hPct / 100) × N / 365
daysToBreakEven = |netEntryEdgeBps| / (fundingApr24hPct × 100 / 365)   // funding pays entry drag
```

**Funding on total DN capital:** APR on the perp leg ≈ **half** the same APR expressed on total capital (50/50 spot + short collateral).

**Exit (rough planning only, not in monitor):** budget ~34 bps Decibel taker on close + Jupiter sell slippage/fees (~15–30 bps indicative). Round-trip **extra** exit drag ≈ **$2.5–3.5** on a $500 leg, **$25–35** on a $5k leg, plus spread move at exit.

---

## Case study A — GOLD/USD (positive entry edge)

**Source:** production logs, 2026-06-11 ~18:15 UTC, `solana_jupiter_quote`, token XAUt (Tether Gold). No `basisWarning` (unlike SILVER ETF tokens).

| Quote size | netEntryEdgeBps | fundingApr24hPct | Notes |
|------------|-----------------|------------------|-------|
| $500 | **+13.2** | ~30.6% | Best edge; size-sensitive |
| $5,000 | **+4.5** | ~30.6% | Edge compresses at size |

### $1k DN ($500 / $500) — 7 days, funding flat

| Line | Calculation | USD |
|------|-------------|-----|
| Entry gain | 500 × 13.2 / 10_000 | **+$0.66** |
| Funding 7d | 500 × 30.6% × 7 / 365 | **+$2.94** |
| **Gross 7d** | | **~$3.60** (~0.36% on $1k) |
| Exit drag (planning) | ~50–70 bps round-trip on leg | **−$2.5 to −$3.5** |
| **Net 7d (after exit)** | | **~$0.1 to +$1.1** |

Entry gain is ~**18%** of gross; funding ~**82%**. Positive entry edge is a **timing bonus**, not the main bet.

### $10k DN ($5k / $5k) — 7 days

| Line | USD |
|------|-----|
| Entry gain (+4.5 bps on $5k) | +$2.25 |
| Funding 7d (~30.6% on $5k) | +$29.36 |
| **Gross 7d** | **~$31.60** (~0.32%) |

### Strategy — GOLD

| Rule | Rationale |
|------|-----------|
| **Enter immediately when `netEntryEdgeBps > 0`** | Edge is one-off; windows are short (observed burst ~18:00–19:15 UTC). |
| **Prefer $500 quote sizing for entry** | Edge was **3× better** at $500 vs $5k in the same window. |
| **Hold ≥ ~5–7 days** if exiting | Exit fees consume most of a 1-week gross unless entry edge is large. |
| **Do not wait for “more edge”** | +13 bps at $500 was the best observed positive signal; xStocks showed no positive quote-era edge. |
| **Multi-chain blocker** | Spot is Solana XAUt; executor today is Aptos-only for DN open — needs Phase 3 Solana leg. |

---

## Case study B — NVDA/USD (negative entry edge, high funding)

**Source:** production logs, 2026-06-11 (07:15–19:15 UTC sample), `solana_jupiter_quote`.

| Metric | Best observed | Day average |
|--------|---------------|-------------|
| netEntryEdgeBps @ $500 | **−27.3** (~10:00 UTC) | **−38.7** |
| fundingApr24hPct | ~50.3% | **~52.6%** |
| `daysToBreakEven` | **~1.9 days** | **~2.7 days** |

Spot is **more expensive** than Decibel mark after fees (negative net edge) — you **pay** to enter, then **earn** funding on the short.

### $1k DN ($500 / $500) — 7 days, funding flat at ~52.6% APR

**Average day (−38.7 bps entry):**

| Line | USD |
|------|-----|
| Entry drag | 500 × 38.7 / 10_000 = **−$1.94** |
| Funding 7d | 500 × 52.6% × 7 / 365 = **+$5.04** |
| **Gross 7d** | **~+$3.10** (~0.31% on $1k) |

**Best tick (−27.3 bps, ~50.3% funding):**

| Line | USD |
|------|-----|
| Entry drag | **−$1.37** |
| Funding 7d | **+$4.82** |
| **Gross 7d** | **~+$3.45** |

### $10k DN ($5k / $5k) — 7 days (average −38.7 bps, 52.6% funding)

| Line | USD |
|------|-----|
| Entry drag | **−$19.35** |
| Funding 7d | **+$50.41** |
| **Gross 7d** | **~+$31.06** |

### Break-even timeline (funding only, no exit fees)

| Scenario | daysToBreakEven |
|----------|-----------------|
| NVDA best (−27.3 bps, 50.3% APR) | **~1.9 days** |
| NVDA average (−38.7 bps, 52.6% APR) | **~2.7 days** |

Add **~3–4 days** more to cover **exit fees** → practical minimum hold **~5–7 days** for average NVDA, **~4–5 days** on a good tick.

### Strategy — NVDA (contrast with GOLD)

| Rule | Rationale |
|------|-----------|
| **Do not require positive entry edge** | Trade is **carry + mean reversion of spread**, not instant arb. |
| **Enter when `daysToBreakEven ≤ 3` and funding stable** | Monitor field `estimatedDaysToBreakEven` (PR #171+); average NVDA ~2.7d in sample. |
| **Avoid entry when funding collapses** | TSLA same day: ~−40 bps entry but **~13% funding** → ~11 days break-even; poor R/R. |
| **Hold through break-even + exit buffer** | ~1 week hold reasonable if funding persists; 1-day hold loses to entry + exit. |
| **Size note** | Best net edge was at **$500** quote (−27.3 bps); larger size may widen spread. |

---

## Side-by-side ($1k DN, 7 days, flat funding, no exit)

| Market | Entry (1×) | Funding 7d | Gross 7d | Entry type |
|--------|--------------|------------|----------|------------|
| **GOLD** (+13.2 bps, 30.6%) | +$0.66 | +$2.94 | **~$3.60** | Immediate edge + carry |
| **NVDA** avg (−38.7 bps, 52.6%) | −$1.94 | +$5.04 | **~$3.10** | Carry pays entry drag |
| **NVDA** best (−27.3 bps, 50.3%) | −$1.37 | +$4.82 | **~$3.45** | Better timing on entry |

Similar **gross** over 7 days, different **risk profile**:

- **GOLD:** needs favorable spread window; lower funding; **positive edge** de-risks short hold.
- **NVDA:** higher funding; **negative edge** requires hold; sensitive to funding drops and spread widening.

---

## Decision framework (for future multi-chain executor)

```
IF netEntryEdgeBps > 0 AND NOT basisWarning:
  → Enter immediately (GOLD-like); size at lower quote if edge is size-sensitive.
ELIF netEntryEdgeBps < 0 AND shortEarnsFunding AND estimatedDaysToBreakEven ≤ 3:
  → Enter for carry (NVDA-like); plan hold ≥ breakEven + exit buffer (~5–7 days).
ELIF estimatedDaysToBreakEven > 7 OR fundingApr24hPct < 20%:
  → Skip (TSLA-like).
ELSE:
  → Log only; keep accumulating monitor data (Phase 1).
```

**Exit:** close when (a) spread moves sharply against position, (b) funding APR drops below threshold, or (c) planned hold horizon reached and net of exit quote is acceptable.

---

## Phase 1 data to keep collecting

| Signal | What to look for in `[DN-Monitor]` logs |
|--------|----------------------------------------|
| Persistent positive edge | Same market `netEntryEdgeBps > 0` on **≥3 consecutive** 15m runs |
| Carry candidates | `estimatedDaysToBreakEven ≤ 3` with stable `fundingApr24hPct` |
| Size sensitivity | Compare $500 vs $5k quotes for same market |
| False positives | `basisWarning`, Jupiter quote errors (zeros with `error` field) |
| Funding regime change | NVDA 40% → 52% in one day — track variance |

---

## Open questions (Phase 3 multi-chain)

1. **Solana executor:** Jupiter buy + custody + Decibel short coordination; USDC on Solana vs Aptos subaccount.
2. **Exit liquidity:** XAUt / xStock pools at $5k+ without destroying edge.
3. **Funding stationarity:** 24h APR extrapolated over 7d — validate with historical funding series.
4. **Hedge mismatch:** spot fill vs short size at open (existing executor pre-flight patterns).
5. **GOLD vs xStock priority:** GOLD showed positive edge but smaller universe; NVDA higher funding but always negative quote-era edge in sample.

---

## 2026-06-12 update (production logs, ~12h window)

**Window:** 2026-06-11 17:45 → 2026-06-12 05:45 UTC. Monitor fields `estimatedDaysToBreakEven` / `breakEvenWithin3Days` confirmed in production.

| Market | Entry signal | Funding | 7d gross @ $1k (flat funding) | Notes |
|--------|--------------|---------|-------------------------------|-------|
| **GOLD @ $500** | **+8…+20 bps** (12h persistent) | ~22% (down from ~31%) | **~$3.50** | Only market with sustained `netEdge > 0` |
| **GOLD @ $5k** | **42%** of samples positive; avg **−1.5 bps** | ~22% | entry often **flat/negative** | Size erodes edge; see below |
| **NVDA @ $500** | −35…−52 bps (worse than 06-11) | ~40% (down from ~53%) | ~+$3.5 carry math | `beDays` mostly **>3** now; overnight had ≤3h windows |
| **TSLA** | ~−51 bps | **~10%** | **negative** | Skip |
| **GOOGL** | ~−75 bps | ~50% | ~+$2.4 | Carry only; long hold |

**Phase 1 read:** GOLD **persistent positive edge @ $500** validates “not one-off noise”. NVDA carry was time-limited; do not treat as always-on.

### GOLD at larger size

Monitor quotes **entry only** (USDC → XAUt ExactIn). In the 12h sample:

| Quote `sizeUsd` | Positive `netEntryEdgeBps` | avg net edge | max net edge |
|-----------------|------------------------------|--------------|--------------|
| **$500** | **100%** of samples | **+12.9 bps** | +20.2 bps |
| **$5,000** | **42%** of samples | **−1.5 bps** | +8.3 bps |

**$10k DN** ($5k spot + $5k short) using a **$5k Jupiter quote:** entry is **not reliably positive**. Latest ticks were **−4 to −15 bps** on the $5k leg. Best observed $5k entry: **+$4.15** (+8.3 bps); typical recent: small drag or breakeven.

**Practical implication:** scaling GOLD by quoting the full spot leg at $5k **does not** replicate the $500 edge. Options for size: (a) accept slight entry drag + funding carry on $5k quote, (b) staged/smaller clips if execution allows, (c) wait for $5k quote windows when net edge turns positive (~42% of observations).

### Exit pricing — not in monitor (important)

**No.** Economics above are **entry quote + funding carry only**. We did **not** model:

- Jupiter **sell** quote (XAUt → USDC) at exit
- Decibel **close short** fees / slippage
- Spread at exit vs entry (mean reversion)

Planning budget from doc: **~50–70 bps** round-trip friction on a leg (~**$2.5–3.5** per $500, ~**$25–35** per $5k) **plus** whatever the exit spread is. A **+14 bps entry edge on $500 (~$0.70)** is largely consumed by exit fees unless spread at close is also favorable.

**Before Phase 2:** add exit-side Jupiter quote (ExactIn USDC target or sell XAUt) and Decibel close preview to compute **round-trip net**, not entry-only.

---

## Changelog

| Date | Notes |
|------|-------|
| 2026-06-11 | Initial economics from production monitor; GOLD burst + NVDA carry comparison |
| 2026-06-12 | 12h persistence check; GOLD size sensitivity; exit explicitly out of scope |
