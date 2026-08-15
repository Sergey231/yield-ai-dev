/**
 * Yield AI Vault contract (mainnet).
 * Module: 0x333d1890e0aa3762bb256f5caeeb142431862628c63063801f44c152ef154700::vault
 */
export const YIELD_AI_VAULT_MODULE =
  "0x333d1890e0aa3762bb256f5caeeb142431862628c63063801f44c152ef154700::vault";

/** Vault package id (mainnet), without `::module` suffix. */
export const YIELD_AI_PACKAGE_ADDRESS =
  "0x333d1890e0aa3762bb256f5caeeb142431862628c63063801f44c152ef154700";

/** View: returns Echelon adapter object address for vault integration. */
export const YIELD_AI_ECHELON_ADAPTER_VIEW =
  `${YIELD_AI_PACKAGE_ADDRESS}::adapter_echelon::get_echelon_adapter_address` as const;

export const VAULT_VIEW = {
  safeRefExists: `${YIELD_AI_VAULT_MODULE}::safe_ref_exists`,
  getSafeCount: `${YIELD_AI_VAULT_MODULE}::get_safe_count`,
  getSafeAddress: `${YIELD_AI_VAULT_MODULE}::get_safe_address`,
} as const;

export const APTOS_COIN_TYPE = "0x1::aptos_coin::AptosCoin";
export const COIN_BALANCE_VIEW = "0x1::coin::balance";

export const YIELD_AI_VAULT_VIEWS = {
  getTotalSafes: `${YIELD_AI_VAULT_MODULE}::get_total_safes`,
  // Returns (safe_address, owner, paused, exists) for range [start, start+limit)
  getSafesRangeInfo: `${YIELD_AI_VAULT_MODULE}::get_safes_range_info`,
  isSafePaused: `${YIELD_AI_VAULT_MODULE}::is_safe_paused`,
  // Per-safe FA swap config existence — pre-flight gate for FA->FA swap actions.
  faSwapConfigExists: `${YIELD_AI_VAULT_MODULE}::fa_swap_config_exists`,
} as const;

/**
 * Per-safe FA swap limits resource (`VaultFaSwapConfig`). Stored at the safe object's
 * address inside the object resource group. Read directly via `getAccountResource` to
 * pre-flight non-zero swap limits — there is no dedicated getter view.
 */
export const YIELD_AI_VAULT_FA_SWAP_CONFIG_TYPE =
  `${YIELD_AI_VAULT_MODULE}::VaultFaSwapConfig` as const;

export const YIELD_AI_VAULT_ENTRYPOINTS = {
  executeClaimApt: `${YIELD_AI_VAULT_MODULE}::execute_claim_apt`,
  executeSwapAptToFa: `${YIELD_AI_VAULT_MODULE}::execute_swap_apt_to_fa`,
  executeSwapFaToFa: `${YIELD_AI_VAULT_MODULE}::execute_swap_fa_to_fa`,
  executeDeposit: `${YIELD_AI_VAULT_MODULE}::execute_deposit`,
  executeWithdrawFull: `${YIELD_AI_VAULT_MODULE}::execute_withdraw_full`,
  executeDepositEchelonFa: `${YIELD_AI_VAULT_MODULE}::execute_deposit_echelon_fa`,
  // Partial Echelon exit (amount in underlying FA base units). Executor-signed;
  // the owner-signed variant exists only as full exit (execute_withdraw_all_echelon_fa_as_owner).
  executeWithdrawEchelonFa: `${YIELD_AI_VAULT_MODULE}::execute_withdraw_echelon_fa`,
  executeClaimEchelon: `${YIELD_AI_VAULT_MODULE}::execute_claim_echelon`,
  // Two-pool Hyperion batch route (e.g. thAPT -> APT -> USDC). Route is allowlisted on-chain.
  executeSwapFaToFaHyperionBatch: `${YIELD_AI_VAULT_MODULE}::execute_swap_fa_to_fa_hyperion_batch`,
  // Hyperion CLMM LP
  executeHyperionOpenZapUsdc: `${YIELD_AI_VAULT_MODULE}::execute_hyperion_open_zap_usdc`,
  executeHyperionAddZapUsdc: `${YIELD_AI_VAULT_MODULE}::execute_hyperion_add_zap_usdc`,
  // Dual (two-sided) entries: both legs supplied directly from the safe, no swap.
  executeHyperionOpenDual: `${YIELD_AI_VAULT_MODULE}::execute_hyperion_open_dual`,
  executeHyperionAddDual: `${YIELD_AI_VAULT_MODULE}::execute_hyperion_add_dual`,
  executeHyperionRemoveLiquidity: `${YIELD_AI_VAULT_MODULE}::execute_hyperion_remove_liquidity`,
  executeHyperionRemoveAll: `${YIELD_AI_VAULT_MODULE}::execute_hyperion_remove_all`,
  executeHyperionClaimFees: `${YIELD_AI_VAULT_MODULE}::execute_hyperion_claim_fees`,
  executeHyperionClaimRewards: `${YIELD_AI_VAULT_MODULE}::execute_hyperion_claim_rewards`,
} as const;

