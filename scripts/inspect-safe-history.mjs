/**
 * One-off: dump ALL fungible_asset_activities for a safe (no entry-fn filter),
 * compare with what deposit-history / stablecoin-compound-history would show,
 * and recompute Modified Dietz APR.
 * Usage: node scripts/inspect-safe-history.mjs [safeAddress]
 */
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
} catch {}

const SAFE =
  process.argv[2] ??
  "0x2822696e70a22d2a4bd8aa12444a8293b9a84839122632e162a22da41f18b203";

const INDEXER = "https://indexer.mainnet.aptoslabs.com/v1/graphql";
const KEY = process.env.APTOS_API_KEY;
const VAULT = "0x333d1890e0aa3762bb256f5caeeb142431862628c63063801f44c152ef154700::vault";
const USDC = "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b";
const USD1 = "0x05fabd1b12e39967a3c24e91b7b8f67719a6dacee74f3c8b9fb7d93e855437d2";

const QUERY = `
  query AllSafeFlows($safe: String!) {
    fungible_asset_activities(
      where: {
        owner_address: { _eq: $safe }
        is_transaction_success: { _eq: true }
      }
      order_by: { transaction_version: asc }
      limit: 1000
    ) {
      transaction_version
      transaction_timestamp
      entry_function_id_str
      asset_type
      type
      amount
    }
  }
`;

async function gql(query, variables) {
  const res = await fetch(INDEXER, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`indexer ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const data = await gql(QUERY, { safe: SAFE });
const rows = data.fungible_asset_activities ?? [];
console.log(`Total FA activity rows for safe: ${rows.length}\n`);

// Group by tx
const byTx = new Map();
for (const r of rows) {
  const v = String(r.transaction_version);
  if (!byTx.has(v)) byTx.set(v, { ts: r.transaction_timestamp, fn: r.entry_function_id_str, legs: [] });
  byTx.get(v).legs.push({ asset: r.asset_type, type: r.type, amount: r.amount });
}

const shortAsset = (a) => {
  if (a === USDC) return "USDC";
  if (a === USD1) return "USD1";
  if (a === "0xa" || /aptos_coin/i.test(a)) return "APT";
  return a.slice(0, 10) + "…" + a.slice(-6);
};
const dirOf = (t) => (/Deposit/i.test(t) ? "+" : /Withdraw/i.test(t) ? "-" : "?");

for (const [v, tx] of byTx) {
  const fn = tx.fn ?? "(none)";
  const fnShort = fn.replace(VAULT + "::", "vault::");
  console.log(`v${v}  ${tx.ts}  ${fnShort}`);
  for (const leg of tx.legs) {
    console.log(`    ${dirOf(leg.type)}${leg.amount}  ${shortAsset(leg.asset)}  (${leg.type.split("::").pop()})`);
  }
}

// What deposit-history counts (user flows only):
console.log("\n=== deposit-history view (vault::deposit / vault::withdraw, USDC+USD1 only) ===");
let dep = 0n, wd = 0n;
const flowEntries = [];
for (const r of rows) {
  const fn = r.entry_function_id_str ?? "";
  if (![USDC, USD1].includes(r.asset_type)) continue;
  if (fn === `${VAULT}::deposit`) {
    dep += BigInt(r.amount);
    flowEntries.push({ ts: r.transaction_timestamp, amt: Number(r.amount) / 1e6, dir: "deposit" });
  } else if (fn === `${VAULT}::withdraw`) {
    wd += BigInt(r.amount);
    flowEntries.push({ ts: r.transaction_timestamp, amt: Number(r.amount) / 1e6, dir: "withdraw" });
  }
}
console.log("totalDeposited:", Number(dep) / 1e6, " totalWithdrawn:", Number(wd) / 1e6, " net:", Number(dep - wd) / 1e6);

// Modified Dietz with currentValue from screenshot
const CURRENT_VALUE = 142.06;
flowEntries.sort((a, b) => new Date(a.ts) - new Date(b.ts));
if (flowEntries.length) {
  const now = Date.now();
  const firstTs = new Date(flowEntries[0].ts).getTime();
  const totalDays = (now - firstTs) / 86400000;
  let dollarDays = 0, balance = 0, prev = firstTs;
  for (const e of flowEntries) {
    const ts = new Date(e.ts).getTime();
    dollarDays += balance * (ts - prev) / 86400000;
    prev = ts;
    balance += e.dir === "deposit" ? e.amt : -e.amt;
  }
  dollarDays += balance * (now - prev) / 86400000;
  const avgCapital = dollarDays / totalDays;
  const net = Number(dep - wd) / 1e6;
  const pnl = CURRENT_VALUE - net;
  console.log(`\nModified Dietz: days=${totalDays.toFixed(2)} avgCapital=${avgCapital.toFixed(2)} pnl=${pnl.toFixed(2)} apr=${((pnl / avgCapital) * (365 / totalDays) * 100).toFixed(2)}%`);
}
