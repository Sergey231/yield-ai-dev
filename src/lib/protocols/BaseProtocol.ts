import { TransactionPayload } from "@aptos-labs/ts-sdk";

/** `null` = protocol-specific max withdraw (Moar: Move `Option::None` on `pool::withdraw`). */
export type ProtocolWithdrawAmount = bigint | null;

export type EntryFunctionArg = string | number | bigint | null;

export interface BaseProtocol {
  name: string;
  buildDeposit(amountOctas: bigint, token: string, userAddress?: string, marketAddress?: string): Promise<{
    type: 'entry_function_payload';
    function: string;
    type_arguments: string[];
    arguments: string[];
  }>;
  buildWithdraw?(marketAddress: string, amountOctas: ProtocolWithdrawAmount, token: string, userAddress?: string): Promise<{
    type: 'entry_function_payload';
    function: string;
    type_arguments: string[];
    arguments: EntryFunctionArg[];
  }>;
  buildClaimRewards?(positionIds: string[], tokenTypes: string[], userAddress?: string): Promise<{
    type: 'entry_function_payload';
    function: string;
    type_arguments: string[];
    arguments: any;
  }>;
} 