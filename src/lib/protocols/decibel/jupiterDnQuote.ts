const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_DECIMALS = 6;
const JUPITER_SWAP_QUOTE_URL = "https://api.jup.ag/swap/v1/quote";
const DEFAULT_SLIPPAGE_BPS = 50;
/** Stay under Jupiter 10 req/s key limit (burst-safe). */
export const JUPITER_DN_QUOTE_MAX_PER_SECOND = 8;

export async function mapWithJupiterQuoteRateLimit<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += JUPITER_DN_QUOTE_MAX_PER_SECOND) {
    const batch = items.slice(i, i + JUPITER_DN_QUOTE_MAX_PER_SECOND);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + JUPITER_DN_QUOTE_MAX_PER_SECOND < items.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return results;
}

export type JupiterDnQuoteResult = {
  inAmount: string;
  outAmount: string;
  priceImpactPct: number | null;
};

function stripEnv(value: string): string {
  return value.replace(/^["']|["']$/g, "").trim();
}

function getJupiterApiKey(): string {
  return stripEnv(process.env.JUPITER_API_KEY || process.env.JUP_API_KEY || "");
}

export async function fetchJupiterDnQuote(options: {
  outputMint: string;
  sizeUsd: number;
  slippageBps?: number;
}): Promise<JupiterDnQuoteResult> {
  const apiKey = getJupiterApiKey();
  if (!apiKey) {
    throw new Error("JUPITER_API_KEY (or JUP_API_KEY) is not configured");
  }

  const sizeUsd = options.sizeUsd;
  if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) {
    throw new Error(`Invalid quote sizeUsd: ${sizeUsd}`);
  }

  const slippageBps = options.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const amount = Math.round(sizeUsd * 10 ** USDC_DECIMALS);

  const params = new URLSearchParams({
    inputMint: USDC_MINT,
    outputMint: options.outputMint,
    amount: String(amount),
    slippageBps: String(slippageBps),
    swapMode: "ExactIn",
  });

  const res = await fetch(`${JUPITER_SWAP_QUOTE_URL}?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "x-api-key": apiKey,
    },
    cache: "no-store",
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Jupiter quote HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  let json: { inAmount?: string; outAmount?: string; priceImpactPct?: string } | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("Jupiter quote returned invalid JSON");
  }

  const inAmount = json?.inAmount;
  const outAmount = json?.outAmount;
  if (!inAmount || !outAmount || BigInt(outAmount) <= 0n) {
    throw new Error("Jupiter quote missing inAmount/outAmount");
  }

  const priceImpactRaw = json?.priceImpactPct;
  const priceImpactPct =
    priceImpactRaw != null && priceImpactRaw !== "" && Number.isFinite(Number(priceImpactRaw))
      ? Number(priceImpactRaw)
      : null;

  return { inAmount, outAmount, priceImpactPct };
}

/** Spot → USDC sell quote sized from USD notional and Decibel mark (oz ≈ sizeUsd / markPx). */
export async function fetchJupiterDnSellQuote(options: {
  inputMint: string;
  sizeUsd: number;
  markPx: number;
  inputDecimals: number;
  slippageBps?: number;
}): Promise<JupiterDnQuoteResult> {
  const sizeUsd = options.sizeUsd;
  const markPx = options.markPx;
  if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) {
    throw new Error(`Invalid sell quote sizeUsd: ${sizeUsd}`);
  }
  if (!Number.isFinite(markPx) || markPx <= 0) {
    throw new Error(`Invalid sell quote markPx: ${markPx}`);
  }
  if (!Number.isInteger(options.inputDecimals) || options.inputDecimals < 0) {
    throw new Error(`Invalid sell quote inputDecimals: ${options.inputDecimals}`);
  }

  const ozHuman = sizeUsd / markPx;
  const amount = String(
    BigInt(Math.max(1, Math.ceil(ozHuman * 10 ** options.inputDecimals)))
  );

  const raw = await fetchJupiterQuoteRaw({
    inputMint: options.inputMint,
    outputMint: USDC_MINT,
    amount,
    slippageBps: options.slippageBps,
    swapMode: "ExactIn",
  });

  const priceImpactRaw = raw.priceImpactPct;
  const priceImpactPct =
    priceImpactRaw != null && priceImpactRaw !== "" && Number.isFinite(Number(priceImpactRaw))
      ? Number(priceImpactRaw)
      : null;

  return {
    inAmount: raw.inAmount,
    outAmount: raw.outAmount,
    priceImpactPct,
  };
}

/** Effective USD per 1 input token from an ExactIn spot→USDC sell quote. */
export function effectiveUsdPriceFromJupiterSellQuote(
  quote: JupiterDnQuoteResult,
  inputDecimals: number
): number | null {
  if (!Number.isInteger(inputDecimals) || inputDecimals < 0 || inputDecimals > 18) {
    return null;
  }

  const inRaw = BigInt(quote.inAmount);
  const outRaw = BigInt(quote.outAmount);
  if (inRaw <= 0n || outRaw <= 0n) return null;

  const inHuman = Number(inRaw) / 10 ** inputDecimals;
  const outUsd = Number(outRaw) / 10 ** USDC_DECIMALS;
  if (!Number.isFinite(inHuman) || !Number.isFinite(outUsd) || inHuman <= 0) {
    return null;
  }

  return outUsd / inHuman;
}

export type JupiterQuoteRaw = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct?: string;
  [key: string]: unknown;
};

/** Full Jupiter quote JSON (required for `/swap/v1/swap`). */
export async function fetchJupiterQuoteRaw(options: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps?: number;
  swapMode?: "ExactIn" | "ExactOut";
}): Promise<JupiterQuoteRaw> {
  const apiKey = getJupiterApiKey();
  if (!apiKey) {
    throw new Error("JUPITER_API_KEY (or JUP_API_KEY) is not configured");
  }

  const amount = options.amount.trim();
  if (!amount || BigInt(amount) <= 0n) {
    throw new Error(`Invalid quote amount: ${amount}`);
  }

  const slippageBps = options.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const params = new URLSearchParams({
    inputMint: options.inputMint,
    outputMint: options.outputMint,
    amount,
    slippageBps: String(slippageBps),
    swapMode: options.swapMode ?? "ExactIn",
  });

  const res = await fetch(`${JUPITER_SWAP_QUOTE_URL}?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "x-api-key": apiKey,
    },
    cache: "no-store",
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Jupiter quote HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  let json: JupiterQuoteRaw | null = null;
  try {
    json = text ? (JSON.parse(text) as JupiterQuoteRaw) : null;
  } catch {
    throw new Error("Jupiter quote returned invalid JSON");
  }

  if (!json?.inAmount || !json?.outAmount || BigInt(json.outAmount) <= 0n) {
    throw new Error("Jupiter quote missing inAmount/outAmount");
  }

  return json;
}

/** Effective USD price per 1 output token from an ExactIn USDC quote. */
export function effectiveUsdPriceFromJupiterQuote(
  quote: JupiterDnQuoteResult,
  outputDecimals: number
): number | null {
  if (!Number.isInteger(outputDecimals) || outputDecimals < 0 || outputDecimals > 18) {
    return null;
  }

  const inRaw = BigInt(quote.inAmount);
  const outRaw = BigInt(quote.outAmount);
  if (outRaw <= 0n) return null;

  const inUsd = Number(inRaw) / 10 ** USDC_DECIMALS;
  const outHuman = Number(outRaw) / 10 ** outputDecimals;
  if (!Number.isFinite(inUsd) || !Number.isFinite(outHuman) || outHuman <= 0) {
    return null;
  }

  return inUsd / outHuman;
}
