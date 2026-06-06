import { PACKAGE_MAINNET, PACKAGE_TESTNET } from './closePosition';
import { DECIBEL_MAINNET_USDC_METADATA } from './depositToSubaccount';

export interface WithdrawFromCrossCollateralParams {
  subaccountAddr: string;
  amountBaseUnits: bigint | number | string;
  isTestnet?: boolean;
}

/**
 * Build payload for withdrawing USDC from a Decibel trading account (cross collateral).
 * @see https://docs.decibel.trade/developer-hub/on-chain/account-management/withdraw
 */
export function buildWithdrawFromCrossCollateralPayload(
  params: WithdrawFromCrossCollateralParams
): {
  function: string;
  typeArguments: string[];
  functionArguments: unknown[];
} {
  const { subaccountAddr, amountBaseUnits, isTestnet = false } = params;
  const pkg = isTestnet ? PACKAGE_TESTNET : PACKAGE_MAINNET;

  return {
    function: `${pkg}::dex_accounts_entry::withdraw_from_cross_collateral`,
    typeArguments: [],
    functionArguments: [
      subaccountAddr,
      DECIBEL_MAINNET_USDC_METADATA,
      amountBaseUnits.toString(),
    ],
  };
}
