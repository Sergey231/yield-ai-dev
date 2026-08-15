# Jupiter Lend (Earn / Borrow) and Jupiter Swap on Solana

Jupiter in Yield AI is **Solana-only**. There is no Aptos entry-function path for Jupiter; deposits and swaps use **Jupiter HTTP APIs** plus **RPC**, and the client signs Solana transactions (sometimes with a **server fee payer** for gasless swap).

## Jupiter Lend — Earn (supply / pools list)

### User positions

- **Route:** `GET /api/protocols/jupiter/userPositions?address=<solana_wallet>`
- **Upstream:** Jupiter Lend Earn positions API (parallel fetch):
  - `https://api.jup.ag/lend/v1/earn/positions?users=<address>` (optional `x-api-key`)
  - `https://lite-api.jup.ag/lend/v1/earn/positions?users=<address>`
- **API key:** Read from `JUP_API_KEY`, `NEXT_PUBLIC_JUP_API_KEY`, or `JUPITER_API_KEY` (same precedence as in `userPositions/route.ts`). Sending the key to both official and lite endpoints often improves completeness.
- **Source selection:** If one response has more **meaningful** rows (`shares` or `underlyingAssets` > 0), that source wins; otherwise falls back to official then lite.
- **Enrichment:** Fetches `/lend/v1/earn/tokens` (official + lite), merges catalogs, reads wallet SPL balances via RPC, and can **backfill** positions when the API shows scaffold/zero-share rows but the wallet holds **jl\*** receipt tokens, or **append** synthetic rows from catalog + wallet — see `jupiterEarnPositionsEnrichment` and `meta.note` in the route.

### Pools (Ideas / dashboard)

- **Route:** `GET /api/protocols/jupiter/pools`
- **Upstream:** `https://lite-api.jup.ag/lend/v1/earn/tokens`
- Maps each pool to `InvestmentData` (APY from `totalRate` in bps, TVL from `totalAssets` × price). WSOL is displayed as **SOL**.

### Deposit and withdraw (Earn)

- **Routes:**  
  - `POST /api/protocols/jupiter/deposit`  
  - `POST /api/protocols/jupiter/withdraw`
- **Body (typical):** `asset` (mint), `signer` (user pubkey), `amount` (string, base units or format expected by upstream), optional `preferLegacyInstruction`.
- **Upstream instruction APIs:**  
  - Deposit: `POST https://lite-api.jup.ag/lend/v1/earn/deposit-instructions`  
  - Withdraw: `POST https://lite-api.jup.ag/lend/v1/earn/withdraw-instructions`  
- The server assembles a **legacy `Transaction`**, sets blockhash, returns **base64** for the user to sign; client sends via `/api/solana/sendRaw` (see `deposit-button.tsx` for the Jupiter flow).
- **Token-2022:** Mints like **USDG** use associated token program resolution appropriate for Token-2022 in the route implementation.

### Frontend (Earn)

- **Hooks:** `useJupiterPositions` → `userPositions` API.  
- **Mapping:** `mapJupiterToProtocolPositions` — APY from `token.totalRate` (bps → percent), value from `underlyingAssets` × price.  
- **Modals:** `JupiterDepositModal` + `deposit-button` when protocol is **Jupiter**.

## Jupiter Lend — Borrow (read path)

- **Route:** `GET /api/protocols/jupiter/borrow?address=<solana_wallet>`
- **Data sources:**
  1. **Vault module (NFT-style positions):** `@jup-ag/lend-read` `Client` → `client.vault.getAllUserPositions(user)` over Solana `Connection` (with RPC fallback across endpoints on failure).
  2. **Liquidity module (reserve borrows):** `Liquidity` from `@jup-ag/lend-read` → `listedTokens()` + `getUserMultipleBorrowData`, with **mint** attached by index to each row.
- **Optional:** `https://api.jup.ag/portfolio/v1/positions/<address>` with `x-api-key` when the key is set (enrichment / token info); if the key is missing, that path is skipped.
- **Caching:** Short in-memory cache (~120s) for the full JSON response to reduce RPC burst (see route).
- **UI:** `useJupiterBorrow` + `JupiterPositions` / `PositionsList` — supply from `userPositions`, borrow from `borrow` API, shown as **pairs** with health / APR when available.

## Jupiter Swap (Swap modal — Solana chain)

> **See also:** [swap-integration.md](./swap-integration.md) — end-to-end Swap modal flow for **both** Aptos (Panora) and Solana (Jupiter), with official doc links.

Controlled by **`NEXT_PUBLIC_GASLESS_SWAP`**: when `"1"` or `"true"`, the app uses the **gasless** path; otherwise the **user pays** SOL for fees.

