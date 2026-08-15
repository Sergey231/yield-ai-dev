/**
 * Preflight for GOLD/USD multi-chain DN pilot: signal, balances, delegation.
 *
 * Run:
 *   npm run dn-pilot:preflight
 *   npx tsx scripts/dn-pilot-preflight.mts
 *
 * Requires `.env.local` or process env:
 *   DECIBEL_API_KEY, JUPITER_API_KEY, SOLANA_RPC_URL,
 *   DN_SOLANA_EXECUTOR_PRIVATE_KEY (optional for pubkey check only),
 *   YIELD_AI_EXECUTOR_PRIVATE_KEY (delegation uses on-chain executor)
 */
import { getServerSolanaConnection } from "@/app/api/jupiter/_lib";
import { logDnExecutor } from "@/lib/protocols/decibel/dnMultiChain/auditLog";
import {
  assertExecutorDelegation,
  fetchSubaccountUsdcBalanceUsd,
} from "@/lib/protocols/decibel/dnMultiChain/decibelShortLeg";
import { loadEnvLocal } from "@/lib/protocols/decibel/dnMultiChain/loadEnv";
import {
  DN_PILOT_RECOMMENDED_SOL,
  loadDnPilotConfig,
  USDC_DECIMALS_SOLANA,
  USDC_MINT_SOLANA,
} from "@/lib/protocols/decibel/dnMultiChain/pilotConfig";
import { evaluateDnPilotSignal } from "@/lib/protocols/decibel/dnMultiChain/preflightSignal";
import {
  getDnSolanaKeypair,
  getSolBalanceSol,
  getSplTokenBalanceBaseUnits,
} from "@/lib/protocols/decibel/dnMultiChain/solanaExecutor";

async function main() {
  loadEnvLocal();
  const config = loadDnPilotConfig();
  const connection = getServerSolanaConnection();

  let derivedPubkey: string | null = null;
  try {
    derivedPubkey = getDnSolanaKeypair(config.solanaPubkey).address;
  } catch (e) {
    logDnExecutor("preflight_key_warning", {
      error: e instanceof Error ? e.message : String(e),
      note: "Set DN_SOLANA_EXECUTOR_PRIVATE_KEY locally to verify pubkey before live run",
    });
  }

  const [solBal, usdcBal, spotBal, delegation, subUsdc, signal] = await Promise.all([
    getSolBalanceSol(connection, config.solanaPubkey),
    getSplTokenBalanceBaseUnits({
      connection,
      owner: config.solanaPubkey,
      mint: USDC_MINT_SOLANA,
    }),
    getSplTokenBalanceBaseUnits({
      connection,
      owner: config.solanaPubkey,
      mint: config.spotMint,
    }),
    assertExecutorDelegation(config.subaccount).catch((e) => ({
      error: e instanceof Error ? e.message : String(e),
    })),
    fetchSubaccountUsdcBalanceUsd(config.subaccount),
    evaluateDnPilotSignal(config),
  ]);

  const usdcHuman = Number(usdcBal) / 10 ** USDC_DECIMALS_SOLANA;
  const spotHuman = Number(spotBal) / 10 ** config.spotDecimals;
  const solOk = solBal >= DN_PILOT_RECOMMENDED_SOL * 0.8;
  const usdcOk = usdcHuman >= config.sizeUsd * 0.95;
  const subUsdcOk = subUsdc == null ? null : subUsdc >= config.sizeUsd * 0.95;

  const ready =
    solOk &&
    usdcOk &&
    subUsdcOk !== false &&
    !("error" in delegation) &&
    signal.passesMinNetEdge;

  logDnExecutor("preflight", {
    config: {
      market: config.market,
      token: config.token,
      sizeUsd: config.sizeUsd,
      safeAddress: config.safeAddress,
      subaccount: config.subaccount,
      solanaPubkey: config.solanaPubkey,
      derivedPubkey,
    },
    balances: {
      sol: solBal,
      recommendedSol: DN_PILOT_RECOMMENDED_SOL,
      usdcOnSolana: usdcHuman,
      spotOnSolana: spotHuman,
      subaccountUsdcEstimate: subUsdc,
    },
    delegation,
    signal,
    checks: {
      solOk,
      usdcOk,
      subUsdcOk,
      signalOk: signal.passesMinNetEdge,
      ready,
    },
    fundingGuide: {
      solana: `Send ~${DN_PILOT_RECOMMENDED_SOL} SOL + $${config.sizeUsd} USDC to ${config.solanaPubkey}`,
      decibel: `Deposit ~$${config.sizeUsd} USDC margin to subaccount ${config.subaccount}`,
    },
  });

  if (!ready) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
