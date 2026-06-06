# Token Yield Badges

This document describes the small yield badges rendered next to wallet assets, their data sources, and how to add new Solana LSTs.

## UI entry points

- Wallet token list: `src/components/portfolio/TokenList.tsx`
- Wallet token row and badge rendering: `src/components/portfolio/TokenItem.tsx`
- Shared token yield registry/helpers: `src/lib/yields/tokenYields.ts`
- Yield API route for Solana token yields: `src/app/api/yields/route.ts`

`TokenList` loads two independent yield maps:

1. Aptos staking APRs from `/api/protocols/echelon/v2/pools`.
2. Solana token APYs from `/api/yields?mints=...`, only when the wallet holds a supported token.

`TokenItem` prefers the token APY map from `/api/yields`. If no token APY is available, it can fall back to the Aptos staking APR map.

## Badge labels

Use the label that matches the source:

- OnRe `live-apy` returns APY, so ONyc/ONe badges must be labeled `APY`.
- Hylo `sHYUSD` is compounded in practice; the app labels the compounded latest-epoch estimate as `APY`.
- Sanctum LST data is APY, so Solana LST badges must be labeled `APY`.
- Echelon staking values are currently represented as APR in the existing route/UI path, so Aptos staking badges are APR-style values.

Do not rename APY values to APR unless a separate APR source is added.

## Aptos staking badges

Aptos staking badges are loaded by `TokenList` from:

```txt
/api/protocols/echelon/v2/pools
```

That route returns a `stakingAprs` map. `TokenItem` resolves a token by:

1. Direct token address key.
2. Fungible asset address from `src/lib/data/tokenList.json` via `getTokenList(1)` and `findAptosTokenByAssetId`.
3. Symbol fallback through the token list.

When found, the badge displays:

```txt
{aprPct.toFixed(2)}%
```

The Aptos staking badge still has a tooltip such as `Amnis protocol staking APR` or `Staking APR`.

## Solana token APY badges

Solana token APY badges are loaded through:

```txt
GET /api/yields?mints=<comma-separated-supported-mints>
```

The response shape is:

```ts
type TokenYield = {
  value: number;
  type: "APY";
  source: string;
  sourceUrl?: string;
  updatedAt?: string;
};

type TokenYieldMap = Record<string, TokenYield>;
```

`TokenItem` displays:

```txt
{value.toFixed(2)}% APY
```

The Solana APY badge intentionally has no tooltip.

### ONyc / ONe

ONyc uses this mint:

```txt
5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5
```

The source is the official OnRe APY endpoint:

```txt
https://core.api.onre.finance/data/live-apy
```

The endpoint returns a plain text decimal. Example:

```txt
0.1189
```

The UI/API converts it to percent:

```txt
0.1189 * 100 = 11.89% APY
```

The API returns the same `TokenYield` under the mint and aliases:

- `5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5`
- `ONe`
- `ONyc`
- `ONYC`

`src/lib/yields/tokenYields.ts` also normalizes wallet metadata aliases such as `one`, `onyc`, and `ony` so the badge still appears if the token symbol casing differs.

### sHYUSD

sHYUSD uses this mint:

```txt
HnnGv3HrSqjRpgdFmx7vQGjntNEoex1SU4e9Lxcxuihz
```

The source is the Hylo stats endpoint:

```txt
https://api.hylo.so/stats
```

The route reads:

```ts
exchangeStats.yieldHarvestCache.stablecoinYieldToPool
exchangeStats.yieldHarvestCache.stabilityPoolCap
```

Hylo confirmed this gives the yield for the last epoch:

```txt
epochReturn = stablecoinYieldToPool / stabilityPoolCap
```

The app labels the badge as APY and compounds the latest-epoch yield because the position compounds in practice:

```ts
const epochReturn = stablecoinYieldToPool / stabilityPoolCap;
const epochsPerYear = 186.5; // roughly one 47-hour epoch cadence
const apy = (Math.pow(1 + epochReturn, epochsPerYear) - 1) * 100;
```

The API returns the same `TokenYield` under the mint and aliases:

