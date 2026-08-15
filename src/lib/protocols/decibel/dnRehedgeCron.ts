/**
 * Auto-rehedge cron pass for LP-hedge delta-neutral cycles.
 *
 * Enumerates safes with an open DN-LP cycle (reusing `resolveDnLpSafes`) and, per cycle, resizes
 * ONLY the perp short back to the live LP base via the manage-auth-free `rehedgeLpDeltaNeutralCore`
 * (secret-gated; the executor signs on-chain). Bounded, delta-restoring action: the 15% band gates
 * noise, the margin guard skips an under-funded grow, and `maxActionsPerRun` caps live orders.
 */
import { resolveDnLpSafes, resolveSafeOwners } from "@/lib/protocols/yield-ai/hyperionLpCron";
import {
  CYCLE_SUBACCOUNT_KEY,
  fetchCycleString,
  fetchOpenCycles,
} from "@/lib/protocols/yield-ai/strategyJournal";
import { aptosClient } from "@/lib/protocols/decibel/lpDeltaNeutralOpen";
import { rehedgeLpDeltaNeutralCore } from "@/lib/protocols/decibel/lpDeltaNeutralRehedge";
import { normalizeAddress, toCanonicalAddress } from "@/lib/utils/addressNormalization";
import {
  NOTIFY_EMOJI,
  formatTelegramNotification,
  notifyWalletTelegram,
  shortAddr,
} from "@/lib/notifications/telegramWalletNotify";

export const DN_REHEDGE_CRON_LOCK_KEY = "__yieldAiDnRehedgeCronRunning";

function isZeroAddr(addr: string | null | undefined): boolean {
  if (!addr) return true;
  const n = normalizeAddress(toCanonicalAddress(addr));
  return n === normalizeAddress("0x0") || /^0x0+$/.test(n);
}

export type DnRehedgeCycleResult = {
  safeAddress: string;
  cycleId: string;
  subaccount?: string;
  action?: string;
  error?: string;
  [k: string]: unknown;
};

export type DnRehedgeCronRunResult = {
  dryRun: boolean;
  safesProcessed: number;
  cyclesProcessed: number;
  actedCycles: number;
  results: DnRehedgeCycleResult[];
};

