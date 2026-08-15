import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import {
  deriveAtaAddress,
  getJupiterApiKey,
  getServerSolanaConnection,
  stripEnv,
} from "@/app/api/jupiter/_lib";
import {
  fetchJupiterQuoteRaw,
  type JupiterQuoteRaw,
} from "@/lib/protocols/decibel/jupiterDnQuote";
import { USDC_DECIMALS_SOLANA, USDC_MINT_SOLANA } from "@/lib/protocols/decibel/dnMultiChain/pilotConfig";

const JUPITER_SWAP_URL = "https://api.jup.ag/swap/v1/swap";

function stripPkEnv(value: string): string {
  return stripEnv(value);
}

/** DN pilot wallet: `DN_SOLANA_EXECUTOR_PRIVATE_KEY` only (not SOLANA_PAYER_WALLET_PRIVATE_KEY). */
export function getDnSolanaKeypair(expectedPubkey?: string): { keypair: Keypair; address: string } {
  const pk = stripPkEnv(process.env.DN_SOLANA_EXECUTOR_PRIVATE_KEY || "");
  if (!pk) {
    throw new Error(
      "Missing DN_SOLANA_EXECUTOR_PRIVATE_KEY. Set it in Vercel Preview (and Production) for the funded pilot wallet."
    );
  }

  const keypair = Keypair.fromSecretKey(bs58.decode(pk));
  const address = keypair.publicKey.toBase58();
  const expected =
    stripPkEnv(process.env.DN_PILOT_SOLANA_PUBKEY || process.env.DN_SOLANA_EXECUTOR_PUBKEY || "") ||
    expectedPubkey ||
    "";
  if (expected && address !== expected) {
    throw new Error(`Solana key pubkey mismatch: derived ${address}, expected ${expected}`);
  }
  return { keypair, address };
}

export async function getSolBalanceSol(connection: Connection, pubkey: string): Promise<number> {
  const lamports = await connection.getBalance(new PublicKey(pubkey), "confirmed");
  return lamports / 1e9;
}

/** Cap USDC swap size to on-wallet balance minus a small buffer (fees / rounding). */
export async function capSpotSwapUsd(params: {
  connection: Connection;
  owner: string;
  targetUsd: number;
  bufferBps?: number;
}): Promise<number> {
  const bal = await getSplTokenBalanceBaseUnits({
    connection: params.connection,
    owner: params.owner,
    mint: USDC_MINT_SOLANA,
  });
  const availableUsd = Number(bal) / 10 ** USDC_DECIMALS_SOLANA;
  const bufferBps = params.bufferBps ?? 100; // 1%
  const maxUsd = availableUsd * (1 - bufferBps / 10_000);
  const capped = Math.min(params.targetUsd, maxUsd);
  if (!Number.isFinite(capped) || capped <= 0) {
    throw new Error(`Insufficient USDC on Solana for spot hedge (available ~${availableUsd.toFixed(2)} USD)`);
  }
  return capped;
}

export async function getSplTokenBalanceBaseUnits(params: {
  connection: Connection;
  owner: string;
  mint: string;
}): Promise<bigint> {
  const ownerPk = new PublicKey(params.owner);
  const mintPk = new PublicKey(params.mint);
  const ata = getAssociatedTokenAddressSync(mintPk, ownerPk, false);
  try {
    const bal = await params.connection.getTokenAccountBalance(ata, "confirmed");
    return BigInt(bal.value.amount);
  } catch {
    return 0n;
  }
}

