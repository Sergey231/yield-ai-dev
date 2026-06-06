# Kamino integration (Yield AI)

Kamino in this app is a **Solana** integration. The Aptos `BaseProtocol` path is intentionally **not** used: `KaminoProtocol.buildDeposit` throws, and the UI uses **server-built Solana transactions** + **wallet signing** + **`/api/solana/sendRaw`**.

## Scope in the product

- **Lend (KLend)**: user **obligations** per lending market (supply / borrow), enriched with reserve metadata and USD pricing.
- **Earn (KVaults)**: user **kvault** positions, APR / exchange rate, deposit and withdraw via SDK-built transactions.
- **Farms rewards**: **pending** farm rewards (read-only aggregation for UI), priced via Jupiter where possible.
- **Discovery**: Kamino **vault pools** for the investment dashboard (TVL / APY filter), not user-specific.

## External APIs and on-chain

- **Kamino HTTP API** (base: `https://api.kamino.finance`):
  - Markets: `GET /v2/kamino-market`
  - Per-user obligations: `GET /kamino-market/{lendingMarket}/users/{address}/obligations?env=mainnet-beta`
  - Reserve metrics: `GET /kamino-market/{lendingMarket}/reserves/metrics?env=mainnet-beta`
  - KVault user positions: `GET /kvaults/users/{address}/positions`
  - KVault catalog: `GET /kvaults/vaults`
- **Solana RPC** (read + send): resolved by `getSafeSolanaRpcEndpoint()` in `src/lib/solana/solanaRpcEndpoint.ts` — prefers `NEXT_PUBLIC_SOLANA_RPC_URL` / `SOLANA_RPC_URL`, can append Helius `api-key` from env, otherwise falls back to public mainnet beta.
- **Farms SDK** (`@kamino-finance/farms-sdk`): lists farms for the user and reads `FarmState` for pending rewards.
- **KLend SDK** (`@kamino-finance/klend-sdk`): `KaminoVault` is used **server-side** to construct deposit/withdraw instruction bundles and to load the vault’s **address lookup table** for v0 transactions.

## Server routes (Next.js App Router)

| Method | Path | Role |
|--------|------|------|
| `GET` | `/api/protocols/kamino/userPositions?address=<solana>` | Lend + Earn (+ internal farm rows); merging, caching, pricing |
| `GET` | `/api/protocols/kamino/rewards?address=<solana>` | Pending farm rewards (no claim) |
| `GET` | `/api/protocols/kamino/pools` | Pool list for dashboard (Kamino vaults, TVL/APY gating) |
| `POST` | `/api/protocols/kamino/deposit` | Build **unsigned** KLend vault deposit tx (base64) |
| `POST` | `/api/protocols/kamino/earnTx` | Build **unsigned** KVault deposit or withdraw tx (`mode`: `deposit` \| `withdraw`) |

The public wallet API also maps Kamino: `src/app/api/public/v1/wallet/[address]/protocols/route.ts` → `/api/protocols/kamino/userPositions`.

## `userPositions`: data flow

1. **Validate** `address` as a Solana pubkey (`isLikelySolanaAddress`).
2. **Lend leg** (per markets from `/v2/kamino-market`):
   - Fetch **reserve metrics** per market (concurrent, capped).
   - For each market, fetch **user obligations** from Kamino.
   - Map reserve pubkeys → **mint, symbol, logo**, and **USD price** (Jupiter token search + hardcoded stable mints).
   - **Slim** each obligation for the client: deposits/borrows line items, USD scaling to align with Kamino refreshed totals where needed, health / borrow limit fields.
3. **Earn leg**:
   - `GET /kvaults/users/.../positions`, filter non-zero balances, merge **vault catalog** metadata.
   - Pull **vault metrics** (APR, exchange rate); if exchange rate is missing, **RPC fallback** via SDK.
   - Price underlying tokens (Jupiter + stables ≈ 1).
4. **Resilience**: `fetchWithRetry` on 429/502/503/504; in-memory **SWR**-style cache for user payloads; longer TTL for market and vault catalog; optional query param to refresh server-side caches (see `userPositions` route).

