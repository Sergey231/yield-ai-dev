import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";
import { YIELD_AI_VAULT_VIEWS } from "@/lib/constants/yieldAiVault";
import {
  STRATEGY_REGISTRY_VIEWS,
  resolveActiveAiAgentStrategy,
} from "@/lib/protocols/yield-ai/strategyRegistry";
import {
  runHyperionAutoClaim,
  runHyperionRecenter,
} from "@/lib/protocols/yield-ai/hyperionLpActions";

const APTOS_API_KEY = process.env.APTOS_API_KEY;
const PAGE_SIZE = 100;

export const HYPERION_LP_CRON_LOCK_KEY = "__yieldAiHyperionLpCronRunning";

const aptos = new Aptos(
  new AptosConfig({
    network: Network.MAINNET,
    ...(APTOS_API_KEY && {
      clientConfig: { HEADERS: { Authorization: `Bearer ${APTOS_API_KEY}` } },
    }),
  })
);

export type HyperionLpCronAction = "claim" | "recenter";

export type HyperionLpCronRunResult = {
  action: HyperionLpCronAction;
  dryRun: boolean;
  safesProcessed: number;
  actedPositions: number;
  results: Array<{ safeAddress: string; error?: string; [k: string]: unknown }>;
};

async function getTotalSafes(): Promise<number> {
  const res = await aptos.view({
    payload: {
      function: YIELD_AI_VAULT_VIEWS.getTotalSafes,
      typeArguments: [],
      functionArguments: [],
    },
  });
  const raw = Array.isArray(res) ? res[0] : (res as unknown);
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

async function getSafeAddressesRange(start: number, limit: number): Promise<string[]> {
  const res = await aptos.view({
    payload: {
      function: YIELD_AI_VAULT_VIEWS.getSafesRangeInfo,
      typeArguments: [],
      functionArguments: [String(start), String(limit)],
    },
  });
  const vec = Array.isArray(res) ? res[0] : res;
  const list = Array.isArray(vec) ? vec : [];
  // get_safes_range_info returns tuples (safe_address, owner, paused, exists).
  return list
    .map((row: unknown) => {
      if (Array.isArray(row)) return typeof row[0] === "string" ? row[0] : null;
      if (row && typeof row === "object") {
        const o = row as Record<string, unknown>;
        const addr = o.safe_address ?? o.address;
        return typeof addr === "string" ? addr : null;
      }
      return null;
    })
    .filter((x): x is string => Boolean(x));
}

async function isHyperionSafe(safe: string): Promise<boolean> {
  try {
    const raw = await aptos.view({
      payload: {
        function: STRATEGY_REGISTRY_VIEWS.getSafeActiveStrategies,
        typeArguments: [],
        functionArguments: [safe],
      },
    });
    const vec = Array.isArray(raw) ? raw[0] : raw;
    return resolveActiveAiAgentStrategy({ activeStrategyIdBytesVec: vec }).activeStrategyId === "hyperion_lp";
  } catch {
    return false;
  }
}

async function resolveHyperionSafes(safeAddresses?: string[]): Promise<string[]> {
  if (Array.isArray(safeAddresses) && safeAddresses.length > 0) {
    return safeAddresses
      .filter((x) => typeof x === "string" && x.trim().length > 0)
      .map((x) => toCanonicalAddress(x));
  }

  const total = await getTotalSafes();
  const all: string[] = [];
  for (let start = 0; start < total; start += PAGE_SIZE) {
    const batch = await getSafeAddressesRange(start, PAGE_SIZE);
    all.push(...batch.map((s) => toCanonicalAddress(s)));
  }
  const flags = await Promise.all(all.map((s) => isHyperionSafe(s)));
  return all.filter((_, i) => flags[i]);
}

export async function runHyperionLpCronPass(options: {
  safeAddresses?: string[];
  action?: HyperionLpCronAction;
  halfWidthTicks?: number;
  edgeBufferTicks?: number;
  slippageBps?: number;
  minReopenUsdcBaseUnits?: bigint;
  minClaimUsd?: number;
  minRewardClaimUsd?: number;
  minRewardSwapUsd?: number;
  swapRewardsToUsdc?: boolean;
  dryRun?: boolean;
}): Promise<HyperionLpCronRunResult> {
  const action: HyperionLpCronAction = options.action === "recenter" ? "recenter" : "claim";
  const dryRun = Boolean(options.dryRun);
  const safes = await resolveHyperionSafes(options.safeAddresses);

  const perSafe: HyperionLpCronRunResult["results"] = [];
  let actedPositions = 0;

  for (const safe of safes) {
    try {
      if (action === "recenter") {
        const res = await runHyperionRecenter({
          safeAddress: safe,
          halfWidthTicks: options.halfWidthTicks,
          edgeBufferTicks: options.edgeBufferTicks,
          slippageBps: options.slippageBps,
          minReopenUsdcBaseUnits: options.minReopenUsdcBaseUnits,
          dryRun,
        });
        actedPositions += res.positions.filter((p) => p.action === "recenter" && !p.error).length;
        perSafe.push(res);
      } else {
        const res = await runHyperionAutoClaim({
          safeAddress: safe,
          minClaimUsd: options.minClaimUsd,
          minRewardClaimUsd: options.minRewardClaimUsd,
          minRewardSwapUsd: options.minRewardSwapUsd,
          swapRewardsToUsdc: options.swapRewardsToUsdc !== false,
          dryRun,
        });
        actedPositions += res.positions.filter((p) => p.action === "claimed").length;
        perSafe.push(res);
      }
    } catch (err) {
      perSafe.push({
        safeAddress: safe,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    action,
    dryRun,
    safesProcessed: safes.length,
    actedPositions,
    results: perSafe,
  };
}
