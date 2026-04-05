import type { Token } from "@/lib/types/token";

/**
 * USD value for a wallet token row. Prefer `token.value` when set; otherwise derive from amount × price (same as Solana wallet card).
 */
export function getTokenUsdValue(token: Token): number {
  const rawValue = token.value;
  if (rawValue != null && String(rawValue).trim() !== "") {
    const directValue = parseFloat(String(rawValue));
    if (Number.isFinite(directValue)) {
      return directValue;
    }
  }

  const price = token.price != null && String(token.price).trim() !== "" ? Number(token.price) : NaN;
  const rawAmount = Number(token.amount);
  const decimals = Number(token.decimals);
  if (!Number.isFinite(price) || !Number.isFinite(rawAmount) || !Number.isFinite(decimals)) {
    return 0;
  }

  return (rawAmount / Math.pow(10, decimals)) * price;
}
