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
} as const;

export const YIELD_AI_VAULT_ENTRYPOINTS = {
  executeClaimApt: `${YIELD_AI_VAULT_MODULE}::execute_claim_apt`,
  executeSwapAptToFa: `${YIELD_AI_VAULT_MODULE}::execute_swap_apt_to_fa`,
  executeSwapFaToFa: `${YIELD_AI_VAULT_MODULE}::execute_swap_fa_to_fa`,
  executeDeposit: `${YIELD_AI_VAULT_MODULE}::execute_deposit`,
  executeWithdrawFull: `${YIELD_AI_VAULT_MODULE}::execute_withdraw_full`,
  executeDepositEchelonFa: `${YIELD_AI_VAULT_MODULE}::execute_deposit_echelon_fa`,
  executeClaimEchelon: `${YIELD_AI_VAULT_MODULE}::execute_claim_echelon`,
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
  },
} as const;

export type HyperionPoolKey = keyof typeof YIELD_AI_HYPERION_POOLS;