export async function buildJupiterSwapTransaction(params: {
  quoteResponse: JupiterQuoteRaw;
  userPublicKey: string;
  wrapAndUnwrapSol?: boolean;
}): Promise<{ swapTransaction: string; lastValidBlockHeight: number | null }> {
  const apiKey = getJupiterApiKey();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;

  const res = await fetch(JUPITER_SWAP_URL, {
    method: "POST",
    headers,
    cache: "no-store",
    body: JSON.stringify({
      userPublicKey: params.userPublicKey,
      quoteResponse: params.quoteResponse,
      wrapAndUnwrapSol: params.wrapAndUnwrapSol ?? false,
    }),
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Jupiter /swap failed: ${res.status} ${text.slice(0, 300)}`);
  }

  const json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  const swapTransaction = String(json?.swapTransaction || "").trim();
  if (!swapTransaction) {
    throw new Error("Jupiter response missing swapTransaction");
  }

  const lastValidBlockHeight =
    typeof json?.lastValidBlockHeight === "number" ? json.lastValidBlockHeight : null;
  return { swapTransaction, lastValidBlockHeight };
}

export async function signAndSendVersionedSwap(params: {
  connection: Connection;
  keypair: Keypair;
  swapTransactionBase64: string;
  lastValidBlockHeight?: number | null;
}): Promise<string> {
  const raw = Buffer.from(params.swapTransactionBase64, "base64");
  const tx = VersionedTransaction.deserialize(raw);
  tx.sign([params.keypair]);

  const sig = await params.connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  const latest = await params.connection.getLatestBlockhash("confirmed");
  await params.connection.confirmTransaction(
    {
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: params.lastValidBlockHeight ?? latest.lastValidBlockHeight,
    },
    "confirmed"
  );

  return sig;
}

/** Buy spot token with USDC (ExactIn). */
export async function jupiterBuySpotWithUsdc(params: {
  connection?: Connection;
  keypair: Keypair;
  outputMint: string;
  sizeUsd: number;
  slippageBps?: number;
  dryRun?: boolean;
}): Promise<{
  quote: JupiterQuoteRaw;
  signature: string | null;
  usdcIn: string;
  spotOut: string;
}> {
  const connection = params.connection ?? getServerSolanaConnection();
  const amount = String(Math.round(params.sizeUsd * 10 ** USDC_DECIMALS_SOLANA));
  const quote = await fetchJupiterQuoteRaw({
    inputMint: USDC_MINT_SOLANA,
    outputMint: params.outputMint,
    amount,
    slippageBps: params.slippageBps,
    swapMode: "ExactIn",
  });

  if (params.dryRun) {
    return { quote, signature: null, usdcIn: quote.inAmount, spotOut: quote.outAmount };
  }

  const { swapTransaction, lastValidBlockHeight } = await buildJupiterSwapTransaction({
    quoteResponse: quote,
    userPublicKey: params.keypair.publicKey.toBase58(),
    wrapAndUnwrapSol: false,
  });
  const signature = await signAndSendVersionedSwap({
    connection,
    keypair: params.keypair,
    swapTransactionBase64: swapTransaction,
    lastValidBlockHeight,
  });

  return { quote, signature, usdcIn: quote.inAmount, spotOut: quote.outAmount };
}

/** Sell spot token for USDC (ExactIn on spot balance). */
export async function jupiterSellSpotForUsdc(params: {
  connection?: Connection;
  keypair: Keypair;
  inputMint: string;
  amountBaseUnits: bigint;
  slippageBps?: number;
  dryRun?: boolean;
}): Promise<{
  quote: JupiterQuoteRaw;
  signature: string | null;
  spotIn: string;
  usdcOut: string;
}> {
  if (params.amountBaseUnits <= 0n) {
    throw new Error("Spot balance is zero; nothing to sell on Jupiter");
  }

  const connection = params.connection ?? getServerSolanaConnection();
  const quote = await fetchJupiterQuoteRaw({
    inputMint: params.inputMint,
    outputMint: USDC_MINT_SOLANA,
    amount: params.amountBaseUnits.toString(),
    slippageBps: params.slippageBps,
    swapMode: "ExactIn",
  });

  if (params.dryRun) {
    return { quote, signature: null, spotIn: quote.inAmount, usdcOut: quote.outAmount };
  }

  const { swapTransaction, lastValidBlockHeight } = await buildJupiterSwapTransaction({
    quoteResponse: quote,
    userPublicKey: params.keypair.publicKey.toBase58(),
    wrapAndUnwrapSol: false,
  });
  const signature = await signAndSendVersionedSwap({
    connection,
    keypair: params.keypair,
    swapTransactionBase64: swapTransaction,
    lastValidBlockHeight,
  });

  return { quote, signature, spotIn: quote.inAmount, usdcOut: quote.outAmount };
}

/** Ensure ATA exists for a mint (logs only in dry-run). */
export async function ensureAtaExists(params: {
  connection: Connection;
  keypair: Keypair;
  mint: string;
  dryRun?: boolean;
}): Promise<string> {
  const owner = params.keypair.publicKey;
  const mintPk = new PublicKey(params.mint);
  const ata = await deriveAtaAddress({ owner, mint: mintPk });
  const info = await params.connection.getAccountInfo(ata, "confirmed");
  if (info) return ata.toBase58();
  if (params.dryRun) return ata.toBase58();
  throw new Error(
    `Missing ATA for mint ${params.mint}. Fund the wallet and retry; Jupiter usually creates ATAs on first swap.`
  );
}
