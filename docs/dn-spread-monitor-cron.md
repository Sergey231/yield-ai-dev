## Delta-neutral spread monitor cron

Read-only worker that samples Decibel perp marks vs Solana (Jupiter Swap v1 ExactIn quotes at $500 / $5k) and Aptos (Hyperion execution quotes), logs structured JSON to Vercel runtime logs, and returns a summary JSON response.

### Endpoint

- **Methods:** `GET` (Vercel Cron) or `POST` (manual)
- **Path:** `/api/protocols/decibel/dn-spread-monitor/cron`

### Authentication

| Header | Value |
|--------|--------|
| `x-cron-secret` | `YIELD_AI_CRON_SECRET` |
| `Authorization` | `Bearer <YIELD_AI_CRON_SECRET>` (Vercel Cron default) |

Accepts **either** `YIELD_AI_CRON_SECRET` or `CRON_SECRET` when both are set (Vercel Cron uses `CRON_SECRET` in Bearer auth).

### Schedule (vercel.json)

Every **15 minutes**: `*/15 * * * *`

Separate from `/api/protocols/yield-ai/cron/run` and Hyperion LP cron (no tx lock overlap).

### Logs

Search Vercel logs for `[DN-Monitor]`. Each row is one JSON object with spread/funding fields.

| `kind` | Meaning |
|--------|---------|
| `solana` | Entry: Jupiter **buy** (USDC → spot) vs Decibel mark |
| `solana_exit` | Exit: Jupiter **sell** (spot → USDC) vs Decibel mark — all watchlist items except basis-warning legs (SILVER) |
| `aptos` | Hyperion execution quote vs Decibel mark |

Summary line: `[DN-Monitor] summary` with entry/exit counts, `hold3dFundingBeatsExit`, etc.

### Row fields (funding payback)

| Field | Meaning |
|-------|---------|
| `estimatedDaysToBreakEven` | Calendar days until 24h funding APR on the short leg (`sizeUsd` notional) offsets `estimatedEntryCostUsd`. `null` when entry is already favorable, funding does not pay shorts, or data is missing. Formula: `\|netEntryEdgeBps\| / (fundingApr24hPct × 100 / 365)`. |
| `estimatedEntryCostUsd` | One-time entry drag in USD when `netEntryEdgeBps < 0` (`sizeUsd × \|netEdge\| / 10 000`). |

### Exit rows (`kind: solana_exit`)

| Field | Meaning |
|-------|---------|
| `spotSellPrice` | Effective USD per unit from Jupiter **sell** quote (spot → USDC, ExactIn) |
| `netExitEdgeBps` | `spreadBps - 3.4` (Decibel close taker; Jupiter fees in quote). **Positive = favorable exit** |
| `estimatedExitDragUsd` | USD drag vs mark when `netExitEdgeBps < 0` |
| `favorableExitAfterFees` | `netExitEdgeBps > 0` |

Signals: `netExitEdgePositive` (favorable exit now). **`hold3dFundingBeatsExit`**: 3 calendar days of funding at **7d weighted APR** minus exit drag (entry ignored); lists rows where net &gt; 0.

### Entry row fields (funding payback)

Signals array `breakEvenWithinDays` lists rows with `estimatedDaysToBreakEven ≤ 3`.

### Watchlist

Defined in `src/lib/protocols/decibel/dnSpreadMonitorWatchlist.ts`.

### Manual curl

```bash
curl -s "https://yieldai.app/api/protocols/decibel/dn-spread-monitor/cron" \
  -H "x-cron-secret: $YIELD_AI_CRON_SECRET"
```

### Required env

| Variable | Purpose |
|----------|---------|
| `YIELD_AI_CRON_SECRET` | Cron auth (must match Vercel `CRON_SECRET` if using Bearer auth) |
| `DECIBEL_API_KEY` | Decibel mark prices |
| `DECIBEL_API_BASE_URL` | Mainnet Decibel REST |

| `JUPITER_API_KEY` or `JUP_API_KEY` | Jupiter Swap v1 `/quote` (USDC → spot mint, ExactIn) |

Solana quotes: one request per watchlist item × notional (`$500`, `$5000`), throttled to 8 Jupiter quotes/second. Swap fees are in the quote; net edge subtracts Decibel taker **3.4 bps** per leg (Tier-0 0.034%; optional +10 bps builder when routed via Yield AI).

**Exit quotes:** Jupiter sell for each watchlist token (no SILVER basis-warning legs) × `$500` / `$5000`. Read-only; no trades.

### Economics research

Worked examples (GOLD positive edge vs NVDA carry), formulas, and entry/hold rules: **`docs/dn-spread-economics-research.md`**.

Multi-chain execution architecture (pilot $200, Solana spot + Decibel short): **`docs/dn-multi-chain-architecture.md`** (draft).
