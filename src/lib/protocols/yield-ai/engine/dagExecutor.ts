import { ActionExecutionResult, ComputedState, StrategyRunContext } from "./types";
import { executeAction } from "./actionHandlers";
import { refreshBalancesForAllowedAssets } from "./stateComputer";

function topoSort(actions: StrategyRunContext["mergedActions"]): StrategyRunContext["mergedActions"] {
  const byId = new Map(actions.map((a) => [a.id, a]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const out: any[] = [];

  function visit(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Action dependency cycle detected at ${id}`);
    }
    const a = byId.get(id);
    if (!a) return;
    visiting.add(id);
    for (const dep of a.dependsOn ?? []) {
      visit(dep);
    }
    visiting.delete(id);
    visited.add(id);
    out.push(a);
  }

  for (const a of actions) visit(a.id);
  return out as any;
}

export async function executeActionDag(options: {
  ctx: StrategyRunContext;
  state: ComputedState;
  adapters: { echelonAdapterAddress: string; moarAdapterAddress: string };
  moarAptClaimLines: Array<{ reward_id: string; farming_identifier: string; claimable_amount: string }>;
}): Promise<{
  results: ActionExecutionResult[];
  totalTxCount: number;
  txHashes: string[];
}> {
  const { ctx, state, adapters, moarAptClaimLines } = options;

  const ordered = topoSort(ctx.mergedActions);
  const maxActions = Number(ctx.strategy.execution?.maxActionsPerRun ?? 100);

  const results: ActionExecutionResult[] = [];
  let executedActions = 0;
  let totalTxCount = 0;
  const allHashes: string[] = [];

  for (const action of ordered) {
    if (executedActions >= maxActions) break;

    try {
      const r = await executeAction({ ctx, action, state, adapters, moarAptClaimLines });
      results.push(r);
      if (r.executed) executedActions += 1;
      totalTxCount += r.txCount;
      allHashes.push(...r.txHashes);

      // Chain actions within one cron pass by refreshing on-chain balances after
      // successful balance-changing transactions. This enables sequences like:
      // withdraw -> swap -> deposit to happen in a single run.
      if (!ctx.dryRun && r.executed && r.txCount > 0) {
        const t = action.type;
        const changesBalance =
          t === "withdrawMoarFull" ||
          t === "swapFaToFa" ||
          t === "depositEchelonFa" ||
          t === "depositMoar" ||
          t === "claimMoarReward" ||
          t === "claimEchelonReward";
        if (changesBalance) {
          await refreshBalancesForAllowedAssets({ ctx, state });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Yield AI] action error:", {
        runId: ctx.runId,
        safeAddress: ctx.safeAddress,
        actionId: action.id,
        actionType: action.type,
        error: msg,
      });
      results.push({
        actionId: action.id,
        executed: false,
        skippedReason: `error:${msg}`,
        txHashes: [],
        txCount: 0,
      });
      if (action.onError === "halt" || ctx.strategy.execution?.stopOnFailure) {
        break;
      }
    }
  }

  return { results, totalTxCount, txHashes: allHashes };
}

