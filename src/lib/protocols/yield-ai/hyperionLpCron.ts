import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { normalizeAddress, toCanonicalAddress } from "@/lib/utils/addressNormalization";
import { fetchOpenCycles } from "@/lib/protocols/yield-ai/strategyJournal";
import {
  YIELD_AI_HYPERION_POOLS,
  YIELD_AI_VAULT_VIEWS,
  type HyperionPoolKey,
} from "@/lib/constants/yieldAiVault";
import {
  STRATEGY_REGISTRY_VIEWS,
  resolveActiveAiAgentStrategy,
} from "@/lib/protocols/yield-ai/strategyRegistry";
import {
  runHyperionAutoClaim,
  runHyperionRecenter,
  runHyperionRecenterDual,
  type HyperionAutoClaimFeeSwap,
  type HyperionAutoClaimPositionResult,
  type HyperionRecenterPositionResult,
  type HyperionRecenterDualPositionResult,
} from "@/lib/protocols/yield-ai/hyperionLpActions";
import {
  NOTIFY_EMOJI,
  formatTelegramNotification,
  notifyWalletTelegram,
  shortAddr,
} from "@/lib/notifications/telegramWalletNotify";

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

export type HyperionLpCronAction = "claim" | "recenter" | "recenter-dual";

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

/**
 * Resolve the owner wallet for each of the given safes (one full registry scan, then filtered).
 * Used to notify a safe's owner (e.g. Telegram rehedge alerts) — the vault only tracks
 * safe_address -> owner, never the reverse, so there is no cheaper single-safe lookup.
 */
export async function resolveSafeOwners(safeAddresses: string[]): Promise<Map<string, string>> {
  const want = new Set(safeAddresses.map((s) => normalizeAddress(toCanonicalAddress(s))));
  const out = new Map<string, string>();
  if (want.size === 0) return out;

  const total = await getTotalSafes();
  for (let start = 0; start < total && out.size < want.size; start += PAGE_SIZE) {
    const res = await aptos.view({
      payload: {
        function: YIELD_AI_VAULT_VIEWS.getSafesRangeInfo,
        typeArguments: [],
        functionArguments: [String(start), String(PAGE_SIZE)],
      },
    });
    const vec = Array.isArray(res) ? res[0] : res;
    const list = Array.isArray(vec) ? vec : [];
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const addr = typeof o.safe_address === "string" ? o.safe_address : null;
      const owner = typeof o.owner === "string" ? o.owner : null;
      if (!addr || !owner) continue;
      const norm = normalizeAddress(toCanonicalAddress(addr));
      if (want.has(norm)) out.set(norm, toCanonicalAddress(owner));
    }
  }
  return out;
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

/**
 * Validate pool keys for the recenter pool filter. Throws on unknown keys — a
 * typo must not silently widen the pass to every pool (or filter everything out).
 */
