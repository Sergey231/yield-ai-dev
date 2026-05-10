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

export type AiAgentStrategyId = "stablecoin_compound" | "decibel_delta_neutral";

export const AI_AGENT_STRATEGIES: Record<
  AiAgentStrategyId,
  { id: AiAgentStrategyId; label: string; description: string }
> = {
  stablecoin_compound: {
    id: "stablecoin_compound",
    label: "Stablecoin compound",
    description: "Auto-compound stable yield strategy (current implementation: USD1 + Echelon).",
  },
  decibel_delta_neutral: {
    id: "decibel_delta_neutral",
    label: "Decibel delta-neutral",
    description: "Manual delta-neutral strategy on Decibel (no auto-compound cron actions).",
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

  const hasDn = decoded.includes("decibel_delta_neutral");
  const hasStable = decoded.includes("stablecoin_compound");

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

