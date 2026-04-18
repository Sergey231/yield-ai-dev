export type SwapPairParams = {
  feeTier: bigint;
  sqrtPriceLimit: bigint;
};

function key(a: string, b: string) {
  return `${a.toLowerCase()}->${b.toLowerCase()}`;
}

/**
 * v1 hardcoded table for on-chain swap integration.
 *
 * Keyed by FA metadata object address pairs (fromMetadata -> toMetadata).
 * Both directions must be defined explicitly.
 */
export const SWAP_PAIR_TABLE: Record<string, SwapPairParams> = {
  // USDC -> USD1
  [key(
    "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b",
    "0x05fabd1b12e39967a3c24e91b7b8f67719a6dacee74f3c8b9fb7d93e855437d2"
  )]: {
    feeTier: 0n, // 0.01%
    sqrtPriceLimit: 30000000000000000000n,
  },
  // USD1 -> USDC
  [key(
    "0x05fabd1b12e39967a3c24e91b7b8f67719a6dacee74f3c8b9fb7d93e855437d2",
    "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b"
  )]: {
    feeTier: 0n, // 0.01%
    // Direction-sensitive: USD1 is likely token0 vs USDC (lexicographically smaller metadata),
    // so USD1 -> USDC (zeroForOne) should use a near-min bound.
    sqrtPriceLimit: 4295048017n,
  },
};

export function getSwapPairParams(fromMetadata: string, toMetadata: string): SwapPairParams | null {
  return SWAP_PAIR_TABLE[key(fromMetadata, toMetadata)] ?? null;
}

