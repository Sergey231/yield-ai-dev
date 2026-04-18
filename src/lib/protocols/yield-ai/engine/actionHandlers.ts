import { ActionExecutionResult, ComputedState, StrategyRunContext } from "./types";
import { evaluateCondition } from "./conditionEvaluator";
import { getSwapPairParams } from "./swapPairTable";
import { getHyperionAmountOut } from "./hyperionQuote";
import {
  executeClaimApt,
  executeClaimEchelonReward,
  executeDepositEchelonFa,
  executeDepositToMoar,
  executeSwapFaToFa,
  executeWithdrawMoarFull,
} from "@/lib/protocols/yield-ai/vaultExecutor";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";

function slippageBps(ctx: StrategyRunContext): number {
  const global = Number(ctx.config.global.dexDefaults?.slippageBps ?? 0);
  const capped = Number(ctx.mergedRiskLimits?.maxSlippageBps ?? global);
  return Math.max(0, Math.min(global, capped));
}

function applySlippage(amountOut: bigint, bps: number): bigint {
  const b = BigInt(Math.max(0, Math.min(10_000, Math.trunc(bps))));
  return (amountOut * (10_000n - b)) / 10_000n;
}

export async function executeAction(options: {
  ctx: StrategyRunContext;
  action: StrategyRunContext["mergedActions"][number];
  state: ComputedState;
  adapters: { echelonAdapterAddress: string; moarAdapterAddress: string };
  moarAptClaimLines: Array<{ reward_id: string; farming_identifier: string; claimable_amount: string }>;
}): Promise<ActionExecutionResult> {
  const { ctx, action, state, adapters, moarAptClaimLines } = options;

  if (!action.enabled) {
    return { actionId: action.id, executed: false, skippedReason: "disabled", txHashes: [], txCount: 0 };
  }

  if (!evaluateCondition(action.condition, ctx, state)) {
    return {
      actionId: action.id,
      executed: false,
      skippedReason: "condition=false",
      txHashes: [],
      txCount: 0,
    };
  }

  const txHashes: string[] = [];
  let txCount = 0;

  if (action.type === "claimMoarReward") {
    for (const line of moarAptClaimLines) {
      const r = await executeClaimApt({
        safeAddress: ctx.safeAddress,
        adapterAddress: adapters.moarAdapterAddress,
        rewardId: line.reward_id,
        farmingIdentifier: line.farming_identifier,
        dryRun: ctx.dryRun,
      });
      txCount += 1;
      if (!ctx.dryRun && r.hash) txHashes.push(r.hash);
    }
    return { actionId: action.id, executed: true, txHashes, txCount };
  }

  if (action.type === "claimEchelonReward") {
    const rewardCoinType = action.params?.rewardCoinType;
    const rewardMetadata = action.params?.rewardMetadata;
    const farmingId = ctx.mergedContext?.echelon?.farmingId;
    if (typeof rewardCoinType !== "string" || typeof rewardMetadata !== "string") {
      throw new Error("claimEchelonReward missing rewardCoinType/rewardMetadata");
    }
    if (typeof farmingId !== "string" || farmingId.length === 0) {
      throw new Error("claimEchelonReward missing context.echelon.farmingId");
    }

    const r = await executeClaimEchelonReward({
      safeAddress: ctx.safeAddress,
      adapterAddress: adapters.echelonAdapterAddress,
      rewardCoinType,
      rewardMetadata,
      farmingId,
      dryRun: ctx.dryRun,
    });
    txCount += 1;
    if (!ctx.dryRun && r.hash) txHashes.push(r.hash);
    return { actionId: action.id, executed: true, txHashes, txCount };
  }

  if (action.type === "swapFaToFa") {
    const fromAssetKey = action.params?.fromAsset;
    const toAssetKey = action.params?.toAsset;
    if (typeof fromAssetKey !== "string" || typeof toAssetKey !== "string") {
      throw new Error("swapFaToFa missing fromAsset/toAsset");
    }
    const fromAsset = ctx.config.global.assets[fromAssetKey];
    const toAsset = ctx.config.global.assets[toAssetKey];
    if (!fromAsset || !toAsset) {
      throw new Error(`swapFaToFa unknown asset: ${fromAssetKey} -> ${toAssetKey}`);
    }

    const amountIn = state.safeBalance[fromAssetKey] ?? 0n;
    if (amountIn <= 0n) {
      return { actionId: action.id, executed: false, skippedReason: "amountIn<=0", txHashes: [], txCount: 0 };
    }

    const pair = getSwapPairParams(fromAsset.metadata, toAsset.metadata);
    if (!pair) {
      return {
        actionId: action.id,
        executed: false,
        skippedReason: "pair-not-supported",
        txHashes: [],
        txCount: 0,
      };
    }

    const quotedOut = await getHyperionAmountOut({
      amountInBaseUnits: amountIn,
      fromMetadata: fromAsset.metadata,
      toMetadata: toAsset.metadata,
    });
    const minOut = applySlippage(quotedOut, slippageBps(ctx));

    const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(ctx.config.global.dexDefaults.deadlineSecs ?? 120));

    const r = await executeSwapFaToFa({
      safeAddress: ctx.safeAddress,
      feeTier: pair.feeTier,
      amountInBaseUnits: amountIn,
      amountOutMinBaseUnits: minOut,
      sqrtPriceLimit: pair.sqrtPriceLimit,
      fromTokenMetadata: fromAsset.metadata,
      toTokenMetadata: toAsset.metadata,
      deadlineUnixSeconds: deadline,
      dryRun: ctx.dryRun,
    });

    txCount += 1;
    if (!ctx.dryRun && r.hash) txHashes.push(r.hash);
    return { actionId: action.id, executed: true, txHashes, txCount };
  }

  if (action.type === "depositEchelonFa") {
    const assetKey = action.params?.asset;
    const marketObj = ctx.mergedContext?.echelon?.marketObj;
    if (typeof assetKey !== "string") throw new Error("depositEchelonFa missing asset");
    if (typeof marketObj !== "string") throw new Error("depositEchelonFa missing context.echelon.marketObj");

    const amount = state.excessBalance[assetKey] ?? 0n;
    if (amount <= 0n) {
      return { actionId: action.id, executed: false, skippedReason: "amount<=0", txHashes: [], txCount: 0 };
    }

    const r = await executeDepositEchelonFa({
      safeAddress: ctx.safeAddress,
      adapterAddress: adapters.echelonAdapterAddress,
      marketObj,
      amountBaseUnits: amount,
      dryRun: ctx.dryRun,
    });
    txCount += 1;
    if (!ctx.dryRun && r.hash) txHashes.push(r.hash);
    return { actionId: action.id, executed: true, txHashes, txCount };
  }

  if (action.type === "withdrawMoarFull") {
    const assetKey = action.params?.asset;
    if (typeof assetKey !== "string") throw new Error("withdrawMoarFull missing params.asset");
    const asset = ctx.config.global.assets[assetKey];
    if (!asset) throw new Error(`withdrawMoarFull unknown asset ${assetKey}`);

    const r = await executeWithdrawMoarFull({
      safeAddress: ctx.safeAddress,
      adapterAddress: adapters.moarAdapterAddress,
      metadataAddress: asset.metadata,
      dryRun: ctx.dryRun,
    });
    txCount += 1;
    if (!ctx.dryRun && r.hash) txHashes.push(r.hash);
    return { actionId: action.id, executed: true, txHashes, txCount };
  }

  if (action.type === "depositMoar") {
    const assetKey = action.params?.asset;
    if (typeof assetKey !== "string") throw new Error("depositMoar missing params.asset");
    const asset = ctx.config.global.assets[assetKey];
    if (!asset) throw new Error(`depositMoar unknown asset ${assetKey}`);

    const amount = state.safeBalance[assetKey] ?? 0n;
    if (amount <= 0n) {
      return { actionId: action.id, executed: false, skippedReason: "amount<=0", txHashes: [], txCount: 0 };
    }

    const r = await executeDepositToMoar({
      safeAddress: ctx.safeAddress,
      adapterAddress: adapters.moarAdapterAddress,
      metadataAddress: asset.metadata,
      amountBaseUnits: amount,
      dryRun: ctx.dryRun,
    });
    txCount += 1;
    if (!ctx.dryRun && r.hash) txHashes.push(r.hash);
    return { actionId: action.id, executed: true, txHashes, txCount };
  }

  throw new Error(`Unknown action type: ${(action as any).type}`);
}