### Quote

| Mode | Client calls | Notes |
|------|----------------|-------|
| Gasless | `POST /api/jupiter/quote` | Proxies Jupiter **Swap API v2** `GET .../build` with `taker`, optional platform fee (`JUPITER_PLATFORM_FEE_BPS`, `JUPITER_FEE_OWNER`), requires server **fee payer** env for execute |
| User pays gas | `POST /api/jupiter/quoteV1` | Proxies `GET https://api.jup.ag/swap/v1/quote` → returns a **quoteResponse** for v1 swap |

Shared helpers: `src/app/api/jupiter/_lib.ts` (`getJupiterApiKey`, `getJupiterSwapBaseUrl`, `getSolanaPayerKeypair`, etc.).

### Execute swap

| Mode | Steps |
|------|--------|
| **Gasless** | 1) `POST /api/jupiter/build` — builds unsigned v0 tx (Swap v2 `/build` + fee payer from `SOLANA_PAYER_WALLET_PRIVATE_KEY`). 2) User signs with Solana wallet. 3) `POST /api/jupiter/execute` — server adds **fee payer** signature and broadcasts. |
| **User pays** | 1) `POST /api/jupiter/swapTx` — calls `POST https://api.jup.ag/swap/v1/swap` with `quoteResponse` → `swapTransaction` base64. 2) User signs. 3) Client `sendRawTransaction` via local `Connection` (no execute route). |

**Platform fee (gasless path):** `JUPITER_PLATFORM_FEE_BPS` (default in code treats missing as small bps); **fee account** is the fee owner’s ATA for **output** mint. Requires `JUPITER_FEE_OWNER` when fees are enabled.

**Server secrets (gasless only):**

- `SOLANA_PAYER_WALLET_PRIVATE_KEY` (and optional `SOLANA_PAYER_WALLET_ADDRESS` sanity check) — fee payer / gas station SOL  
- `JUPITER_FEE_OWNER` — recipient owner for platform fee ATA  

Implementation reference: `src/components/ui/swap-modal.tsx` (`getQuote` / `executeSwap` for `chainSelection !== "aptos"`).

### Config endpoint

- `GET /api/jupiter/config` — exposes `platformFeeBps` for client UI.

## Related environment variables (summary)

| Variable | Used for |
|----------|-----------|
| `JUP_API_KEY` / `NEXT_PUBLIC_JUP_API_KEY` / `JUPITER_API_KEY` | Lend positions API, Jupiter Swap API `x-api-key` |
| `JUPITER_SWAP_API_BASE` | Override Swap v2 base (default `https://api.jup.ag/swap/v2`) |
| `NEXT_PUBLIC_GASLESS_SWAP` | Toggle gasless vs user-paid Solana swap |
| `SOLANA_RPC_URL` / `NEXT_PUBLIC_SOLANA_RPC_URL`, `SOLANA_RPC_API_KEY` | RPC for reads, sends, lend-read, enrichment |
| `SOLANA_PAYER_WALLET_PRIVATE_KEY` | Gasless swap fee payer |
| `JUPITER_PLATFORM_FEE_BPS`, `JUPITER_FEE_OWNER` | Optional platform fee on gasless swap |

## Key source files

| Area | Path |
|------|------|
| Lend positions | `src/app/api/protocols/jupiter/userPositions/route.ts` |
| Earn enrichment | `src/lib/services/solana/jupiterEarnPositionsEnrichment.ts` |
| Pools | `src/app/api/protocols/jupiter/pools/route.ts` |
| Deposit / withdraw | `src/app/api/protocols/jupiter/deposit/route.ts`, `withdraw/route.ts` |
| Borrow | `src/app/api/protocols/jupiter/borrow/route.ts` |
| Hooks | `src/lib/query/hooks/protocols/jupiter/useJupiterPositions.ts`, `useJupiterBorrow.ts`, `useJupiterPools.ts` |
| Position mapping | `src/components/protocols/jupiter/mapJupiterToProtocolPositions.ts` |
| Swap API | `src/app/api/jupiter/quote/route.ts`, `quoteV1/route.ts`, `swapTx/route.ts`, `build/route.ts`, `execute/route.ts`, `_lib.ts` |
| Swap UI | `src/components/ui/swap-modal.tsx` |
| Jupiter deposit UX | `src/components/ui/deposit-button.tsx`, `jupiter-deposit-modal.tsx` |

## Publishing to `yield-ai-docs`

Same as other files under `docs/`: run `pnpm publish:docs:dev` to copy into `../yield-ai-docs/docs/dev/frontend/`.