function parsePoolKeys(raw: unknown): HyperionPoolKey[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const valid = new Set(Object.keys(YIELD_AI_HYPERION_POOLS));
  return raw.map((k) => {
    const s = String(k).trim();
    if (!valid.has(s)) {
      throw new Error(`Unknown poolKey "${s}" — valid: ${[...valid].join(", ")}`);
    }
    return s as HyperionPoolKey;
  });
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

/** A DN-LP cycle carries a Hyperion LP position (lp_position != 0x0). The hold-spot DN
 * variant has no LP leg, so it is excluded. Mirrors `isZeroAddress` in delta-neutral-cycles. */
function cycleHasLpPosition(lpPosition: string | null | undefined): boolean {
  if (!lpPosition) return false;
  const n = normalizeAddress(toCanonicalAddress(lpPosition));
  return n !== normalizeAddress("0x0") && !/^0x0+$/.test(n);
}

/**
 * Enumerate safes that currently hold an open DN-LP cycle (Hyperion LP leg hedged by a
 * Decibel short). These safes run the DN strategy, so the registry filter `isHyperionSafe`
 * (active strategy == "hyperion_lp") skips them — we discover them by their open
 * `strategy_journal` cycles instead. Cycle reads are batched (`concurrency`) to bound RPC
 * load / function time. Pass the result as `safeAddresses` to `runHyperionLpCronPass`.
 */
export async function resolveDnLpSafes(concurrency = 8): Promise<string[]> {
  const total = await getTotalSafes();
  const all: string[] = [];
  for (let start = 0; start < total; start += PAGE_SIZE) {
    const batch = await getSafeAddressesRange(start, PAGE_SIZE);
    all.push(...batch.map((s) => toCanonicalAddress(s)));
  }

  const dn: string[] = [];
  for (let i = 0; i < all.length; i += concurrency) {
    const slice = all.slice(i, i + concurrency);
    const flags = await Promise.all(
      slice.map(async (safe) => {
        try {
          const cycles = await fetchOpenCycles(aptos, safe);
          return cycles.some((c) => cycleHasLpPosition(c.lpPosition));
        } catch {
          return false;
        }
      })
    );
    slice.forEach((safe, j) => {
      if (flags[j]) dn.push(safe);
    });
  }
  return dn;
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
  /** Opt-in (DN-autoclaim cron): sweep claimed VOLATILE fee legs (WBTC/APT) → USDC too.
   * Plain-LP callers leave this off — their policy keeps claimed fees as-is. */
  convertFeesToUsdc?: boolean;
  /** recenter-dual gates */
  minPositionAgeSeconds?: number;
  minFeesUsd?: number;
  forceRerange?: boolean;
  /** Only touch positions in these pools (phased rollout, e.g. ["usdt_usdc"]). */
  poolKeys?: string[];
  /** Cap live recenter actions per run (0 = unlimited). Once hit, remaining safes
   * run observe-only (dryRun) — bounds tx count / function execution time. */
  maxActionsPerRun?: number;
  dryRun?: boolean;
}): Promise<HyperionLpCronRunResult> {
  const action: HyperionLpCronAction =
    options.action === "recenter"
      ? "recenter"
      : options.action === "recenter-dual"
        ? "recenter-dual"
        : "claim";
  const dryRun = Boolean(options.dryRun);
  const maxActionsPerRun = Math.max(0, Math.trunc(Number(options.maxActionsPerRun ?? 0)));
  const poolKeys = parsePoolKeys(options.poolKeys);
  const safes = await resolveHyperionSafes(options.safeAddresses);

  const perSafe: HyperionLpCronRunResult["results"] = [];
  let actedPositions = 0;
  const pendingNotifies: Array<{ safeAddress: string; message: string }> = [];

  for (const safe of safes) {
    try {
      if (action === "recenter") {
        const res = await runHyperionRecenter({
          safeAddress: safe,
          halfWidthTicks: options.halfWidthTicks,
          edgeBufferTicks: options.edgeBufferTicks,
          slippageBps: options.slippageBps,
          minReopenUsdcBaseUnits: options.minReopenUsdcBaseUnits,
          poolKeys,
          dryRun,
        });
        actedPositions += res.positions.filter((p) => p.action === "recenter" && !p.error).length;
        perSafe.push(res);
        // This is the always-on, all-pools monitor (its prod schedule runs permanently
        // dryRun=true — see vercel.json's bare-path cron entry) — the out-of-range ALERT is a
        // chain-state fact independent of dryRun, so it fires regardless. A live execution
        // (manual/future, dryRun=false) instead fires the ACTION message. No dedup/state store
        // (accepted tradeoff): a position stuck out of range re-alerts every run.
        for (const p of res.positions) {
          if (p.error) continue;
          if (!dryRun && p.action === "recenter" && p.reopen) {
            pendingNotifies.push({ safeAddress: safe, message: formatHyperionRecenterMessage(safe, p) });
          } else if (p.outOfRange === true) {
            pendingNotifies.push({ safeAddress: safe, message: formatHyperionOutOfRangeMessage(safe, p) });
          }
        }
      } else if (action === "recenter-dual") {
        // Swap-free dual re-center (stable-pair friendly). Once the per-run action
        // cap is reached, remaining safes run observe-only so a busy hour can't run
        // unbounded txs / exceed the function timeout.
        const capHit = maxActionsPerRun > 0 && actedPositions >= maxActionsPerRun;
        const effectiveDryRun = dryRun || capHit;
        const res = await runHyperionRecenterDual({
          safeAddress: safe,
          halfWidthTicks: options.halfWidthTicks,
          edgeBufferTicks: options.edgeBufferTicks,
          minPositionAgeSeconds: options.minPositionAgeSeconds,
          minFeesUsd: options.minFeesUsd,
          forceRerange: options.forceRerange,
          poolKeys,
          dryRun: effectiveDryRun,
        });
        actedPositions += res.positions.filter((p) => p.action === "recenter" && !p.error).length;
        perSafe.push(res);
        // ACTION only — no separate out-of-range alert here (the plain "recenter" monitor
        // above already covers every pool, so alerting here too would double-notify).
        if (!effectiveDryRun) {
          for (const p of res.positions) {
            if (!p.error && p.action === "recenter") {
              pendingNotifies.push({ safeAddress: safe, message: formatHyperionRecenterMessage(safe, p) });
            }
          }
        }
      } else {
        const res = await runHyperionAutoClaim({
          safeAddress: safe,
          minClaimUsd: options.minClaimUsd,
          minRewardClaimUsd: options.minRewardClaimUsd,
          minRewardSwapUsd: options.minRewardSwapUsd,
          swapRewardsToUsdc: options.swapRewardsToUsdc !== false,
          convertFeesToUsdc: options.convertFeesToUsdc,
          dryRun,
        });
        actedPositions += res.positions.filter((p) => p.action === "claimed").length;
        perSafe.push(res);
        // Covers BOTH callers of this branch — DN-LP autoclaim (dn-autoclaim/cron, scoped via
        // resolveDnLpSafes) and plain Hyperion-LP autoclaim (hyperion-lp/cron, resolveHyperionSafes)
        // — since both go through this same runHyperionAutoClaim() call, just with a different
        // safe list. One message per safe (not per position) so a multi-position claim doesn't spam.
        if (!dryRun) {
          const claimed = res.positions.filter((p) => p.action === "claimed");
          if (claimed.length > 0) {
            pendingNotifies.push({
              safeAddress: safe,
              message: formatAutoclaimMessage(safe, claimed, res.rewardSwap, res.feeSwaps ?? []),
            });
          }
        }
      }
    } catch (err) {
      perSafe.push({
        safeAddress: safe,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (pendingNotifies.length > 0) {
    try {
      await notifyPending(pendingNotifies);
    } catch (err) {
      // Notifications must never affect the cron's own result — log and move on.
      console.warn("[Hyperion-LP] notify pass failed; continuing", err);
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

async function notifyPending(pending: Array<{ safeAddress: string; message: string }>): Promise<void> {
  const owners = await resolveSafeOwners([...new Set(pending.map((n) => n.safeAddress))]);
  await Promise.all(
    pending.map(async (n) => {
      const owner = owners.get(normalizeAddress(toCanonicalAddress(n.safeAddress)));
      if (!owner) return;
      const res = await notifyWalletTelegram({ address: owner, message: n.message }).catch((err) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      }));
      if (!res.ok) {
        console.warn(`[Hyperion-LP] notify failed safe=${n.safeAddress}: ${res.error ?? "unknown"}`);
      }
    })
  );
}

// Safe address, not position address — a position is an internal implementation
// detail (and gets replaced by a new address on every re-center); the safe is
// what the user actually recognizes and manages in the app. Matches the
// dn-rehedge notification style (`Safe ${shortAddr(...)}`).
function formatHyperionRecenterMessage(
  safeAddress: string,
  p: HyperionRecenterPositionResult | HyperionRecenterDualPositionResult
): string {
  return formatTelegramNotification(NOTIFY_EMOJI.recenter, `Recentered LP — ${p.poolKey ?? "position"}`, [
    "Position was re-centered around the current price.",
    `Safe ${shortAddr(safeAddress)}`,
  ]);
}

function formatHyperionOutOfRangeMessage(safeAddress: string, p: HyperionRecenterPositionResult): string {
  return formatTelegramNotification(NOTIFY_EMOJI.alert, `LP out of range — ${p.poolKey ?? "position"}`, [
    "Position has drifted outside its price range and is no longer earning fees.",
    `Safe ${shortAddr(safeAddress)}`,
  ]);
}

/** One message per safe (not per position) — covers both DN-LP and plain Hyperion-LP autoclaim. */
function formatAutoclaimMessage(
  safeAddress: string,
  claimed: HyperionAutoClaimPositionResult[],
  rewardSwap: { aptIn: string; hash: string | null } | null,
  feeSwaps: HyperionAutoClaimFeeSwap[]
): string {
  const lines = claimed.map((p, i) => {
    const parts = [`$${p.feesUsd.toFixed(2)} fees`];
    if (p.rewardsUsd > 0) parts.push(`$${p.rewardsUsd.toFixed(2)} rewards`);
    // Position address isn't meaningful to a user; only distinguish by index
    // when a safe has more than one position claiming in the same pass.
    return claimed.length > 1 ? `Position ${i + 1}: ${parts.join(" + ")}` : parts.join(" + ");
  });
  if (rewardSwap) {
    const aptHuman = Number(rewardSwap.aptIn) / 1e8;
    lines.push(`Swapped ${aptHuman.toFixed(4)} APT rewards → USDC.`);
  }
  for (const s of feeSwaps) {
    const human = Number(s.amountIn) / 10 ** s.decimals;
    lines.push(`Swapped ${human.toFixed(Math.min(s.decimals, 6))} ${s.symbol} fees → USDC.`);
  }
  lines.push(`Safe ${shortAddr(safeAddress)}`);
  const title = claimed.length > 1 ? `Autoclaim — ${claimed.length} positions` : "Autoclaim";
  return formatTelegramNotification(NOTIFY_EMOJI.claim, title, lines);
}
