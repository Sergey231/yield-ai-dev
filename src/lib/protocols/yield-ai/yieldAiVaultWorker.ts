import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";
import { YIELD_AI_VAULT_VIEWS } from "@/lib/constants/yieldAiVault";
import { loadStrategyConfigFromDisk, buildRunContext } from "./engine/configLoader";
import { computeStateForSafe } from "./engine/stateComputer";
import { executeActionDag } from "./engine/dagExecutor";
import {
  STRATEGY_REGISTRY_VIEWS,
  bytesToUtf8String,
} from "@/lib/protocols/yield-ai/strategyRegistry";

export type YieldAiVaultCronRunResult = {
  runId: string;
  startedAtUnixMs: number;
  totalSafes: number;
  /** Kept for backward compatibility; config-driven runs do not use pagination. */
  pageSize: number;
  maxSafesProcessedPerRun: number;
  maxTxPerRun: number;
  processedSafes: number;
  /** Total executed or dry-run simulated vault txs (claim + swap + deposit). */
  txCount: number;
  /** Breakdown of `txCount` (same for dry run and live). */
  txCountByKind: {
    claim: number;
    swap: number;
    deposit: number;
    withdraw: number;
  };
  /** Distinct safes successfully claimed (live only; dry run keeps 0). */
  claimedSafes: number;
  swappedSafes: number;
  depositedSafes: number;
  withdrawnSafes: number;
  txHashes: {
    claim: string[];
    swap: string[];
    deposit: string[];
    withdraw: string[];
  };
  /** Captures suppressed per-action errors for observability. */
  errors: Array<{
    safeAddress: string;
    actionId: string;
    error: string;
  }>;
  /** Safes that were intentionally skipped (e.g. by strategy tags). */
  skippedSafes: Array<{
    safeAddress: string;
    reason: string;
  }>;
  dryRun: boolean;
};

function buildAptos(rpcUrl: string) {
  const config = new AptosConfig({
    network: Network.MAINNET,
    fullnode: rpcUrl,
    ...(process.env.APTOS_API_KEY && {
      clientConfig: { HEADERS: { Authorization: `Bearer ${process.env.APTOS_API_KEY}` } },
    }),
  });
  return new Aptos(config);
}

function parseBool(v: any): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  return s === "true" || s === "1";
}

function parseNumber(v: any): number {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  const n = Number(String(v));
  return Number.isFinite(n) ? n : 0;
}

type SafeEntry = {
  safeAddress: string;
  paused: boolean;
  exists: boolean;
};

function parseSafeEntry(raw: any): SafeEntry | null {
  if (!raw) return null;

  if (typeof raw === "object" && !Array.isArray(raw)) {
    const addr = raw.safe_address ?? raw.safeAddress ?? raw.safe_addr ?? raw.safe ?? null;
    if (typeof addr !== "string") return null;
    return {
      safeAddress: toCanonicalAddress(addr),
      paused: parseBool(raw.paused ?? raw.isPaused ?? false),
      exists: parseBool(raw.exists ?? raw.isExists ?? true),
    };
  }

  if (Array.isArray(raw)) {
    const [safe_address, _owner, paused, exists] = raw;
    if (typeof safe_address !== "string") return null;
    return {
      safeAddress: toCanonicalAddress(safe_address),
      paused: parseBool(paused),
      exists: parseBool(exists),
    };
  }

  return null;
}

async function getTotalSafes(aptos: Aptos): Promise<number> {
  const res = await aptos.view({
    payload: {
      function: YIELD_AI_VAULT_VIEWS.getTotalSafes,
      typeArguments: [],
      functionArguments: [],
    },
  });
  const raw = Array.isArray(res) ? res[0] : (res as any);
  return parseNumber(raw);
}

async function getSafesRangeInfo(aptos: Aptos, start: number, limit: number): Promise<SafeEntry[]> {
  const res = await aptos.view({
    payload: {
      function: YIELD_AI_VAULT_VIEWS.getSafesRangeInfo,
      typeArguments: [],
      functionArguments: [String(start), String(limit)],
    },
  });

  const maybeVec = Array.isArray(res) ? res[0] : res;
  const list = Array.isArray(maybeVec) ? maybeVec : Array.isArray(res) ? res : [];
  return (list as any[])
    .map((x) => parseSafeEntry(x))
    .filter((x): x is SafeEntry => x != null);
}

