# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev            # Start dev server (Next.js)
pnpm dev:turbo      # Dev server with Turbopack (faster rebuilds)
pnpm build          # Production build
pnpm lint           # ESLint
pnpm update-tokens  # Refresh Panora token list → src/lib/data/tokenList.json
npx tsc --noEmit --skipLibCheck  # Type-check without emitting
```

No test suite is configured.

## Architecture Overview

Multi-chain DeFi dashboard: Aptos is primary, Solana is secondary (cross-chain bridge + derived wallets). Users discover yield opportunities, manage positions, and execute swaps across 14+ Aptos DeFi protocols.

### Provider nesting (src/app/layout.tsx)

```
AptosWalletAdapterProvider
  └─ SolanaProvider (Phantom, Solflare, MWA)
       └─ WalletProvider (lib/WalletProvider.tsx — orchestrates both chains)
            └─ AptosClientProvider
                 └─ QueryProvider (TanStack React Query)
                      └─ DragDropContext (modal orchestration)
                           └─ WalletDataProvider (loads portfolio)
```

### Data flow

1. **Wallet connects** → `WalletProvider` sets up Aptos wallet adapter + auto-derives Solana keypair from Aptos seed (`@aptos-labs/derived-wallet-solana`). If a native Solana wallet (Phantom etc.) is also connected, it takes priority over the derived one.
2. **Portfolio loaded** → `WalletContext` fetches Aptos balances+prices via `AptosPortfolioService`; `useSolanaPortfolio` hook fetches Solana positions. Both are cached in the Zustand `walletStore` (60s TTL for prices, 30–60s for positions).
3. **User drags token → protocol** → `DragDropContext.handleDrop()` validates compatibility and opens the appropriate modal (`DepositModal`, `SwapAndDepositModal`, `WithdrawModal`).
4. **Deposit executes** → `protocol.buildDeposit()` generates an Aptos entry-function payload → `wallet.signAndSubmitTransaction()` → Gas Station submits (free gas for users).

### State management

**Zustand** (`src/lib/stores/walletStore.ts`) is the central hub — caches balances, positions, rewards, prices with TTL. Use `NEXT_PUBLIC_DEBUG_PROTOCOLS` env var to filter protocols during development.

**React Context** for cross-cutting concerns:
- `WalletContext` — Aptos portfolio + `refreshPortfolio()`
- `DragDropContext` — opens/closes all investment modals, validates drops
- `CollapsibleContext` — sidebar section open/close persistence

### Protocol abstraction

Every DeFi protocol implements `BaseProtocol` (`src/lib/protocols/BaseProtocol.ts`):
```ts
interface BaseProtocol {
  name: string;
  buildDeposit(amountOctas, token, userAddress?, marketAddress?): Promise<InputEntryFunctionData>;
  buildWithdraw?(marketAddress, amount, token, userAddress?): Promise<InputEntryFunctionData>;
  buildClaimRewards?(positionIds, tokenTypes, userAddress?): Promise<InputEntryFunctionData>;
}
```
`ProtocolRegistry` (`src/lib/protocols/protocolsRegistry.ts`) maps names → instances. Add new protocols there.

### Token prices

- **Aptos tokens**: Panora API (`src/lib/services/panora/prices.ts`), falling back to `usdPrice` field in `src/lib/data/tokenList.json`.
- **Solana tokens**: Jupiter Price API v2 (`https://api.jup.ag/price/v2?ids=<mints>`), public CORS-enabled.
- All prices cached 60s in Zustand.

### Swap flow (Panora DEX)

`PanoraSwapService` (`src/lib/services/panora/swap.ts`) fetches a quote from the Panora aggregator. The quote includes a ready-to-sign `transactionPayload` (BCS-encoded entry function). `SwapAndDepositModal` chains: swap tx → deposit tx.

### Solana Privacy Bridge

Route: `/privacy-bridge`. Layers: Privacy Cache pool (Solana) → temp browser-only keypair → Circle CCTP burn on Solana → CCTP mint on Aptos → X-Chain Derived Account. No on-chain link between source and destination wallets.

### Address normalization

Aptos addresses are inconsistent (0x-prefix, leading zeros). Always use utilities in `src/lib/utils/addressNormalization.ts` — required for protocol market lookups and token matching.

### API routes

All backend logic lives in `src/app/api/`:
- `aptos/` — balances, portfolio, pools
- `panora/` — prices, swap quotes, token list
- `protocols/{name}/` — protocol-specific endpoints
- `bridge/` — CCTP deposit-for-burn, attestation polling
- `jupiter/`, `solana/` — Solana RPC queries

### Key large files

| File | What it does |
|------|-------------|
| `src/lib/stores/walletStore.ts` | Central Zustand store (~66KB); all TTL/fetch logic lives here |
| `src/contexts/DragDropContext.tsx` | Opens all modals, validates drops (~22KB) |
| `src/components/InvestmentsDashboard.tsx` | Main dashboard UI (~81KB); protocol filtering, search, APY display |
| `src/lib/services/panora/swap.ts` | Swap quote + BCS payload handling |
| `src/lib/query/queryKeys.ts` | Type-safe React Query key factory; add new query keys here |

### MCP (Cursor/Claude integration)

`src/.cursor/mcp.json` registers `@aptos-labs/aptos-mcp` — enables direct Aptos SDK calls from AI assistants via MCP protocol.
