/**
 * Recalculate DN economics from live cron spreads using corrected Decibel fees (3.4 bps taker).
 * Run: node scripts/recalc-dn-all.mjs
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

const TAKER = 3.4;
const BUILDER_PROD = 1; // from GET /api/protocols/decibel/builder-config (Jun 2026)
const BUILDER_CODE_DEFAULT = 10; // builder-config route fallback if env unset
const HYPERION_BUFFER = 20; // DN_INPUT_BUFFER_BPS — already in spreadBps from monitor

function netEntry(spreadBps, decibelLeg) {
  return -spreadBps - decibelLeg;
}
function netExit(spreadBps, decibelLeg) {
  return spreadBps - decibelLeg;
}
function beDays(netBps, fundPct, earns) {
  if (netBps >= 0 || !earns || !fundPct || fundPct <= 0) return null;
  const daily = (fundPct * 100) / 365;
  return Math.abs(netBps) / daily;
}
function usd(size, bps) {
  return (size * Math.max(0, -bps)) / 10_000;
}

const secret = process.env.YIELD_AI_CRON_SECRET;
const res = await fetch("https://yieldai.app/api/protocols/decibel/dn-spread-monitor/cron", {
  headers: { "x-cron-secret": secret },
});
const cron = await res.json();
const d = cron.data;
if (!d) {
  console.error("No cron data");
  process.exit(1);
}

console.log("=== DN RECALC (Decibel taker 3.4 bps; builder +1 bps prod if approved) ===");
console.log("Sampled:", new Date(d.sampledAtUnixMs).toISOString());
console.log("OLD monitor used 34 bps (10x too high)\n");

/** @typedef {{ kind: string, market?: string, asset?: string, token?: string, sizeUsd: number, spreadBps: number, fundingApr24hPct?: number, shortEarnsFunding?: boolean, oldNet?: number, basisWarning?: string | null }} Row */

/** @type {Row[]} */
const rows = [];
for (const r of d.solana ?? []) {
  rows.push({
    kind: "entry",
    market: r.market,
    token: r.token,
    sizeUsd: r.sizeUsd,
    spreadBps: r.spreadBps,
    fundingApr24hPct: r.fundingApr24hPct,
    shortEarnsFunding: r.shortEarnsFunding,
    oldNet: r.netEntryEdgeBps,
    basisWarning: r.basisWarning,
  });
}
for (const r of d.solanaExit ?? []) {
  rows.push({
    kind: "exit",
    market: r.market,
    token: r.token,
    sizeUsd: r.sizeUsd,
    spreadBps: r.spreadBps,
    fundingApr24hPct: r.fundingApr24hPct,
    oldNet: r.netExitEdgeBps,
    basisWarning: r.basisWarning,
  });
}
for (const r of d.aptos ?? []) {
  rows.push({
    kind: "entry",
    market: r.market,
    asset: r.asset,
    sizeUsd: r.sizeUsd,
    spreadBps: r.spreadBps,
    fundingApr24hPct: r.fundingApr24hPct,
    shortEarnsFunding: r.shortEarnsFunding,
    oldNet: r.netEntryEdgeBps,
  });
}

function label(r) {
  return r.market ?? r.asset ?? "?";
}

console.log("--- SOLANA / APTOS @ $5000 (entry) ---");
console.log(
  "Market".padEnd(14),
  "spread",
  "net@3.4",
  "net@4.4*",
  "fav",
  "BE d",
  "fund%",
  "oldNet"
);
for (const r of rows.filter((x) => x.kind === "entry" && x.sizeUsd === 5000)) {
  if (r.basisWarning) continue;
  const n34 = netEntry(r.spreadBps, TAKER);
  const n134 = netEntry(r.spreadBps, TAKER + BUILDER_PROD);
  const net = n34; // Hyperion cost is already in spreadBps (exec quote + 20 bps buffer)
  const fav = net > 0;
  const be = beDays(net, r.fundingApr24hPct ?? 0, r.shortEarnsFunding ?? false);
  console.log(
    label(r).padEnd(14),
    r.spreadBps.toFixed(1).padStart(6),
    n34.toFixed(1).padStart(7),
    n134.toFixed(1).padStart(8),
    (fav ? "YES" : "no").padStart(6),
    (be?.toFixed(1) ?? "-").padStart(7),
    (r.fundingApr24hPct?.toFixed(1) ?? "-").padStart(6),
    r.oldNet?.toFixed(1).padStart(7)
  );
}

console.log("\n--- EXIT (Jupiter sell + Decibel close) $5000 ---");
for (const r of rows.filter((x) => x.kind === "exit" && x.sizeUsd === 5000)) {
  const n34 = netExit(r.spreadBps, TAKER);
  const n134 = netExit(r.spreadBps, TAKER + BUILDER_PROD);
  console.log(
    label(r).padEnd(14),
    "spread",
    r.spreadBps.toFixed(1),
    "| net exit @3.4:",
    n34.toFixed(1),
    "bps ($" + usd(r.sizeUsd, n34).toFixed(2) + ")",
    "| @13.4:",
    n134.toFixed(1),
    "bps | old:",
    r.oldNet?.toFixed(1)
  );
}

const favEntry = rows.filter(
  (r) =>
    r.kind === "entry" &&
    !r.basisWarning &&
    (r.asset ? netEntry(r.spreadBps, TAKER) : netEntry(r.spreadBps, TAKER)) > 0
);
const favExit = rows.filter((r) => r.kind === "exit" && netExit(r.spreadBps, TAKER) > 0);

console.log("\n--- FAVORABLE ENTRY (protocol 3.4 bps only) ---");
if (!favEntry.length) console.log("(none)");
else
  favEntry.forEach((r) =>
    console.log(`  ${label(r)} $${r.sizeUsd}: +${netEntry(r.spreadBps, TAKER).toFixed(1)} bps`)
  );

console.log("\n--- FAVORABLE EXIT @ 3.4 bps ---");
if (!favExit.length) console.log("(none)");
else favExit.forEach((r) => console.log(`  ${label(r)} $${r.sizeUsd}: +${netExit(r.spreadBps, TAKER).toFixed(1)} bps`));

console.log("\n--- RT COST ESTIMATE $1000 SOL (illustrative) ---");
const sol = rows.find((r) => r.market === "SOL/USD" && r.kind === "entry" && r.sizeUsd === 1000);
const solE = rows.find((r) => r.market === "SOL/USD" && r.kind === "exit" && r.sizeUsd === 1000);
if (sol) {
  const entryDrag = usd(1000, netEntry(sol.spreadBps, TAKER));
  const exitDrag = solE ? usd(1000, netExit(solE.spreadBps, TAKER)) : null;
  console.log({
    entryDragUsd: "$" + entryDrag.toFixed(2),
    exitDragUsd: exitDrag != null ? "$" + exitDrag.toFixed(2) : "n/a",
    rtDecibelOnly: "$" + ((1000 * TAKER * 2) / 10000).toFixed(2),
    fund24: sol.fundingApr24hPct?.toFixed(1) + "%",
  });
}
