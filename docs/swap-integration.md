# Swap integration (Aptos + Solana)

Yield AI supports token swaps from **Tools → Swap** (`SwapModal`) and from **Swap & Deposit** flows (drag token → protocol). Both chains use different aggregators:

| Chain | Aggregator | Gas model in app |
|-------|------------|------------------|
| **Aptos** | [Panora](https://docs.panora.exchange/developer/swap) | Gasless for users (Aptos Gas Station / fee payer) |
| **Solana** | [Jupiter Swap API](https://dev.jup.ag/docs/swap-api/) | Configurable: gasless (server fee payer) or user-paid SOL |

Official docs:

- Panora Swap overview: [docs.panora.exchange/developer/swap](https://docs.panora.exchange/developer/swap)
- Panora HTTP API: [docs.panora.exchange/developer/swap/api](https://docs.panora.exchange/developer/swap/api)
- Panora TypeScript SDK (`@panoraexchange/swap-sdk`): [docs.panora.exchange/developer/swap/sdk](https://docs.panora.exchange/developer/swap/sdk)
- Jupiter Swap API (v2): [dev.jup.ag/docs/swap-api](https://dev.jup.ag/docs/swap-api/)
- Jupiter legacy v1 quote/swap (user pays gas): [dev.jup.ag/docs/swap-api/get-quote](https://dev.jup.ag/docs/swap-api/get-quote) (Metis `/swap/v1/*`)

For Jupiter **Lend** (Earn/Borrow) — separate from the Swap modal — see [jupiter-lend-and-swap.md](./jupiter-lend-and-swap.md).

---

## High-level flow

```
User opens SwapModal
        │
        ├─ Aptos tab ──► POST /api/panora/swap-quote
        │                      │
        │                      ▼
        │               Panora SwapQuote (SDK → api.panora.exchange)
        │                      │
        │                      ▼
        │               POST /api/panora/execute-swap  (extract transactionPayload)
        │                      │
        │                      ▼
        │               wallet.signAndSubmitTransaction (Gas Station)
        │
        └─ Solana tab ──► NEXT_PUBLIC_GASLESS_SWAP ?
                              │
                    yes ──────┴────── no
                     │                │
                     ▼                ▼
              Jupiter v2 build   Jupiter v1 quote
              (fee payer)        (user pays SOL)
                     │                │
                     ▼                ▼
              sign + /execute    /swap/v1/swap → sign → sendRaw
```

**Wallet gate:** Swap requires a connected wallet for the active chain. Without a wallet the modal shows a **«Подключите кошелек»** overlay and blocks quotes/execution (`src/components/ui/swap-modal.tsx`).

---

## Aptos — Panora

### What we use

- NPM package: `@panoraexchange/swap-sdk`
- Service: `src/lib/services/panora/swap.ts` (`PanoraSwapService`)
- Quote returns a ready-to-sign **`transactionPayload`** (`function`, `type_arguments`, `arguments`) inside `quotes[0]`.

Panora is a meta-DEX aggregator on Aptos (multi-hop routing across AMMs / CLAMMs / CLOBs). We request **ExactIn** quotes: human-readable `fromTokenAmount`, slippage in percent, `getTransactionData: "transactionPayload"`.

### App API routes

| Route | Role |
|-------|------|
| `POST /api/panora/swap-quote` | Proxy quote; body mirrors Panora API fields (`chainId`, `fromTokenAddress`, `toTokenAddress`, `fromTokenAmount`, `toWalletAddress`, `slippagePercentage`, …) |
| `POST /api/panora/execute-swap` | Extract `transactionPayload` from quote JSON (no re-quote on chain) |
| `POST /api/panora/swap` | Legacy/alternate swap entry (see route if used) |
| `GET /api/panora/tokenList` | Token list for UI / cache |
| `GET /api/panora/prices`, `tokenPrices` | USD prices |

Unified swap helper (Panora + Hyperion): `POST /api/swap/quote`, `POST /api/swap/execute` with `provider: "panora"`.

### Client flow (`SwapModal`, Aptos)

1. **Quote** — `POST /api/panora/swap-quote` with wallet address and token FA addresses from the cached token list ([panora-token-list.md](./panora-token-list.md)).
2. **Execute** — `POST /api/panora/execute-swap` with quote JSON + `walletAddress`.
3. **Submit** — `signAndSubmitTransaction` / native WebView bridge (`submitAptosTransaction`). Gas is covered by **Gas Station** where configured (users do not need APT for gas on standard swaps).

### Integrator fee

Optional Panora integrator fee comes from protocol config (`getProtocolByName("Panora").panoraConfig`: `integratorFeeAddress`, `integratorFeePercentage`). Passed into the SDK quote request.

### Environment

| Variable | Purpose |
|----------|---------|
| `PANORA_API_KEY` | Panora API key (server + token list script) |
| `PANORA_API_URL` | Override base URL (default `https://api.panora.exchange`) |
| `APTOS_RPC_URL` | RPC for SDK initialization |

### Swap & Deposit

`SwapAndDepositStatusModal` uses the same Panora path: `swap-quote` → `execute-swap` → sign → deposit tx (`src/components/ui/swap-and-deposit-status-modal.tsx`).

---

## Solana — Jupiter Swap API v2 (and v1 fallback)

Controlled by **`NEXT_PUBLIC_GASLESS_SWAP`** (`"1"` / `"true"` → gasless; otherwise user pays SOL).

Shared server helpers: `src/app/api/jupiter/_lib.ts`.

### Mode A — Gasless (Jupiter Swap **v2**)

Uses [Ultra / Swap API v2 `build`](https://dev.jup.ag/docs/swap-api/build-swap-transaction) with a server **fee payer** (`payer` query param).

| Step | App route | Upstream |
|------|-----------|----------|
| 1. Quote (preview) | `POST /api/jupiter/quote` | `GET {JUPITER_SWAP_API_BASE}/build?...` (default `https://api.jup.ag/swap/v2/build`) |
| 2. Build tx | `POST /api/jupiter/build` | Same v2 `/build` + assemble v0 transaction, fee payer as first signer slot |
| 3. User sign | Client (`signTransaction`) | — |
| 4. Broadcast | `POST /api/jupiter/execute` | Server adds fee-payer signature + sends |

Optional **platform fee**: `JUPITER_PLATFORM_FEE_BPS` + `JUPITER_FEE_OWNER` (fee ATA on output mint). UI reads `GET /api/jupiter/config`.

### Mode B — User pays gas (Jupiter Swap **v1** / Metis)

| Step | App route | Upstream |
|------|-----------|----------|
| 1. Quote | `POST /api/jupiter/quoteV1` | `GET https://api.jup.ag/swap/v1/quote` |
| 2. Swap tx | `POST /api/jupiter/swapTx` | `POST https://api.jup.ag/swap/v1/swap` → `swapTransaction` base64 |
| 3. Sign + send | Client | `Connection.sendRawTransaction` or native WebView bridge |

### Environment (Solana swap)

| Variable | Purpose |
|----------|---------|
| `JUPITER_API_KEY` / `JUP_API_KEY` | `x-api-key` for Jupiter APIs |
| `JUPITER_SWAP_API_BASE` | v2 base URL (default `https://api.jup.ag/swap/v2`) |
| `NEXT_PUBLIC_GASLESS_SWAP` | Toggle gasless vs user-paid |
| `SOLANA_PAYER_WALLET_PRIVATE_KEY` | Fee payer keypair (gasless only) |
| `SOLANA_PAYER_WALLET_ADDRESS` | Optional sanity check vs derived pubkey |
| `JUPITER_PLATFORM_FEE_BPS`, `JUPITER_FEE_OWNER` | Optional platform fee (gasless) |
| `SOLANA_RPC_URL`, `SOLANA_RPC_API_KEY` | RPC for build/send/confirm |

---

## Key source files

| Area | Path |
|------|------|
| Swap UI | `src/components/ui/swap-modal.tsx` |
| Panora service | `src/lib/services/panora/swap.ts` |
| Panora routes | `src/app/api/panora/swap-quote/route.ts`, `execute-swap/route.ts` |
| Jupiter routes | `src/app/api/jupiter/quote/route.ts`, `quoteV1/route.ts`, `build/route.ts`, `execute/route.ts`, `swapTx/route.ts`, `_lib.ts` |
| Swap & Deposit | `src/components/ui/swap-and-deposit-status-modal.tsx` |
| Token list cache | `src/lib/data/tokenList.json` — see [panora-token-list.md](./panora-token-list.md) |

---

## Publishing to `yield-ai-docs`

Same as other files under `docs/`: run `pnpm publish:docs:dev` to copy into `../yield-ai-docs/docs/dev/frontend/`.
