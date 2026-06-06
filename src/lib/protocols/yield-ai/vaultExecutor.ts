import {
  Aptos,
  AptosConfig,
  Network,
  Account,
  Ed25519PrivateKey,
} from "@aptos-labs/ts-sdk";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";
import {
  YIELD_AI_VAULT_ENTRYPOINTS,
  YIELD_AI_HYPERION_ADAPTER_ADDRESS,
} from "@/lib/constants/yieldAiVault";

const APTOS_API_KEY = process.env.APTOS_API_KEY;

const config = new AptosConfig({
  network: Network.MAINNET,
  ...(APTOS_API_KEY && {
    clientConfig: {
      HEADERS: { Authorization: `Bearer ${APTOS_API_KEY}` },
    },
  }),
});

const aptos = new Aptos(config);

/** Aptos SDK entry function id shape: `0xaddr::module::function` */
type EntryFunctionId = `${string}::${string}::${string}`;

let cachedExecutorAccount: Account | null = null;

function getExecutorAccount(): Account {
  if (cachedExecutorAccount) return cachedExecutorAccount;

  const privateKeyHex = process.env.YIELD_AI_EXECUTOR_PRIVATE_KEY;
  if (!privateKeyHex) {
    throw new Error("YIELD_AI_EXECUTOR_PRIVATE_KEY is not configured");
  }

  const keyHex = privateKeyHex.replace(/^0x/, "").trim();
  const account = Account.fromPrivateKey({
    privateKey: new Ed25519PrivateKey(keyHex),
  });

  cachedExecutorAccount = account;
  return account;
}

type ExecutorArg = string | number | bigint | number[] | Uint8Array;

async function buildAndSubmit(options: {
  function: string;
  typeArguments?: string[];
  functionArguments: ExecutorArg[];
  maxGasAmount?: number;
  dryRun?: boolean;
  logPrefix?: string;
}) {
  const {
    function: fn,
    typeArguments = [],
    functionArguments,
    maxGasAmount = 50_000,
    dryRun = false,
    logPrefix = "[Yield AI]",
  } = options;

  if (dryRun) {
    let senderLabel: string;
    if (process.env.YIELD_AI_EXECUTOR_PRIVATE_KEY) {
      senderLabel = getExecutorAccount().accountAddress.toString();
    } else {
      senderLabel =
        "(dry-run: YIELD_AI_EXECUTOR_PRIVATE_KEY unset — live runs would fail at submit)";
    }
    console.log(`${logPrefix} dryRun tx build:`, {
      function: fn,
      sender: senderLabel,
      typeArguments,
      functionArguments,
    });
    return { hash: null as string | null, dryRun: true };
  }

  const executor = getExecutorAccount();
  const executorAddress = executor.accountAddress;

  const transaction = await aptos.transaction.build.simple({
    sender: executorAddress,
    withFeePayer: false,
    data: {
      function: fn as EntryFunctionId,
      typeArguments,
      functionArguments: functionArguments.map((a) => {
        if (a instanceof Uint8Array) return a;
        if (Array.isArray(a)) return Uint8Array.from(a);
        if (typeof a === "bigint") return a.toString();
        return String(a);
      }),
    },
    options: { maxGasAmount },
  });

  const senderAuthenticator = aptos.transaction.sign({
    signer: executor,
    transaction,
  });

  const result = await aptos.transaction.submit.simple({
    transaction,
    senderAuthenticator,
  });

  const hash = result.hash as string;

  console.log(`${logPrefix} tx submitted:`, {
    hash,
    function: fn,
  });

  // Wait until this tx is committed so the next tx from the same executor gets a fresh sequence number.
  // Without this, rapid back-to-back submits hit: invalid_transaction_update / mempool payload mismatch.
  await aptos.waitForTransaction({
    transactionHash: hash,
  });

  console.log(`${logPrefix} tx confirmed on-chain:`, { hash, function: fn });

  return { hash, dryRun: false };
}

