# Backlog

## Tasks

- [ ] Hyperion LP: drag range boundaries on the price chart (`BinChart`)
  - Goal: let users set min/max price by dragging handles on the open-position chart (alternative to ±% / Price inputs).
  - Context: `BinChart` uses lightweight-charts with read-only price lines + CSS overlay bands; no drag callbacks today. Needs `coordinateToPrice`, tick-spacing snap, mobile touch, and sync with `rangeMode` / parent state.
  - MVP estimate: ~1–2 days (handles + snap). Polished (mobile, min range width, mode sync): ~3–5 days.
  - Simpler fallback to try first: click-to-set min then max on the chart.

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

- [ ] WBTC bridge Aptos ↔ Ethereum via LayerZero Value Transfer API
  - **Prerequisite:** ship the EVM USDC bridge first (CCTP V2 + `wagmi`/`viem` EVM wallet stack). WBTC reuses the same EVM wallet infra for `dstWalletAddress` on Ethereum; doing USDC first is lower risk and fits the existing stack.
  - Goal: programmatic cross-chain WBTC between Aptos (lzWBTC) and canonical Ethereum WBTC inside the app (extend `/bridge` or a dedicated flow).
  - Route status (verified against live API, no key required for discovery):
    - Aptos → Ethereum: `0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa::asset::WBTC` (6 decimals, lzWBTC) → `0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599` (8 decimals).
    - Ethereum → Aptos: reverse route supported; two Aptos WBTC variants exist in the API (6-dec lzWBTC coin type and 8-dec FA-style address `0x68844a0d…` — pick the correct one per direction).
    - **Do not** pass the FA metadata address (`0xa64d2d6f…`) to the API — returns `422 Unsupported token`. Use the coin type address for lzWBTC.
  - API: [Value Transfer API](https://docs.layerzero.network/v2/developers/value-transfer-api/overview) — base URL `https://transfer.layerzero-api.com/v1`.
    - Public (no auth): `GET /chains`, `GET /tokens`, `GET /metadata`.
    - Auth required: `POST /quotes`, `GET /status/{quoteId}`, `POST /build-user-steps`, `POST /submit-signature`.
    - **API key:** no self-service portal. Contact LayerZero team — [enterprise.layerzero.network](https://enterprise.layerzero.network/) or `enterprise@layerzerolabs.org`. Store key server-side only (`LAYERZERO_API_KEY` in env, proxied via Next.js API routes).
  - Proposed integration flow:
    1. `GET /tokens?transferrableFromChainKey=…&transferrableFromTokenAddress=…` — discover valid destination tokens.
    2. `POST /quotes` (server proxy) — fees, route (`OFT` / `APTOS_V1`), and `userSteps`.
    3. Execute `userSteps` in order: Aptos Move tx via wallet adapter (source leg); EVM approve + bridge via `viem` (if source is Ethereum).
    4. Poll `GET /status/{quoteId}?txHash=…` until `SUCCEEDED` / `FAILED`.
    5. Reuse bridge progress UX patterns from existing CCTP flow (`BridgeProgressView`, action log).
  - Safety notes from LayerZero docs: execute every `userStep` exactly as returned; never approve LZMulticall (Wrapper) as ERC-20 spender — the approve step targets TransferDelegate inside calldata.
  - Alternative for manual use (no API): [Stargate bridge UI](https://stargate.finance/bridge) — same LayerZero OFT infrastructure for WBTC.
  - Rough estimate: ~1 week after EVM wallet + USDC bridge land (API proxy + Aptos userSteps + status polling + UI). EVM-as-source adds approve/bridge steps on top.

- [ ] Delta-neutral auto-entry: phased rollout (monitor → manual → multi-chain → scale)
  - **Phase 1 — Validate spreads (current):** keep the read-only DN spread monitor cron (`/api/protocols/decibel/dn-spread-monitor/cron`) running in production; use Vercel logs (`[DN-Monitor]`) to confirm which markets (e.g. xStocks NVDA/TSLA/GOOGL/QQQ) show **persistent** favorable spread + funding windows, not one-off noise. No automated execution in this phase. Economics notes: `docs/dn-spread-economics-research.md`.
  - **Phase 2 — Personal wallet entry/exit tests:** after signal confidence is high enough, run manual open/close cycles on a **personal wallet** (not bulk safes). Likely path: Decibel delta-neutral **V2** on-chain flows + existing executor endpoints (`executor-open-delta-neutral`, close/history). Tune sizing, slippage, hedge mismatch, and economics at realistic notionals before any fleet automation.
  - **Phase 3 — Multi-chain spot leg:** extend beyond Aptos-only spot (Hyperion APT/BTC today). Solana xStocks from the monitor need a Solana executor (Jupiter swap, custody/bridge). Aptos↔Solana USDC (CCTP) and broader EVM legs tie into the EVM bridge backlog items above — do not start fleet DN execution on Solana spot until this leg is designed. Architecture draft: `docs/dn-multi-chain-architecture.md`.
  - **Phase 4 — Execution scaling across many Yield AI safes:** once single-wallet economics are proven, add a dedicated DN executor worker (discover `decibel_delta_neutral` safes, caps per run, sequential txs from `YIELD_AI_EXECUTOR_PRIVATE_KEY`, idempotency). Pattern exists in `yieldAiVaultWorker` / `hyperionLpCron` (pagination, `maxTxPerRun`, `safeAddresses`). Vercel timeout and per-open tx chains are the main limits — chunk across cron invocations or a durable queue.
  - **Scaling reference (later):** review execution-queue / multi-tenant patterns from the **s1lkpay card** project before designing fleet DN cron; discuss separately when Phase 2–3 are stable.
  - **Explicit non-goals until Phase 2 passes:** no auto-open from monitor signals; stablecoin cron continues to skip `decibel_delta_neutral` safes.

- [ ] Per-safe Hyperion LP automation params (on-chain) — design
  - **Origin:** folded in from the former `docs/HYPERION_SAFE_AUTOMATION_PARAMS.md` (idea, not implemented, 2026-06-11). `docs/HYPERION_LP_FRONTEND.md` references this as the successor to the single global cron-param set.
  - **Motivation:** all automation knobs (re-center width, gates, claim thresholds) live in global cron query params today — one value for every safe and pool. Breaks down because pools need different widths (stable USDt/USDC ±10 ticks vs WBTC/USDC ±250), users differ in risk appetite (auto-recenter vs manual-only), and some actions need explicit owner consent (`redeployIdle` — sweeping pre-existing safe holdings — must be per-safe opt-in, never default). Architecture is already "state on chain, cron stateless"; this extends the same pattern (no off-chain DB).
  - **Storage (contract `yield-ai-agent-smart`):** one owner-gated, additive resource per safe (absent ⇒ current defaults):
    ```move
    struct HyperionAutomationParams has key {
        version: u16,                       // schema version for off-chain readers
        auto_claim_enabled: bool,
        auto_claim_min_usd_cents: u64,      // 0 = strategy default
        auto_compound_enabled: bool,
        auto_compound_min_usd_cents: u64,
        auto_recenter_enabled: bool,
        half_width_ticks: u32,              // 0 = strategy default
        edge_buffer_ticks: u32,
        min_position_age_secs: u64,
        min_fees_usd_cents: u64,            // re-center cost gate
        redeploy_idle_enabled: bool,        // OPT-IN: sweep pre-existing pair tokens
        redeploy_idle_min_usd_cents: u64,
        max_slippage_bps: u16,              // cap for any automation swap
        pool_half_width: vector<PoolWidth>, // per-pool width override; PoolWidth { pool: address, ticks: u32 }
    }
    ```
    Typed fields (not an opaque blob) give on-chain validation (bps ≤ 10_000, tick bounds), readable explorer state, per-field events; `version` still allows additive evolution.
  - **Entrypoints/views:** `set_hyperion_automation_params(owner, safe, ...)` (owner-only, validates ranges, emits `HyperionAutomationParamsUpdatedEvent`); `clear_hyperion_automation_params(owner, safe)`; view `get_hyperion_automation_params(safe) -> (exists, params)`.
  - **Cron integration:** resolution order per safe/action = per-safe params → global cron query params → strategy defaults. In `runHyperionLpCronPass`: batch-read params per safe after `resolveHyperionSafes`; skip disabled actions; pass per-safe `halfWidthTicks` (with per-pool override) into `runHyperionRecenterDual` (also fixes the one-global-width-for-stable-and-volatile bug); `redeployIdle` off unless opted in.
  - **UI:** settings sheet on the agent panel (gear icon) — toggles + thresholds via the owner-signature pattern (`hyperionManageAuth`); prefer the wallet signing the entry directly (owner action, not executor).
  - **Phasing:** (1) v1 contract (resource + set/clear/view, no cron changes); (2) cron reads params (recenter gating + per-pool widths, globals become fallback); (3) auto-compound consumes `auto_compound_*` (claim-event-driven); (4) `redeployIdle` last (smallest value, highest blast radius, opt-in only).

- [ ] Hyperion stable LP — remaining follow-ups (post-ship)
  - **Origin:** folded in from the former `docs/stablecoin-lp-handoff.md` (session handoff). Core strategy is shipped (PRs #153/#154/#156 merged): `runHyperionRecenterDual` (swap-free dual re-center + leg-imbalance rebalance), cron integration (`hyperionLpCron` action `recenter-dual`), `halfWidthTicks` floor 1, display fixes. Below are the items that were still open.
  - **F — DefiLlama adapter Hyperion LP (DONE, awaiting merge):** the adapter now includes Hyperion LP (per-safe `get_hyperion_positions` → `get_hyperion_position` → `api.add(...)`, `doublecounted:true`). **Submitted to DefiLlama, pending their merge** — once merged, stable-LP TVL is counted. Spec: `docs/defillama-adapter-spec.md` §4b. No action on our side beyond tracking the merge.
  - **E — open stable pools to users (`uiEnabled:true`):** pools themselves are **live and available**; remaining is the stable range UX (panel presets ±2.5/5/10% are volatile-tuned — a user opening USDt/USDC at ±2.5% earns ~0%; need a stable default ±0.1% / stable presets or a fixed agent-managed width) + scheduled live auto-recenter, then flip `uiEnabled:true` in `yieldAiVault.ts`. Verify current state against prod.
  - **D — schedule the recenter cron LIVE:** `vercel.json` cron currently hits the GET default = monitor (dryRun). Go live after calibration via query: `?action=recenter-dual&dryRun=false&halfWidthTicks=<N>&minPositionAgeSeconds=3600&minFeesUsd=0.03&maxActionsPerRun=10` (+ a separate `?action=claim&dryRun=false&minClaimUsd=0.05`).
  - **G — USD1/USDC second pool:** higher yield (~13–15%) but smaller TVL (~$413K). Pool is **available now** (allowlisted); remaining is exposing it via the same stable flow once the UX above (E) lands.
  - **Calibration reference:** ±0.1% (10 ticks) measured ~3.9% fee APR on ~$1000 over ~5h, never left range in ~6h; tighter (±0.05%) expected ~7–8% (was pending a prod-deploy promotion when handoff was written — verify live). Gate rough calibration: recenter-dual ~$0.02 cost, fees ~$0.004/h per $1000 → `minFeesUsd ≈ 0.02–0.05`, `minPositionAgeSeconds ≈ a few hours`, `edgeBufferTicks = 0`.
  - **Note:** the volatile delta-neutral LP variant (WBTC LP + Decibel short) was shelved here as net-negative in one test (short gamma / LVR ate fees); the revived, dialable version is specced in `docs/hedged-lp-strategy.md`.
