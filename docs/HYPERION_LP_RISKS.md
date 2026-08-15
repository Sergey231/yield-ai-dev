# Hyperion LP — risk acknowledgment (pre-open)

Draft checklist shown before a user opens their **first** Hyperion CLMM LP
position. Purpose now: a simple, explicit "do you understand the risks" gate.
Purpose later: the seed of a structured doc that the AI agent reads/quotes when
talking to the user about LP decisions.

## Why a gate
Concentrated-liquidity LP is **not** a stablecoin deposit. A user moving from
"AI agent auto-compounds my USDC" to "I provide WBTC/USDC liquidity in a range"
takes on materially different risks. We want an explicit, one-time acknowledgment
(per safe) before the first open.

## Risks to acknowledge (checklist)
The user must confirm each before the first open:

1. **Impermanent loss / divergence loss.** As the price moves, the position is
   rebalanced into more of the falling asset. On withdrawal the USD value can be
   **less** than if I had simply held the two tokens — and can be less than the
   USDC I deposited.
2. **The position stops earning when out of range.** If the price leaves my
   chosen range, the position earns **no fees** until it comes back or is
   re-centered. A narrow range earns more while in range but leaves it sooner.
3. **Value in USDC can drop.** The position's value measured in USDC can fall
   below what I deposited — from price moves, divergence loss, and fees not
   covering the gap. This is not a fixed-yield product; principal is at risk.
4. **Not a stablecoin strategy.** WBTC/APT legs are volatile. My returns depend
   on price action, time in range, and pool fees/rewards — none guaranteed.
5. **Fees/rewards are variable.** Displayed APR is the pool's recent rate, not a
   promise; it changes with volume, TVL, and the reward program.

## Proposed UX (MVP)
- On the first "Open LP position" for a safe (no prior LP position + no stored
  ack), show a modal: the 5 points above as checkboxes + a single "I understand
  and accept these risks" confirm.
- Persist acknowledgment per safe (localStorage key `yield-ai:hyperionRiskAck:<safe>`
  for MVP; later an on-chain `strategy_registry` extra so it's portable/auditable).
- Re-show only if never acknowledged for that safe.

## Roadmap → AI-agent comms doc
This file evolves into the canonical "what the agent tells the user about LP"
document: risk language, when the agent re-centers, when it claims, how it
decides ranges. The agent can quote/link sections here so user-facing
explanations stay consistent with the on-chain behavior.

> Status: draft. UI gate not yet implemented — pending product sign-off on the
> exact wording and where to persist the acknowledgment.