export async function submitYieldAiExecutorEntryFunction(options: {
  fn: string;
  typeArguments?: string[];
  functionArguments: ExecutorArg[];
  maxGasAmount?: number;
  dryRun?: boolean;
  logPrefix?: string;
}) {
  const { fn, typeArguments, functionArguments, maxGasAmount, dryRun, logPrefix } = options;
  return buildAndSubmit({
    function: fn,
    typeArguments,
    functionArguments,
    maxGasAmount,
    dryRun,
    logPrefix,
  });
}

export async function executeSwapAptToUsdc(options: {
  safeAddress: string;
  feeTier: bigint | number;
  amountInBaseUnits: bigint;
  amountOutMinBaseUnits: bigint;
  sqrtPriceLimit: bigint;
  toToken: string;
  deadlineUnixSeconds: bigint | number;
  maxGasAmount?: number;
  dryRun?: boolean;
}) {
  const {
    safeAddress,
    feeTier,
    amountInBaseUnits,
    amountOutMinBaseUnits,
    sqrtPriceLimit,
    toToken,
    deadlineUnixSeconds,
    maxGasAmount,
    dryRun,
  } = options;

  return buildAndSubmit({
    function: YIELD_AI_VAULT_ENTRYPOINTS.executeSwapAptToFa,
    functionArguments: [
      toCanonicalAddress(safeAddress),
      feeTier,
      amountInBaseUnits,
      amountOutMinBaseUnits,
      sqrtPriceLimit,
      toCanonicalAddress(toToken),
      deadlineUnixSeconds,
    ],
    maxGasAmount,
    dryRun,
    logPrefix: "[Yield AI] execute_swap_apt_to_fa",
  });
}

export async function executeSwapFaToFa(options: {
  safeAddress: string;
  feeTier: bigint | number;
  amountInBaseUnits: bigint;
  amountOutMinBaseUnits: bigint;
  sqrtPriceLimit: bigint;
  fromTokenMetadata: string;
  toTokenMetadata: string;
  deadlineUnixSeconds: bigint | number;
  maxGasAmount?: number;
  dryRun?: boolean;
}) {
  const {
    safeAddress,
    feeTier,
    amountInBaseUnits,
    amountOutMinBaseUnits,
    sqrtPriceLimit,
    fromTokenMetadata,
    toTokenMetadata,
    deadlineUnixSeconds,
    maxGasAmount,
    dryRun,
  } = options;

  return buildAndSubmit({
    function: YIELD_AI_VAULT_ENTRYPOINTS.executeSwapFaToFa,
    functionArguments: [
      toCanonicalAddress(safeAddress),
      feeTier,
      amountInBaseUnits,
      amountOutMinBaseUnits,
      sqrtPriceLimit,
      toCanonicalAddress(fromTokenMetadata),
      toCanonicalAddress(toTokenMetadata),
      deadlineUnixSeconds,
    ],
    maxGasAmount,
    dryRun,
    logPrefix: "[Yield AI] execute_swap_fa_to_fa",
  });
}

export async function executeDepositEchelonFa(options: {
  safeAddress: string;
  adapterAddress: string;
  marketObj: string;
  amountBaseUnits: bigint;
  maxGasAmount?: number;
  dryRun?: boolean;
}) {
  const { safeAddress, adapterAddress, marketObj, amountBaseUnits, maxGasAmount, dryRun } = options;
  return buildAndSubmit({
    function: YIELD_AI_VAULT_ENTRYPOINTS.executeDepositEchelonFa,
    functionArguments: [
      toCanonicalAddress(safeAddress),
      toCanonicalAddress(adapterAddress),
      toCanonicalAddress(marketObj),
      amountBaseUnits,
    ],
    maxGasAmount,
    dryRun,
    logPrefix: "[Yield AI] execute_deposit_echelon_fa",
  });
}

