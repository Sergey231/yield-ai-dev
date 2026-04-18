import { BaseProtocol } from './BaseProtocol';

export class MoarMarketProtocol implements BaseProtocol {
  name = 'Moar Market';

  async buildDeposit(amountOctas: bigint, token: string, userAddress?: string): Promise<{
    type: 'entry_function_payload';
    function: string;
    type_arguments: string[];
    arguments: string[];
  }> {
    // Determine poolId and type argument based on token address
    let poolId = '';
    let typeArgument = '';
    let tokenArgument = token;
    
    if (token === '0x1::aptos_coin::AptosCoin' || token === '0xa') {
      poolId = '0'; // APT pool
      typeArgument = '0x1::aptos_coin::AptosCoin';
      // `deposit_entry` expects a hex `address` for the asset/metadata, not a Move type.
      // For APT, Panora uses the FA metadata shorthand "0xa" (odd-length), canonical is "0x0a".
      tokenArgument = '0x0a';
    } else {
      poolId = '1'; // USDC pool
      typeArgument = '0x1::string::String';
    }

    if (!userAddress) {
      throw new Error('User address is required for Moar Market deposit');
    }
    
    return {
      type: 'entry_function_payload',
      function: '0xa3afc59243afb6deeac965d40b25d509bb3aebc12f502b8592c283070abc2e07::pool::deposit_entry',
      type_arguments: [typeArgument],     // correct type argument for each token
      arguments: [
        poolId,                    // pool ID
        tokenArgument,             // token/metadata address
        amountOctas.toString(),    // amount in raw format
        userAddress                // user wallet address
      ]
    };
  }

  async buildWithdraw(marketAddress: string, amountOctas: bigint | null, _token: string, userAddress?: string): Promise<{
    type: 'entry_function_payload';
    function: string;
    type_arguments: string[];
    arguments: (string | null)[];
  }> {
    // For Moar Market, marketAddress is actually the poolId
    // token is the underlying asset address (unused by entry payload but kept for interface parity)
    // userAddress is the user's wallet address
    //
    // On-chain signature: withdraw(signer, pool_id, Option<u64> amount, recipient).
    // null => Option::None: contract withdraws the full redeemable amount (avoids share/amount rounding aborts).
    // bigint => Option::Some(amount): partial withdraw in raw underlying units.

    if (!userAddress) {
      throw new Error('User address is required for Moar Market withdraw');
    }

    return {
      type: 'entry_function_payload',
      function: '0xa3afc59243afb6deeac965d40b25d509bb3aebc12f502b8592c283070abc2e07::pool::withdraw',
      type_arguments: [],
      arguments: [
        marketAddress,
        amountOctas === null ? null : amountOctas.toString(),
        userAddress,
      ],
    };
  }

  async buildClaimRewards(positionIds: string[], tokenTypes: string[], userAddress?: string): Promise<{
    type: 'entry_function_payload';
    function: string;
    type_arguments: string[];
    arguments: any;
  }> {
    // For Moar Market, we claim individual rewards
    // positionIds contains farming_identifiers
    // tokenTypes contains reward_ids
    
    if (positionIds.length !== 1 || tokenTypes.length !== 1) {
      throw new Error('Moar Market supports only individual reward claims');
    }
    
    const farmingIdentifier = positionIds[0];
    const rewardId = tokenTypes[0];
    
    return {
      type: 'entry_function_payload',
      function: '0xa3afc59243afb6deeac965d40b25d509bb3aebc12f502b8592c283070abc2e07::farming::claim_reward_entry',
      type_arguments: [],
      arguments: [rewardId, farmingIdentifier]
    };
  }
}
