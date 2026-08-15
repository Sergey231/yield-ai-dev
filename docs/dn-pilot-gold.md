# GOLD/USD multi-chain DN pilot ($200)

Off-chain pilot: **$100 Decibel short** (Aptos) + **$100 Jupiter spot** (Solana XAUt). No Yield AI `record_open` — bookkeeping via `[DN-Executor]` logs and explorers.

## Branch

`feat/dn-pilot-gold` (from `main`)

Preview URL: `https://yield-ai-git-feat-dn-pilot-gold-edbiz.vercel.app`

---

## Trade log

### Trade #1 — 2026-06-14 (live, preview API)

**Status:** open (hedged, slight size mismatch)

| Field | Value |
|-------|--------|
| Market | GOLD/USD |
| Safe (reference) | `0x23b329bff0ad2f462c7b212458cc0d1b20019af03766cde48bdc9f9d0a17617d` |
| Decibel subaccount | `0x971eee7f82d2ed4ed9633a2292165c74b354b7932d360a8fc56ed9fa47588fb6` |
| Solana executor | `EZrrqeQHMpXSF2BdsE9QA4wvGPM4gSiXoP8vvWnaGuVD` |
| Open saga (actual) | Decibel short first → Jupiter spot recovery (`spotOnly`) |
| Preflight signal at entry | net edge **+9.6 bps**, funding APR ~10.5% |

#### Leg 1 — Decibel short (Aptos)

