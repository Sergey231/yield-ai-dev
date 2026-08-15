/**
 * Dry-run for the thAPT -> APT -> USDC Hyperion batch swap.
 *
 * Validates the new `swapFaToFaHyperionBatch` path WITHOUT submitting any transaction:
 *   1) reads the safe's thAPT balance,
 *   2) pre-flights `VaultFaSwapConfig` (exists + non-zero limits),
 *   3) quotes `router_v3::get_batch_amount_out`,
 *   4) derives `amount_out_min = quote * (10000 - slippageBps) / 10000`,
 *   5) prints the plan. No funds move.
 *
 * Run (Node >= 22.6):
 *   node --experimental-strip-types scripts/thapt-batch-swap-dryrun.mts <SAFE_ADDRESS> [AMOUNT_IN_BASE_UNITS]
 *
 * AMOUNT_IN defaults to the safe's current thAPT balance; if that is 0 it falls back to
 * 0.1 thAPT (10000000) so the quote view still returns a number.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { submitSwapFaToFaHyperionBatch } from "../src/lib/protocols/yield-ai/swapFaToFaHyperionBatch.ts";
import { getFaBalance } from "../src/lib/protocols/yield-ai/engine/stateComputer.ts";
import {
  HYPERION_THAPT_USDC_LP_PATH,
  THAPT_FA_METADATA_MAINNET,
  USDC_FA_METADATA_MAINNET,
} from "../src/lib/constants/yieldAiVault.ts";

// dexDefaults.slippageBps in the strategy config (capped by riskLimits.maxSlippageBps: 100).
const SLIPPAGE_BPS = 50;
// 0.1 thAPT (8 decimals) — same trigger threshold as minSwapRewardBaseUnits.
const FALLBACK_AMOUNT_IN = 10_000_000n;

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

async function main() {
  loadEnvLocal();

  const safe = process.argv[2];
  if (!safe || !safe.startsWith("0x")) {
    console.error(
      "Usage: node --experimental-strip-types scripts/thapt-batch-swap-dryrun.mts <SAFE_ADDRESS> [AMOUNT_IN_BASE_UNITS]"
    );
    process.exit(1);
  }
  const amountArg = process.argv[3];

  const aptos = buildAptos();
  const balance = await getFaBalance(aptos, safe, THAPT_FA_METADATA_MAINNET);

  const amountIn =
    amountArg && /^\d+$/.test(amountArg)
      ? BigInt(amountArg)
      : balance > 0n
        ? balance
        : FALLBACK_AMOUNT_IN;

  console.log("[dry-run] inputs:", {
    safe,
    thAptBalance: balance.toString(),
    amountIn: amountIn.toString(),
    lpPath: HYPERION_THAPT_USDC_LP_PATH,
    slippageBps: SLIPPAGE_BPS,
  });

  // dryRun: true → runs pre-flight + quote + logging, never submits.
  const result = await submitSwapFaToFaHyperionBatch({
    network: "mainnet",
    safe,
    lpPath: HYPERION_THAPT_USDC_LP_PATH,
    amountIn,
    fromMetadata: THAPT_FA_METADATA_MAINNET,
    toMetadata: USDC_FA_METADATA_MAINNET,
    slippageBps: SLIPPAGE_BPS,
    dryRun: true,
  });

  console.log("[dry-run] result:", {
    skipped: result.skipped,
    skippedReason: result.skippedReason,
    quoteUsdc: result.quote?.toString() ?? null,
    amountOutMinUsdc: result.amountOutMin.toString(),
  });

  if (result.skipped) {
    console.log(
      `[dry-run] action would be SKIPPED (${result.skippedReason}) — no swap on a live run.`
    );
  } else {
    console.log("[dry-run] action would EXECUTE on a live run with the values above.");
  }
}

main().catch((e) => {
  console.error("[dry-run] error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
