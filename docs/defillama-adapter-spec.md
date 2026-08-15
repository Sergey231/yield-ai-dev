# Yield AI — DefiLlama adapter spec (Aptos)

Self-contained handoff for building a DefiLlama TVL adapter for the **Yield AI agent vault**
on Aptos mainnet. A fresh session should be able to write the adapter from this file alone.

Target repo: `DefiLlama/DefiLlama-Adapters` → `projects/yield-ai/index.js` (Aptos helpers in
`projects/helper/chain/aptos.js`: `getResources`, `aptosView`, `sumTokens`).

---

## 1. What the protocol is (TVL model)

Yield AI manages per-user **safe objects** (on-chain resource accounts). Each safe custodies
the user's funds and deploys them into Aptos DeFi via adapters. **TVL = the value of all assets
held by all safes**, across these components per safe:

| Component | Where the value lives | How to read |
|---|---|---|
| Idle FA balances | the safe object's fungible stores | `primary_fungible_store::balance(safe, token)` |
| Hyperion CLMM LP | locked in Hyperion | `vault::get_hyperion_positions` + per-position composition |
| Echelon lending | deposited in Echelon | Echelon adapter views |
| Decibel delta-neutral | spot leg in safe (counted above) + perp margin on Decibel | `delta_neutral` views (optional — see §6) |

**Recommended v1 scope:** idle FA balances + Hyperion LP underlying + Echelon deposits. Add each
to the balances object as the **underlying token**; let DefiLlama price them. (Decibel perp margin
is debatable — see §6, default: exclude to avoid double-counting with Decibel's own TVL.)

---

## 2. Key on-chain addresses (mainnet)

```
Vault package:   0x333d1890e0aa3762bb256f5caeeb142431862628c63063801f44c152ef154700
  module:        {pkg}::vault
  strategy reg:  {pkg}::strategy_registry
  DN module:     {pkg}::delta_neutral
Hyperion DEX:    0x8b4a2c4bb53857c718a04c020b98f8c2e1f99a68b0f57389a8bf5434cd22e05c  (pool_v3)
```

**Tokens (FA metadata addresses, all 6 decimals unless noted):**
```
USDC  0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b  (6)
USDt  0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b  (6)
USD1  0x05fabd1b12e39967a3c24e91b7b8f67719a6dacee74f3c8b9fb7d93e855437d2  (6)
WBTC  0x68844a0d7f2587e726ad0579f3d640865bb4162c08a4589eeda3f9689ec52a3d  (8)
APT   0x000000000000000000000000000000000000000000000000000000000000000a  (8)  (coin 0x1::aptos_coin::AptosCoin)
```
The current canonical list lives in `src/lib/constants/yieldAiVault.ts`
(`USDC_FA_METADATA_MAINNET`, `USDt`, `USD1_FA_METADATA_MAINNET`, `WBTC_FA_METADATA_MAINNET`,
`YIELD_AI_HYPERION_POOLS`).

---

## 3. Enumerate all safes

```
view {pkg}::vault::get_total_safes() -> u64
view {pkg}::vault::get_safes_range_info(start: u64, limit: u64)
     -> vector<tuple/struct (safe_address: address, owner: address, paused: bool, exists: bool)>
```
Loop `start = 0 .. total` in pages of 100. Collect `safe_address` for entries where `exists`.
(Normalize addresses — Aptos addresses vary in leading zeros / 0x prefix; lowercase + pad.)

Optional filter by strategy (not required for TVL — count all safes):
```
view {pkg}::strategy_registry::get_safe_active_strategies(safe) -> vector<vector<u8>>
```

---

## 4. Per-safe TVL components

### 4a. Idle FA balances (in the safe object)
For each safe and each token in §2:
```
view 0x1::primary_fungible_store::balance<0x1::object::ObjectCore>(safe, token_metadata) -> u64
```
Add `balances[token] += amount`. (These are dust/leftover/unallocated funds sitting in the safe.)

### 4b. Hyperion CLMM LP positions (underlying)
```
view {pkg}::vault::get_hyperion_positions(safe) -> vector<address>          // open position object addrs
view {pkg}::vault::get_hyperion_position(safe, position) -> HyperionPositionView
```
`HyperionPositionView` includes: `token_a`, `token_b`, `tick_lower`, `tick_upper`, `liquidity`,
`amount_a`, `amount_b`, `closed`. For TVL: for each NON-closed position add the current composition
as underlying:
```
balances[token_a] += amount_a
balances[token_b] += amount_b
```
> If `amount_a`/`amount_b` aren't returned live by the view, compute them from `liquidity` +
> `tick_lower/upper` + the pool's current tick via Hyperion `pool_v3` (see
> `src/lib/protocols/yield-ai/hyperionLp.ts: readSafeHyperionPositions`, which already does this).
> Tick encoding note: ticks are **i32 stored as two's-complement u32** (values ≥ 2^31 are negative).

