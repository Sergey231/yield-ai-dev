/**
 * Model: ignore entry; 3d funding (7d APR) vs Jupiter+Decibel exit drag.
 * Run: node scripts/model-dn-hold3d.mjs
 */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i <= 0) continue;
  const k = t.slice(0, i).trim();
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  if (!process.env[k]) process.env[k] = v;
}

const HOLD_DAYS = 3;

async function funding7d(market) {
  const key = market.replace(/USDC/gi, "USD");
  const url = `https://yieldai.aoserver.ru/funding.php?market_name=${encodeURIComponent(key)}&weighted_average=true&period=week`;
  const w = (await fetch(url).then((r) => r.json()))?.weighted_average;
  const apr = w?.avg_yearly_apr_pct ?? 0;
  const dir = String(w?.direction ?? "");
  const shortEarns = apr > 0 && dir.toLowerCase().includes("long") && dir.toLowerCase().includes("short");
  return { apr, dir, shortEarns };
}

function fundUsd(size, apr, days) {
  return size * (apr / 100) * (days / 365);
}

const secret = process.env.YIELD_AI_CRON_SECRET;
const cron = await fetch("https://yieldai.app/api/protocols/decibel/dn-spread-monitor/cron", {
  headers: { "x-cron-secret": secret },
}).then((r) => r.json());
const d = cron.data;

console.log("=== DN HOLD MODEL: 3d funding (7d APR) − exit drag (entry ignored) ===");
console.log("Sampled:", new Date(d.sampledAtUnixMs).toISOString());
console.log("Exit rows:", d.solanaExit?.length ?? 0, "| signal hold3d+:", d.signals?.hold3dFundingBeatsExit?.length ?? "n/a (deploy pending)\n");

const exits = (d.solanaExit ?? []).filter((r) => r.sizeUsd === 5000 && !r.error && !r.basisWarning);
const rows = [];

for (const ex of exits) {
  const f7 = await funding7d(ex.market);
  const f24 = ex.fundingApr24hPct ?? 0;
  const drag = ex.estimatedExitDragUsd ?? (ex.sizeUsd * Math.max(0, -ex.netExitEdgeBps) / 10000);
  const f3_7d = fundUsd(ex.sizeUsd, f7.apr, HOLD_DAYS);
  const f3_24h = fundUsd(ex.sizeUsd, f24, HOLD_DAYS);
  const net7 = f3_7d - drag;
  const net24 = f3_24h - drag;
  rows.push({
    market: ex.market,
    token: ex.token,
    fund7d: f7.apr.toFixed(1) + "%",
    fund24h: f24.toFixed(1) + "%",
    shortEarns7d: f7.shortEarns,
    exitBps: ex.netExitEdgeBps?.toFixed(1),
    exitDrag: "$" + drag.toFixed(2),
    fund3d_7d: "$" + f3_7d.toFixed(2),
    net3d_7d: "$" + net7.toFixed(2),
    net3d_24h: "$" + net24.toFixed(2),
    ok7d: f7.shortEarns && net7 > 0,
    ok24h: ex.shortEarnsFunding && net24 > 0,
  });
}

rows.sort((a, b) => parseFloat(b.net3d_7d.slice(1)) - parseFloat(a.net3d_7d.slice(1)));

console.log("--- $5000 notional ---");
console.log(
  "Market".padEnd(12),
  "fund7d",
  "fund24h",
  "exit",
  "drag",
  "f3d(7d)",
  "net3d(7d)",
  "net3d(24h)",
  "OK7d",
  "OK24h"
);
for (const r of rows) {
  console.log(
    r.market.padEnd(12),
    r.fund7d.padStart(6),
    r.fund24h.padStart(6),
    r.exitBps.padStart(6),
    r.exitDrag.padStart(7),
    r.fund3d_7d.padStart(8),
    r.net3d_7d.padStart(9),
    r.net3d_24h.padStart(10),
    (r.ok7d ? "YES" : "no").padStart(4),
    (r.ok24h ? "YES" : "no").padStart(5)
  );
}

console.log("\n--- WINNERS (7d funding, 3d hold, exit drag, $5k) ---");
const winners = rows.filter((r) => r.ok7d);
if (!winners.length) console.log("(none — exit drag eats 3d funding at 7d APR)");
else winners.forEach((r) => console.log(`  ${r.market}: ${r.net3d_7d} net after exit`));

if (d.signals?.hold3dFundingBeatsExit?.length) {
  console.log("\n--- MONITOR SIGNAL hold3dFundingBeatsExit ---");
  for (const s of d.signals.hold3dFundingBeatsExit) {
    console.log(`  ${s.market} $${s.sizeUsd}: net $${s.net3dAfterExitUsd} (fund3d $${s.funding3dUsd} − exit $${s.exitDragUsd})`);
  }
}