export async function executeClaimEchelonReward(options: {
  safeAddress: string;
  adapterAddress: string;
  rewardCoinType: string;
  rewardMetadata: string;
  farmingId: string;
  maxGasAmount?: number;
  dryRun?: boolean;
}) {
  const {
    safeAddress,
    adapterAddress,
    rewardCoinType,
    rewardMetadata,
    farmingId,
    maxGasAmount,
    dryRun,
  } = options;

  return buildAndSubmit({
    function: YIELD_AI_VAULT_ENTRYPOINTS.executeClaimEchelon,
    typeArguments: [rewardCoinType],
    functionArguments: [
      toCanonicalAddress(safeAddress),
      toCanonicalAddress(adapterAddress),
      toCanonicalAddress(rewardMetadata),
      farmingId,
    ],
    maxGasAmount,
    dryRun,
    logPrefix: "[Yield AI] execute_claim_echelon",
  });
}

// ───────────────────────── Hyperion CLMM LP ─────────────────────────

/**
 * Executor: open a Hyperion CLMM LP position via USDC zap-in.
 * `tickLower`/`tickUpper` are u32; `swapAmountIn` is the USDC portion to swap to
 * the non-USDC leg before adding liquidity (0 for single-sided).
 */
export async function executeHyperionOpenZapUsdc(options: {
  safeAddress: string;
  tokenA: string;
  tokenB: string;
  feeTier: bigint | number;
  tickLower: number;
  tickUpper: number;
  usdcAmountInBaseUnits: bigint;
  swapAmountInBaseUnits: bigint;
  swapAmountOutMinBaseUnits: bigint;
  deadlineUnixSeconds: bigint | number;
  maxGasAmount?: number;
  dryRun?: boolean;
}) {
  return buildAndSubmit({
    function: YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionOpenZapUsdc,
    functionArguments: [
      toCanonicalAddress(options.safeAddress),
      toCanonicalAddress(YIELD_AI_HYPERION_ADAPTER_ADDRESS),
      toCanonicalAddress(options.tokenA),
      toCanonicalAddress(options.tokenB),
      options.feeTier,
      options.tickLower,
      options.tickUpper,
      options.usdcAmountInBaseUnits,
      options.swapAmountInBaseUnits,
      options.swapAmountOutMinBaseUnits,
      options.deadlineUnixSeconds,
    ],
    maxGasAmount: options.maxGasAmount,
    dryRun: options.dryRun,
    logPrefix: "[Yield AI] execute_hyperion_open_zap_usdc",
  });
}

/** Executor: add USDC (zap-in) to an existing Hyperion position. */
export async function executeHyperionAddZapUsdc(options: {
  safeAddress: string;
  position: string;
  usdcAmountInBaseUnits: bigint;
  swapAmountInBaseUnits: bigint;
  swapAmountOutMinBaseUnits: bigint;
  deadlineUnixSeconds: bigint | number;
  maxGasAmount?: number;
  dryRun?: boolean;
}) {
  return buildAndSubmit({
    function: YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionAddZapUsdc,
    functionArguments: [
      toCanonicalAddress(options.safeAddress),
      toCanonicalAddress(YIELD_AI_HYPERION_ADAPTER_ADDRESS),
      toCanonicalAddress(options.position),
      options.usdcAmountInBaseUnits,
      options.swapAmountInBaseUnits,
      options.swapAmountOutMinBaseUnits,
      options.deadlineUnixSeconds,
    ],
    maxGasAmount: options.maxGasAmount,
    dryRun: options.dryRun,
    logPrefix: "[Yield AI] execute_hyperion_add_zap_usdc",
  });
}

/**
 * Executor: open a Hyperion CLMM LP position from BOTH legs already in the safe
 * (dual / two-sided), no swap. `amountAMin`/`amountBMin` default to 0 (CLMM
 * rounding); leftovers of the over-supplied leg are returned to the safe.
 */
