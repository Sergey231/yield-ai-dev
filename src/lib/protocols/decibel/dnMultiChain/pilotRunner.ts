import { getServerSolanaConnection } from "@/app/api/jupiter/_lib";
import { logDnExecutor } from "@/lib/protocols/decibel/dnMultiChain/auditLog";
import {
  assertExecutorDelegation,
  fetchSubaccountUsdcBalanceUsd,
  openDecibelShort,
  closeDecibelShort,
  getActiveShortSize,
  resolvePilotMarket,
} from "@/lib/protocols/decibel/dnMultiChain/decibelShortLeg";
import { fetchDecibelMarkPx } from "@/lib/protocols/decibel/decibelApi";
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
  jupiterBuySpotWithUsdc,
  jupiterSellSpotForUsdc,
  capSpotSwapUsd,
} from "@/lib/protocols/decibel/dnMultiChain/solanaExecutor";

export type DnPilotPreflightResult = {
  config: ReturnType<typeof loadDnPilotConfig>;
  derivedPubkey: string | null;
  balances: {
    sol: number;
    recommendedSol: number;
    usdcOnSolana: number;
    spotOnSolana: number;
    subaccountUsdcEstimate: number | null;
  };
  delegation: Awaited<ReturnType<typeof assertExecutorDelegation>> | { error: string };
  signal: Awaited<ReturnType<typeof evaluateDnPilotSignal>>;
  checks: {
    solOk: boolean;
    usdcOk: boolean;
    subUsdcOk: boolean | null;
    signalOk: boolean;
    keyOk: boolean;
    ready: boolean;
  };
};

