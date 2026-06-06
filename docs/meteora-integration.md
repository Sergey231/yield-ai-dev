# Meteora integration (Yield AI)

Meteora in this app is a **Solana** integration. The Aptos `BaseProtocol` path is **not** used — Meteora is a Solana-native DEX. The current scope is **view-only DLMM positions**; claim / withdraw is not wired yet (see "Future work" below).

## Scope in the product

- **DLMM positions** (Dynamic Liquidity Market Maker — Meteora's concentrated-liquidity AMM): the user's positions per LB-pair, enriched with token metadata, USD pricing, fee tier, active bin and in-range badge.
- **Manage Positions panel**: pair, bin step, base fee %, pool price, per-bin range, liquidity and claimable fees broken down by token, plus a pool-details modal.
- **No DAMM v2**: Meteora's classic constant-product pools are a separate program and **not** included in this integration.

## External APIs and on-chain

- **DLMM TypeScript SDK** (`@meteora-ag/dlmm`, dynamic import on the server):
  - `DLMM.getAllLbPairPositionsByUser(connection, userPubKey)` → `Map<string, PositionInfo>` (LB-pair pubkey → aggregated `PositionInfo` with `lbPair`, `tokenX`, `tokenY`, `lbPairPositionsData[]`).
  - Each `PositionInfo.lbPairPositionsData[i].positionData` already exposes `totalXAmount` / `totalYAmount` (raw) and `feeX` / `feeY` (raw) and per-bin `positionBinData[]` — no bin math required on our side.
- **Solana RPC** (read): `getServerSolanaConnection()` from `@/app/api/jupiter/_lib` — same Helius/public fallback as Jupiter integration.
- **Jupiter token-metadata service** (`JupiterTokenMetadataService`, shared with Kamino): resolves `symbol`, `decimals`, `logoUrl` for both mints, cached 30 days.
- **Jupiter price API v3** (`https://api.jup.ag/price/v3?ids=<mint>,<mint>`): USD price per mint. Retried up to 3× to avoid `$0.00` ghost rows on transient misses.
- **Meteora REST** (`https://dlmm.datapi.meteora.ag`): not consumed yet; pool / TVL / APR metadata could come from here later (see "Future work").

## Server route

| Method | Path | Role |
|--------|------|------|
| `GET` | `/api/protocols/meteora/userPositions?address=<solana>&debug=1` | DLMM positions per LB-pair, raw + enriched |

Source: [`src/app/api/protocols/meteora/userPositions/route.ts`](../src/app/api/protocols/meteora/userPositions/route.ts).

### Response shape

```ts
{
  success: true,
  address: string,
  data: Array<{ lbPair: string; positions: unknown[] }>,  // raw, sanitized DLMM rows
  poolCount: number,
  positionCount: number,
  enriched: Array<{
    poolAddress: string,
    binStep: number,
    baseFactor: number,
    baseFeePct: number,                  // = binStep * baseFactor / 1e8 * 100
    activeBinId: number,
    pricePerY?: number,                  // tokenX USD price / tokenY USD price (e.g. USDC per SOL)
    tokenX: { mint, symbol, decimals, logoUrl?, priceUsd? },
    tokenY: { mint, symbol, decimals, logoUrl?, priceUsd? },
    positions: Array<{
      positionAddress: string,
      owner: string,
      lowerBinId: number,
      upperBinId: number,
      inRange: boolean,                  // activeBinId ∈ [lowerBinId, upperBinId]
      amountX: number,                   // UI units (raw / 10^decimalsX)
      amountY: number,
      feeX: number,
      feeY: number,
      valueUsd: number,                  // amounts × prices
      feesUsd: number,                   // fees × prices
      totalUsd: number,                  // valueUsd + feesUsd
    }>,
    totalUsd: number,                    // Σ position.totalUsd
  }>,
  totalUsd: number,                      // Σ pool.totalUsd
  note: string,
  meta?: { ms, rpcHost },                // when `?debug=1`
}
```

The legacy `data[]` field stays for debugging; the client only reads `enriched[]`.

### Quirks worth remembering

- **`@meteora-ag/dlmm` is loaded with `await import(...)` inside the route**, then probed for either default-export or named `DLMM`. Some bundlers expose one or the other.
- **BN.js objects** (`{ negative, words, length, red }`) leak through `JSON.stringify` on the Vercel runtime because the production build minifies class names, so `constructor.name === "BN"` doesn't match. `sanitizeForJson` therefore detects the BN shape by duck-typing (`words[] of numbers + numeric length + numeric negative`) and converts via 26-bit little-endian limb reconstruction (`bnLikeToString`). Without this, every amount/fee silently becomes `NaN` → `0` and the position vanishes from the UI. **Don't remove the shape check.**
- The route also reads `*ExcludeTransferFee` variants when present (`totalXAmountExcludeTransferFee`, `feeXExcludeTransferFee`, …) and falls back to the plain fields — this matches what Meteora's own UI displays.
- Dust filter: positions with all four of `amountX`, `amountY`, `feeX`, `feeY` below `1e-9` are dropped. DLMM keeps zeroed position accounts on-chain after a full withdraw, and showing them as `$0.00` ghost rows is worse than hiding them.

## Client wiring

```
src/lib/query/hooks/protocols/meteora/useMeteoraPositions.ts   ← React Query hook, returns enriched[]
src/components/protocols/meteora/
  mapMeteoraToProtocolPositions.ts                              ← maps to ProtocolPosition rows (deposit-only value)
  PositionsList.tsx                                             ← sidebar card (ProtocolCard wrapper)
src/components/protocols/manage-positions/protocols/
  MeteoraPositions.tsx                                          ← center-dashboard detail panel (Hyperion-style)
```

Wiring points:

- [`queryKeys.protocols.meteora.userPositions(address)`](../src/lib/query/queryKeys.ts).
- Sidebar / PortfolioPage / MobileTabs all import `PositionsList as MeteoraPositionsList`, track `meteoraValue` state, include it in `solanaProtocolsTotal` → `solanaTotalAssets` → `Total Assets`, and add `"Meteora"` to `SOLANA_PROTOCOL_NAMES` (so the "Checking positions…" indicator and global refresh cover it).
- [`ManagePositions.tsx`](../src/components/protocols/manage-positions/ManagePositions.tsx) routes `case 'meteora'` → `<MeteoraPositions />` and the refresh handler hits `/api/protocols/meteora/userPositions`.
- Protocol metadata: `name: "Meteora"`, `key: "meteora"`, `category: "DEX"`, `managedType: "native"` (so the Manage Positions button opens the in-app panel rather than redirecting). `logoUrl: "/protocol_ico/meteora.svg"` — sourced from `app.meteora.ag/icons/v2.svg`.

## Sidebar / Manage layout conventions

- Sidebar row `value = position.valueUsd` (deposit only). Fees are shown on a separate `💰 Total fees:` row (custom `rewardsLabel` prop on `ProtocolCard`). The card **header** total = `valueUsd + feesUsd` — matches the Hyperion convention so wallet totals stay consistent.
- Manage Positions row mirrors `HyperionPositions.tsx`: overlapping token icons, pair label, Active/Inactive badge with tooltip, info button → pool-details modal, bin/fee badge, USD value, `💰 Fees` row with per-token tooltip, liquidity sub-breakdown, "Open on Meteora" link. Mobile layout is a stacked variant of the same data.

## Future work (not implemented)

### Claim fees / withdraw / close

The DLMM SDK already exposes everything needed. Pattern would be: build the tx server-side (so we keep the `@meteora-ag/dlmm` import out of the client bundle), return base64, sign with the wallet adapter, send via `/api/solana/sendRaw` — same flow as Kamino's earn deposit/withdraw.

| Operation | SDK method | Returns | Notes |
|-----------|------------|---------|-------|
| Claim swap fees (single) | `dlmmPool.claimSwapFee({ owner, position })` | `Promise<Transaction[]>` | One pool per call; sign sequentially. |
| Claim swap fees (bulk) | `dlmmPool.claimAllSwapFee({ owner, positions })` | `Promise<Transaction[]>` | Batches multiple positions in one pool. |
| Claim LM rewards | `dlmmPool.claimLMReward` / `claimAllLMRewards` | `Promise<Transaction[]>` | Only relevant for pools running emissions. SOL/USDC has none. |
| Remove liquidity | `dlmmPool.removeLiquidity({ user, position, fromBinId, toBinId, bps, shouldClaimAndClose, skipUnwrapSOL })` | `Promise<Transaction[]>` | `bps` as `BN(10000)` = 100%. Set `shouldClaimAndClose: true` to also claim fees + close the position in the same flow. **Returns multiple txs — sign and send them sequentially.** |
| Close empty position | `dlmmPool.closePosition({ owner, position })` / `closePositionIfEmpty` | `Promise<Transaction>` | Reclaims account rent. |

Sketch of a withdraw-100% server route:

```ts
const dlmmPool = await DLMM.create(connection, new PublicKey(poolAddress));
const position = await dlmmPool.getPosition(new PublicKey(positionAddress));
const txs = await dlmmPool.removeLiquidity({
  user: new PublicKey(owner),
  position: new PublicKey(positionAddress),
  fromBinId: position.positionData.lowerBinId,
  toBinId: position.positionData.upperBinId,
  bps: new BN(10000),
  shouldClaimAndClose: true,
});
return txs.map((tx) => Buffer.from(tx.serialize({ requireAllSignatures: false })).toString("base64"));
```

The client would then iterate the array, deserialize each, `signTransaction`, and post to `/api/solana/sendRaw`.

### Bin liquidity chart

`positionBinData[]` is already in the SDK response (`binId`, `binXAmount`, `binYAmount`, `binLiquidity`, `positionXAmount`, `positionYAmount`, `positionFeeXAmount`, …). Drawing a histogram of `positionLiquidity` over `binId` with a marker on `activeBinId` is straight SVG (~150 lines, no chart-lib dep — same approach as `src/shared/PieChart/PieChart.tsx`). Effort: about half a day including responsive sizing and tooltips.

### DAMM v2 positions

Separate program (`cp-amm`). Would need `@meteora-ag/cp-amm-sdk` (or its equivalent) and a parallel server route. Not started.

### Pool TVL / APR

Available at `https://dlmm.datapi.meteora.ag/pair/all` (and per-pool endpoint). Could be fetched once per session for the Ideas dashboard, but Meteora isn't on that surface yet.

## Test wallet

`EP9fKzBpQzyZC2GYjjAF9tKEeUwi7dqNqMStmxdYu4h2` has a small SOL/USDC DLMM position in pool `BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y` (bin step 10, fee 0.1%). Endpoint check:

```bash
curl "http://localhost:3000/api/protocols/meteora/userPositions?address=EP9fKzBpQzyZC2GYjjAF9tKEeUwi7dqNqMStmxdYu4h2&debug=1" | jq '{totalUsd, pair: .enriched[0].tokenX.symbol + "/" + .enriched[0].tokenY.symbol, inRange: .enriched[0].positions[0].inRange}'
```