/** Hyperion LP per-safe views on the vault. */
export const YIELD_AI_HYPERION_VIEWS = {
  getPositions: `${YIELD_AI_VAULT_MODULE}::get_hyperion_positions`,
  getPosition: `${YIELD_AI_VAULT_MODULE}::get_hyperion_position`,
  getOpenCount: `${YIELD_AI_VAULT_MODULE}::get_hyperion_open_count`,
  configExists: `${YIELD_AI_VAULT_MODULE}::hyperion_lp_config_exists`,
} as const;

/** Hyperion LP adapter object address (mainnet) — whitelisted in protocol. */
export const YIELD_AI_HYPERION_ADAPTER_ADDRESS =
  "0xe962ebafd209b0106ba9a1c23cde4cd79ef34158ce9a600f120eff9369aac3f5";

/** Hyperion DEX (dex_contract) package address on mainnet — for pool views. */
export const HYPERION_DEX_ADDRESS =
  "0x8b4a2c4bb53857c718a04c020b98f8c2e1f99a68b0f57389a8bf5434cd22e05c";

export const HYPERION_POOL_VIEWS = {
  currentTickAndPrice: `${HYPERION_DEX_ADDRESS}::pool_v3::current_tick_and_price`,
  liquidityPoolAddressSafe: `${HYPERION_DEX_ADDRESS}::pool_v3::liquidity_pool_address_safe`,
  // Pending (uncollected) amounts for an open position object.
  // get_pending_fees → vector<u64> = [feeTokenA, feeTokenB]
  // get_pending_rewards → vector<{ amount_owed: u64, reward_fa: { inner: address } }>
  getPendingFees: `${HYPERION_DEX_ADDRESS}::pool_v3::get_pending_fees`,
  getPendingRewards: `${HYPERION_DEX_ADDRESS}::pool_v3::get_pending_rewards`,
} as const;

/**
 * Hyperion router_v3 batch-route quote views (multi-pool path).
 * `get_batch_amount_out(lp_path, amount_in, from_token, to_token): u64` returns the expected
 * output for a fixed allowlisted route — used to derive `amount_out_min` right before a swap.
 */
export const HYPERION_ROUTER_V3_VIEWS = {
  getBatchAmountOut: `${HYPERION_DEX_ADDRESS}::router_v3::get_batch_amount_out`,
  getBatchAmountIn: `${HYPERION_DEX_ADDRESS}::router_v3::get_batch_amount_in`,
} as const;

/**
 * Allowlisted Hyperion batch route thAPT -> APT -> USDC (mainnet).
 * Leg 1: APT/thAPT pool, Leg 2: USDC/APT pool. This exact `lp_path` is allowlisted on-chain
 * (`protocol::set_hyperion_batch_route`); the executor may vary only `amount_in`/`amount_out_min`.
 * Pass it as a plain address array in `functionArguments` (vector<address>).
 */
export const HYPERION_THAPT_USDC_LP_PATH: readonly string[] = [
  "0x692ba87730279862aa1a93b5fef9a175ea0cccc1f29dfc84d3ec7fbe1561aef3", // thAPT/APT
  "0x925660b8618394809f89f8002e2926600c775221f43bf1919782b297a79400d8", // USDC/APT
];

// Thresholds:
// - APT has 8 decimals
// - USDC has 6 decimals
export const APT_CLAIM_THRESHOLD_OCTAS = BigInt("10000000"); // 0.1 APT
export const USDC_DEPOSIT_THRESHOLD_BASE_UNITS = BigInt("100000"); // 0.1 USDC

/** APT kept on safe after swap: 0 = swap full balance above claim/swap thresholds. */
export const APT_SWAP_RESERVE_OCTAS = BigInt(0);
/** USDC left on safe after deposit: 0 = deposit full detected balance (subject to vault policy caps). */
export const USDC_DEPOSIT_RESERVE_BASE_UNITS = BigInt(0);

// Claim parameters:
export const APT_REWARD_ID = "APT-1";
// From MAINNET_DEPLOY runtime:
export const APT_FARMING_IDENTIFIER =
  "0x22dbe22abf689d8a0f751cab7a32fe5570c49b53fcccd4e5d709b269efda554a-1";