### 4c. Echelon lending deposits
Yield AI deposits stablecoins (e.g. USD1/USDC) into Echelon. Read the safe's Echelon supply
position and add the underlying. Reference: `config/strategy-usd1-echelon-compound.json` for the
market objects, and `src/lib/protocols/yield-ai/` Echelon adapter usage. Add `balances[token] +=
suppliedAmount`.

---

## 5. DefiLlama adapter skeleton

```js
// projects/yield-ai/index.js
const PKG = "0x333d1890e0aa3762bb256f5caeeb142431862628c63063801f44c152ef154700";
const TOKENS = {
  USDC: "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b",
  USDt: "0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b",
  USD1: "0x05fabd1b12e39967a3c24e91b7b8f67719a6dacee74f3c8b9fb7d93e855437d2",
  WBTC: "0x68844a0d7f2587e726ad0579f3d640865bb4162c08a4589eeda3f9689ec52a3d",
  APT:  "0x000000000000000000000000000000000000000000000000000000000000000a",
};
const { aptosView, getResources } = require("../helper/chain/aptos"); // confirm exact helpers

async function tvl(api) {
  const total = Number(await aptosView({ function: `${PKG}::vault::get_total_safes` }))[0] ?? 0;
  const safes = [];
  for (let s = 0; s < total; s += 100) {
    const rows = (await aptosView({
      function: `${PKG}::vault::get_safes_range_info`,
      arguments: [String(s), "100"],
    }))[0];
    for (const r of rows) if (r.exists) safes.push(r.safe_address);
  }
  for (const safe of safes) {
    // idle FA balances
    for (const t of Object.values(TOKENS)) {
      const bal = (await aptosView({
        function: "0x1::primary_fungible_store::balance",
        type_arguments: ["0x1::object::ObjectCore"],
        arguments: [safe, t],
      }))[0];
      if (+bal) api.add(t, bal);
    }
    // Hyperion LP underlying
    const positions = (await aptosView({ function: `${PKG}::vault::get_hyperion_positions`, arguments: [safe] }))[0] ?? [];
    for (const p of positions) {
      const pos = (await aptosView({ function: `${PKG}::vault::get_hyperion_position`, arguments: [safe, p] }))[0];
      if (pos && !pos.closed) {
        if (+pos.amount_a) api.add(pos.token_a, pos.amount_a);
        if (+pos.amount_b) api.add(pos.token_b, pos.amount_b);
      }
    }
    // TODO: Echelon supplied balances (§4c)
  }
}

module.exports = { timetravel: false, methodology: "Sums assets custodied by all Yield AI safes: idle balances, Hyperion CLMM LP underlying, and Echelon lending deposits.", aptos: { tvl } };
```
> Verify exact DefiLlama Aptos helper names/signatures against `projects/helper/chain/aptos.js` in
> the live repo — they evolve. `api.add(token, amount)` keys by FA metadata address; DefiLlama prices.

---

## 6. Decisions / gotchas

- **Decibel perp margin:** USDC margin on a Decibel subaccount is arguably Decibel's TVL, not Yield
  AI's. Default: **exclude** to avoid double-counting. The DN spot leg lives in the safe and is
  already counted via §4a/§4b. (`{pkg}::delta_neutral::get_delta_neutral_position_v2` if you decide
  to include it.)
- **Don't double-count:** a token is either idle in the safe (§4a) OR locked in Hyperion (§4b) OR in
  Echelon (§4c) — never both. The views return disjoint amounts, so summing is correct.
- **Address normalization:** pad/lowercase addresses before dedup/compare.
- **Pricing:** WBTC priced by DefiLlama via its FA address; stables ≈ $1. Don't hand-price — `api.add`
  the raw amounts and let DefiLlama's Aptos pricing handle it.
- **Pagination:** `get_safes_range_info` in pages of 100; some safes may be empty (still fine to query).
- **Fullnode:** use DefiLlama's Aptos RPC via the helper (don't hardcode an endpoint).

## 7. Reference files in this repo (for the adapter author)
- `src/lib/constants/yieldAiVault.ts` — addresses, views (`YIELD_AI_VAULT_VIEWS`,
  `YIELD_AI_HYPERION_POOLS`), token metadata.
- `src/lib/protocols/yield-ai/hyperionLp.ts` — `readSafeHyperionPositions` (live LP composition +
  pool_v3 reads, tick math).
- `src/lib/protocols/yield-ai/hyperionLpCron.ts` — `getTotalSafes` / `getSafesRangeInfo` /
  enumeration pattern (mirror this).
- `docs/HYPERION_LP_FRONTEND.md` §1 — deployed contract facts + Hyperion views/events.
- `docs/strategy-registry-and-dn-v2.md` — strategy + delta-neutral views.