**Row `source` values** the UI uses: `kamino-lend`, `kamino-earn`. Rows with `kamino-farm` are filtered out in `mapKaminoToProtocolPositions` (treated as internal / rewards noise).

## Rewards

`GET /api/protocols/kamino/rewards`:

- `Farms.getAllFarmsForUser` + `FarmState.fetchMultiple`
- Aggregates `pendingRewards` by **reward token mint**, converts to UI amount using token decimals from `rewardInfos`
- USD: Jupiter token search; **stable mints** can be forced to **$1** for consistent UI when price lookup is flaky

## Transaction building (unsigned on server, sign on client)

**Pattern:** the server returns `data.transaction` as **base64** of a **VersionedTransaction** (v0 + **ALT** from the vault). The client **signs** with the Solana wallet adapter, then POSTs to `/api/solana/sendRaw`.

- **KLend vault deposit (pools flow)** — `deposit-button.tsx` → `POST /api/protocols/kamino/deposit`  
  - `buildKaminoVaultDepositTransactionBase64` in `src/lib/solana/kaminoTxServer.ts` uses `vault.depositIxs` + optional farm stake instructions, compiles with the lookup table from `vault.getState()`.
- **KVault Earn deposit / withdraw** — `KaminoPositions.tsx` → `POST /api/protocols/kamino/earnTx`  
  - Same pattern: `vaultAddress`, `signer`, `amountUi`, `mode`.

The server does not hold private keys: `createAddressOnlySigner` throws if signing is attempted on the server path.

## Frontend

- **React Query**: `useKaminoPositions`, `useKaminoRewards`, `useKaminoPools` — `src/lib/query/hooks/protocols/kamino/*`.
- **Mapping to generic protocol cards**: `src/components/protocols/kamino/mapKaminoToProtocolPositions.ts` — net USD for lend ≈ sum supply USD − sum borrow USD from line items (header avoids relying only on `refreshedStats.netAccountValue` where it diverges from rendered rows).
- **Testing**: `NEXT_PUBLIC_KAMINO_REWARDS_MOCK` and query `?kaminoAddress=` / `?address=` can override which Solana address is queried for positions/rewards in some components.

## Environment variables (relevant)

- `NEXT_PUBLIC_SOLANA_RPC_URL` or `SOLANA_RPC_URL`
- `NEXT_PUBLIC_SOLANA_RPC_API_KEY` or `SOLANA_RPC_API_KEY` (e.g. Helius)
- `NEXT_PUBLIC_KAMINO_REWARDS_MOCK` — optional mock address override for rewards UI

## Publishing to `yield-ai-docs`

Running `pnpm publish:docs:dev` (or `npm run publish:docs:dev`) copies all `.md`/`.mdx` files from `docs/` into the sibling repo `../yield-ai-docs/docs/dev/frontend/`. This file will sync there on the next publish.

## Key source files

| Area | Path |
|------|------|
| User positions API | `src/app/api/protocols/kamino/userPositions/route.ts` |
| Rewards API | `src/app/api/protocols/kamino/rewards/route.ts` |
| Pools API | `src/app/api/protocols/kamino/pools/route.ts` |
| Deposit / earnTx API | `src/app/api/protocols/kamino/deposit/route.ts`, `earnTx/route.ts` |
| TX building (server) | `src/lib/solana/kaminoTxServer.ts` |
| Client send helpers | `src/lib/solana/kaminoKvVaultTx.ts`, `kaminoTxClient.ts` |
| RPC resolution | `src/lib/solana/solanaRpcEndpoint.ts` |
| Protocol stub | `src/lib/protocols/kamino.ts` |
| Hooks | `src/lib/query/hooks/protocols/kamino/useKaminoPositions.ts`, `useKaminoRewards.ts`, `useKaminoPools.ts` |
| Mapping | `src/components/protocols/kamino/mapKaminoToProtocolPositions.ts` |
| Deposit UX | `src/components/ui/deposit-button.tsx` |
| Manage positions | `src/components/protocols/manage-positions/protocols/KaminoPositions.tsx` |
