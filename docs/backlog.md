# Backlog

## Tasks

- [ ] Unify protocol position fetching through `walletStore` (Variant A)
  - Goal: eliminate duplicate `userPositions` requests coming from `walletStore`, `Sidebar`, and `MobileTabs`.
  - Approach: keep `walletStore.fetchPositions()` as the single data source and pass protocol positions from the store into protocol `PositionsList` components.
  - Scope:
    - Add optional `positions` props to protocol `PositionsList` components.
    - When `positions` prop is provided, render from store data and skip internal `fetch()` calls.
    - Keep the current internal fetch logic only as a fallback for standalone pages or contexts that do not provide store data.
    - Update `Sidebar` and `MobileTabs` to read protocol positions from `walletStore` and pass them down.
  - Expected result:
    - One `userPositions` request per protocol instead of duplicated requests from multiple mounted components.
    - `ClaimAllRewardsModal` and reward aggregation continue to use the same store-backed source of truth.

## Ideas

- [ ] EVM chains in the USDC bridge (CCTP V2)
  - Goal: bridge USDC between EVM chains (Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche, …) and Solana, alongside the existing Solana↔Aptos route.
  - Context:
    - CCTP V1 is being deprecated by Circle (manual phase-out from 2026-07-31); the current bridge is entirely V1, so a V2 migration is required regardless.
    - Aptos/Sui are V1-only for now; Circle is expected to ship canonical (V2) CCTP on Aptos/Sui around mid-2026 — treat that timing as unconfirmed (third-party reports, not a primary Circle source).
  - Proposed approach:
    - Mode split by route: Aptos↔Solana stays on the working V1 path; Solana↔EVM and EVM↔EVM use a new V2 path. The route picker chooses the mode.
    - Note: Solana straddles both — Solana↔Aptos uses V1 Solana programs, Solana↔EVM uses V2 Solana programs (separate deployments). The Solana burn needs both a V1 and a V2 variant.
    - Refactor the per-pair executors (`executeSolanaToAptosBridge`, …) into burn-step / mint-step modules so any source × any dest composes without a combinatorial explosion.
    - EVM wallet stack: `wagmi` + `viem` (viem is already in package.json) + a connector UI (e.g. ConnectKit), wired as a new provider.
    - One EVM burn/mint code path covers all EVM chains — only the TokenMessenger address and CCTP domain ID differ per chain.
  - Monetization: CCTP has no native integrator fee. A bridge fee is a pre-burn skim (transfer a % to a fee wallet, burn the rest) — works on V1/V2, any chain. Circle's App Kit offers a turnkey `customFee` config (`value` + `recipientAddress`) but takes 10% of the collected fee; building the skim ourselves keeps 100%. Apply the fee only on non-Aptos routes (Aptos legs are gas-subsidized via Gas Station).
  - Rough estimate: ~1 week to refactor executors into burn/mint steps, ~2–3 days EVM wallet stack, ~3–4 days EVM burn+mint. First EVM chains in ~2–2.5 weeks; each additional EVM chain after that is config-only.

- [ ] EVM portfolio display via Zerion API
  - Goal: show users' EVM (and optionally Solana) token + DeFi portfolio using the Zerion API.
  - Context:
    - Zerion covers all major EVM chains + Solana, 8000+ protocols, with P&L. It does NOT support Aptos — so Zerion complements, never replaces, `AptosPortfolioService`.
    - For Solana, Zerion currently has no protocol/DeFi positions (token balances only), so it does not improve on the existing Jupiter-based Solana portfolio.
    - Therefore Zerion only pays off once EVM wallets exist in the app — pair this with the EVM bridge work above.
  - Proposed approach:
    - Server-side API route calling Zerion REST (`GET /v1/wallets/{address}/positions`) with an API key (free tier: 2k req/month; paid for production).
    - Map the Zerion response into the existing `Token` / `walletStore` portfolio model (price normalization, chain tagging, TTL cache).
    - Zerion also supports x402 auth (pay-per-request, no signup) — possible alternative if agentic billing is wanted later.
  - Rough estimate: ~3–5 days for a clean integration once EVM wallets are wired.
