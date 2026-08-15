# Yield AI Public Wallet API — Integration Guide

This document describes the **external read-only HTTP API** for wallet token balances and DeFi positions on **Aptos** and **Solana**. It is intended for third-party applications that need structured JSON without running the Yield AI frontend.

**Version:** `v1`  
**Base path:** `/api/public/v1/wallet/{address}/…`

---

## Quick start

For a full wallet snapshot, make **two requests** per address:

| Purpose | Endpoint |
|---------|----------|
| Wallet tokens (spot balances) | `GET …/balance` |
| DeFi positions (all supported protocols) | `GET …/protocols` |

The server **auto-detects the chain** from the address format (Aptos 64-hex vs Solana base58). Use the same URL shape for both chains.

### Production base URL

```
https://yieldai.app
```

Example (Aptos):

```http
GET https://yieldai.app/api/public/v1/wallet/0x56ff2fc971deecd286314fe99b8ffd6a5e72e62eacdc46ae9b234c5282985f97/balance
x-api-key: YOUR_API_KEY
```

Example (Solana):

```http
GET https://yieldai.app/api/public/v1/wallet/EP9fKzBpQzyZC2GYjjAF9tKEeUwi7dqNqMStmxdYu4h2/protocols
x-api-key: YOUR_API_KEY
```

---

## Authentication

When enabled on the deployment (`PUBLIC_API_REQUIRE_KEY=true`), every request must include a valid API key.

| Method | Example |
|--------|---------|
| Header (recommended) | `x-api-key: YOUR_API_KEY` |
| Query string | `?api_key=YOUR_API_KEY` |

**Responses without a valid key:** `401` with body `{ "error": "unauthorized" }`.

API keys are issued by the Yield AI team. Do not embed keys in client-side/mobile apps; call the API from your backend.

---

## Address rules

| Chain | Format | Normalization |
|-------|--------|---------------|
| **Aptos** | 64 hex characters, optional `0x` prefix | Lowercase, `0x` prefix added if missing |
| **Solana** | Base58, 32–44 characters | Trimmed, case preserved |

Invalid addresses return `400`:

```json
{ "error": "invalid_address", "address": "<provided>" }
```

**Detection order:** Aptos hex is checked first; if it does not match, Solana base58 is tried.

---

## Endpoints

### 1. Wallet balance — `GET /balance`

Returns fungible token balances with USD pricing.

```http
GET /api/public/v1/wallet/{address}/balance
```

#### Response (200)

