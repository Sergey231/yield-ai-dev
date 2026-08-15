/**
 * Deploy idle USDt into an in-range USDt/USDC LP position:
 * 1) swap ~50% USDt → USDC (center tick needs both legs)
 * 2) dual-add remaining USDt + USDC from the idle pile
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { runHyperionAddDual } from "../src/lib/protocols/yield-ai/hyperionLpActions.ts";
import { executeSwapFaToFa } from "../src/lib/protocols/yield-ai/vaultExecutor.ts";
import { getHyperionAmountOut } from "../src/lib/protocols/yield-ai/engine/hyperionQuote.ts";
import { computeZapValueFractionToNonUsdc, getPoolCurrentTick } from "../src/lib/protocols/yield-ai/hyperionLp.ts";
import { getFaBalance } from "../src/lib/protocols/yield-ai/engine/stateComputer.ts";
import {
  SWAP_SQRT_PRICE_LIMIT,
  USDC_FA_METADATA_MAINNET,
  YIELD_AI_HYPERION_POOLS,
} from "../src/lib/constants/yieldAiVault.ts";

const USDT = "0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b";
const SAFE = "0x14d82c74993aa5457e1b105cbe6c0169bc8315271db7d28153a4c53dbd47174f";
const POSITION = "0x33ed926502673a0152646ab82a8642b82591280636f9d08d93bb524ce5c6c9ef";
const POOL = YIELD_AI_HYPERION_POOLS.usdt_usdc;
const SLIPPAGE_BPS = 50n;
const DEADLINE_SEC = 600;

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const i = trimmed.indexOf("=");
      if (i <= 0) continue;
      const key = trimmed.slice(0, i).trim();
      let val = trimmed.slice(i + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* optional */
  }
}

function buildAptos(): Aptos {
  const key = process.env.APTOS_API_KEY;
  return new Aptos(
    new AptosConfig({
      network: Network.MAINNET,
      ...(key ? { clientConfig: { HEADERS: { Authorization: `Bearer ${key}` } } } : {}),
    })
  );
}

function deadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SEC);
}

async function main() {
  loadEnvLocal();
  const live = process.argv.includes("--live");
  const dryRun = !live;
  const aptos = buildAptos();

  const usdtBefore = await getFaBalance(aptos, SAFE, USDT);
  const usdcBefore = await getFaBalance(aptos, SAFE, USDC_FA_METADATA_MAINNET);
  const currentTick = await getPoolCurrentTick(POOL.poolAddress);

  // Use full idle USDt (caller can cap via DEPLOY_USDT_BASE env).
  const deployCap = process.env.DEPLOY_USDT_BASE ? BigInt(process.env.DEPLOY_USDT_BASE) : usdtBefore;
  const deployUsdt = deployCap > usdtBefore ? usdtBefore : deployCap;
  if (deployUsdt <= 0n) throw new Error("No idle USDt to deploy");

  const r = computeZapValueFractionToNonUsdc({
    currentTick,
    tickLower: -7,
    tickUpper: 3,
  });
  // Swap the USDC-leg share of the idle USDt pile into USDC before dual-add.
  const swapIn = (deployUsdt * BigInt(Math.round(r * 1_000_000))) / 1_000_000n;
  const addAPlanned = deployUsdt - swapIn;

  let quotedOut = 0n;
  let amountOutMin = 0n;
  if (swapIn > 0n) {
    quotedOut = await getHyperionAmountOut({
      amountInBaseUnits: swapIn,
      fromMetadata: USDT,
      toMetadata: USDC_FA_METADATA_MAINNET,
    });
    amountOutMin = (quotedOut * (10_000n - SLIPPAGE_BPS)) / 10_000n;
  }

  console.log(
    JSON.stringify(
      {
        step: dryRun ? "dryRun" : "live",
        usdtBefore: usdtBefore.toString(),
        usdcBefore: usdcBefore.toString(),
        deployUsdt: deployUsdt.toString(),
        currentTick,
        valueFractionNonUsdc: r,
        swapUsdtIn: swapIn.toString(),
        addUsdtPlanned: addAPlanned.toString(),
        quotedUsdcOut: quotedOut.toString(),
        amountOutMin: amountOutMin.toString(),
      },
      null,
      2
    )
  );

  let swapHash: string | null = null;
  if (swapIn > 0n) {
    const swap = await executeSwapFaToFa({
      safeAddress: SAFE,
      feeTier: POOL.feeTier,
      amountInBaseUnits: swapIn,
      amountOutMinBaseUnits: amountOutMin,
      sqrtPriceLimit: SWAP_SQRT_PRICE_LIMIT,
      fromTokenMetadata: USDT,
      toTokenMetadata: USDC_FA_METADATA_MAINNET,
      deadlineUnixSeconds: deadline(),
      dryRun,
    });
    swapHash = swap.hash ?? null;
    if (!dryRun) console.log("swapHash", swapHash);
  }

  if (dryRun) {
    console.log(JSON.stringify({ swapDryRun: true, addDryRunPlanned: true }, null, 2));
    const addPreview = await runHyperionAddDual({
      safeAddress: SAFE,
      position: POSITION,
      amountABaseUnits: addAPlanned,
      amountBBaseUnits: amountOutMin,
      dryRun: true,
    });
    console.log(JSON.stringify(addPreview, null, 2));
    return;
  }

  // Live: use actual post-swap balances delta from the idle pile.
  const usdtAfter = await getFaBalance(aptos, SAFE, USDT);
  const usdcAfter = await getFaBalance(aptos, SAFE, USDC_FA_METADATA_MAINNET);
  const addA = usdtBefore > usdtAfter ? usdtBefore - usdtAfter : 0n;
  const addB = usdcAfter > usdcBefore ? usdcAfter - usdcBefore : 0n;

  if (addA <= 0n && addB <= 0n) throw new Error("No deployable legs after swap");

  const add = await runHyperionAddDual({
    safeAddress: SAFE,
    position: POSITION,
    amountABaseUnits: addA,
    amountBBaseUnits: addB,
    dryRun: false,
  });

  console.log(
    JSON.stringify(
      {
        swapHash,
        addHash: add.hash ?? null,
        addA: addA.toString(),
        addB: addB.toString(),
        usdtAfter: (await getFaBalance(aptos, SAFE, USDT)).toString(),
        usdcAfter: (await getFaBalance(aptos, SAFE, USDC_FA_METADATA_MAINNET)).toString(),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
