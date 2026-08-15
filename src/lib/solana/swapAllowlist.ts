import { TOKEN_REGISTRY } from "@/lib/tokens/registry";

/** Solana mint addresses allowed in the swap modal token picker. */
export function getSolanaSwapAllowlistMints(): Set<string> {
  const mints = TOKEN_REGISTRY.filter((t) => t.chain === "solana")
    .map((t) => t.addresses.mint)
    .filter((mint): mint is string => typeof mint === "string" && mint.length > 0);
  return new Set(mints);
}

export function isSolanaSwapAllowlistedMint(mint: string, allowlist = getSolanaSwapAllowlistMints()): boolean {
  return allowlist.has(mint);
}

export function poolUsesOnlySwapAllowlistedMints(
  mintA: string,
  mintB: string,
  allowlist = getSolanaSwapAllowlistMints()
): boolean {
  return allowlist.has(mintA) && allowlist.has(mintB);
}
