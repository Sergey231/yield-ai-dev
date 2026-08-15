'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';
import { PanoraPricesService } from '@/lib/services/panora/prices';
import type { TokenPrice } from '@/lib/types/panora';
import type { Token } from '@/lib/types/token';
import {
  APTOS_COIN_TYPE,
  USDC_FA_METADATA_MAINNET,
  USD1_FA_METADATA_MAINNET,
  WBTC_FA_METADATA_MAINNET,
  XBTC_FA_METADATA_MAINNET,
  ELON_FA_METADATA_MAINNET,
  THAPT_FA_METADATA_MAINNET,
} from '@/lib/constants/yieldAiVault';
import { normalizeAddress } from '@/lib/utils/addressNormalization';
import { getTokenList } from '@/lib/tokens/getTokenList';
import {
  findAptosPriceForAsset,
  findAptosTokenByAssetId,
} from '@/lib/tokens/aptosTokenLookup';

interface SafeContentsResponse {
  data?: {
    tokens?: { asset_type: string; amount: string }[];
    aptBalance?: string;
  };
  error?: string;
}

async function fetchSafeContents(safeAddress: string) {
  const response = await fetch(
    `/api/protocols/yield-ai/safe-contents?safeAddress=${encodeURIComponent(safeAddress)}`
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch safe contents: ${response.status}`);
  }
  const json: SafeContentsResponse = await response.json();
  if (json.error) throw new Error(json.error);
  return {
    faTokens: json.data?.tokens ?? [],
    aptBalance: json.data?.aptBalance ?? '0',
  };
}

function tokenNormalizedFaAddress(token: Token): string {
  const addr = token.address.includes('::') ? token.address.split('::')[0] : token.address;
  return normalizeAddress(addr);
}

const APT_FA_METADATA_MAINNET =
  '0x000000000000000000000000000000000000000000000000000000000000000a';
/** USDt (Tether) FA metadata — leg of the USDt/USDC stable LP; shown in the safe card. */
const USDT_FA_METADATA_MAINNET =
  '0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b';

/** FA balances shown in AI agent safe card (allowlist). */
function isAllowedSafeDisplayToken(token: Token): boolean {
  if (token.address === APTOS_COIN_TYPE) return true;
  const n = tokenNormalizedFaAddress(token);
  return (
    n === normalizeAddress(USDC_FA_METADATA_MAINNET) ||
    n === normalizeAddress(USD1_FA_METADATA_MAINNET) ||
    n === normalizeAddress(USDT_FA_METADATA_MAINNET) ||
    n === normalizeAddress(WBTC_FA_METADATA_MAINNET) ||
    n === normalizeAddress(XBTC_FA_METADATA_MAINNET) ||
    n === normalizeAddress(APT_FA_METADATA_MAINNET) ||
    n === normalizeAddress(ELON_FA_METADATA_MAINNET) ||
    n === normalizeAddress(THAPT_FA_METADATA_MAINNET) ||
    token.symbol === 'USDC' ||
    token.symbol === 'USD1' ||
    token.symbol === 'USDt' ||
    token.symbol === 'USDT' ||
    token.symbol === 'WBTC' ||
    token.symbol === 'xBTC' ||
    token.symbol === 'APT' ||
    token.symbol === 'ELON' ||
    token.symbol === 'thAPT'
  );
}

/** Equality for Move coin type strings, tolerant of address zero-padding. */
function coinTypeEquals(a: string, b: string): boolean {
  const ai = a.indexOf('::');
  const bi = b.indexOf('::');
  if (ai < 0 || bi < 0) return false;
  return (
    normalizeAddress(a.slice(0, ai)) === normalizeAddress(b.slice(0, bi)) &&
    a.slice(ai) === b.slice(bi)
  );
}

/**
 * Resolves an indexer `asset_type` to an FA metadata object address.
 * Pure FA assets already report their metadata address; legacy coins report
 * the coin struct (`0x..::module::Struct`), which `vault::withdraw` rejects.
 */
function resolveFaMetadata(assetType: string): string {
  if (!assetType.includes('::')) return assetType;
  const tokenListAptos = getTokenList(1) as Array<{
    faAddress?: string;
    tokenAddress?: string | null;
  }>;
  const match = tokenListAptos.find(
    (t) => t.tokenAddress && coinTypeEquals(t.tokenAddress, assetType)
  );
  return match?.faAddress ?? assetType;
}

function resolveLogoUrl(addressOrType: string, symbol: string): string | undefined {
  const tokenListAptos = getTokenList(1) as Array<{
    faAddress?: string;
    tokenAddress?: string | null;
    symbol?: string;
    logoUrl?: string;
  }>;
  const byAddr = findAptosTokenByAssetId(addressOrType, tokenListAptos);
  if (byAddr?.logoUrl) return byAddr.logoUrl;
  const bySymbol = tokenListAptos.find((t) => t.symbol === symbol);
  return bySymbol?.logoUrl;
}

interface UseYieldAiSafeTokensOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

/**
 * Fetches safe balances and attaches prices, returning allowlisted assets (USDC, APT, USD1, WBTC/xBTC).
 * Native APT is sourced from coin::balance (aptBalance) to avoid duplicate APT rows.
 */
export function useYieldAiSafeTokens(
  safeAddress: string | undefined,
  options?: UseYieldAiSafeTokensOptions
) {
  const enabled =
    (options?.enabled ?? true) && Boolean(safeAddress && safeAddress.length >= 10);

  return useQuery({
    queryKey: queryKeys.protocols.yieldAi.safeTokens(safeAddress ?? ''),
    enabled,
    staleTime: STALE_TIME.POSITIONS,
    refetchOnMount: options?.refetchOnMount,
    queryFn: async (): Promise<Token[]> => {
      const { faTokens, aptBalance } = await fetchSafeContents(safeAddress!);

      const tokenAddresses = [
        ...faTokens.map((t) => t.asset_type),
        APTOS_COIN_TYPE,
      ].filter(Boolean);

      const pricesService = PanoraPricesService.getInstance();
      let prices: TokenPrice[] = [];
      try {
        const pr = await pricesService.getPrices(1, tokenAddresses);
        prices = Array.isArray(pr) ? pr : (pr?.data ?? []);
      } catch {
        // no prices
      }

      const tokens: Token[] = [];

      for (const t of faTokens) {
        // Native APT is accounted only via coin::balance below (avoids duplicate with indexer FA row).
        // Indexer returns FA-form APT under `0xa`; coin::balance returns the same amount via paired_metadata.
        if (t.asset_type === APTOS_COIN_TYPE) continue;
        if (normalizeAddress(t.asset_type) === normalizeAddress(APT_FA_METADATA_MAINNET)) continue;

        const tokenInfo = findAptosTokenByAssetId(t.asset_type);
        const price = findAptosPriceForAsset(prices, t.asset_type, tokenInfo);
        const decimals = tokenInfo?.decimals ?? price?.decimals ?? 8;
        const priceUsd = price?.usdPrice ?? tokenInfo?.usdPrice ?? null;
        const amount = parseFloat(t.amount) / Math.pow(10, decimals);
        const usd = priceUsd ? amount * parseFloat(priceUsd) : 0;
        const symbol = tokenInfo?.symbol ?? price?.symbol ?? '?';

        tokens.push({
          address: resolveFaMetadata(t.asset_type),
          name: tokenInfo?.name ?? price?.name ?? t.asset_type.split('::').pop() ?? '',
          symbol,
          decimals,
          amount: t.amount,
          price: priceUsd,
          value: priceUsd ? String(usd) : null,
          logoUrl: resolveLogoUrl(t.asset_type, symbol),
        });
      }

      if (BigInt(aptBalance) > 0n) {
        const aptPrice = prices.find(
          (p) => p.tokenAddress === APTOS_COIN_TYPE || p.faAddress === APTOS_COIN_TYPE
        );
        const decimals = aptPrice?.decimals ?? 8;
        const amount = Number(aptBalance) / Math.pow(10, decimals);
        const usd = aptPrice ? amount * parseFloat(aptPrice.usdPrice) : 0;
        const symbol = 'APT';
        tokens.push({
          address: APTOS_COIN_TYPE,
          name: 'Aptos Coin',
          symbol,
          decimals,
          amount: aptBalance,
          price: aptPrice?.usdPrice ?? null,
          value: aptPrice ? String(usd) : null,
          logoUrl: resolveLogoUrl(APTOS_COIN_TYPE, symbol),
        });
      } else {
        const faNativeApt = faTokens.find(
          (x) =>
            x.asset_type === APTOS_COIN_TYPE ||
            normalizeAddress(x.asset_type) === normalizeAddress(APT_FA_METADATA_MAINNET)
        );
        if (faNativeApt) {
          const price = prices.find(
            (p) => p.faAddress === faNativeApt.asset_type || p.tokenAddress === faNativeApt.asset_type
          );
          const decimals = price?.decimals ?? 8;
          const amount = parseFloat(faNativeApt.amount) / Math.pow(10, decimals);
          const usd = price ? amount * parseFloat(price.usdPrice) : 0;
          const symbol = price?.symbol ?? 'APT';
          tokens.push({
            address: APTOS_COIN_TYPE,
            name: price?.name ?? 'Aptos Coin',
            symbol,
            decimals,
            amount: faNativeApt.amount,
            price: price?.usdPrice ?? null,
            value: price ? String(usd) : null,
            logoUrl: resolveLogoUrl(APTOS_COIN_TYPE, symbol),
          });
        }
      }

      const baseOnly = tokens
        .filter((t) => isAllowedSafeDisplayToken(t))
        .sort((a, b) => {
          const va = a.value ? parseFloat(a.value) : 0;
          const vb = b.value ? parseFloat(b.value) : 0;
          return vb - va;
        });

      return baseOnly;
    },
  });
}

