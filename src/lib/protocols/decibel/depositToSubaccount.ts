import { PACKAGE_MAINNET, PACKAGE_TESTNET } from './closePosition';

export const DECIBEL_MAINNET_USDC_METADATA =
  '0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b';

export interface DepositToSubaccountParams {
  subaccountAddr: string;
  amountBaseUnits: bigint | number | string;
  isTestnet?: boolean;
}

export interface DepositAssetToSubaccountParams extends DepositToSubaccountParams {
  assetMetadataAddr: string;
}

export function buildDepositAssetToSubaccountPayload(
  params: DepositAssetToSubaccountParams
): {
  function: string;
  typeArguments: string[];
  functionArguments: unknown[];
} {
  const { subaccountAddr, assetMetadataAddr, amountBaseUnits, isTestnet = false } = params;
  const pkg = isTestnet ? PACKAGE_TESTNET : PACKAGE_MAINNET;

  return {
    function: `${pkg}::dex_accounts_entry::deposit_to_subaccount_at`,
    typeArguments: [],
    functionArguments: [
      subaccountAddr,
      assetMetadataAddr,
      amountBaseUnits.toString(),
    ],
  };
}

export function buildDepositToSubaccountPayload(
  params: DepositToSubaccountParams
): {
  function: string;
  typeArguments: string[];
  functionArguments: unknown[];
} {
  return buildDepositAssetToSubaccountPayload({
    ...params,
    assetMetadataAddr: DECIBEL_MAINNET_USDC_METADATA,
  });
}