export async function executeHyperionOpenDual(options: {
  safeAddress: string;
  tokenA: string;
  tokenB: string;
  feeTier: bigint | number;
  tickLower: number;
  tickUpper: number;
  amountABaseUnits: bigint;
  amountBBaseUnits: bigint;
  amountAMinBaseUnits?: bigint;
  amountBMinBaseUnits?: bigint;
  deadlineUnixSeconds: bigint | number;
  maxGasAmount?: number;
  dryRun?: boolean;
}) {
  return buildAndSubmit({
    function: YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionOpenDual,
    functionArguments: [
      toCanonicalAddress(options.safeAddress),
      toCanonicalAddress(YIELD_AI_HYPERION_ADAPTER_ADDRESS),
      toCanonicalAddress(options.tokenA),
      toCanonicalAddress(options.tokenB),
      options.feeTier,
      options.tickLower,
      options.tickUpper,
      options.amountABaseUnits,
      options.amountBBaseUnits,
      options.amountAMinBaseUnits ?? 0n,
      options.amountBMinBaseUnits ?? 0n,
      options.deadlineUnixSeconds,
    ],
    maxGasAmount: options.maxGasAmount,
    dryRun: options.dryRun,
    logPrefix: "[Yield AI] execute_hyperion_open_dual",
  });
}

/** Executor: add both legs (dual) to an existing Hyperion position, no swap. */
export async function executeHyperionAddDual(options: {
  safeAddress: string;
  position: string;
  amountABaseUnits: bigint;
  amountBBaseUnits: bigint;
  amountAMinBaseUnits?: bigint;
  amountBMinBaseUnits?: bigint;
  deadlineUnixSeconds: bigint | number;
  maxGasAmount?: number;
  dryRun?: boolean;
}) {
  return buildAndSubmit({
    function: YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionAddDual,
    functionArguments: [
      toCanonicalAddress(options.safeAddress),
      toCanonicalAddress(YIELD_AI_HYPERION_ADAPTER_ADDRESS),
      toCanonicalAddress(options.position),
      options.amountABaseUnits,
      options.amountBBaseUnits,
      options.amountAMinBaseUnits ?? 0n,
      options.amountBMinBaseUnits ?? 0n,
      options.deadlineUnixSeconds,
    ],
    maxGasAmount: options.maxGasAmount,
    dryRun: options.dryRun,
    logPrefix: "[Yield AI] execute_hyperion_add_dual",
  });
}

/** Executor or owner: claim CLMM fees (perf fee per leg to treasury). */
export async function executeHyperionClaimFees(options: {
  safeAddress: string;
  position: string;
  maxGasAmount?: number;
  dryRun?: boolean;
}) {
  return buildAndSubmit({
    function: YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionClaimFees,
    functionArguments: [
      toCanonicalAddress(options.safeAddress),
      toCanonicalAddress(YIELD_AI_HYPERION_ADAPTER_ADDRESS),
      toCanonicalAddress(options.position),
    ],
    maxGasAmount: options.maxGasAmount,
    dryRun: options.dryRun,
    logPrefix: "[Yield AI] execute_hyperion_claim_fees",
  });
}

/** Executor or owner: claim farm rewards for a Hyperion position (→ safe). */
export async function executeHyperionClaimRewards(options: {
  safeAddress: string;
  position: string;
  maxGasAmount?: number;
  dryRun?: boolean;
}) {
  return buildAndSubmit({
    function: YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionClaimRewards,
    functionArguments: [
      toCanonicalAddress(options.safeAddress),
      toCanonicalAddress(YIELD_AI_HYPERION_ADAPTER_ADDRESS),
      toCanonicalAddress(options.position),
    ],
    maxGasAmount: options.maxGasAmount,
    dryRun: options.dryRun,
    logPrefix: "[Yield AI] execute_hyperion_claim_rewards",
  });
}

/** Executor or owner: remove all liquidity from a Hyperion position (funds → safe). */
export async function executeHyperionRemoveAll(options: {
  safeAddress: string;
  position: string;
  deadlineUnixSeconds: bigint | number;
  maxGasAmount?: number;
  dryRun?: boolean;
}) {
  return buildAndSubmit({
    function: YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionRemoveAll,
    functionArguments: [
      toCanonicalAddress(options.safeAddress),
      toCanonicalAddress(YIELD_AI_HYPERION_ADAPTER_ADDRESS),
      toCanonicalAddress(options.position),
      options.deadlineUnixSeconds,
    ],
    maxGasAmount: options.maxGasAmount,
    dryRun: options.dryRun,
    logPrefix: "[Yield AI] execute_hyperion_remove_all",
  });
}

