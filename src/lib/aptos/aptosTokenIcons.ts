/**
 * Local token icons under /public/token_ico (case-insensitive symbol → {symbol}.png).
 * Prefer these over Panora CDN URLs when available (CDN may return AccessDenied).
 */
const LOCAL_APTOS_ICON_SYMBOLS = new Set([
  "aet",
  "eurc",
  "jupusd",
  "sol",
  "sui",
  "tbtc",
  "usd1",
  "usdc",
  "usdg",
  "usds",
  "usdt",
  "wbtc",
]);

function normalizeAptosIconSymbol(symbol?: string | null): string {
  return (symbol ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Resolve Aptos token icon: local /token_ico/{symbol}.png first, then Panora (or other) fallback.
 */
export function getAptosTokenIcon(
  symbol?: string | null,
  panoraFallbackUrl?: string | null,
): string {
  const key = normalizeAptosIconSymbol(symbol);
  if (key && LOCAL_APTOS_ICON_SYMBOLS.has(key)) {
    return `/token_ico/${key}.png`;
  }

  const fallback = (panoraFallbackUrl ?? "").trim();
  return fallback.length > 0 ? fallback : "/file.svg";
}

/** Symbols that resolve to a local /token_ico/*.png icon (for docs/tests). */
export const APTOS_LOCAL_ICON_SYMBOLS = [...LOCAL_APTOS_ICON_SYMBOLS];