```json
{
  "address": "0x56ff2fc971deecd286314fe99b8ffd6a5e72e62eacdc46ae9b234c5282985f97",
  "chain": "aptos",
  "timestamp": "2026-06-11T20:00:00.000Z",
  "tokens": [
    {
      "tokenAddress": "0x000000000000000000000000000000000000000000000000000000000000000a",
      "symbol": "APT",
      "name": "Aptos Coin",
      "logoUrl": "https://…",
      "decimals": 8,
      "amount": "12.34567890",
      "priceUSD": 0.65,
      "valueUSD": 8.02
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `chain` | `"aptos"` \| `"solana"` | Detected chain |
| `tokens` | array | Sorted by `valueUSD` descending |
| `tokens[].amount` | string | Human-readable balance (not raw octas/lamports) |
| `tokens[].priceUSD` | number | USD price per token unit |
| `tokens[].valueUSD` | number | `amount × priceUSD` |

**Pricing sources (internal):** Aptos — Panora API with fallback to cached token list; Solana — Jupiter Price API v2.

**Client-side total (wallet only):**

```javascript
const walletUSD = tokens.reduce((sum, t) => sum + (t.valueUSD || 0), 0);
```

---

### 2. DeFi protocols — `GET /protocols`

Aggregates positions across all protocols supported for the detected chain. Each protocol is fetched server-side in parallel.

```http
GET /api/public/v1/wallet/{address}/protocols
```

#### Response (200)

```json
{
  "address": "0x56ff2fc971deecd286314fe99b8ffd6a5e72e62eacdc46ae9b234c5282985f97",
  "chain": "aptos",
  "timestamp": "2026-06-11T20:00:00.000Z",
  "protocolsTotal": 16,
  "protocolsWithPositions": 11,
  "failedProtocols": 0,
  "walletValueUSD": 141.76,
  "totalDeFiValueUSD": 7294.68,
  "totalDeFiValueUSDComplete": true,
  "totalAssetsUSD": 7436.43,
  "totalAssetsUSDComplete": true,
  "protocols": [
    {
      "protocol": "echelon",
      "endpoint": "/api/protocols/echelon/userPositions",
      "success": true,
      "positionsCount": 7,
      "positions": [ "…" ],
      "valueUSD": 598.99,
      "valueUSDComplete": true,
      "status": 200
    },
    {
      "protocol": "decibel",
      "endpoint": "/api/protocols/decibel/userPositions",
      "success": true,
      "positionsCount": 3,
      "positions": [ "…" ],
      "valueUSD": 2682.10,
      "valueUSDComplete": true,
      "status": 200
    },
    {
      "protocol": "yield-ai",
      "endpoint": "/api/protocols/yield-ai/safes",
      "success": true,
      "positionsCount": 4,
      "positions": [ { "safeAddress": "0x…", "valueUSD": 600.30 } ],
      "valueUSD": 2401.21,
      "valueUSDComplete": true,
      "status": 200
    }
  ]
}
```

#### Top-level fields

| Field | Type | Description |
|-------|------|-------------|
| `protocolsTotal` | number | Protocols queried for this chain |
| `protocolsWithPositions` | number | Protocols with `positionsCount > 0` |
| `failedProtocols` | number | Protocols where upstream fetch failed |
| `walletValueUSD` | number | Spot wallet tokens USD (same as the sum of `/balance` `tokens[].valueUSD`) |
| `totalDeFiValueUSD` | number | Sum of all `protocols[].valueUSD` |
| `totalDeFiValueUSDComplete` | boolean | `false` only if a **non-deprecated** protocol with positions has incomplete USD |
| `totalAssetsUSD` | number | `walletValueUSD + totalDeFiValueUSD` — matches the app Sidebar "Total Assets" |
| `totalAssetsUSDComplete` | boolean | Same as `totalDeFiValueUSDComplete` (wallet value is always complete) |

#### Per-protocol fields

| Field | Type | Description |
|-------|------|-------------|
| `protocol` | string | Protocol key (see tables below) |
| `success` | boolean | Upstream route returned HTTP 2xx |
| `positionsCount` | number | Number of positions (Joule uses nested count logic) |
| `positions` | array | Raw position objects from the protocol adapter |
| `valueUSD` | number | Best-effort net USD for this protocol |
| `valueUSDComplete` | boolean | `false` when USD cannot be derived reliably |
| `meta` | object? | Optional upstream metadata (e.g. Kamino timings) |
| `status` | number? | HTTP status from upstream |
| `error` | string? | Present when `success: false` |

#### Supported protocols

**Aptos (16):**

| Protocol key | Position types (typical) | USD |
|--------------|--------------------------|-----|
| `hyperion` | Concentrated LP, farm/fee rewards | Complete |
| `echelon` | Lending supply/borrow + rewards (net) | Complete |
| `tapp` | LP / incentives | Complete |
| `meso` | Lending | Complete |
| `amnis` | Liquid staking | Complete |
| `aave` | Lending (Aave on Aptos) | Complete |
| `moar` | Vaults | Complete |
| `thala` | CLMM LP | Complete |
| `echo` | Lending | Complete |
| `decibel` | Perp equity + vaults + pre-deposit | Complete |
| `aptree` | Deposits | Complete |
| `yield-ai` | AI-agent safes (tokens + Echelon + Hyperion LP per safe) | Complete |
| `aries` | Lending | Deprecated (not priced) |
| `joule` | Lending (multi-position map) | Deprecated (not priced) |
| `auro` | CDP / NFT positions | Deprecated (not priced) |
| `earnium` | Rewards / staking | Deprecated (not priced) |

The `yield-ai` entry aggregates every safe owned by the address; its `positions[]`
are `{ safeAddress, valueUSD }` summaries (one per safe), and `positionsCount` is
the number of safes.

**Solana (6):**

| Protocol key | Position types (typical) | USD |
|--------------|--------------------------|-----|
| `jupiter` | Jupiter Lend | Complete |
| `kamino` | Earn vaults, farms | Complete |
| `meteora` | DLMM concentrated LP | Complete |
| `tramplin` | Native SOL stake + unclaimed winnings | Complete |
| `raydium` | CLMM / LP | Complete |
| `orca` | Whirlpool LP | Complete |

> Solana responses include the same top-level totals as Aptos (`walletValueUSD`,
> `totalDeFiValueUSD`, `totalAssetsUSD` + `*Complete`). `walletValueUSD` equals the
> `SolanaPortfolioService` total (the in-app Solana wallet card). USD figures are as
> accurate as the upstream protocol routes; a transient Jupiter price miss can briefly
> render a position at `$0` (same data the app's protocol cards use).

#### USD completeness (`valueUSDComplete`)

A small set of **deprecated** Aptos protocols are still surfaced (so you can see the
raw positions) but are intentionally **not priced**. For those, `valueUSD` is `0`
and the per-protocol `valueUSDComplete` is `false`:

| Protocol | USD in API today |
|----------|------------------|
| `aries`, `joule`, `auro`, `earnium` (Aptos) | Deprecated — `valueUSD: 0`, parse `positions` yourself if needed |
| Everything else with positions | Complete |

**Headline completeness:** `totalDeFiValueUSDComplete` and `totalAssetsUSDComplete`
**ignore the deprecated protocols above** — they are `true` as long as every actively
priced protocol resolved its USD. If a non-deprecated protocol ever fails to price,
the flag turns `false`; in that case treat `totalDeFiValueUSD` / `totalAssetsUSD` as a
**lower bound**.

**Recommended client logic:**

```javascript
if (!data.totalDeFiValueUSDComplete) {
  // Show partial total; optionally sum known protocols only
  // or derive USD from raw positions for incomplete protocols
}
const defiUSD = data.totalDeFiValueUSD;
```

---

### 3. LP price (Aptos only, auxiliary) — `GET /lp`

Proxies MoneyFi LP price data. The wallet address is validated but **not used** in the upstream query yet.

```http
GET /api/public/v1/wallet/{address}/lp
```

Aptos addresses only. Returns upstream payload plus `address` and `timestamp`.

---

## Combining balance + DeFi (full portfolio)

There is **no single unified endpoint**. Integrators should:

1. `GET …/balance` → sum `tokens[].valueUSD` → **wallet USD**
2. `GET …/protocols` → read `totalDeFiValueUSD` and `totalDeFiValueUSDComplete` → **DeFi USD**
3. **Estimated total** = wallet USD + DeFi USD (mark as partial if `totalDeFiValueUSDComplete === false`)

```javascript
async function fetchPortfolio(baseUrl, address, apiKey) {
  const headers = { 'x-api-key': apiKey, Accept: 'application/json' };

  const [balanceRes, protocolsRes] = await Promise.all([
    fetch(`${baseUrl}/api/public/v1/wallet/${address}/balance`, { headers }),
    fetch(`${baseUrl}/api/public/v1/wallet/${address}/protocols`, { headers }),
  ]);

  if (!balanceRes.ok) throw new Error(`balance: ${balanceRes.status}`);
  if (!protocolsRes.ok) throw new Error(`protocols: ${protocolsRes.status}`);

  const balance = await balanceRes.json();
  const protocols = await protocolsRes.json();

  const walletUSD = balance.tokens.reduce((s, t) => s + (t.valueUSD || 0), 0);

  return {
    address: balance.address,
    chain: balance.chain,
    walletUSD,
    defiUSD: protocols.totalDeFiValueUSD,
    defiUSDComplete: protocols.totalDeFiValueUSDComplete,
    estimatedTotalUSD: walletUSD + protocols.totalDeFiValueUSD,
    tokens: balance.tokens,
    protocols: protocols.protocols,
    fetchedAt: new Date().toISOString(),
  };
}
```

**Latency:** `/protocols` queries many upstream routes in parallel. Expect **~5–30 seconds** depending on chain and position count. Use timeouts ≥ 60s on your side.

**Caching:** Responses include `timestamp`. Consider caching per wallet for 30–60 seconds to avoid hammering the API.

---

## Error responses

| HTTP | Body | Meaning |
|------|------|---------|
| `400` | `{ "error": "invalid_address", "address": "…" }` | Address format not Aptos or Solana |
| `401` | `{ "error": "unauthorized" }` | Missing or invalid API key |
| `500` | `{ "error": "internal_error" }` | Server error |

Individual protocols may fail inside `/protocols` while the overall response is still `200` — check `failedProtocols` and per-item `success`.

---

## Example: cURL

```bash
BASE="https://yieldai.app"
KEY="YOUR_API_KEY"
ADDR="0x56ff2fc971deecd286314fe99b8ffd6a5e72e62eacdc46ae9b234c5282985f97"

