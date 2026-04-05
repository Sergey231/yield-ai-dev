'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { STALE_TIME } from '@/lib/query/config';
import { PanoraPricesService } from '@/lib/services/panora/prices';
import type { TokenPrice } from '@/lib/types/panora';
import type { Token } from '@/lib/types/token';
import { APTOS_COIN_TYPE, USDC_FA_METADATA_MAINNET } from '@/lib/constants/yieldAiVault';
import { normalizeAddress } from '@/lib/utils/addressNormalization';
import { getTokenList } from '@/lib/tokens/getTokenList';

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

function isUsdcToken(token: Token) {
  if (token.symbol === 'USDC') return true;
  const addr = token.address.includes('::') ? token.address.split('::')[0] : token.address;
  return normalizeAddress(addr) === normalizeAddress(USDC_FA_METADATA_MAINNET);
}

function resolveLogoUrl(addressOrType: string, symbol: string): string | undefined {
  const tokenListAptos = getTokenList(1) as Array<{
    faAddress?: string;
    tokenAddress?: string | null;
    symbol?: string;
    logoUrl?: string;
  }>;
  const addr = addressOrType.includes('::')
    ? addressOrType.split('::')[0]
    : addressOrType;
  const norm = normalizeAddress(addr);
  const byAddr = tokenListAptos.find((t) => {
    const tFa = t.faAddress && normalizeAddress(t.faAddress);
    const tTa = t.tokenAddress && normalizeAddress(t.tokenAddress);
    return tFa === norm || tTa === norm;
  });
  if (byAddr?.logoUrl) return byAddr.logoUrl;
  const bySymbol = tokenListAptos.find((t) => t.symbol === symbol);
  return bySymbol?.logoUrl;
}

interface UseYieldAiSafeTokensOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

/**
 * Fetches safe balances and attaches prices, returning base assets (USDC, APT).
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
        // Native APT is accounted only via coin::balance below (avoids duplicate with indexer FA row)
        if (t.asset_type === APTOS_COIN_TYPE) continue;

        const price = prices.find(
          (p) => p.faAddress === t.asset_type || p.tokenAddress === t.asset_type
        );
        const decimals = price?.decimals ?? 8;
        const amount = parseFloat(t.amount) / Math.pow(10, decimals);
        const usd = price ? amount * parseFloat(price.usdPrice) : 0;
        const symbol = price?.symbol ?? '?';

        tokens.push({
          address: t.asset_type,
          name: price?.name ?? t.asset_type.split('::').pop() ?? '',
          symbol,
          decimals,
          amount: t.amount,
          price: price?.usdPrice ?? null,
          value: price ? String(usd) : null,
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
        const faNativeApt = faTokens.find((x) => x.asset_type === APTOS_COIN_TYPE);
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
        .filter((t) => isUsdcToken(t) || t.address === APTOS_COIN_TYPE)
        .sort((a, b) => {
          const va = a.value ? parseFloat(a.value) : 0;
          const vb = b.value ? parseFloat(b.value) : 0;
          return vb - va;
        });

      return baseOnly;
    },
  });
}

