import { BaseProtocol } from "./BaseProtocol";

export class KoFiProtocol implements BaseProtocol {
  name = "Kofi Finance";

  async buildDeposit(_amountOctas: bigint, _token: string, _walletAddress?: string): Promise<never> {
    throw new Error('Kofi Finance deposits are disabled while kAPT and stkAPT are deprecated from Echelon core pools');
  }

  async buildWithdraw(marketAddress: string, amountOctas: bigint | null, token: string) {
    if (amountOctas === null) {
      throw new Error('Withdraw amount is required');
    }
    // Kofi Finance liquid staking withdraw transaction - пока не реализуем
    // Return a placeholder payload that will throw an error when used
    return {
      type: "entry_function_payload" as const,
      function: "0x2cc52445acc4c5e5817a0ac475976fbef966fedb6e30e7db792e10619c76181f::gateway::withdraw",
      type_arguments: [],
      arguments: []
    };
  }

  async buildClaimRewards(positionIds: string[], _tokenTypes: string[]): Promise<{
    type: 'entry_function_payload';
    function: string;
    type_arguments: string[];
    arguments: [string[], any[]];
  }> {
    // Kofi Finance claim rewards transaction - пока не реализуем
    // Return a placeholder payload that will throw an error when used
    return {
      type: "entry_function_payload" as const,
      function: "0x2cc52445acc4c5e5817a0ac475976fbef966fedb6e30e7db792e10619c76181f::gateway::claim_rewards",
      type_arguments: [],
      arguments: [positionIds, _tokenTypes]
    };
  }
}
