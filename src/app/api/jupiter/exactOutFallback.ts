export type JupiterQuoteLike = {
  inputMint?: string;
  outputMint?: string;
  inAmount?: string;
  outAmount?: string;
  otherAmountThreshold?: string;
  slippageBps?: number;
  swapMode?: string;
  routePlan?: unknown[];
  priceImpactPct?: string;
  synthesizedFromExactOut?: boolean;
  [key: string]: unknown;
};

export function isJupiterNoRoutesFound(status: number, bodyText: string): boolean {
  if (status !== 400) return false;
  try {
    const parsed = JSON.parse(bodyText) as { errorCode?: string; error?: string };
    if (parsed?.errorCode === "NO_ROUTES_FOUND") return true;
    return /no routes found/i.test(String(parsed?.error ?? ""));
  } catch {
    return /NO_ROUTES_FOUND/i.test(bodyText) || /no routes found/i.test(bodyText);
  }
}

/**
 * Jupiter Metis ExactOut is unavailable for some mints (e.g. Token-2022 USDG).
 * Approximate ExactOut by binary-searching ExactIn quotes for the minimum input
 * whose output meets the requested receive amount (within slippage).
 */
export async function synthesizeExactOutViaExactIn(
  targetOutAmount: string,
  slippageBps: number,
  fetchExactIn: (inAmount: string) => Promise<JupiterQuoteLike | null>,
): Promise<JupiterQuoteLike | null> {
  let target: bigint;
  try {
    target = BigInt(targetOutAmount);
  } catch {
    return null;
  }
  if (target <= 0n) return null;

  const safeSlippage = Number.isFinite(slippageBps)
    ? Math.max(0, Math.min(5000, Math.floor(slippageBps)))
    : 50;
  const minOut = (target * BigInt(10_000 - safeSlippage)) / 10_000n;

  async function meetsTarget(inAmount: string): Promise<JupiterQuoteLike | null> {
    const quote = await fetchExactIn(inAmount);
    if (!quote?.outAmount) return null;
    try {
      if (BigInt(quote.outAmount) >= minOut) return quote;
    } catch {
      return null;
    }
    return null;
  }

  async function minimizeInput(upperIn: bigint): Promise<JupiterQuoteLike | null> {
    let low = 1n;
    let high = upperIn;
    let best = await meetsTarget(high.toString());
    if (!best) return null;

    for (let i = 0; i < 22 && low <= high; i++) {
      const mid = (low + high) / 2n;
      const candidate = await meetsTarget(mid.toString());
      if (candidate) {
        best = candidate;
        if (mid === 0n) break;
        high = mid - 1n;
      } else {
        low = mid + 1n;
      }
    }
    return best;
  }

  // Fast path: ~1:1 pairs (USDG→USDC) — a single ExactIn probe at the target often suffices.
  const direct = await meetsTarget(target.toString());
  if (direct?.inAmount) {
    const minimized = await minimizeInput(BigInt(direct.inAmount));
    if (minimized) {
      return { ...minimized, swapMode: "ExactIn", synthesizedFromExactOut: true };
    }
  }

  // Scale input using an under-filled probe, then binary-search.
  const probe = await fetchExactIn(target.toString());
  if (probe?.inAmount && probe?.outAmount) {
    try {
      const probeOut = BigInt(probe.outAmount);
      const probeIn = BigInt(probe.inAmount);
      if (probeOut > 0n && probeOut < minOut) {
        const estimatedIn = (probeIn * target) / probeOut + 1n;
        const scaled = await meetsTarget(estimatedIn.toString());
        if (scaled?.inAmount) {
          const minimized = await minimizeInput(BigInt(scaled.inAmount));
          if (minimized) {
            return { ...minimized, swapMode: "ExactIn", synthesizedFromExactOut: true };
          }
        }
      }
    } catch {
      // continue to exponential search
    }
  }

  // Exponential search for an upper bound on input.
  let high = target;
  let upperQuote: JupiterQuoteLike | null = null;
  for (let i = 0; i < 14; i++) {
    const candidate = await meetsTarget(high.toString());
    if (candidate?.inAmount) {
      upperQuote = candidate;
      break;
    }
    high *= 2n;
    if (high > target * 1_000_000n) break;
  }
  if (!upperQuote?.inAmount) return null;

  const minimized = await minimizeInput(BigInt(upperQuote.inAmount));
  if (!minimized) return null;
  return { ...minimized, swapMode: "ExactIn", synthesizedFromExactOut: true };
}
