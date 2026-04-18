const HYPERION_API_HOST = "https://api.hyperion.xyz";

/**
 * Calls Hyperion REST API directly to get a swap quote.
 * SDK v0.0.25 added this endpoint; we call it without the SDK to avoid
 * pulling in the heavy @aptos-labs/script-composer-sdk WASM dependency.
 */
export async function getHyperionAmountOut(options: {
  amountInBaseUnits: bigint;
  fromMetadata: string;
  toMetadata: string;
}): Promise<bigint> {
  const n = Number(options.amountInBaseUnits);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error("amountInBaseUnits is not a safe integer for Hyperion quote");
  }

  const params = new URLSearchParams({
    amount: n.toString(),
    from: options.fromMetadata,
    to: options.toMetadata,
    safeMode: "true",
    flag: "in",
  });

  const res = await fetch(`${HYPERION_API_HOST}/base/rate/getSwapInfo?${params}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Hyperion quote HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }

  const data = await res.json();
  const raw = data?.amountOut;
  if (typeof raw !== "string" && typeof raw !== "number") {
    throw new Error(`Hyperion quote missing amountOut: ${JSON.stringify(data)}`);
  }

  const s = typeof raw === "number" ? String(Math.trunc(raw)) : raw;
  try {
    return BigInt(s);
  } catch {
    throw new Error("Hyperion quote amountOut is not bigint-parsable");
  }
}