curl -s -H "x-api-key: $KEY" \
  "$BASE/api/public/v1/wallet/$ADDR/balance" | jq '{chain, tokenCount: (.tokens|length)}'

curl -s -H "x-api-key: $KEY" \
  "$BASE/api/public/v1/wallet/$ADDR/protocols" | jq '{
    totalDeFiValueUSD,
    totalDeFiValueUSDComplete,
    withPositions: .protocolsWithPositions,
    byProtocol: [.protocols[] | select(.positionsCount>0) | {protocol, valueUSD, valueUSDComplete}]
  }'
```

---

## Position payload shapes (parsing hints)

Schemas vary by protocol. Common patterns:

| Protocol | Useful fields in each position |
|----------|--------------------------------|
| **Echelon** | `coin`, `supply`, `borrow`, `amount`, `type` (`supply` \| `borrow`) — amounts in raw token units |
| **Hyperion** | `value` (USD), `fees.unclaimed[].amountUSD`, `farm.unclaimed[].amountUSD` |
| **Aave** | `deposit_value_usd`, `borrow_value_usd`, `symbol`, `underlying_asset` |
| **Thala** | `totalValueUSD`, `token0` / `token1` with `amount`, `priceUSD`, `valueUSD` |
| **Echo** | `type` (`supply` \| `borrow`), `valueUSD`, `symbol` |
| **Aptree** | `value` (USD), `balance`, `assetName`, `type` |
| **Jupiter (Solana)** | `token.asset.price`, `underlyingAssets`, `shares` |
| **Orca (Solana)** | `valueUsd`, `principalUsd`, `feesUsd`, `tokenA` / `tokenB` |
| **Kamino (Solana)** | `totalUsdValue` / `netUsdAmount` on farm rows; vault fields on earn rows |

For lending protocols marked incomplete, you may need your own price oracle to convert raw `amount` × decimals × price.

---

## Changelog / rollout

| Feature | Status |
|---------|--------|
| Aptos `/balance` | Available |
| Solana `/balance` | Available (same endpoint, auto-detect) |
| Aptos `/protocols` (16 protocols, incl. `yield-ai` safes) | Available |
| Solana `/protocols` (6 protocols, incl. Meteora + Tramplin) | Available |
| `totalDeFiValueUSD` + per-protocol `valueUSD` | Available |
| `walletValueUSD` + `totalAssetsUSD` (+ `*Complete`) top-level | Available |
| Echelon / Decibel / Yield AI safes USD in aggregator | Available — Sidebar parity |
| Aries / Joule / Auro / Earnium USD | Deprecated — positions returned, `valueUSD: 0` |

---

## Support

- **API keys:** contact the Yield AI team.
- **Issues / feature requests:** GitHub repository issues (private integrations — use your agreed channel).

---

## Related internal docs

These describe individual protocol adapters used behind `/protocols` (not part of the public contract):

- [Kamino integration](./kamino-integration.md)
- [Jupiter Lend and Swap](./jupiter-lend-and-swap.md)
- [Orca integration](./orca-integration.md)