export async function runDnPilotPreflight(): Promise<DnPilotPreflightResult> {
  const config = loadDnPilotConfig();
  const connection = getServerSolanaConnection();

  let derivedPubkey: string | null = null;
  let keyOk = false;
  try {
    const { address } = getDnSolanaKeypair(config.solanaPubkey);
    derivedPubkey = address;
    keyOk = address === config.solanaPubkey;
  } catch (e) {
    logDnExecutor("preflight_key_error", {
      error: e instanceof Error ? e.message : String(e),
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
  const delegationOk = !("error" in delegation);

  const ready =
    keyOk &&
    solOk &&
    usdcOk &&
    subUsdcOk !== false &&
    delegationOk &&
    signal.passesMinNetEdge;

  return {
    config,
    derivedPubkey,
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
      keyOk,
      ready,
    },
  };
}

export async function runDnPilotOpen(options: {
  live: boolean;
  skipSignal?: boolean;
  spotOnly?: boolean;
}): Promise<Record<string, unknown>> {
  const config = loadDnPilotConfig();
  const dryRun = !options.live;

  if (!dryRun && !process.env.YIELD_AI_EXECUTOR_PRIVATE_KEY && !options.spotOnly) {
    throw new Error("YIELD_AI_EXECUTOR_PRIVATE_KEY is required for live Aptos leg");
  }

  const { address: derivedPubkey } = getDnSolanaKeypair(config.solanaPubkey);
  if (derivedPubkey !== config.solanaPubkey) {
    throw new Error(
      `DN_SOLANA_EXECUTOR_PRIVATE_KEY pubkey mismatch: derived ${derivedPubkey}, expected ${config.solanaPubkey}`
    );
  }

  if (options.spotOnly) {
    return runDnPilotSpotOnly({ config, dryRun, derivedPubkey });
  }

  const signal = options.skipSignal ? null : await evaluateDnPilotSignal(config);
  if (signal && !signal.passesMinNetEdge) {
    throw new Error(
      `Signal blocked: netEntryEdgeBps=${signal.netEntryEdgeBps} < min ${config.minNetEdgeBps}`
    );
  }

  logDnExecutor("open_start", {
    mode: dryRun ? "dryRun" : "live",
    market: config.market,
    sizeUsd: config.sizeUsd,
    subaccount: config.subaccount,
    solanaPubkey: config.solanaPubkey,
    signal,
  });

  const shortResult = await openDecibelShort({
    subaccount: config.subaccount,
    marketName: config.market,
    orderSizeUsd: config.sizeUsd,
    dryRun,
  });

  const swapNotionalUsd = await capSpotSwapUsd({
    connection: getServerSolanaConnection(),
    owner: config.solanaPubkey,
    targetUsd:
      Number.isFinite(shortResult.shortNotionalUsd) && shortResult.shortNotionalUsd > 0
        ? shortResult.shortNotionalUsd
        : config.sizeUsd,
  });

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

  const result = {
    mode: dryRun ? "dryRun" : "live",
    signal,
    decibel: {
      configureTxHash: shortResult.configureTxHash,
      openTxHash: shortResult.openTxHash,
      openTxVersion: shortResult.openTxVersion?.toString() ?? null,
      markPx: shortResult.markPx,
      filledShortHumanBase: shortResult.filledShortHumanBase,
      shortNotionalUsd: shortResult.shortNotionalUsd,
    },
    solana: {
      signature: spotSwap.signature,
      usdcIn: spotSwap.usdcIn,
      spotOut: spotSwap.spotOut,
      swapNotionalUsd,
    },
  };

  logDnExecutor("open_done", result);
  return result;
}

async function runDnPilotSpotOnly(params: {
  config: ReturnType<typeof loadDnPilotConfig>;
  dryRun: boolean;
  derivedPubkey: string;
}): Promise<Record<string, unknown>> {
  const { config, dryRun } = params;
  const market = await resolvePilotMarket(config.market);
  const shortSize = await getActiveShortSize({
    subaccount: config.subaccount,
    marketAddr: market.market_addr,
  });
  if (shortSize <= 0) {
    throw new Error(`No active ${config.market} short to hedge on Solana`);
  }

  const markPx = await fetchDecibelMarkPx(market.market_addr);
  if (markPx == null || markPx <= 0) {
    throw new Error(`Failed to resolve mark price for ${config.market}`);
  }

  const swapNotionalUsd = await capSpotSwapUsd({
    connection: getServerSolanaConnection(),
    owner: config.solanaPubkey,
    targetUsd: shortSize * markPx,
  });
  logDnExecutor("recover_spot_start", {
    mode: dryRun ? "dryRun" : "live",
    market: config.market,
    shortSize,
    markPx,
    swapNotionalUsd,
    solanaPubkey: config.solanaPubkey,
  });

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

  const result = {
    mode: dryRun ? "dryRun" : "live",
    recoverSpotOnly: true,
    decibel: { shortSize, markPx, shortNotionalUsd: swapNotionalUsd },
    solana: {
      signature: spotSwap.signature,
      usdcIn: spotSwap.usdcIn,
      spotOut: spotSwap.spotOut,
      swapNotionalUsd,
    },
  };
  logDnExecutor("recover_spot_done", result);
  return result;
}

export async function runDnPilotClose(options: { live: boolean }): Promise<Record<string, unknown>> {
  const config = loadDnPilotConfig();
  const dryRun = !options.live;

  if (!dryRun && !process.env.YIELD_AI_EXECUTOR_PRIVATE_KEY) {
    throw new Error("YIELD_AI_EXECUTOR_PRIVATE_KEY is required for live Aptos leg");
  }

  getDnSolanaKeypair(config.solanaPubkey);

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
  }

  const decibelClose = await closeDecibelShort({
    subaccount: config.subaccount,
    marketName: config.market,
    dryRun,
  });

  const result = {
    mode: dryRun ? "dryRun" : "live",
    solana: spotSell
      ? { signature: spotSell.signature, spotIn: spotSell.spotIn, usdcOut: spotSell.usdcOut }
      : { skipped: true, reason: "zero spot balance" },
    decibel: {
      closeTxHash: decibelClose.closeTxHash,
      shortSize: decibelClose.shortSize,
      markPx: decibelClose.markPx,
    },
  };

  logDnExecutor("close_done", result);
  return result;
}
