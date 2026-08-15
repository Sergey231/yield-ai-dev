/**
 * One-off: read Hyperion LP positions for a safe and compute realized APR.
 * Usage: node scripts/check-safe-apr.mjs [safeAddress]
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAFE =
  process.argv[2] ??
  "0x14d82c74993aa5457e1b105cbe6c0169bc8315271db7d28153a4c53dbd47174f";

// Load .env.local
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

const APTOS_FULLNODE = "https://api.mainnet.aptoslabs.com/v1";
const APTOS_API_KEY = process.env.APTOS_API_KEY;
const VAULT = "0x333d1890e0aa3762bb256f5caeeb142431862628c63063801f44c152ef154700::vault";
const HYPERION = "0x8b4a2c4bb53857c718a04c020b98f8c2e1f99a68b0f57389a8bf5434cd22e05c";
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
const APR_MIN_ELAPSED = 3600;

async function aptosView(fn, args) {
  const res = await fetch(`${APTOS_FULLNODE}/view`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(APTOS_API_KEY ? { Authorization: `Bearer ${APTOS_API_KEY}` } : {}),
    },
    body: JSON.stringify({ function: fn, type_arguments: [], arguments: args }),
  });
  if (!res.ok) throw new Error(`${fn} HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

function i32FromU32(n) {
  return n >= 2147483648 ? n - 4294967296 : n;
}

function norm(addr) {
  const s = addr.toLowerCase().replace(/^0x/, "");
  return "0x" + s.padStart(64, "0");
}

async function getPrices(addresses) {
  const panoraUrl = process.env.PANORA_API_URL || "https://api.panora.exchange";
  const qp = new URLSearchParams({ chainId: "1", tokenAddress: addresses.join(",") });
  const res = await fetch(`${panoraUrl}/prices?${qp}`, {
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.PANORA_API_KEY || "",
    },
  });
  if (!res.ok) throw new Error(`Panora ${res.status}`);
  const list = await res.json();
  const byAddr = new Map();
  for (const it of Array.isArray(list) ? list : []) {
    const info = {
      usd: parseFloat(String(it.usdPrice ?? "0")) || 0,
      decimals: Number(it.decimals ?? 0) || 0,
      symbol: it.symbol ?? "?",
    };
    if (it.faAddress) byAddr.set(norm(it.faAddress), info);
    if (it.tokenAddress) byAddr.set(norm(it.tokenAddress), info);
  }
  return byAddr;
}

function rawToUsd(raw, info) {
  if (!info || raw <= 0n) return 0;
  return (Number(raw) / 10 ** info.decimals) * info.usd;
}

function toUsd(rawStr, info) {
  if (!info || rawStr == null) return 0;
  const n = Number(rawStr);
  if (!Number.isFinite(n)) return 0;
  return (n / 10 ** info.decimals) * info.usd;
}

async function main() {
  console.log("Safe:", SAFE);
  const configExists = await aptosView(`${VAULT}::hyperion_lp_config_exists`, [SAFE]).then(
    (r) => Boolean(r?.[0])
  );
  if (!configExists) {
    console.log("No Hyperion LP config on this safe.");
    return;
  }

  const posList = await aptosView(`${VAULT}::get_hyperion_positions`, [SAFE]);
  const addresses = posList?.[0] ?? [];
  console.log("Positions:", addresses.length);

  const positions = [];
  for (const posAddr of addresses) {
    const viewRes = await aptosView(`${VAULT}::get_hyperion_position`, [SAFE, posAddr]);
    const raw = viewRes?.[0];
    if (!raw) continue;

    let pendingFeeA = "0";
    let pendingFeeB = "0";
    let pendingRewards = [];
    if (!raw.closed) {
      const feesRes = await aptosView(`${HYPERION}::pool_v3::get_pending_fees`, [posAddr]).catch(
        () => null
      );
      if (feesRes?.[0]) {
        pendingFeeA = String(feesRes[0][0] ?? "0");
        pendingFeeB = String(feesRes[0][1] ?? "0");
      }
      const rewardsRes = await aptosView(`${HYPERION}::pool_v3::get_pending_rewards`, [
        posAddr,
      ]).catch(() => null);
      if (Array.isArray(rewardsRes?.[0])) {
        pendingRewards = rewardsRes[0]
          .map((r) => ({
            metadata: String(r?.reward_fa?.inner ?? ""),
            amount: String(r?.amount_owed ?? "0"),
          }))
          .filter((r) => r.metadata && r.amount !== "0");
      }
    }

    positions.push({
      position: posAddr,
      tokenA: raw.token_a,
      tokenB: raw.token_b,
      tickLower: i32FromU32(Number(raw.tick_lower)),
      tickUpper: i32FromU32(Number(raw.tick_upper)),
      amountA: String(raw.amount_a ?? raw.liquidity ?? "0"),
      amountB: String(raw.amount_b ?? "0"),
      openedAt: Number(raw.opened_at),
      closed: Boolean(raw.closed),
      pendingFeeA,
      pendingFeeB,
      pendingRewards,
    });
  }

  const addrs = new Set();
  for (const p of positions) {
    addrs.add(p.tokenA);
    addrs.add(p.tokenB);
    for (const r of p.pendingRewards) addrs.add(r.metadata);
  }

  const prices = await getPrices([...addrs]);
  const priceOf = (a) => prices.get(norm(a));
  const nowSec = Math.floor(Date.now() / 1000);

  for (const p of positions) {
    const pa = priceOf(p.tokenA);
    const pb = priceOf(p.tokenB);
    const valueUsd = toUsd(p.amountA, pa) + toUsd(p.amountB, pb);
    const feesUsd = toUsd(p.pendingFeeA, pa) + toUsd(p.pendingFeeB, pb);
    let rewardsUsd = 0;
    for (const r of p.pendingRewards) {
      rewardsUsd += toUsd(r.amount, priceOf(r.metadata));
    }
    const elapsed = p.openedAt > 0 ? nowSec - p.openedAt : 0;
    const aprPct =
      valueUsd > 0 && elapsed >= APR_MIN_ELAPSED
        ? ((feesUsd + rewardsUsd) / valueUsd) * (SECONDS_PER_YEAR / elapsed) * 100
        : null;

    const days = elapsed / 86400;
    console.log("\n---");
    console.log("Position:", p.position.slice(0, 18) + "…");
    console.log("Pool:", `${pa?.symbol ?? "?"}/${pb?.symbol ?? "?"}`, "range", [p.tickLower, p.tickUpper]);
    console.log("Closed:", p.closed);
    console.log("Value USD:", valueUsd.toFixed(4));
    console.log("Uncollected fees USD:", feesUsd.toFixed(6));
    console.log("Uncollected rewards USD:", rewardsUsd.toFixed(6));
    console.log("Opened:", new Date(p.openedAt * 1000).toISOString(), `(${days.toFixed(2)} days)`);
    console.log("Realized APR:", aprPct != null ? `${aprPct.toFixed(2)}%` : "n/a");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
