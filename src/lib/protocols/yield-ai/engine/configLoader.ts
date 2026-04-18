import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  Action,
  SafeAssignment,
  StrategyConfig,
  StrategyDefinition,
  StrategyRunContext,
} from "./types";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";
import bundledDefaultConfig from "../../../../../config/strategy-usd1-echelon-compound.json";

const DEFAULT_CONFIG_PATH = "config/strategy-usd1-echelon-compound.json";

export async function loadStrategyConfigFromDisk(): Promise<StrategyConfig> {
  const p = process.env.YIELD_AI_STRATEGY_CONFIG_PATH || DEFAULT_CONFIG_PATH;

  // In Vercel/Next.js standalone builds, non-imported files may be omitted from the
  // server bundle due to output file tracing. To make the default config always
  // available, we also import it as a module and use it when no override is set.
  if (!process.env.YIELD_AI_STRATEGY_CONFIG_PATH && p === DEFAULT_CONFIG_PATH) {
    return bundledDefaultConfig as StrategyConfig;
  }

  const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  const raw = await readFile(abs, "utf8");
  const parsed = JSON.parse(raw) as StrategyConfig;
  return parsed;
}

function shallowMerge<T extends Record<string, any>>(base: T, override?: Record<string, any>): T {
  return { ...(base as any), ...(override ?? {}) };
}

function mergeActions(base: Action[], overrideMap?: Record<string, Partial<Action>>): Action[] {
  if (!overrideMap) return base;
  return base.map((a) => {
    const o = overrideMap[a.id];
    if (!o) return a;
    return {
      ...a,
      ...o,
      params: shallowMerge(a.params ?? {}, (o as any).params),
    };
  });
}

export function buildRunContext(options: {
  config: StrategyConfig;
  safe: SafeAssignment;
  strategyId: string;
  strategy: StrategyDefinition;
  runId: string;
  dryRun: boolean;
}): StrategyRunContext {
  const { config, safe, strategyId, strategy, runId, dryRun } = options;

  const mergedDefaults = shallowMerge(strategy.defaults ?? {}, safe.overrides?.defaults);
  const mergedRiskLimits = shallowMerge(strategy.riskLimits ?? {}, safe.overrides?.riskLimits);
  const mergedContext = shallowMerge(strategy.context ?? {}, safe.overrides?.context);
  const mergedActions = mergeActions(strategy.actions ?? [], safe.overrides?.actions);

  return {
    runId,
    safeAddress: toCanonicalAddress(safe.address),
    safeLabel: safe.label,
    dryRun,
    config,
    strategyId,
    strategy,
    mergedContext,
    mergedDefaults,
    mergedRiskLimits,
    mergedActions,
  };
}

