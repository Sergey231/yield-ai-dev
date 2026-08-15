# Exponent integration (Yield AI)

Exponent is a **Solana** yield-trading protocol. Users split yield-bearing assets into **PT** (principal, fixed rate) and **YT** (yield, variable rate), then trade or hold them across several on-chain venues.

This doc captures **research + integration** for reading user positions into the Yield AI dashboard (same pattern as Kamino / Jupiter Lend). The read API lives at `GET /api/protocols/exponent/userPositions`.

## Scope in the product (planned)

- **Read positions** for a connected Solana wallet: Core PT/YT, staked YT, CLMM LP, orderbook balances, and **Strategy Vault deposits**.
- **Discovery** (later): Exponent markets / vaults for the investment dashboard.
- **Transactions** (later): deposit / withdraw / trade via Exponent SDK + wallet signing + `/api/solana/sendRaw`.

Exponent is **not** an Aptos `BaseProtocol`; integration is Solana-only (server RPC + optional HTTP catalog).

## Product surfaces and position types

A single wallet can hold Exponent exposure in **multiple venues**. All of them must be aggregated for portfolio parity with Jupiter / Exponent UI.

| Venue | What the user holds | How to detect | USD value (MVP) |
|-------|---------------------|---------------|-----------------|
| **Core — wallet PT/YT** | SPL tokens (`ptMint` / `ytMint` from market catalog) | Match wallet SPL balances against `GET /markets` | `balance × ptPriceInAsset` (or YT price) × underlying USD |
| **Core — staked YT** | `YieldTokenPosition` PDA (YT deposited for yield accrual) | `getProgramAccounts` on Core program, memcmp **owner** @ offset 8; or `ExponentFetcher` | YT amount × `ytPriceInAsset` × underlying USD |
| **CLMM** | Rate-CLMM LP position | `lpPosition` accounts on CLMM program, memcmp owner @ offset 8 | SDK / position state → SY exposure → USD |
| **Orderbook** | Resting PT/YT offers | `Orderbook.getAllUserOrderbookBalances()` (SDK) | Quoted notionals from orderbook state |
| **Strategy Vaults** | **Vault share / LP SPL token** (`mintLp`) | SPL balance of `mintLp` + map mint → vault via `ExponentVaultsFetcher.fetchAllVaults()` | `shares × vault_index` where index ≈ `aumInBase / total_lp_supply` (see below) |

### Strategy Vaults (easy to miss)

Strategy Vaults are a **separate product layer** from Core PT/YT markets. Depositors receive an **SPL share token** (`mintLp`) representing pro-rata AUM, not raw USDC 1:1.

