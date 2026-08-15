/**
 * Open GOLD/USD multi-chain DN pilot: Decibel short first, then Jupiter spot buy.
 *
 * Default is dry-run (no on-chain txs). Pass `--live` to execute.
 *
 * Run:
 *   npm run dn-pilot:open
 *   npx tsx scripts/dn-pilot-open.mts --live
 *
 * Optional flags:
 *   --skip-signal     skip net-edge gate
 *   --short-only      only open Decibel short (debug)
 */
import { getServerSolanaConnection } from "@/app/api/jupiter/_lib";
import { logDnExecutor } from "@/lib/protocols/decibel/dnMultiChain/auditLog";
import { openDecibelShort } from "@/lib/protocols/decibel/dnMultiChain/decibelShortLeg";
import { loadEnvLocal } from "@/lib/protocols/decibel/dnMultiChain/loadEnv";
import { loadDnPilotConfig } from "@/lib/protocols/decibel/dnMultiChain/pilotConfig";
import { evaluateDnPilotSignal } from "@/lib/protocols/decibel/dnMultiChain/preflightSignal";
import {
  getDnSolanaKeypair,
  jupiterBuySpotWithUsdc,
} from "@/lib/protocols/decibel/dnMultiChain/solanaExecutor";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  loadEnvLocal();
  const live = hasFlag("--live");
  const dryRun = !live;
  const skipSignal = hasFlag("--skip-signal");
  const shortOnly = hasFlag("--short-only");
  const config = loadDnPilotConfig();

  if (!dryRun && !process.env.YIELD_AI_EXECUTOR_PRIVATE_KEY) {
    throw new Error("YIELD_AI_EXECUTOR_PRIVATE_KEY is required for live Aptos leg");
  }

  const signal = skipSignal ? null : await evaluateDnPilotSignal(config);
  if (signal && !signal.passesMinNetEdge) {
    throw new Error(
      `Signal blocked: netEntryEdgeBps=${signal.netEntryEdgeBps} < min ${config.minNetEdgeBps}. Use --skip-signal to override.`
    );
  }

  logDnExecutor("open_start", {
    mode: dryRun ? "dryRun" : "live",
    config: {
      market: config.market,
      sizeUsd: config.sizeUsd,
      subaccount: config.subaccount,
      solanaPubkey: config.solanaPubkey,
    },
    signal,
  });

  const shortResult = await openDecibelShort({
    subaccount: config.subaccount,
    marketName: config.market,
    orderSizeUsd: config.sizeUsd,
    dryRun,
  });

  logDnExecutor("decibel_short_opened", {
    configureTxHash: shortResult.configureTxHash,
    openTxHash: shortResult.openTxHash,
    openTxVersion: shortResult.openTxVersion?.toString() ?? null,
    markPx: shortResult.markPx,
    filledShortHumanBase: shortResult.filledShortHumanBase,
    shortNotionalUsd: shortResult.shortNotionalUsd,
  });

  if (shortOnly) {
    logDnExecutor("open_done_short_only", { dryRun });
    return;
  }

  const swapNotionalUsd =
    Number.isFinite(shortResult.shortNotionalUsd) && shortResult.shortNotionalUsd > 0
      ? shortResult.shortNotionalUsd
      : config.sizeUsd;

  const { keypair } = getDnSolanaKeypair(config.solanaPubkey);
  const connection = getServerSolanaConnection();
  const spotSwap = await jupiterBuySpotWithUsdc({
    connection,
    keypair,
    outputMint: config.spotMint,
    sizeUsd: swapNotionalUsd,
    slippageBps: config.slippageBps,
    dryRun,
  });

  logDnExecutor("open_done", {
    dryRun,
    decibel: {
      openTxHash: shortResult.openTxHash,
      shortNotionalUsd: shortResult.shortNotionalUsd,
    },
    solana: {
      signature: spotSwap.signature,
      usdcIn: spotSwap.usdcIn,
      spotOut: spotSwap.spotOut,
      swapNotionalUsd,
    },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