| | |
|--|--|
| Tx | [0x8d89347d…](https://explorer.aptoslabs.com/txn/0x8d89347d3f1132c14c5a36d8b0793da3e295638bd3f221b3fa7bfeaa867a16a8) (v5721320744) |
| Size | **−0.0237 oz** GOLD perp |
| Entry | **$4,228.60/oz** |
| Notional | **~$100.22** (margin @ 1×; USDC not spent as spot buy) |
| Gas | ~0.000281 APT |

#### Leg 2 — Jupiter spot buy (Solana)

| | |
|--|--|
| Tx | [3vSZin7o…](https://solscan.io/tx/3vSZin7otAust9XPZSs7BtQjRLsGdqAEXHP9wN4ajuxZyociwQeCPf6GRuLDR3rC339U7FyQjpP683y75pUgaNXK) |
| USDC in | **$99.00** |
| XAUt out | **0.02352 oz** |
| Effective price | **$4,209.18/oz** |
| SOL fee | 0.000105 SOL |
| USDC dust left | $1.00 |

#### Hedge mismatch at entry

| | oz | ~$ @ entry |
|--|-----|------------|
| Short | 0.0237 | $100.22 |
| Spot | 0.02352 | $99.00 |
| Δ | −0.00018 oz (~0.76%) | ~$1.22 |

**Cause:** wallet had exactly $100 USDC; short notional (~$100.22) exceeded available USDC after 1% swap buffer cap.

#### Entry economics (indicative)

- **Entry edge** (Jupiter buy vs Decibel mark): bought spot **~$19/oz cheaper** than short entry → ~**+$0.09–0.13** on ~$100 leg (+9–13 bps).
- **Not immediately profitable if closed:** indicative Jupiter sell of 0.02352 XAUt → ~$98.96 USDC at mark; plus Decibel close taker ~34 bps → **round-trip exit drag ~$0.5–0.7** eats entry edge. Funding not accrued yet (minutes held).
- **Path to profit:** hold for **funding on short** (~10.5% APR on ~$100 notional ≈ **~$0.03/day**) and/or **exit when sell-side spread is favorable** (see Exit monitoring below).

---

## Wallet funding (for new trades)

| Chain | Address | Amount |
|-------|---------|--------|
| Solana executor | `EZrrqeQHMpXSF2BdsE9QA4wvGPM4gSiXoP8vvWnaGuVD` | **~0.05 SOL** + **$100+ USDC** (add buffer for fees/slippage) |
| Decibel subaccount | `0x971eee7f82d2ed4ed9633a2292165c74b354b7932d360a8fc56ed9fa47588fb6` | **~$100 USDC** margin |

Safe is for future on-chain bookkeeping; not required for this pilot.

---

## Recommended open saga (next trades)

**Do not repeat Trade #1 order.** Use **Solana first, Decibel second**:

```
1. Preflight (signal, balances, key, delegation)
2. Jupiter USDC → XAUt on Solana (harder leg; fails if insufficient USDC/liquidity)
3. Size Decibel short from ACTUAL fill:
     orderSizeUsd = (xautOzReceived) × (decibelMarkPx)
   — same economic exposure as spot, not a pre-set $100 target
4. Open Decibel short for that notional (1× cross margin)
```

**Why:** Solana swap is the brittle leg (balance cap, slippage, ATA). Doing it first guarantees known spot size before locking perp notional. Decibel can be sized to match filled XAUt oz × mark.

**Funding:** deposit **$100+ USDC** on Solana (e.g. $101–102) so swap is not capped below short target.

Code change (TODO): invert `runDnPilotOpen` default saga; remove short-first path except `spotOnly` recovery.

---

## Exit monitoring

### What exists today

| Source | Entry | Exit (sell) |
|--------|-------|-------------|
| **DN spread monitor cron** | ✅ buy; `netEntryEdgeBps`, funding | ✅ **GOLD sell** — `kind: solana_exit`, `netExitEdgeBps` |
| **`docs/dn-spread-economics-research.md`** | ✅ formulas | ⚠️ **Planning only** (~34 bps Decibel close + ~15–30 bps Jupiter sell) |
| **Pilot preflight** | ✅ buy-side signal | ❌ no sell quote |
| **Pilot close API** | — | ✅ executes sell + close; **no pre-close edge gate** |

### What to watch before closing Trade #1

Manually (or future monitor row):

1. **Jupiter sell quote** in monitor logs: `[DN-Monitor]` with `kind: solana_exit`, field `favorableExitAfterFees: true`
2. **Funding accumulated** on GOLD short (`unrealized_funding` on position).
3. **Round-trip fee budget** from research doc: ~**50–70 bps** on ~$99 leg ≈ **$0.50–0.70** minimum gross needed to break even on exit.

---

## Env (Vercel / `.env.local`)

| Variable | Purpose |
|----------|---------|
| `DN_SOLANA_EXECUTOR_PRIVATE_KEY` | Base58 secret for Solana executor (Sensitive) |
| `SOLANA_RPC_URL` | Solana RPC |
| `JUPITER_API_KEY` / `JUP_API_KEY` | Jupiter quote + swap |
| `YIELD_AI_EXECUTOR_PRIVATE_KEY` | Aptos executor (Decibel delegated trades) |
| `DECIBEL_API_KEY` | Decibel REST |
| `APTOS_API_KEY` | Aptos fullnode (optional) |
| `YIELD_AI_CRON_SECRET` / `CRON_SECRET` | Pilot API auth |

`SOLANA_PAYER_WALLET_PRIVATE_KEY` is **unrelated** to the DN pilot leg.

Optional overrides: `DN_PILOT_*` — see `pilotConfig.ts`.

---

## Preview API

| Endpoint | Method | Body |
|----------|--------|------|
| `/api/protocols/decibel/dn-pilot/preflight` | GET/POST | — |
| `/api/protocols/decibel/dn-pilot/open` | POST | `{}` dry-run; `{ "live": true }` live; `{ "live": true, "spotOnly": true }` recovery |
| `/api/protocols/decibel/dn-pilot/close` | POST | `{}` dry-run; `{ "live": true }` live |

Auth: `x-cron-secret` or `Authorization: Bearer <YIELD_AI_CRON_SECRET|CRON_SECRET>`.

---

## Close flow (current code)

1. Jupiter sell all XAUt → USDC on Solana
2. Decibel reduce-only close on GOLD/USD

---

## Code layout

- `src/lib/protocols/decibel/dnMultiChain/` — shared legs + `pilotRunner.ts`
- `src/app/api/protocols/decibel/dn-pilot/` — preview API
- `scripts/dn-pilot-*.mts` — optional CLI

## Related docs

- `docs/dn-spread-economics-research.md` — entry/exit fee budgets, GOLD case study
- `docs/dn-multi-chain-architecture.md` — phased rollout
- `docs/backlog.md` — DN Phase 1–4