export async function runDnRehedgeCronPass(options: {
  safeAddresses?: string[];
  bandBps?: number;
  marginBufferPct?: number;
  /** Cap live rehedge orders per run (0 = unlimited). Once hit, remaining cycles run observe-only. */
  maxActionsPerRun?: number;
  dryRun?: boolean;
}): Promise<DnRehedgeCronRunResult> {
  const dryRun = Boolean(options.dryRun);
  const maxActionsPerRun = Math.max(0, Math.trunc(Number(options.maxActionsPerRun ?? 0)));
  const aptos = aptosClient();

  const safes =
    options.safeAddresses && options.safeAddresses.length > 0
      ? options.safeAddresses.map((s) => toCanonicalAddress(s))
      : await resolveDnLpSafes();

  const results: DnRehedgeCycleResult[] = [];
  let cyclesProcessed = 0;
  let actedCycles = 0;

  for (const safe of safes) {
    let cycles;
    try {
      cycles = await fetchOpenCycles(aptos, safe);
    } catch (err) {
      results.push({ safeAddress: safe, cycleId: "?", error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    for (const cycle of cycles) {
      if (isZeroAddr(cycle.lpPosition)) continue; // hold-spot DN, not LP-hedge
      cyclesProcessed += 1;
      const cycleId = String(cycle.cycleId);
      try {
        const subaccount = await fetchCycleString(aptos, safe, cycleId, CYCLE_SUBACCOUNT_KEY);
        if (!subaccount) {
          results.push({ safeAddress: safe, cycleId, error: "no decibel_subaccount pinned on cycle" });
          continue;
        }
        // Once the per-run action cap is reached, remaining cycles run observe-only so a busy hour
        // can't fire unbounded orders / exceed the function timeout.
        const capHit = maxActionsPerRun > 0 && actedCycles >= maxActionsPerRun;
        const res = (await rehedgeLpDeltaNeutralCore({
          safeAddress: safe,
          subaccount,
          cycleId,
          bandBps: options.bandBps,
          marginBufferPct: options.marginBufferPct,
          dryRun: dryRun || capHit,
        })) as Record<string, unknown>;
        // A live order ran only when the core took the order path (it stamps `success: true`).
        if (res.success === true) actedCycles += 1;
        results.push({ safeAddress: safe, cycleId, subaccount, ...res });
      } catch (err) {
        results.push({ safeAddress: safe, cycleId, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  try {
    await notifyRehedgeResults(results);
  } catch (err) {
    // Notifications must never affect the cron's own result — log and move on.
    console.warn("[DN-Rehedge] notify pass failed; continuing", err);
  }

  return { dryRun, safesProcessed: safes.length, cyclesProcessed, actedCycles, results };
}

/**
 * Best-effort Telegram alerts to each affected safe's owner. Two independent kinds, a cycle may
 * fire either, both, or neither in the same pass:
 *   - ACTION (grow-short / reduce-short / margin-skip): only for LIVE runs — gated on the
 *     per-cycle `dryRun` the core actually ran with (never the pass-level flag), so a cycle
 *     forced dry by `maxActionsPerRun` and manual observe-only test calls never fire this.
 *   - ALERT (out of range): `inRange` is a chain-state FACT independent of whether the hedge
 *     drifted, so it fires whenever the LP is out of range on a LIVE pass — regardless of what
 *     the hedge action was. Same `dryRun` gate as ACTION (keeps manual test calls silent).
 * Never throws: a Telegram hiccup must not affect the rehedge cron's own result/response.
 */
async function notifyRehedgeResults(results: DnRehedgeCycleResult[]): Promise<void> {
  const live = results.filter((r) => r.dryRun !== true && !r.error);
  if (live.length === 0) return;

  let owners: Map<string, string>;
  try {
    owners = await resolveSafeOwners([...new Set(live.map((r) => r.safeAddress))]);
  } catch (err) {
    console.warn("[DN-Rehedge] notify: resolveSafeOwners failed; skipping notifications", err);
    return;
  }

  const send = async (r: DnRehedgeCycleResult, message: string) => {
    const owner = owners.get(normalizeAddress(toCanonicalAddress(r.safeAddress)));
    if (!owner) return;
    const res = await notifyWalletTelegram({ address: owner, message }).catch((err) => ({
      ok: false as const,
      error: err instanceof Error ? err.message : String(err),
    }));
    if (!res.ok) {
      console.warn(
        `[DN-Rehedge] notify failed safe=${r.safeAddress} cycle=${r.cycleId}: ${res.error ?? "unknown"}`
      );
    }
  };

  await Promise.all(
    live.flatMap((r) => {
      const sends: Promise<void>[] = [];
      if (r.action === "grow-short" || r.action === "reduce-short" || r.action === "margin-skip") {
        sends.push(send(r, formatRehedgeMessage(r)));
      }
      if (r.inRange === false) {
        sends.push(send(r, formatOutOfRangeMessage(r)));
      }
      return sends;
    })
  );
}

function marketLabel(r: DnRehedgeCycleResult): string {
  const market = typeof r.marketName === "string" ? r.marketName : "DN position";
  return `${market} (cycle #${r.cycleId})`;
}

function formatRehedgeMessage(r: DnRehedgeCycleResult): string {
  const adj = Number(r.adjustedApt ?? 0);
  const target = Number(r.targetAptHuman ?? 0);
  const short = Number(r.currentShortHuman ?? 0);
  const safe = shortAddr(r.safeAddress);

  if (r.action === "margin-skip") {
    return formatTelegramNotification(NOTIFY_EMOJI.alert, `Rehedge skipped — ${marketLabel(r)}`, [
      "Short needed to grow but there wasn't enough free margin.",
      typeof r.note === "string" ? r.note : null,
      `Safe ${safe}`,
    ]);
  }

  const verb = r.action === "grow-short" ? "Grew" : "Reduced";
  return formatTelegramNotification(NOTIFY_EMOJI.rehedge, `Auto-rehedge — ${marketLabel(r)}`, [
    `${verb} short by ${adj.toFixed(4)} (target ${target.toFixed(4)}, short now ${short.toFixed(4)}).`,
    `Safe ${safe}`,
  ]);
}

function formatOutOfRangeMessage(r: DnRehedgeCycleResult): string {
  const mark = Number(r.markPx ?? 0);
  return formatTelegramNotification(NOTIFY_EMOJI.alert, `LP out of range — ${marketLabel(r)}`, [
    "The Hyperion LP leg has drifted outside its price range and is no longer earning fees.",
    mark ? `Mark: ${mark}` : null,
    "No auto-recenter for DN-LP yet — close and reopen manually to re-center.",
    `Safe ${shortAddr(r.safeAddress)}`,
  ]);
}