// Swap parameters (APT -> USDC FA):
export const SWAP_FEE_TIER = BigInt(1); // 0.05%
export const SWAP_AMOUNT_OUT_MIN = BigInt(0);
export const SWAP_SQRT_PRICE_LIMIT = BigInt("4295048017");
export const SWAP_DEADLINE_SECONDS = BigInt(600);

/** USDC FA metadata object address (mainnet). Used as second argument to vault::deposit. */
export const USDC_FA_METADATA_MAINNET =
  "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b";

/** USD1 FA metadata object address (mainnet). */
export const USD1_FA_METADATA_MAINNET =
  "0x05fabd1b12e39967a3c24e91b7b8f67719a6dacee74f3c8b9fb7d93e855437d2";

/** xBTC (OKX Wrapped BTC) FA metadata object address (mainnet). */
export const XBTC_FA_METADATA_MAINNET =
  "0x81214a80d82035a190fcb76b6ff3c0145161c3a9f33d137f2bbaee4cfec8a387";

/** Native WBTC FA metadata object address (mainnet). */
export const WBTC_FA_METADATA_MAINNET =
  "0x68844a0d7f2587e726ad0579f3d640865bb4162c08a4589eeda3f9689ec52a3d";

/** ELON (Echelon) FA metadata object address (mainnet). Display + withdraw only. */
export const ELON_FA_METADATA_MAINNET =
  "0xfc087a394c203d62c43eecfeba79db01441d39dd9d234131b78415626a26750e";

/** thAPT (Thala APT) FA metadata object address (mainnet). Display + withdraw only. */
export const THAPT_FA_METADATA_MAINNET =
  "0xa0d9d647c5737a5aed08d2cfeb39c31cf901d44bc4aa024eaa7e5e68b804e011";

// ───────────────────────── Thala CLMM Swap ─────────────────────────

/** Thala CLMM swap adapter (allowlisted in yield_ai vault). */
export const THALA_SWAP_ADAPTER_ADDRESS =
  "0x1bf4a0b27821eba74626848727d6e9870ee1cfb5c354cf9ffecc9f65cf224509";

/** Thala CLMM package address (mainnet) — for pool views. */
export const THALA_CLMM_PACKAGE =
  "0x75b4890de3e312d9425408c43d9a9752b64ab3562a30e89a55bdc568c645920";

/** ELON-USDC pool object (Thala CLMM, 30bps fee, allowlisted). */
export const THALA_ELON_USDC_POOL =
  "0xf6ada118eaa45ddca28f74f1965b6f1f994bef5ebaf651c268238c2ea9ca5695";

/** Permissive upper bound for SELL-ELON direction; economic protection is amount_out_min. */
export const THALA_SELL_ELON_SQRT_LIMIT = BigInt("79005160168441461737552776224");

/**
 * Per-pool UI profile for the open-position form. Volatile pairs use wide ±%
 * presets; stable pairs need a narrow-range mode (±0.05–0.5%), 4-decimal
 * prices, and an APR concentration anchor matching their typical band.
 * `simpleFixedRangePct` (stables) pins the simple-mode width to the band the
 * auto-recenter cron maintains (±0.1% = halfWidthTicks 10) so the user's
 * choice is never silently overridden by the first re-center.
 */
export type HyperionPoolUiProfile = {
  isStable: boolean;
  rangePresetsPct: readonly string[];
  defaultRangePct: string;
  /**
   * Concentration anchor: a ±this% range ≈ the pool's reported headline APR
   * (`feeAPR` = fees ÷ TVL, i.e. the pool's average concentration). Must match
   * the band Hyperion's own UI implies for its headline number, or our per-range
   * estimate diverges from theirs. WBTC/USDC: Hyperion quotes its headline at
   * its default ±5% band, so the anchor is 5 (not 10 — that overstated ~2×).
   */
  aprReferencePct: number;
  priceDecimals: number;
  /** Simple mode locks the range to this width (Advanced unlocks presets). */
  simpleFixedRangePct?: string;
};

const VOLATILE_POOL_UI: HyperionPoolUiProfile = {
  isStable: false,
  rangePresetsPct: ["2.5", "5", "10", "20"],
  // ±5% matches Hyperion's own default band and the APR anchor below, so the
  // opened position lines up with the APR estimate we show.
  defaultRangePct: "5",
  // Hyperion shows its headline APR for the default ±5% band; anchor here so our
  // per-range estimate lines up with theirs (±5% ≈ headline, ±10% ≈ half).
  aprReferencePct: 5,
  priceDecimals: 2,
};

