# AGENTS.md — yield-ai repository guide

## Project overview
`yield-ai` is a Next.js App Router application for DeFi portfolio tracking and yield execution across Aptos and Solana ecosystems. It combines:

- A **dashboard/chat UX** (`src/app/page.tsx`) with desktop + mobile layouts.
- A large set of **internal API routes** under `src/app/api/*` that aggregate protocol pools, wallet balances, swap/bridge flows, and protocol-specific actions.
- **Wallet/connectivity infrastructure** for Aptos + Solana (including Aptos derived wallets and Solana Mobile Wallet Adapter).
- **Protocol adapters/services** in `src/lib/services` and `src/lib/protocols`.

The root layout wires global providers in a specific nesting order (query, theme, aptos client, wallets, protocol/drag-drop contexts, tooltips, toaster, analytics), so provider order matters for app behavior and should be changed cautiously.

## Tech stack (from code and deps)
- **Framework/runtime**: Next.js 15 App Router (`src/app/*`, `next` dependency).
- **Language**: TypeScript with strict mode (`tsconfig.json` sets `strict: true`, `noEmit: true`).
- **UI**:
  - React 19
  - Tailwind CSS v4 via CSS-first config in `src/app/globals.css`
  - shadcn/ui + Radix UI primitives (`components.json`, `src/components/ui/*`)
  - `class-variance-authority`, `clsx`, `tailwind-merge` pattern (`src/components/ui/button.tsx`, `src/lib/utils.ts`).
- **State/data fetching**:
  - TanStack Query with centralized defaults (`src/lib/query/QueryProvider.tsx`, `src/lib/query/config.ts`)
  - Local React context providers (`src/contexts/*`, `src/lib/contexts/*`)
  - Zustand in dependencies for store-style state.
- **Blockchain/integration**:
  - Aptos SDK + wallet adapters (`@aptos-labs/*`, `src/lib/WalletProvider.tsx`)
  - Solana stack (`@solana/web3.js`, wallet adapters, Jupiter/Kamino integrations)
  - Protocol APIs through server routes and service wrappers.
- **Build/deploy/tooling**:
  - ESLint (Next config); build intentionally ignores lint failures in `next.config.js`.
  - Postinstall scripts for dependency validation and WASM file copying (`scripts/verify-kamino-deps.mjs`, `scripts/copy-lightprotocol-wasm.js`).
  - Next standalone output enabled in `next.config.js`.

## Directory structure and purpose
Top-level:
- `src/app/`: App Router pages/layout + all API route handlers.
  - `src/app/api/`: server endpoints (Aptos, Solana, protocols, swap, bridge, public v1).
  - `src/app/*/page.tsx`: feature routes (dashboard, portfolio, wallet, privacy bridge, minting, decibel).
- `src/components/`: app-level React components.
  - `src/components/ui/`: reusable design-system primitives (shadcn-style).
  - `src/components/{bridge,portfolio,wallet,decibel,...}`: feature-specific UI.
- `src/lib/`: business logic + infra.
  - `src/lib/services/`: external/internal API wrappers and protocol service logic.
  - `src/lib/protocols/`: protocol-specific domain implementations.
  - `src/lib/query/`: TanStack Query keys/config/provider.
  - `src/lib/config/`: runtime config (e.g., pool source list).
  - `src/lib/data/`: checked-in data snapshots (e.g., token list, market metadata).
  - `src/lib/solana/`, `src/lib/wallet/`, `src/lib/transactions/`: chain/tx helpers.
- `src/contexts/` and `src/lib/contexts/`: React context providers for app state and protocol data.
- `src/hooks/`: reusable React hooks.
- `src/shared/`: shared UI blocks with module CSS (older/parallel styling pattern).
- `src/types/`: shared TS types.
- `public/`: static assets (icons, logos, chain/protocol imagery).
- `scripts/`: maintenance scripts (token list update, dependency verification, API smoke tests).
- `config/`: strategy JSON config for automation flows (e.g., USD1 Echelon compound strategy).
- `docs/`: internal architecture/feature notes, backlog, API/domain docs.

Infra/meta:
- `next.config.js`: primary Next runtime/build config (webpack aliases/fallbacks, WASM handling, external packages, images).
- `next.config.ts`: additional Next config file exists; keep configs consistent if touching either.
- `components.json`: shadcn/ui alias/style config.

## Key commands
From `package.json` scripts:
- `npm run dev` — standard local development (`next dev`).
- `npm run dev:turbo` — development with Turbopack.
- `npm run build` — production build (`cross-env NEXT_IGNORE_INCORRECT_LOCKFILE=1 next build`).
- `npm run start` — run production server (`next start`).
- `npm run lint` — lint via Next (`next lint`).
- `npm run update-tokens` — refresh token list JSON via local API or direct Panora API fallback.
- `npm run verify:kamino-deps` — verify Kamino/Solana kit dependency resolution and dynamic import.

Other notable command behavior:
- `npm install` triggers `postinstall` which runs WASM copy + Kamino dependency verification. Installation failures may originate from these scripts, not just package resolution.

## Coding conventions observed in this codebase
- **TypeScript + path aliases**: imports use `@/*` alias heavily (`tsconfig.json` paths).
- **Client/server separation**:
  - Client components explicitly use `'use client'`.
  - API handlers in `src/app/api/**/route.ts` use server-only code and return `NextResponse.json(...)`.
- **API route style**:
  - Most handlers wrap work in `try/catch` and return safe JSON fallback/error payloads.
  - Multiple endpoints proxy external APIs and preserve operation via fallback local data (example: Echelon pools route).
- **UI component style**:
  - Reusable UI primitives follow shadcn/Radix patterns (`data-slot`, `cva` variants, `cn(...)` helper).
  - Tailwind class composition via `cn()` utility (`clsx` + `tailwind-merge`).
- **Query/caching**:
  - TanStack Query defaults are centralized; prefer using shared stale/cache/retry constants over ad hoc values.
- **Error handling/UX**:
  - Wallet-related “benign” errors are intentionally suppressed to reduce noisy toasts (`WalletProvider`).
- **Styling**:
  - Global design tokens are defined as CSS variables in `globals.css` (light/dark themes + mobile behavior).
  - Tailwind v4 CSS directives (`@import "tailwindcss"`, `@theme`, `@variant`) are used; do not assume legacy `tailwind.config.js` flow.
- **Formatting**:
  - The repo currently contains mixed quote/semicolon styles across files; match the local style of the file you are editing instead of enforcing a global rewrite.

## Important patterns and constraints
- **Provider order in root layout is a functional dependency** (wallet/query/theme/protocol contexts). Changes can break wallet state or query access.
- **Build constraints around WASM and Solana/Kamino deps** are codified in `next.config.js` + postinstall scripts (externalizing Whirlpool packages, copying wasm, aliasing Anchor CJS). Keep these in mind when upgrading deps.
- **Lint behavior in CI/build**: `next.config.js` sets `eslint.ignoreDuringBuilds = true`, so lint does not block production builds. Run lint explicitly if you need enforcement.
- **Base URL helpers** (`getBaseUrl`, `getClientBaseUrl`) are used to keep server/client fetches consistent across local/Vercel.
- **Pool aggregation pipeline** uses configurable sources (`src/lib/config/poolsConfig.ts`) with per-source transform functions. New protocol integrations typically plug in here.
- **No dedicated `test` npm script** is defined currently; validation is mainly lint/build + targeted scripts.
- **Strategy automation artifacts** in `config/*.json` and related API routes indicate production-sensitive parameters (addresses, limits, slippage). Treat changes there as high-risk.
