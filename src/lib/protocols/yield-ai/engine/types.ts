export type StrategyConfig = {
  version: number;
  network: "mainnet" | "testnet" | "devnet";
  global: {
    package: string;
    rpcUrl: string;
    assets: Record<string, Asset>;
    protocols: Record<string, Protocol>;
    dexDefaults: {
      slippageBps: number;
      deadlineSecs: number;
    };
  };
  scheduler: {
    intervalSecs: number;
    maxConcurrentSafes: number;
    timeoutPerSafeSecs: number;
  };
  strategies: Record<string, StrategyDefinition>;
  safes: SafeAssignment[];
};

export type Asset = {
  metadata: string;
  decimals: number;
  coinType: string | null;
};

export type Protocol = {
  packageAddress: string;
  adapterAddressView: string;
  poolId?: number;
};

export type StrategyDefinition = {
  strategyVersion: number;
  description: string;
  context: Record<string, any>;
  defaults: Record<string, any>;
  execution: {
    stopOnFailure: boolean;
    maxActionsPerRun: number;
  };
  riskLimits: {
    maxSingleActionUsd: number;
    allowedAssets: string[];
    maxSlippageBps: number;
  };
  actions: Action[];
};

export type SafeAssignment = {
  address: string;
  label: string;
  enabled: boolean;
  priority: number;
  strategyId: string;
  overrides?: {
    defaults?: Record<string, any>;
    actions?: Record<string, Partial<Action>>;
    riskLimits?: Record<string, any>;
    context?: Record<string, any>;
  };
};

export type ActionType =
  | "claimMoarReward"
  | "claimEchelonReward"
  | "swapFaToFa"
  | "depositEchelonFa"
  | "withdrawMoarFull"
  | "depositMoar";

export type Action = {
  id: string;
  type: ActionType;
  description: string;
  enabled: boolean;
  dependsOn?: string[];
  params: Record<string, any>;
  condition?: Condition;
  onError: "continue" | "halt";
};

export type Condition =
  | {
      leftRef: string;
      op: ">=" | ">" | "<=" | "<" | "==" | "!=";
      rightRef: string;
    }
  | {
      allOf: Array<{
        leftRef: string;
        op: ">=" | ">" | "<=" | "<" | "==" | "!=";
        rightRef: string;
      }>;
    };

export type ComputedState = {
  safeBalance: Record<string, bigint>;
  excessBalance: Record<string, bigint>;
  moarClaimableApt: bigint;
  echelonClaimable: Record<string, bigint>;
};

export type StrategyRunContext = {
  runId: string;
  safeAddress: string;
  safeLabel: string;
  dryRun: boolean;
  config: StrategyConfig;
  strategyId: string;
  strategy: StrategyDefinition;
  mergedContext: Record<string, any>;
  mergedDefaults: Record<string, any>;
  mergedRiskLimits: StrategyDefinition["riskLimits"];
  mergedActions: Action[];
};

export type ActionExecutionResult = {
  actionId: string;
  executed: boolean;
  skippedReason?: string;
  txHashes: string[];
  txCount: number;
};

