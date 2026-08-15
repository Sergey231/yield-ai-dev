import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(resolve(__dirname, "../.env.local"), "utf8").split("\n")) {
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

import { loadHyperionLpEventTotalsBySafe } from "../src/lib/protocols/yield-ai/hyperionLpEvents";
import { readSafeHyperionPositions } from "../src/lib/protocols/yield-ai/hyperionLp";
import { PanoraPricesService } from "../src/lib/services/panora/prices";
import { normalizeAddress, toCanonicalAddress } from "../src/lib/utils/addressNormalization";

function rawToUsd(raw: bigint, info?: { usd: number; decimals: number }) {
  if (!info || raw <= 0n) return 0;
  return (Number(raw) / 10 ** info.decimals) * info.usd;
}

async function main() {
const [positions, map] = await Promise.all([
  readSafeHyperionPositions(SAFE),
  loadHyperionLpEventTotalsBySafe(SAFE),
]);

const addrs = new Set<string>();
for (const p of positions) {
  addrs.add(p.tokenA);
  addrs.add(p.tokenB);
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

console.log("Safe:", SAFE);
console.log("Positions with any claimed fees/rewards:\n");

for (const p of positions) {
  const ev = map.get(toCanonicalAddress(p.position));
  if (!ev) continue;
  const pa = priceOf(p.tokenA);
  const pb = priceOf(p.tokenB);
  const claimedUsd =
    rawToUsd(ev.feesClaimedA, pa) +
    rawToUsd(ev.feesClaimedB, pb) +
    [...ev.rewardsClaimed.entries()].reduce(
      (s, [meta, amt]) => s + rawToUsd(amt, priceOf(meta)),
      0
    );
  if (claimedUsd <= 0 && ev.feesClaimedA === 0n && ev.feesClaimedB === 0n) continue;

  console.log({
    position: p.position,
    closed: p.closed,
    feesClaimedRaw: { feeA: ev.feesClaimedA.toString(), feeB: ev.feesClaimedB.toString() },
    claimedUsd: +claimedUsd.toFixed(6),
  });
}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