export async function runYieldAiVaultCronPass(options: {
  dryRun?: boolean;
  /** Backward compatible knob (currently fixed internally). */
  pageSize?: number;
  maxSafesProcessedPerRun?: number;
  maxTxPerRun?: number;
  safeAddresses?: string[];
  /** Backward compatible knob (reads are currently sequential per-safe). */
  concurrencyReads?: number;
}) {
  const dryRun = Boolean(options.dryRun);
  const maxSafesProcessedPerRun = options.maxSafesProcessedPerRun ?? 500;
  const maxTxPerRun = options.maxTxPerRun ?? 200;
  const pageSize = 100;

  const runId = `run_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const startedAtUnixMs = Date.now();

  console.log("[Yield AI] strategy cron run started:", {
    runId,
    dryRun,
    maxSafesProcessedPerRun,
    maxTxPerRun,
  });

  const txHashes = {
    claim: [] as string[],
    swap: [] as string[],
    deposit: [] as string[],
    withdraw: [] as string[],
  };
  const errors: Array<{ safeAddress: string; actionId: string; error: string }> = [];
  const skippedSafes: Array<{ safeAddress: string; reason: string }> = [];

  let processedSafes = 0;
  let txCount = 0;
  let txCountClaim = 0;
  let txCountSwap = 0;
  let txCountDeposit = 0;
  let txCountWithdraw = 0;
  let claimedSafes = 0;
  let swappedSafes = 0;
  let depositedSafes = 0;
  let withdrawnSafes = 0;

  const config = await loadStrategyConfigFromDisk();
  const aptos = buildAptos(config.global.rpcUrl);

  // Best-effort: if Strategy Registry is initialized, we can gate cron actions
  // based on on-chain tags (e.g. skip stablecoin compounding when DN is active).
  let strategyRegistryInitialized = false;
  try {
    const raw = await aptos.view({
      payload: {
        function: STRATEGY_REGISTRY_VIEWS.initialized,
        typeArguments: [],
        functionArguments: [],
      },
    });
    const v = Array.isArray(raw) ? raw[0] : raw;
    strategyRegistryInitialized = v === true || v === "true";
  } catch (err) {
    console.warn("[Yield AI] cron: strategy registry init view failed; proceeding without gating", err);
    strategyRegistryInitialized = false;
  }

  const safeFilter =
    Array.isArray(options.safeAddresses) && options.safeAddresses.length > 0
      ? new Set(options.safeAddresses.map((a) => toCanonicalAddress(a).toLowerCase()))
      : null;

  const configuredByAddress = new Map(
    (config.safes ?? []).map((s) => [toCanonicalAddress(s.address).toLowerCase(), s])
  );

  const strategyIds = Object.keys(config.strategies ?? {});
  if (strategyIds.length === 0) {
    throw new Error("No strategies found in config");
  }
  const defaultStrategyId =
    strategyIds.length === 1 ? strategyIds[0] : (process.env.YIELD_AI_DEFAULT_STRATEGY_ID ?? "");
  if (!defaultStrategyId || !config.strategies[defaultStrategyId]) {
    throw new Error(
      "Multiple strategies configured: set YIELD_AI_DEFAULT_STRATEGY_ID or provide exactly one strategy"
    );
  }

  const totalSafesOnChain = await getTotalSafes(aptos);
  const discoveredSafes: SafeEntry[] = [];
  for (let start = 0; start < totalSafesOnChain; start += pageSize) {
    const batch = await getSafesRangeInfo(aptos, start, pageSize);
    for (const s of batch) {
      if (!s.exists || s.paused) continue;
      if (safeFilter && !safeFilter.has(s.safeAddress.toLowerCase())) continue;
      discoveredSafes.push(s);
    }
  }

  const totalSafes = discoveredSafes.length;

  // Sort by priority from config if present; otherwise stable order (on-chain).
  discoveredSafes.sort((a, b) => {
    const ca = configuredByAddress.get(a.safeAddress.toLowerCase());
    const cb = configuredByAddress.get(b.safeAddress.toLowerCase());
    const pa = ca?.priority ?? 1_000_000;
    const pb = cb?.priority ?? 1_000_000;
    return pa - pb;
  });

  for (const discovered of discoveredSafes) {
    if (processedSafes >= maxSafesProcessedPerRun) break;
    if (txCount >= maxTxPerRun) break;

    const configured = configuredByAddress.get(discovered.safeAddress.toLowerCase());
    if (configured && configured.enabled === false) continue;

    // Strategy gating:
    // - Default behavior: if no tag / registry unavailable → run stablecoin compound implementation.
    // - If DN tag is active, skip this safe entirely (no cron automation).
    if (strategyRegistryInitialized) {
      try {
        const raw = await aptos.view({
          payload: {
            function: STRATEGY_REGISTRY_VIEWS.getSafeActiveStrategies,
            typeArguments: [],
            functionArguments: [discovered.safeAddress],
          },
        });
        const vec = Array.isArray(raw) ? raw[0] : raw;
        const list = Array.isArray(vec) ? vec : [];
        const decoded = list
          .map((b) => bytesToUtf8String(b))
          .filter((x): x is string => Boolean(x && x.length > 0));
        if (decoded.includes("decibel_delta_neutral")) {
          skippedSafes.push({
            safeAddress: discovered.safeAddress,
            reason: "Skipped: decibel_delta_neutral strategy tag is ACTIVE (no stablecoin compounding cron).",
          });
          continue;
        }
      } catch (err) {
        // If tag read fails, do not block compounding (best-effort gating only).
        console.warn("[Yield AI] cron: get_safe_active_strategies failed; continuing", {
          safeAddress: discovered.safeAddress,
          err,
        });
      }
    }

    const strategyId = configured?.strategyId ?? defaultStrategyId;
    const strategy = config.strategies?.[strategyId];
    if (!strategy) continue;

    const safe = configured ?? {
      address: discovered.safeAddress,
      label: `Safe ${discovered.safeAddress.slice(0, 10)}…`,
      enabled: true,
      priority: 1_000_000,
      strategyId,
      overrides: {},
    };

    const ctx = buildRunContext({
      config,
      safe,
      strategyId,
      strategy,
      runId,
      dryRun,
    });

    try {
      const { state, adapters, moarAptClaimLines } = await computeStateForSafe(ctx);
      const { results, totalTxCount, txHashes: hashes } = await executeActionDag({
        ctx,
        state,
        adapters,
        moarAptClaimLines,
      });
      // Capture suppressed action errors for API response/logging.
      for (const r of results) {
        if (typeof r.skippedReason === "string" && r.skippedReason.startsWith("error:")) {
          errors.push({
            safeAddress: discovered.safeAddress,
            actionId: r.actionId,
            error: r.skippedReason.slice("error:".length),
          });
        }
      }

      processedSafes += 1;
      txCount += totalTxCount;

      for (const r of results) {
        if (r.executed && r.txCount > 0) {
          // best-effort classification by action id
          if (r.actionId.toLowerCase().includes("claim")) {
            txCountClaim += r.txCount;
            if (!dryRun) claimedSafes += 1;
            if (!dryRun) txHashes.claim.push(...r.txHashes);
          } else if (r.actionId.toLowerCase().includes("swap")) {
            txCountSwap += r.txCount;
            if (!dryRun) swappedSafes += 1;
            if (!dryRun) txHashes.swap.push(...r.txHashes);
          } else if (r.actionId.toLowerCase().includes("deposit")) {
            txCountDeposit += r.txCount;
            if (!dryRun) depositedSafes += 1;
            if (!dryRun) txHashes.deposit.push(...r.txHashes);
          } else if (r.actionId.toLowerCase().includes("withdraw")) {
            txCountWithdraw += r.txCount;
            if (!dryRun) withdrawnSafes += 1;
            if (!dryRun) txHashes.withdraw.push(...r.txHashes);
          }
        }
      }
    } catch (e) {
      console.error("[Yield AI] safe run error (continuing):", {
        runId,
        safeAddress: discovered.safeAddress,
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
  }

  const endedAtUnixMs = Date.now();
  console.log("[Yield AI] strategy cron run finished:", {
    runId,
    durationMs: endedAtUnixMs - startedAtUnixMs,
    processedSafes,
    txCount,
    txCountByKind: {
      claim: txCountClaim,
      swap: txCountSwap,
      deposit: txCountDeposit,
      withdraw: txCountWithdraw,
    },
    claimedSafes,
    swappedSafes,
    depositedSafes,
    withdrawnSafes,
  });

  return {
    runId,
    startedAtUnixMs,
    totalSafes,
    pageSize,
    maxSafesProcessedPerRun,
    maxTxPerRun,
    processedSafes,
    txCount,
    txCountByKind: {
      claim: txCountClaim,
      swap: txCountSwap,
      deposit: txCountDeposit,
      withdraw: txCountWithdraw,
    },
    claimedSafes,
    swappedSafes,
    depositedSafes,
    withdrawnSafes,
    txHashes,
    errors,
    skippedSafes,
    dryRun,
  } satisfies YieldAiVaultCronRunResult;
}

