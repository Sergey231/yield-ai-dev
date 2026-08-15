import { YIELD_AI_PACKAGE_ADDRESS } from "@/lib/constants/yieldAiVault";

/**
 * Strategy Registry (on-chain tags per safe).
 *
 * Strategy ids and extra keys are passed as UTF-8 bytes (vector<u8>).
 * We keep the canonical ids off-chain as a shared convention across UI + executor.
 */

export const STRATEGY_REGISTRY_VIEWS = {
  initialized: `${YIELD_AI_PACKAGE_ADDRESS}::strategy_registry::strategy_registry_initialized` as const,
  getSafeActiveStrategies:
    `${YIELD_AI_PACKAGE_ADDRESS}::strategy_registry::get_safe_active_strategies` as const,
  isStrategyActive: `${YIELD_AI_PACKAGE_ADDRESS}::strategy_registry::is_strategy_active` as const,
  getSafeStrategies: `${YIELD_AI_PACKAGE_ADDRESS}::strategy_registry::get_safe_strategies` as const,
} as const;

export const STRATEGY_REGISTRY_ENTRYPOINTS = {
  attachStrategy: `${YIELD_AI_PACKAGE_ADDRESS}::strategy_registry::attach_strategy` as const,
  detachStrategy: `${YIELD_AI_PACKAGE_ADDRESS}::strategy_registry::detach_strategy` as const,
  setStrategyState: `${YIELD_AI_PACKAGE_ADDRESS}::strategy_registry::set_strategy_state` as const,
  setStrategyExtraU64: `${YIELD_AI_PACKAGE_ADDRESS}::strategy_registry::set_strategy_extra_u64` as const,
} as const;

export type AiAgentStrategyId =
  | "stablecoin_compound"
  | "decibel_delta_neutral"
  | "hyperion_lp";

export const AI_AGENT_STRATEGY_BADGE_CLASS: Record<AiAgentStrategyId, string> = {
  stablecoin_compound:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  decibel_delta_neutral:
    "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30",
  hyperion_lp: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30",
};

export const AI_AGENT_STRATEGIES: Record<
  AiAgentStrategyId,
  {
    id: AiAgentStrategyId;
    label: string;
    description: string;
    /** One-line summary shown next to the strategy badge in Manage Positions. */
    tagline: string;
    /** Expanded behavior copy for the info tooltip. */
    tooltip: string;
  }
> = {
  stablecoin_compound: {
    id: "stablecoin_compound",
    label: "Stablecoin compound",
    description: "Auto-compound stable yield strategy (current implementation: USD1 + Echelon).",
    tagline: "Monitors hourly · auto-compounds Echelon rewards",
    tooltip:
      "Every hour the agent checks your safe for claimable Echelon farming rewards. APT and ThalaAPT rewards are claimed once each reward balance is at least 0.1. ELON is cheaper, so it is claimed and swapped only once it reaches at least 10 ELON. Claimed rewards are swapped to USDC. USDC is converted to USD1 once the safe holds at least 0.1 USDC, then redeposited into Echelon when USD1 reaches at least 0.1 — all within your safe's swap limits. You can deposit or withdraw anytime; compounding runs only when balances clear these thresholds.",
  },
  decibel_delta_neutral: {
    id: "decibel_delta_neutral",
    label: "Decibel delta-neutral",
    description: "Manual delta-neutral strategy on Decibel (no auto-compound cron actions).",
    tagline: "Manual open/close · earns Decibel funding while hedged",
    tooltip:
      "You open and close delta-neutral positions yourself. The executor opens a Decibel short perp hedged with a spot long in your safe (via Hyperion). While the position is open, funding accrues on the short when longs pay shorts. Entry and exit use live spread previews — the agent does not auto-open, resize, or close positions yet. Complete Decibel setup once, then use Open / Close when conditions look good.",
  },
  hyperion_lp: {
    id: "hyperion_lp",
    label: "Hyperion CLMM LP",
    // Pool-agnostic: a safe may hold several concentrated-liquidity LP positions
    // across the whitelisted USDC-leg pools. Pool is chosen at open time.
    description: "Concentrated-liquidity LP on Hyperion (USDC-leg pools, executor-managed).",
    tagline: "Monitors hourly · auto re-centers stable positions",
    tooltip:
      "Every hour the agent checks each LP position against the live price. A stable-pool position (USDt/USDC, USD1/USDC) that has drifted out of range is re-centered at ±0.1% around the current price — only once it is at least 1h old and accrued fees cover the re-center cost. Accrued fees are claimed to the safe automatically (hourly, above a small threshold) and before every re-center; the Claim button works anytime. Volatile pools (WBTC/USDC) are monitored but managed manually for now.",
  },
};

