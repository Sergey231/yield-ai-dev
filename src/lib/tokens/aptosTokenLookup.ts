import type { TokenPrice } from '@/lib/types/panora';
import { normalizeAddress } from '@/lib/utils/addressNormalization';
import { getTokenList } from './getTokenList';

export interface AptosTokenListEntry {
  tokenAddress?: string | null;
  faAddress?: string | null;
  name?: string;
  symbol?: string;
  decimals?: number;
  usdPrice?: string | null;
  logoUrl?: string | null;
  bridge?: string | null;
  panoraSymbol?: string;
}

export function normalizeAptosAssetId(assetId: string | null | undefined): string {
  const raw = (assetId ?? '').trim();
  if (!raw) return '';

  if (raw.includes('::')) {
    const [addr = '', ...rest] = raw.split('::');
    const normalizedAddr = normalizeAddress(addr.startsWith('0x') ? addr : `0x${addr}`).toLowerCase();
    return [normalizedAddr, ...rest.map((part) => part.toLowerCase())].join('::');
  }

  return normalizeAddress(raw.startsWith('0x') ? raw : `0x${raw}`).toLowerCase();
}

export function findAptosTokenByAssetId(
  assetId: string,
  tokens: AptosTokenListEntry[] = getTokenList(1)
): AptosTokenListEntry | undefined {
  const normalizedAssetId = normalizeAptosAssetId(assetId);
  if (!normalizedAssetId) return undefined;

  return tokens.find((token) => normalizeAptosAssetId(token.tokenAddress) === normalizedAssetId)
    ?? tokens.find((token) => normalizeAptosAssetId(token.faAddress) === normalizedAssetId);
}

function tokenAddressKeys(token: AptosTokenListEntry | undefined): Set<string> {
  const keys = new Set<string>();
  if (!token) return keys;

  const tokenAddress = normalizeAptosAssetId(token.tokenAddress);
  const faAddress = normalizeAptosAssetId(token.faAddress);
  if (tokenAddress) keys.add(tokenAddress);
  if (faAddress) keys.add(faAddress);
  return keys;
}

export function findAptosPriceForAsset(
  prices: TokenPrice[],
  assetId: string,
  token?: AptosTokenListEntry
): TokenPrice | undefined {
  const lookupKeys = tokenAddressKeys(token);
  const normalizedAssetId = normalizeAptosAssetId(assetId);
  if (normalizedAssetId) lookupKeys.add(normalizedAssetId);

  if (lookupKeys.size === 0) return undefined;

  return prices.find((price) => {
    const priceTokenAddress = normalizeAptosAssetId(price.tokenAddress);
    const priceFaAddress = normalizeAptosAssetId(price.faAddress);
    const addressMatches =
      (priceTokenAddress && lookupKeys.has(priceTokenAddress)) ||
      (priceFaAddress && lookupKeys.has(priceFaAddress));

    if (!addressMatches) return false;

    // Panora can return a different bridged token for legacy Move coin types.
    // If tokenList has an exact row, keep metadata and price on the same asset.
    return !token?.symbol || !price.symbol || price.symbol.toLowerCase() === token.symbol.toLowerCase();
  });
}