- Program: `sVau1tXvayVWfotzm9Ahcv2qfnnfRWttt78BCnNC6dD`
- Share pricing follows the vault **index** (AUM / LP supply), including PT/YT, orderbook quotes, fees, and pending withdrawals ([Strategy Vault concepts](https://docs.exponent.finance/user-documentation/strategy-vault-concepts)).
- UI may label the receipt token (e.g. **lsONyc**) while Jupiter groups the position under **Exponent → DEPOSIT**.

**PT-only detection is insufficient.** A wallet can have large Strategy Vault exposure with zero wallet PT/YT.

## On-chain programs

| Program | Role | Address |
|---------|------|---------|
| Exponent Core | PT/YT strip/merge, `YieldTokenPosition` | `ExponentnaRg3CQbW6dqQNZKXp7gtZ9DGMp1cwC4HAS7` |
| Exponent CLMM | Concentrated liquidity for PT/YT | `XPC1MM4dYACDfykNuXYZ5una2DsMDWL24CrYubCvarC` |
| Exponent Orderbook | Limit orders on PT/YT | `XPBookgQTN2p8Yw1C2La35XkPMmZTCEYH77AdReVvK1` |
| Exponent Strategy Vaults | Managed vaults (curators, Squads policies) | `sVau1tXvayVWfotzm9Ahcv2qfnnfRWttt78BCnNC6dD` |

## Public HTTP APIs

| Endpoint | Status | Use |
|----------|--------|-----|
| `GET https://api.exponent.finance/markets` | **200 JSON** | Core market catalog: `vaultAddress`, `ptMint`, `ytMint`, `impliedApy`, `ptPriceInAsset`, `ytPriceInAsset`, maturity, platform, underlying |
| `GET https://api.exponent.finance/vaults` | **200 JSON** | Core vault metadata (not Strategy Vault catalog) |
| User positions (`/portfolio/{wallet}`, `/users/...`) | **Not available** | Positions must be built from RPC + SDK |
| `GET .../strategy-vaults` | **404** | No public strategy-vault list API found (as of 2026-06) |

## On-chain reads (reference implementation)

Official gist: [Get Exponent user SY balances across venues](https://gist.github.com/bryantanjw/9e4fe0657f1c5b0eac52ba2a32cf9292) — covers YT, CLMM, orderbook, and **Strategy Vault LP**.

### NPM packages (`@exponent-labs/*`, tested at v0.9.19)

- `@exponent-labs/exponent-fetcher` — Core program accounts (`YieldTokenPosition`, markets)
- `@exponent-labs/exponent-sdk` — `ExponentVaultsFetcher`, `Orderbook`, vault tx builders
- `@exponent-labs/exponent-clmm-idl` — CLMM `lpPosition` Anchor account

Install note: in the main repo, `npm install` may fail on peer deps; use an isolated folder with `npm install --legacy-peer-deps` when spiking.

### Strategy Vault catalog (on-chain)

```ts
import { Connection } from "@solana/web3.js";
import { ExponentVaultsFetcher } from "@exponent-labs/exponent-sdk";

const fetcher = new ExponentVaultsFetcher(connection); // positional Connection arg
const vaults = await fetcher.fetchAllVaults();
// Each item: { publicKey, account: { mintLp, underlyingMint, financials: { aumInBase, lpBalance, ... }, ... } }
```

Map wallet SPL mint → `account.mintLp`. Price shares with vault financials + SPL mint **total supply** (confirm `financials.lpBalance` semantics vs circulating supply during implementation).

### Local probe script

Research script (not shipped): `.tmp-exponent-check/check-wallet.mjs` — markets + wallet PT/YT + staked YT + CLMM LP. **Does not yet include Strategy Vault LP**; extend before implementing the API route.

## Example wallet: `rUg65MzqxeWyjQwpXunJE6hNfZx1w5p8vGKmQtPfyVd`

Validated on mainnet (2026-06). Jupiter portfolio and Exponent UI both show Exponent exposure; our first pass only found **PT** until Strategy Vault LP was added to the checklist.

### 1. Core PT (yield market)

| Field | Value |
|-------|-------|
| Asset | **PT ONyc** (OnRe platform) |
| Balance | **521.93 PT** |
| Core vault | `66R3TcKjaUqxQwYV31BS4nD2s7YH4V7ENuvdwYbQMXCm` |
| PT mint | `2W5zZccVq8AMdrg7P4b3NvBKJyzbdnytRy2CKEDHvhiJ` |
| Implied APY | ~14.0% |
| Est. USD | 521.93 × 0.973 ≈ **$508** (`ptPriceInAsset` from `/markets`) |

Staked YT, CLMM LP, orderbook: **none** for this wallet.

### 2. Strategy Vault — OnRe Growth (lsONyc)

| Field | Value |
|-------|-------|
| UI name | **OnRe Growth** (curator: Loopscale Asset Curation) |
| Receipt label | **lsONyc** (Jupiter: Exponent → DEPOSIT) |
| Strategy vault PDA | `9iPUphFXxnyAKYnCTG3XZv5ybHv5Ki1diqA5mis3TBVB` |
| Share mint (`mintLp`) | `G64HTm5asciRE78KqN8GZodhkDmP4TFyN6drzmWAwr6n` |
| Wallet share balance | **986.314786** (6 decimals) |
| Underlying mint | `USD1111111111111111111111111111111111111111` (USDC) |
| Est. USD (UI / Jupiter) | **~$1,007** |

Jupiter token search does not resolve a friendly symbol for `G64HTm5...`; treat as Exponent Strategy Vault share via on-chain vault map, not generic SPL metadata.

### Combined Exponent exposure (this wallet)

| Source | ~USD |
|--------|------|
| PT ONyc (Core) | ~508 |
| OnRe Growth Strategy Vault | ~1,007 |
| **Total** | **~1,515** |

Other SPL balances on the same wallet (e.g. raw ONyc, unrelated PST) are **not** Exponent positions.

## Planned Yield AI integration

Mirror **Kamino** layout:

```
GET /api/protocols/exponent/userPositions?address=<solana>
```

| Layer | Planned path |
|-------|----------------|
| API route | `src/app/api/protocols/exponent/userPositions/route.ts` |
| React Query hook | `src/lib/query/hooks/protocols/exponent/useExponentPositions.ts` |
| Query keys | `queryKeys.protocols.exponent.userPositions` |
| UI | `src/components/protocols/exponent/ExponentPositions.tsx` |
| Card mapping | `mapExponentToProtocolPositions.ts` |
| RPC | `getSafeSolanaRpcEndpoint()` (`src/lib/solana/solanaRpcEndpoint.ts`) |

### `userPositions` pipeline (MVP)

1. Fetch `https://api.exponent.finance/markets` (cache TTL like Kamino catalogs).
2. Load wallet SPL balances (Token + Token-2022).
3. **Core**: match `ptMint` / `ytMint` → PT/YT rows with implied APY and prices from catalog.
4. **Staked YT**: `ExponentFetcher` / memcmp on `yieldTokenPosition`.
5. **CLMM LP**: CLMM program `lpPosition` accounts for owner.
6. **Strategy Vaults**: `ExponentVaultsFetcher.fetchAllVaults()` → index `mintLp` → price shares → USD via underlying (USDC ≈ $1 + Jupiter for others).
7. Return normalized rows with `source`: `exponent-pt`, `exponent-yt`, `exponent-yt-staked`, `exponent-clmm`, `exponent-strategy-vault`, etc.

### Phase 2

- Orderbook resting balances (full SY notionals).
- Strategy Vault **metadata** (display name, APY, curator) if a stable HTTP source appears; until then, static map or on-chain seed fields.
- Deposit / withdraw / trade tx builders (`ExponentVault`, Core market instructions).
- Public wallet API mapping in `src/app/api/public/v1/wallet/[address]/protocols/route.ts`.

## Environment variables (relevant)

Same as other Solana integrations:

- `NEXT_PUBLIC_SOLANA_RPC_URL` or `SOLANA_RPC_URL`
- `NEXT_PUBLIC_SOLANA_RPC_API_KEY` or `SOLANA_RPC_API_KEY` (e.g. Helius)

`getProgramAccounts` on Strategy Vaults can be heavy; prefer a dedicated RPC and short server-side caching.

## Publishing to `yield-ai-docs`

Running `pnpm publish:docs:dev` copies `docs/*.md` into `../yield-ai-docs/docs/dev/frontend/`. This file syncs on the next publish.

## References

- Exponent docs (full): `https://docs.exponent.finance/llms-full.txt`
- Strategy Vault architecture: `https://docs.exponent.finance/user-documentation/strategy-vault-concepts`
- User SY balances gist: `https://gist.github.com/bryantanjw/9e4fe0657f1c5b0eac52ba2a32cf9292`
- Kamino integration pattern in this repo: [kamino-integration.md](./kamino-integration.md)

## Open questions

- **Strategy Vault display metadata** — no public JSON catalog found; vault `seedId` was empty on-chain for OnRe Growth. May need app-scraped config or curator registry.
- **Share pricing** — confirm whether `financials.lpBalance` equals circulating `mintLp` supply or an internal field; cross-check with Exponent UI NAV before shipping USD totals.
- **Receipt token symbols** (lsONyc) — not in Jupiter token list; derive labels from vault metadata map.
