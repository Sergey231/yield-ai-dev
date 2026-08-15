/**
 * Compute realized APR including claimed fees/rewards (matches positions route).
 * Usage: npx tsx scripts/check-safe-apr-with-claimed.ts [safeAddress]
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

try {
  const envPath = resolve(__dirname, "../.env.local");
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
} catch {
  /* optional */
}

const SAFE =
  process.argv[2] ??
  "0x14d82c74993aa5457e1b105cbe6c0169bc8315271db7d28153a4c53dbd47174f";

import { readSafeHyperionPositions } from "../src/lib/protocols/yield-ai/hyperionLp";
import { loadHyperionLpEventTotalsBySafe } from "../src/lib/protocols/yield-ai/hyperionLpEvents";
import { PanoraPricesService } from "../src/lib/services/panora/prices";
import { normalizeAddress, toCanonicalAddress } from "../src/lib/utils/addressNormalization";
import { APTOS_COIN_TYPE } from "../src/lib/constants/yieldAiVault";

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
const APR_MIN_ELAPSED = 3600;

function rawToUsd(raw: bigint, info?: { usd: number; decimals: number }) {
  if (!info || raw <= 0n) return 0;
  return (Number(raw) / 10 ** info.decimals) * info.usd;
}

function toUsd(raw: string | undefined, info?: { usd: number; decimals: number }) {
  const n = Number(raw);
  if (!info || !Number.isFinite(n)) return 0;
  return (n / 10 ** info.decimals) * info.usd;
}

async function main() {
  const positions = await readSafeHyperionPositions(SAFE);
  const events = await loadHyperionLpEventTotalsBySafe(SAFE);

  const addrs = new Set<string>([APTOS_COIN_TYPE]);
  for (const p of positions) {
    addrs.add(p.tokenA);
    addrs.add(p.tokenB);
    for (const r of p.pendingRewards ?? []) addrs.add(r.metadata);
    const ev = events.get(toCanonicalAddress(p.position));
    if (ev) {
      for (const meta of ev.rewardsClaimed.keys()) addrs.add(meta);
    }
  }

  const pr = await PanoraPricesService.getInstance().getPrices(1, [...addrs]);
  const list = Array.isArray(pr) ? pr : ((pr as { data?: unknown })?.data as unknown[]) ?? [];
  const byAddr = new Map<string, { usd: number; decimals: number; symbol: string }>();
  for (const it of list as Array<Record<string, unknown>>) {
    const info = {
      usd: parseFloat(String(it.usdPrice ?? "0")) || 0,
      decimals: Number(it.decimals ?? 0) || 0,
      symbol: typeof it.symbol === "string" ? it.symbol : "?",
    };
    if (typeof it.faAddress === "string") byAddr.set(normalizeAddress(it.faAddress), info);
    if (typeof it.tokenAddress === "string") byAddr.set(normalizeAddress(it.tokenAddress), info);
  }
  const priceOf = (a: string) => byAddr.get(normalizeAddress(a));

  const nowSec = Math.floor(Date.now() / 1000);

  for (const p of positions.filter((x) => !x.closed)) {
    const pa = priceOf(p.tokenA);
    const pb = priceOf(p.tokenB);
    const valueUsd = toUsd(p.amountA, pa) + toUsd(p.amountB, pb);
    const feesUsd = toUsd(p.pendingFeeA, pa) + toUsd(p.pendingFeeB, pb);
    let rewardsUsd = 0;
    for (const r of p.pendingRewards ?? []) {
      rewardsUsd += toUsd(r.amount, priceOf(r.metadata));
    }

    const ev = events.get(toCanonicalAddress(p.position));
    let claimedUsd = 0;
    if (ev) {
      claimedUsd = rawToUsd(ev.feesClaimedA, pa) + rawToUsd(ev.feesClaimedB, pb);
      for (const [meta, amt] of ev.rewardsClaimed) {
        claimedUsd += rawToUsd(amt, priceOf(meta));
      }
    }

    const elapsed = nowSec - Number(p.openedAt);
    const earnedUsd = feesUsd + rewardsUsd + claimedUsd;
    const aprPct =
      valueUsd > 0 && elapsed >= APR_MIN_ELAPSED
        ? (earnedUsd / valueUsd) * (SECONDS_PER_YEAR / elapsed) * 100
        : null;

    console.log(
      JSON.stringify(
        {
          position: p.position,
          pool: `${pa?.symbol}/${pb?.symbol}`,
          range: [p.tickLower, p.tickUpper],
          valueUsd: +valueUsd.toFixed(4),
          uncollectedFeesUsd: +feesUsd.toFixed(6),
          uncollectedRewardsUsd: +rewardsUsd.toFixed(6),
          claimedUsd: +claimedUsd.toFixed(6),
          totalEarnedUsd: +earnedUsd.toFixed(6),
          daysOpen: +(elapsed / 86400).toFixed(2),
          realizedAprPct: aprPct != null ? +aprPct.toFixed(2) : null,
        },
        null,
        2
      )
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
