/**
 * Close GOLD/USD multi-chain DN pilot: Jupiter sell spot, then Decibel close short.
 *
 * Default is dry-run. Pass `--live` to execute.
 *
 * Run:
 *   npm run dn-pilot:close
 *   npx tsx scripts/dn-pilot-close.mts --live
 */
import { getServerSolanaConnection } from "@/app/api/jupiter/_lib";
import { logDnExecutor } from "@/lib/protocols/decibel/dnMultiChain/auditLog";
import { closeDecibelShort } from "@/lib/protocols/decibel/dnMultiChain/decibelShortLeg";
import { loadEnvLocal } from "@/lib/protocols/decibel/dnMultiChain/loadEnv";
import { loadDnPilotConfig } from "@/lib/protocols/decibel/dnMultiChain/pilotConfig";
import {
  getDnSolanaKeypair,
  getSplTokenBalanceBaseUnits,
  jupiterSellSpotForUsdc,
} from "@/lib/protocols/decibel/dnMultiChain/solanaExecutor";

async function main() {
  loadEnvLocal();
  const live = process.argv.includes("--live");
  const dryRun = !live;
  const config = loadDnPilotConfig();

  if (!dryRun && !process.env.YIELD_AI_EXECUTOR_PRIVATE_KEY) {
    throw new Error("YIELD_AI_EXECUTOR_PRIVATE_KEY is required for live Aptos leg");
  }

  logDnExecutor("close_start", {
    mode: dryRun ? "dryRun" : "live",
    market: config.market,
    subaccount: config.subaccount,
    solanaPubkey: config.solanaPubkey,
  });

  const connection = getServerSolanaConnection();
  const { keypair } = getDnSolanaKeypair(config.solanaPubkey);
  const spotBal = await getSplTokenBalanceBaseUnits({
    connection,
    owner: config.solanaPubkey,
    mint: config.spotMint,
  });

  let spotSell: Awaited<ReturnType<typeof jupiterSellSpotForUsdc>> | null = null;
  if (spotBal > 0n) {
    spotSell = await jupiterSellSpotForUsdc({
      connection,
      keypair,
      inputMint: config.spotMint,
      amountBaseUnits: spotBal,
      slippageBps: config.slippageBps,
      dryRun,
    });
    logDnExecutor("solana_spot_sold", {
      signature: spotSell.signature,
      spotIn: spotSell.spotIn,
      usdcOut: spotSell.usdcOut,
      spotBalanceBefore: spotBal.toString(),
    });
  } else {
    logDnExecutor("solana_spot_skipped", { reason: "zero spot balance" });
  }

  const decibelClose = await closeDecibelShort({
    subaccount: config.subaccount,
    marketName: config.market,
    dryRun,
  });

  logDnExecutor("close_done", {
    dryRun,
    solana: spotSell
      ? { signature: spotSell.signature, usdcOut: spotSell.usdcOut }
      : { skipped: true },
    decibel: {
      closeTxHash: decibelClose.closeTxHash,
      shortSize: decibelClose.shortSize,
      markPx: decibelClose.markPx,
    },
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
