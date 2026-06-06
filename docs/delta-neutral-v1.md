## Delta-neutral V1 (Yield AI) — Notes and limitations

### What V1 stores on-chain

V1 delta-neutral state is exposed via the view:

- `{pkg}::delta_neutral::get_delta_neutral_position(safe_address) -> DeltaNeutralPositionView`

In our frontend types (`src/lib/protocols/yield-ai/deltaNeutralViews.ts`), the V1 view includes:

- **recordExists / isOpen**
- **decibelSubaccount**
- **perpMarket**
- **spotAssetMetadata**
- **openedAt**
- **filledShortSize**
- **usdcSwappedIn** (spot entry cost)
- **decibelTxVersion** (open-side Decibel tx version)
- **closedAt**
- **closeDecibelTxVersion** (close-side Decibel tx version)

Important: **V1 does not persist spot-close proceeds** (USDC received from the spot unwind swap), and does not persist a pointer to the spot swap transaction.

### BTC spot hedge asset switch

New BTC delta-neutral opens use native **WBTC** by default for the safe-side spot hedge. To roll back new opens to the legacy **xBTC** spot leg without a code change, set:

- `DECIBEL_DN_BTC_SPOT_ASSET=xbtc` on the server executor path.
- Optional UI mirror: `NEXT_PUBLIC_DECIBEL_DN_BTC_SPOT_ASSET=xbtc`.

Close and residual-sweep flows use the `spotAssetMetadata` stored in the on-chain DN record, so old xBTC positions and new WBTC positions can coexist.

That is why the UI shows:

- “Spot close output: not recorded on-chain”

### Can we build “history of delta-neutral positions” from the V1 contract?

Not from contract state alone, but **we can reconstruct it off-chain** by scanning
executor-signed `record_open` / `record_close` entry calls.

V1 is effectively a **single-slot registry per safe**:

- The view returns the *current snapshot* for the safe (open or last closed snapshot).
- There is no V1 view that returns “all past positions” or “all markets ever used”.

#### Implemented in this repo

`src/lib/protocols/yield-ai/deltaNeutralHistory.ts` + the API route
`src/app/api/protocols/yield-ai/delta-neutral-history/route.ts` reconstruct a
per-safe history this way:

1. Indexer GraphQL query on `account_transactions` filtered to the executor
   address and `entry_function_id_str ∈ {record_open, record_close}`. This is
   cheap because it uses an indexed entry-function filter.
2. For each matched `transaction_version`, the fullnode is asked for the full
   user transaction (`/v1/transactions/by_version/{version}`), bounded
   concurrency (6).
3. Filter to txs whose `payload.arguments[0]` matches the safe address. Parse
   the remaining arguments per the entry-function signatures.
4. Pair opens with the closest later close to produce a `deals` array.
   Aggregate `totalOpens`, `totalCloses`, `uniqueMarkets`.

This is correct as long as the `record_*` permission stays executor-only on
chain — today it is. If V1 is ever upgraded so users can call `record_*`
directly, the indexer query needs to drop the executor-address filter.

#### Limitations of the off-chain reconstruction

- The fullnode call per version is the bottleneck for safes with many deals.
  Mitigated by `staleTime` caching on the client and by lazy-loading (the
  history endpoint is only hit when the user opens the History modal).
- `record_close` arguments don't include the spot-close USDC amount in V1.
  See "Estimating Spot close output in V1 (heuristic)" below.
- If older deals exist beyond `scanLimit` (default 100), the response sets
  `truncated: true`.
- Recommended long-term: upgrade to **V2**, where per-market records and
  close proceeds are persisted on-chain, removing the need to scan.

### Estimating `Spot close output` in V1 (heuristic)

If you need to display an *estimated* `spot_close_usdc_out` for a closed V1 position, the best available approach is a heuristic:

**Idea:** infer from the **last safe swap** in the close window that matches `(spot_asset_metadata → USDC)`.

#### Inputs

- `safe_address`
- `spot_asset_metadata` (WBTC or legacy xBTC metadata, or APT `0x…000a`)
- `closedAt` (seconds) from the V1 record
- `USDC_FA_METADATA_MAINNET`
- executor address (optional, for stronger filtering)

#### 1) Pick a close window

Use a generous time window around `closedAt` (because the close flow is a sequence of txs and timestamps can drift):

- `t0 = closedAt - 10 minutes`
- `t1 = closedAt + 10 minutes`

#### 2) Find candidate swap transactions

Search Aptos transactions in `[t0, t1]` for calls to:

- `{pkg}::vault::execute_swap_fa_to_fa`

Filter to transactions whose arguments match:

- `safe == safe_address`
- `fromMetadata == spot_asset_metadata`
- `toMetadata == USDC_FA_METADATA_MAINNET`
- `feeTier` matches the expected pool (today: 0.05% → `feeTier = 1` for WBTC/USDC, legacy xBTC/USDC, and APT/USDC)

Optionally strengthen with:

- `sender == executorAddress` (if you only want executor-driven closes)

Then select the **last** matching swap within the window.

#### 3) Derive “USDC received”

Preferred methods (best → worst):

- **From state changes**: read the safe’s USDC `FungibleStore` balance delta for that tx version.
- **From swap events**: if emitted, use the event’s `amount_out` where `to_token == USDC`.

If neither is available, you cannot compute an output amount reliably.

#### 4) Present it as an estimate

UI copy should clearly label it as **estimated** and provide the tx link used for inference.

#### Known failure modes

This heuristic can be wrong if:

- the user performed a manual swap with the same asset pair in the same time window,
- the close flow involved multiple partial swaps and you only pick the last one,
- other automation moved USDC in/out of the safe during the window.

### Recommended fix: V2 close proceeds on-chain

V2 resolves this by persisting:

- `usdc_received_on_close`
- `close_swap_tx_version`

See `docs/strategy-registry-and-dn-v2.md` for the V2 spec and recommended close sequencing.

