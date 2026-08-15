import { getPreferredJupiterTokenIcon } from "@/lib/services/solana/jupiterTokenIcons";

export function resolveExponentTokenIcon(params: {
  underlyingSymbol?: string | null;
  ticker?: string | null;
  underlyingLogoUrl?: string | null;
  tokenIconSymbol?: string | null;
}): { logoUrl?: string; logoUrlFallback?: string } {
  const sym = (params.tokenIconSymbol ?? params.underlyingSymbol ?? params.ticker ?? "").trim();
  const fallback = (params.underlyingLogoUrl ?? "").trim() || undefined;
  const logoUrl = getPreferredJupiterTokenIcon(sym, fallback) || fallback;

  return {
    logoUrl: logoUrl || undefined,
    logoUrlFallback: fallback,
  };
}