- `HnnGv3HrSqjRpgdFmx7vQGjntNEoex1SU4e9Lxcxuihz`
- `sHYUSD`
- `SHYUSD`

### Solana LSTs

Current Solana LST support:

| Symbol | Mint | Source |
| --- | --- | --- |
| `JitoSOL` | `J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn` | Sanctum LST APY |
| `mSOL` | `mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So` | Sanctum LST APY |
| `JupSOL` | `jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v` | Sanctum LST APY |
| `bSOL` | `bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1` | Sanctum LST APY |
| `BNSOL` | `BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85` | Sanctum LST APY |
| `bbSOL` | `Bybit2vBJGhPF52GBdNaQfUJ6ZpThSgHBobjWZpLPb4B` | Sanctum LST APY |
| `hyloSOL` | `hy1oXYgrBW6PVcJ4s6s2FKavRdwgWTXdfE69AxT7kPT` | Sanctum LST APY |

The API source follows the DefiLlama `hylo-lsts` adapter approach:

1. If `SANCTUM_API_KEY` exists, try Ironforge:

```txt
https://sanctum-api.ironforge.network/lsts/{mint}?apiKey=...
```

The route reads `avgApy` and converts it to percent.

2. Fallback to the public Sanctum extra API:

```txt
https://extra-api.sanctum.so/v1/apy/indiv-epochs?lst={mint}&n=30
```

The route averages non-zero epoch APYs and converts the decimal APY to percent.

The fallback window is `n=30` because some LSTs can have recent zero APY epochs; a shorter window may not contain enough non-zero observations.

## How to add a new Solana LST

Use this path when the LST is supported by Sanctum APY data.

1. Add the LST to `SOLANA_LST_YIELD_CONFIGS` in `src/lib/yields/tokenYields.ts`:

```ts
{
  mint: "<solana-mint>",
  symbol: "<symbol>",
  name: "<display name>",
  source: "sanctum",
}
```

2. Make sure the wallet token metadata uses either the same mint in `token.address` or the same symbol/name. Mint matching is preferred.

3. Verify the API:

```powershell
curl.exe "http://localhost:3000/api/yields?mints=<solana-mint>"
```

Expected shape:

```json
{
  "<solana-mint>": {
    "value": 6.14,
    "type": "APY",
    "source": "Sanctum LST APY",
    "sourceUrl": "https://extra-api.sanctum.so/v1/apy/indiv-epochs?lst=<solana-mint>&n=30",
    "updatedAt": "2026-05-25T..."
  },
  "<symbol>": {
    "value": 6.14,
    "type": "APY",
    "source": "Sanctum LST APY",
    "sourceUrl": "https://extra-api.sanctum.so/v1/apy/indiv-epochs?lst=<solana-mint>&n=30",
    "updatedAt": "2026-05-25T..."
  }
}
```

4. Open the Solana wallet UI with that token present. The row should show:

```txt
6.14% APY
```

## When not to use Sanctum

Do not add a token to `SOLANA_LST_YIELD_CONFIGS` unless Sanctum returns APY for its mint.

For non-LST yield tokens such as stablecoin staking or protocol LP shares, add a separate provider in `/api/yields` and a registry entry that names the source explicitly. For example, `sHYUSD` should not be treated as a Sanctum LST unless Hylo or another authoritative source confirms that path.

## Local verification

From the repo root:

```powershell
npm.cmd run dev
```

Then test examples:

```powershell
curl.exe "http://localhost:3000/api/yields?mints=5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5"
curl.exe "http://localhost:3000/api/yields?mints=HnnGv3HrSqjRpgdFmx7vQGjntNEoex1SU4e9Lxcxuihz"
curl.exe "http://localhost:3000/api/yields?mints=hy1oXYgrBW6PVcJ4s6s2FKavRdwgWTXdfE69AxT7kPT"
curl.exe "http://localhost:3000/api/yields?mints=5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5,HnnGv3HrSqjRpgdFmx7vQGjntNEoex1SU4e9Lxcxuihz,hy1oXYgrBW6PVcJ4s6s2FKavRdwgWTXdfE69AxT7kPT"
```

Also run:

```powershell
.\node_modules\.bin\tsc.cmd --noEmit --pretty false
```
