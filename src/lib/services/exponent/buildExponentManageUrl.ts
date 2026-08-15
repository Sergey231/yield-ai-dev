import type { ExponentUserPositionRow } from "@/lib/services/exponent/types";

export const EXPONENT_APP_ORIGIN = "https://app.exponent.finance";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;

/**
 * Exponent income market slug, e.g. ONyc + 2026-09-10 → `onyc-10SEP26`.
 * Matches app routes like /en/market/income/onyc-10SEP26
 */
export function formatExponentIncomeMarketSlug(
  ticker: string | undefined,
  maturityDateUnixTs?: number
): string | null {
  const normalizedTicker = (ticker ?? "").trim();
  if (!normalizedTicker || typeof maturityDateUnixTs !== "number" || !Number.isFinite(maturityDateUnixTs)) {
    return null;
  }

  const date = new Date(maturityDateUnixTs * 1000);
  if (Number.isNaN(date.getTime())) return null;

  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = MONTHS[date.getUTCMonth()];
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${normalizedTicker.toLowerCase()}-${day}${month}${year}`;
}

export function buildExponentIncomeMarketUrl(row: ExponentUserPositionRow): string | null {
  const ticker = row.ticker ?? row.underlyingSymbol ?? row.tokenIconSymbol;
  const slug = formatExponentIncomeMarketSlug(ticker, row.maturityDateUnixTs);
  if (!slug) return null;
  return `${EXPONENT_APP_ORIGIN}/en/market/income/${slug}`;
}

export function buildExponentStrategyVaultUrl(vaultAddress: string): string {
  return `${EXPONENT_APP_ORIGIN}/en/strategy/${vaultAddress}?type=managed`;
}

/** Deep link to manage a position on app.exponent.finance. */
export function buildExponentManageUrl(row: ExponentUserPositionRow): string | null {
  if (row.source === "exponent-strategy-vault") {
    const vault = row.vaultAddress?.trim();
    return vault ? buildExponentStrategyVaultUrl(vault) : null;
  }

  if (
    row.source === "exponent-pt" ||
    row.source === "exponent-yt" ||
    row.source === "exponent-yt-staked"
  ) {
    return buildExponentIncomeMarketUrl(row);
  }

  return null;
}
