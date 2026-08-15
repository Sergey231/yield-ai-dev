import { marketNameForFundingApi } from '@/lib/protocols/decibel/fundingApr';

/** Decibel CDN for per-asset SVG icons (first leg of the pair, lowercased). */
export const DECIBEL_ICONS_BASE_URL = 'https://app.decibel.trade/images/icons/';

export const MARKET_LOGOS: Record<string, string> = {
  'BTC/USD': 'https://app.decibel.trade/images/icons/btc.svg?dpl=dpl_FECfRSDXc1wiUcCXB6MPHgx2CzKp',
  'APT/USD': 'https://assets.panora.exchange/tokens/aptos/apt.svg',
  'ETH/USD': 'https://app.decibel.trade/images/icons/eth.svg?dpl=dpl_FECfRSDXc1wiUcCXB6MPHgx2CzKp',
  'SOL/USD': 'https://app.decibel.trade/images/icons/sol.svg?dpl=dpl_FECfRSDXc1wiUcCXB6MPHgx2CzKp',
  'DOGE/USD': 'https://app.decibel.trade/images/icons/doge.svg?dpl=dpl_FECfRSDXc1wiUcCXB6MPHgx2CzKp',
  'XRP/USD': 'https://app.decibel.trade/images/icons/xrp.svg?dpl=dpl_FECfRSDXc1wiUcCXB6MPHgx2CzKp',
  'BNB/USD': 'https://app.decibel.trade/images/icons/bnb.svg?dpl=dpl_FECfRSDXc1wiUcCXB6MPHgx2CzKp',
  'SUI/USD': '/token_ico/sui.png',
  'HYPE/USD': 'https://app.decibel.trade/images/icons/hype.svg?dpl=dpl_FECfRSDXc1wiUcCXB6MPHgx2CzKp',
  'ZEC/USD': 'https://app.decibel.trade/images/icons/zec.svg?dpl=dpl_FECfRSDXc1wiUcCXB6MPHgx2CzKp',
};

const iconExistsCache = new Map<string, boolean>();

/** First leg of pair → slug, e.g. `WTIOIL/USD` → `wtioil`. */
export function decibelIconSlugFromMarketName(marketName: string): string {
  const normalized = marketNameForFundingApi(marketName);
  const base = normalized.split('/')[0]?.trim() ?? '';
  return base.toLowerCase();
}

/** Candidate Decibel icon URL (not validated). */
export function buildDecibelIconUrl(marketName: string): string | undefined {
  const slug = decibelIconSlugFromMarketName(marketName);
  if (!slug) return undefined;
  return `${DECIBEL_ICONS_BASE_URL}${slug}.svg`;
}

/** Known logo from static map (Panora, local assets, explicit Decibel URLs). */
export function getKnownMarketLogoUrl(
  marketName: string,
  knownLogos: Record<string, string>,
): string | undefined {
  const key = marketNameForFundingApi(marketName);
  return knownLogos[key];
}

/**
 * Resolve logo: known map first, then Decibel CDN if the SVG exists.
 * Results are cached in-memory for the session.
 */
export async function resolveMarketLogoUrl(
  marketName: string,
  knownLogos: Record<string, string>,
): Promise<string | undefined> {
  const known = getKnownMarketLogoUrl(marketName, knownLogos);
  if (known) return known;

  const candidate = buildDecibelIconUrl(marketName);
  if (!candidate) return undefined;

  const exists = await checkDecibelIconExists(candidate);
  return exists ? candidate : undefined;
}

/** Probe icon availability via Image load (works cross-origin; no CORS preflight). */
export function checkDecibelIconExists(url: string): Promise<boolean> {
  const cached = iconExistsCache.get(url);
  if (cached !== undefined) return Promise.resolve(cached);

  if (typeof window === 'undefined') return Promise.resolve(false);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      iconExistsCache.set(url, true);
      resolve(true);
    };
    img.onerror = () => {
      iconExistsCache.set(url, false);
      resolve(false);
    };
    img.src = url;
  });
}
