/**
 * Verify Hyperion quotes vs monitor fee model; check builder-config API.
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

const USDC = "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b";
const WBTC = "0x68844a0d7f2587e726ad0579f3d640865bb4162c08a4589eeda3f9689ec52a3d";
const XBTC = "0x81214a80d82035a190fcb76b6ff3c0145161c3a9f33d137f2bbaee4cfec8a387";
const APT = "0xa";
const BUFFER_BPS = 20;
const DECIBEL_TAKER = 3.4;
const EXTRA_HYPERION_BPS = 30; // DN_EST_HYPERION_SWAP_BPS in monitor net edge

async function hyperionAmountIn(amountOutBase, from, to) {
  const params = new URLSearchParams({
    amount: String(amountOutBase),
    from,
    to,
    safeMode: "true",
    flag: "out",
  });
  const data = await fetch(`https://api.hyperion.xyz/base/rate/getSwapInfo?${params}`).then((r) =>
    r.json()
  );
  return BigInt(String(data.amountIn));
}

async function hyperionAmountOut(amountInBase, from, to) {
  const params = new URLSearchParams({
    amount: String(amountInBase),
    from,
    to,
    safeMode: "true",
    flag: "in",
  });
  const data = await fetch(`https://api.hyperion.xyz/base/rate/getSwapInfo?${params}`).then((r) =>
    r.json()
  );
  return { amountOut: BigInt(String(data.amountOut)), raw: data };
}

async function decibelMark(asset) {
  const secret = process.env.YIELD_AI_CRON_SECRET;
  const cron = await fetch("https://yieldai.app/api/protocols/decibel/dn-spread-monitor/cron", {
    headers: { "x-cron-secret": secret },
  }).then((r) => r.json());
  const row = cron.data?.aptos?.find((x) => x.asset === asset && x.sizeUsd === 5000);
  return row;
}

async function quotePair(label, spotMeta, decimals, mark, sizeUsd) {
  const spotOut = BigInt(Math.ceil((sizeUsd / mark) * 10 ** decimals));
  const usdcIn = await hyperionAmountIn(spotOut, USDC, spotMeta);
  const usdcInUsd = Number(usdcIn) / 1e6;
  const buffered = (usdcIn * BigInt(10000 + BUFFER_BPS)) / BigInt(10000);
  const bufferedUsd = Number(buffered) / 1e6;
  const effPx = bufferedUsd / (Number(spotOut) / 10 ** decimals);
  const spreadBps = ((effPx / mark) - 1) * 10_000;

  const netOnlySpread = -spreadBps - DECIBEL_TAKER;
  const netWithExtra30 = -spreadBps - DECIBEL_TAKER - EXTRA_HYPERION_BPS;

  // Exit: sell same spot amount
  const sell = await hyperionAmountOut(spotOut, spotMeta, USDC);
  const usdcOut = Number(sell.amountOut) / 1e6;
  const sellPx = usdcOut / (Number(spotOut) / 10 ** decimals);
  const exitSpreadBps = ((sellPx / mark) - 1) * 10_000;
  const netExit = exitSpreadBps - DECIBEL_TAKER;

  console.log(`\n=== ${label} $${sizeUsd} (mark $${mark}) ===`);
  console.log({
    hyperionUsdcIn: usdcInUsd.toFixed(2),
    with20bpsBuffer: bufferedUsd.toFixed(2),
    entrySpreadBps: spreadBps.toFixed(2),
    monitorRowSpread: (await decibelMark(label.split(" ")[0]))?.spreadBps?.toFixed(2),
    netEntry_spreadPlusDecibel: netOnlySpread.toFixed(1) + " bps",
    netEntry_monitorAdds30bps: netWithExtra30.toFixed(1) + " bps",
    exitSpreadBps: exitSpreadBps.toFixed(2),
    netExit_spreadPlusDecibel: netExit.toFixed(1) + " bps",
    rtSpreadOnly: (spreadBps - exitSpreadBps).toFixed(1) + " bps (entry+exit hyperion)",
    rtUsd_spreadOnly: ((sizeUsd * (spreadBps - exitSpreadBps)) / 10000).toFixed(2),
  });
  if (sell.raw?.feeRate != null) console.log("  hyperion raw feeRate:", sell.raw.feeRate);
}

const btcRow = await decibelMark("BTC");
const aptRow = await decibelMark("APT");
if (btcRow) {
  await quotePair("BTC WBTC", WBTC, 8, btcRow.decibelMark, 5000);
  await quotePair("BTC xBTC", XBTC, 8, btcRow.decibelMark, 5000);
}
if (aptRow) await quotePair("APT", APT, 8, aptRow.decibelMark, 5000);

console.log("\n=== BUILDER FEE (Yield AI) ===");
try {
  const bc = await fetch("https://yieldai.app/api/protocols/decibel/builder-config").then((r) =>
    r.json()
  );
  console.log("Production builder-config:", bc);
} catch (e) {
  console.log("builder-config fetch failed:", e.message);
}

console.log(`
Sources:
- Hyperion: live getSwapInfo REST (same as monitor + close-preview)
- Entry spread includes ${BUFFER_BPS} bps INPUT_BUFFER on USDC in (deltaNeutralSpread.ts)
- Monitor netEntry ALSO subtracts ${EXTRA_HYPERION_BPS} bps — NOT in close-preview route
- Decibel taker: 3.4 bps (0.034%, docs + close-preview route)
- Builder: env DECIBEL_BUILDER_FEE_BPS default 10; ONLY if user approved on-chain (executor-open-delta-neutral)
`);
