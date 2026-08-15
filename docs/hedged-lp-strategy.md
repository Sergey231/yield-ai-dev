# Hedged LP — Hyperion LP + Decibel short (strategy spec)

**Status:** spec / **NOT BUILT**. Net-new strategy that combines two existing agent types:
[`hyperion_lp`](./HYPERION_LP_FRONTEND.md) (the yield leg) + [`decibel_delta_neutral`](./strategy-registry-and-dn-v2.md)
(the hedge leg). This doc is canonical for the **product intent** of the hedged-LP strategy. It is
**not** canonical for live numbers (see the monitor) or accounting (see DN V2).

**This is not the same as** the stable/stable LP ([HYPERION_LP_FRONTEND](./HYPERION_LP_FRONTEND.md),
follow-ups in [backlog](./backlog.md)): that is delta-neutral *by construction* and needs **no perp
hedge**. Hedged LP is for a **volatile** pool (BTC/USDC, APT/USDC) where a Decibel short supplies the hedge.

> **Numbers below are dated examples, not facts.** Funding/borrow/spread change at runtime — confirm
> live values via [dn-spread-monitor-cron](./dn-spread-monitor-cron.md) (`peek-dn-monitor.mjs`,
> markets `BTC/USD` / `APT/USD`) and protocol APIs before any entry.

---

## 1. What it is

The user provides a Hyperion concentrated-liquidity position in a **volatile** pool and the agent holds
a **Decibel short** against it. Income is **LP fees + perp funding**; the short removes (or tilts) the
price exposure of the LP.

In one user-facing sentence:

> **"Earn Hyperion trading fees with the price risk hedged away — a bet on sideways/down. Deposit, and
> the agent keeps the LP range and the hedge balanced for you."**

It is **not** a bet on the asset rising. A sustained rally is the worst case (see §5).

---

## 2. Why it fits the primary goal

Evaluated through the project goal (grow Yield AI TVL + clear user value; Decibel volume is a bonus):

| Goal criterion | How hedged LP serves it |
|----------------|--------------------------|
| **Grows Yield AI TVL** | The LP position **is** TVL; the short adds Decibel margin/OI |
| **Clear user value** | "fees + funding, hedged; bet on sideways/down" — one sentence, one risk dial |
| **Needs the agent (moat)** | range re-center + **dynamic hedge as LP delta drifts** + harvest + deleverage — cannot be done by hand |
| **Decibel trades** | the short is the volume (bonus, not the reason) |

---

## 3. Mechanics — short-gamma LP + hedge

A concentrated LP in a volatile pool has a **delta that moves with price** (short gamma). A static short
does not track it, so net exposure drifts:

| Price vs range | LP delta (normalized) | + short (x1) | Net delta | Behavior |
|----------------|------------------------|--------------|-----------|----------|
| center | ~+0.5 | −1 | **−0.5** | mild short |
| → bottom of range | → +1 (all base asset) | −1 | **~0** | neutral; short protected on the way down |
| → top of range | → 0 (all USDC) | −1 | **−1** | full short, no LP cushion ← pain |

So the position **gets more short as price rises** and **more neutral as price falls**. That is exactly
why it behaves as a **sideways/down** bet, and why an LP cushion on a rally is **temporary** — once
price exits the range the LP is all-USDC (earns nothing) while the short bleeds linearly.

---

## 4. The hedge dial (core product knob)

`short notional` is a **dial**, not a fixed value. This is the user-facing "your view on the asset":

| Dial position | `short` size | Net stance | Preset name |
|---------------|--------------|------------|-------------|
| **Neutral** | = current LP delta (dynamic) | ~0, pure yield | "Income" |
| **Bearish** | = x1 full notional | net short, profits on down | "Sideways / Bearish" |
| **Long** | = 0 | leveraged long LP | "Bullish LP" (no hedge) |

LP fees + funding accrue at **every** dial position; the dial only sets the **price view**. `x1` is a
sensible default preset; the product is stronger if the hedge is an adjustable dial than a fixed 1×.

---

## 5. Income, costs, risks

**Income streams**
- LP fees (maximized in range / sideways)
- Perp funding — short earns it when funding is **positive** (the usual BTC/APT regime); confirm live
- Net-short P&L on downward moves (when dialed bearish)

**Costs**
- Impermanent / divergence loss — see [HYPERION_LP_RISKS](./HYPERION_LP_RISKS.md)
- Decibel taker fees on open/close + rebalance; Hyperion swap on re-center
- Borrow cost, only if the short margin is funded by borrowing (see §7 capital source)

**Risks (state honestly to the user)**
1. **Rally out of range** — net short with no LP cushion; the main loss. Mitigation: widen/shift range up, trim short.
2. **Impermanent loss** — narrow range = more fees but exits range sooner.
3. **Funding flip** — short starts paying → one income stream turns negative.
4. **Cross-platform margin** — LP/collateral and Decibel margin are separate; a pump erodes Decibel margin while LP value sits elsewhere. Agent must shuttle margin. (Same hazard documented for DN generally.)

User-facing risk copy should extend the existing LP acknowledgment in
[HYPERION_LP_RISKS](./HYPERION_LP_RISKS.md), not duplicate it.

---

## 6. Automation behavior (the moat)

What the agent does that a manual user cannot:

- **Re-center** the LP range when price approaches an edge (reuse `hyperion_lp` recenter cron).
- **Dynamic hedge:** as LP delta drifts, adjust the short toward the chosen dial target (within
  max-drift / max-execution-loss limits). Reuse DN slice actions in
  [ai-agent-strategies](./ai-agent-strategies.md#delta-neutral-slice-actions).
- **Harvest** fees/funding on threshold.
- **Deleverage / margin top-up** when Decibel margin health falls (especially on a rally).

Reuse existing guardrails: per-slice notional, max slippage/loss, cooldowns, event-based PnL. Do **not**
build a separate accounting model — extend the DN V2 / LP event ledger.

---

## 7. Open questions (resolve before building)

1. **Pool:** BTC/USDC or APT/USDC? (BTC: higher/clearer funding; APT: cheaper borrow. Both have Decibel perps. Hyperion WBTC/USDC is live; APT/USDC is registry-only per [HYPERION_LP_FRONTEND](./HYPERION_LP_FRONTEND.md).)
2. **Capital source:** user deposits USDC (agent builds both legs) **or** user already holds the asset (short only, margin funded by a small borrow — cheaper, no spot swap). The "already holds" path is **undocumented** elsewhere and is a real capital-efficiency win.
3. **Range width** + re-center rule (narrow = fee income + frequent swaps vs wide = less IL stress).
4. **Hedge dial presets:** confirm the 2–3 to ship (Income / Sideways-Bearish / Bullish-LP).
5. **Live funding for BTC/APT:** pull from the monitor and record a dated baseline here (do not hardcode).
6. **Margin shuttle mechanics:** how the agent moves value between LP/collateral and Decibel margin on a pump.

---

## 8. Relationship to existing docs

- Yield leg feature + automation: [HYPERION_LP_FRONTEND](./HYPERION_LP_FRONTEND.md)
- Hedge leg on-chain records: [strategy-registry-and-dn-v2](./strategy-registry-and-dn-v2.md)
- Economics / break-even / funding-as-main-driver: [dn-spread-economics-research](./dn-spread-economics-research.md)
- Live signal: [dn-spread-monitor-cron](./dn-spread-monitor-cron.md)
- User risk copy: [HYPERION_LP_RISKS](./HYPERION_LP_RISKS.md)
- Product umbrella (Safe + tags + slice actions): [ai-agent-strategies](./ai-agent-strategies.md)