export type StrategyRegistryResolvedStrategy = {
  /** Canonical on-chain tag id (UTF-8). */
  activeStrategyId: AiAgentStrategyId;
  /** Raw active strategy byte-strings from view (if available). */
  activeStrategyIds: string[];
  /** True if tag was explicit; false if default fallback was applied (no tags). */
  isDefaulted: boolean;
};

export function utf8BytesArray(s: string): number[] {
  if (!s) return [];
  const bytes = new TextEncoder().encode(s);
  return Array.from(bytes);
}

/**
 * Format a strategy id for `vector<u8>` arguments to wallet adapter
 * `signAndSubmitTransaction`.
 *
 * Empirically with this wallet adapter / Aptos SDK pipeline, a plain string is
 * BCS-encoded as the UTF-8 bytes of the string — which is exactly the on-chain
 * format the strategy_registry expects. Hex strings with `0x` prefix are NOT
 * decoded by the wallet (we tested: `"0xdecibel_delta_neutral"` ended up stored
 * as the 23-character literal, not the 21-byte id). `number[]`/`Uint8Array`
 * round-trips are also unreliable through wallet adapters. Pass strings.
 */
export function strategyIdArg(s: string): string {
  return s;
}

export function bytesToUtf8String(bytes: unknown): string | null {
  try {
    // Aptos view responses may return either:
    // - `number[]` (vector<u8>) or
    // - hex string `0x...` (bytes) depending on client/transport.
    if (typeof bytes === "string") {
      const hex = bytes.startsWith("0x") ? bytes.slice(2) : bytes;
      if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) return null;
      // Buffer exists in Next.js runtime on both server and client bundles.
      return Buffer.from(hex, "hex").toString("utf8");
    }
    if (!Array.isArray(bytes)) return null;
    const u8 = Uint8Array.from(bytes.map((x) => Number(x)));
    return new TextDecoder().decode(u8);
  } catch {
    return null;
  }
}

export function resolveActiveAiAgentStrategy(params: {
  activeStrategyIdBytesVec: unknown;
}): StrategyRegistryResolvedStrategy {
  const { activeStrategyIdBytesVec } = params;
  const list = Array.isArray(activeStrategyIdBytesVec) ? activeStrategyIdBytesVec : [];

  const decoded = list
    .map((b) => bytesToUtf8String(b))
    .filter((x): x is string => Boolean(x && x.length > 0));

  const hasHyperion = decoded.includes("hyperion_lp");
  const hasDn = decoded.includes("decibel_delta_neutral");
  const hasStable = decoded.includes("stablecoin_compound");

  if (hasHyperion) {
    return {
      activeStrategyId: "hyperion_lp",
      activeStrategyIds: decoded,
      isDefaulted: false,
    };
  }

  if (hasDn) {
    return {
      activeStrategyId: "decibel_delta_neutral",
      activeStrategyIds: decoded,
      isDefaulted: false,
    };
  }

  if (hasStable) {
    return {
      activeStrategyId: "stablecoin_compound",
      activeStrategyIds: decoded,
      isDefaulted: false,
    };
  }

  // Default behavior: if tags missing/empty/unrecognized → treat as stablecoin compound.
  return {
    activeStrategyId: "stablecoin_compound",
    activeStrategyIds: decoded,
    isDefaulted: true,
  };
}