const STABLE_POOL_UI: HyperionPoolUiProfile = {
  isStable: true,
  rangePresetsPct: ["0.05", "0.1", "0.2", "0.5"],
  defaultRangePct: "0.1",
  // The pool's headline APR reflects the AVERAGE concentration of its
  // liquidity, which on stable pairs sits tighter than our default band.
  // Calibrated on mainnet (USDt/USDC safe 0x14d8…174f): a ±0.05% position
  // realized ~1.3× the headline → anchor headline ≈ ±0.05%, so the default
  // ±0.1% shows ~½ headline (conservative vs the ~0.65× observed).
  aprReferencePct: 0.05,
  priceDecimals: 4,
  simpleFixedRangePct: "0.1", // = cron halfWidthTicks 10
};

/**
 * Whitelisted Hyperion LP pools for the AI agent. MVP: USDC-leg pools only.
 * `tokenA`/`tokenB` must match the pool's canonical Hyperion order.
 */
export const YIELD_AI_HYPERION_POOLS = {
  wbtc_usdc: {
    key: "wbtc_usdc" as const,
    label: "WBTC / USDC",
    poolAddress: "0xa7bb8c9b3215e29a3e2c2370dcbad9c71816d385e7863170b147243724b2da58",
    tokenA: WBTC_FA_METADATA_MAINNET, // pool token_a
    tokenB: USDC_FA_METADATA_MAINNET, // pool token_b (USDC leg)
    feeTier: 1, // 0.05%
    tickSpacing: 10,
    usdcIsTokenA: false,
    decimalsA: 8, // WBTC
    decimalsB: 6, // USDC
    symbolA: "WBTC",
    symbolB: "USDC",
    uiEnabled: true,
    ui: VOLATILE_POOL_UI,
  },
  apt_usdc: {
    key: "apt_usdc" as const,
    label: "APT / USDC",
    poolAddress: "0x925660b8618394809f89f8002e2926600c775221f43bf1919782b297a79400d8",
    tokenA: "0x000000000000000000000000000000000000000000000000000000000000000a", // APT
    tokenB: USDC_FA_METADATA_MAINNET,
    feeTier: 1, // 0.05%
    tickSpacing: 10,
    usdcIsTokenA: false,
    decimalsA: 8,
    decimalsB: 6,
    symbolA: "APT",
    symbolB: "USDC",
    // APT/USDC is a Hyperion coin/FA pool (`AptosCoin` + USDC). The current
    // vault LP entries are address-based FA/FA paths, so opening this pool
    // requires a coin-specific contract upgrade.
    uiEnabled: false,
    ui: VOLATILE_POOL_UI,
  },
  xbtc_usdc: {
    key: "xbtc_usdc" as const,
    label: "xBTC / USDC",
    poolAddress: "0xff5a013a4676f724714aec0082403fad822972c56348ba08e0405d08e533325e",
    tokenA: XBTC_FA_METADATA_MAINNET, // 0x81214a80…
    tokenB: USDC_FA_METADATA_MAINNET,
    feeTier: 1, // 0.05%
    tickSpacing: 10,
    usdcIsTokenA: false,
    decimalsA: 8,
    decimalsB: 6,
    symbolA: "xBTC",
    symbolB: "USDC",
    uiEnabled: false, // registry only (not shown in UI yet)
    ui: VOLATILE_POOL_UI,
  },
  usdt_usdc: {
    key: "usdt_usdc" as const,
    label: "USDt / USDC",
    poolAddress: "0xd3894aca06d5f42b27c89e6f448114b3ed6a1ba07f992a58b2126c71dd83c127",
    tokenA: "0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b", // USDt (Tether)
    tokenB: USDC_FA_METADATA_MAINNET,
    feeTier: 0, // 0.01% — stable pair
    tickSpacing: 1,
    usdcIsTokenA: false,
    decimalsA: 6,
    decimalsB: 6,
    symbolA: "USDt",
    symbolB: "USDC",
    uiEnabled: true,
    ui: STABLE_POOL_UI,
  },
  usd1_usdc: {
    key: "usd1_usdc" as const,
    label: "USD1 / USDC",
    poolAddress: "0x1609a6f6e914e60bf958d0e1ba24a471ee2bcadeca9e72659336a1f002be50db",
    tokenA: USD1_FA_METADATA_MAINNET, // 0x05fabd1b…
    tokenB: USDC_FA_METADATA_MAINNET,
    feeTier: 0, // 0.01% — stable pair
    tickSpacing: 1,
    usdcIsTokenA: false,
    decimalsA: 6,
    decimalsB: 6,
    symbolA: "USD1",
    symbolB: "USDC",
    uiEnabled: false, // temporarily hidden — open flow disabled in UI
    ui: STABLE_POOL_UI,
  },
} as const;

export type HyperionPoolKey = keyof typeof YIELD_AI_HYPERION_POOLS;
