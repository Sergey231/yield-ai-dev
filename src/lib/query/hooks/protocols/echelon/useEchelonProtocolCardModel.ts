'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import tokenList from '@/lib/data/tokenList.json';
import { PanoraPricesService } from '@/lib/services/panora/prices';
import { createDualAddressPriceMap } from '@/lib/utils/addressNormalization';
import { TokenInfoService } from '@/lib/services/tokenInfoService';
import { formatCurrency, formatNumber } from '@/lib/utils/numberFormat';
import type { ProtocolPosition } from '@/shared/ProtocolCard/types';
import { useEchelonPositions, type EchelonPosition } from './useEchelonPositions';
import { useEchelonRewards, type EchelonReward } from './useEchelonRewards';
import { mapEchelonToProtocolPositions } from '@/components/protocols/echelon/mapEchelonToProtocolPositions';
import { useEchelonPools, type EchelonPool } from './useEchelonPools';

interface TokenInfo {
  symbol: string;
  name: string;
  logoUrl: string | null;
  decimals: number;
  usdPrice: string | null;
}

export interface EchelonModalRow {
  id: string;
  symbol: string;
  tokenLogoUrl?: string;
  valueUsd: number;
  amountLabel: string;
  positionType: 'supply' | 'borrow';
  /** Echelon `Object<Market>` inner address for vault emergency withdraw. */
  marketObj: string;
  /** Supply-only: owner can call `execute_withdraw_all_echelon_fa_as_owner`. */
  canEmergencyWithdraw: boolean;
}

export interface EchelonRewardRow {
  symbol: string;
  amount: number;
  usdValue: number;
  logoUrl?: string;
}

function normalizeAddr(addr: string): string {
  if (!addr || !addr.startsWith('0x')) return addr;
  return '0x' + addr.slice(2).replace(/^0+/, '') || '0x0';
}

interface UseEchelonProtocolCardModelOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | 'always';
}

export function useEchelonProtocolCardModel(
  walletAddress: string | undefined,
  options?: UseEchelonProtocolCardModelOptions
) {
  const enabled =
    (options?.enabled ?? true) && Boolean(walletAddress && walletAddress.length >= 10);

  const [tokenPrices, setTokenPrices] = useState<Record<string, string>>({});
  const [fallbackTokenInfo, setFallbackTokenInfo] = useState<Record<string, TokenInfo>>({});
  const pricesService = PanoraPricesService.getInstance();

  const {
    data: positions = [],
    isLoading: positionsLoading,
    isFetching: positionsFetching,
    error: positionsError,
  } = useEchelonPositions(walletAddress, {
    enabled,
    refetchOnMount: options?.refetchOnMount,
  });
  const {
    data: rewardsData = [],
    isLoading: rewardsLoading,
    isFetching: rewardsFetching,
  } = useEchelonRewards(walletAddress, {
    enabled,
    refetchOnMount: options?.refetchOnMount,
  });

  const {
    data: poolsResponse,
    isLoading: poolsLoading,
    isFetching: poolsFetching,
  } = useEchelonPools({ enabled });

  const echelonPools = (poolsResponse?.data ?? []) as EchelonPool[];

  const poolsByMarketAddress = useMemo(() => {
    const map = new Map<string, EchelonPool>();
    for (const p of echelonPools) {
      if (p.marketAddress) map.set(String(p.marketAddress), p);
    }
    return map;
  }, [echelonPools]);

  const poolsByTokenAddress = useMemo(() => {
    const map = new Map<string, EchelonPool>();
    for (const p of echelonPools) {
      if ((p as any).token) map.set(normalizeAddr(String((p as any).token)), p);
      if ((p as any).coinAddress) map.set(normalizeAddr(String((p as any).coinAddress)), p);
      if ((p as any).faAddress) map.set(normalizeAddr(String((p as any).faAddress)), p);
    }
    return map;
  }, [echelonPools]);

  const getAprForPosition = useCallback(
    (position: EchelonPosition): string | undefined => {
      const byMarket = position.market ? poolsByMarketAddress.get(String(position.market)) : undefined;
      const rawCoin = String(position.coin ?? '');
      const cleanCoin = rawCoin ? normalizeAddr(rawCoin.startsWith('@') ? rawCoin.slice(1) : rawCoin) : '';
      const byToken = cleanCoin ? poolsByTokenAddress.get(cleanCoin) : undefined;
      const pool = byMarket ?? byToken;
      if (!pool) return undefined;

      const isBorrow = position.type === 'borrow';
      const aprPctRaw = isBorrow
        ? Number(pool.borrowAPY ?? 0) + Number(pool.borrowRewardsApr ?? 0)
        : Number(pool.depositApy ?? pool.totalSupplyApr ?? 0);

      if (!Number.isFinite(aprPctRaw) || aprPctRaw <= 0) return undefined;
      return aprPctRaw.toFixed(2);
    },
    [poolsByMarketAddress, poolsByTokenAddress]
  );

  const getTokenPrice = useCallback(
    (coinAddress: string): string => {
      let cleanAddress = coinAddress;
      if (cleanAddress.startsWith('@')) {
        cleanAddress = cleanAddress.slice(1);
      }
      if (!cleanAddress.startsWith('0x')) {
        cleanAddress = `0x${cleanAddress}`;
      }
      const normalizedAddress = normalizeAddr(cleanAddress);
      return tokenPrices[cleanAddress] || tokenPrices[normalizedAddress] || '0';
    },
    [tokenPrices]
  );

  const getTokenInfo = useCallback(
    (coinAddress: string): TokenInfo | null => {
      const normalizedCoinAddress = normalizeAddr(coinAddress);

      if (fallbackTokenInfo[normalizedCoinAddress] || fallbackTokenInfo[coinAddress]) {
        const fallbackInfo = fallbackTokenInfo[normalizedCoinAddress] || fallbackTokenInfo[coinAddress];
        return {
          symbol: fallbackInfo.symbol,
          name: fallbackInfo.name,
          logoUrl: fallbackInfo.logoUrl || null,
          decimals: fallbackInfo.decimals,
          usdPrice: null,
        };
      }

      const token = tokenList.data.data.find((t) => {
        const normalizedFaAddress = normalizeAddr(t.faAddress || '');
        const normalizedTokenAddress = normalizeAddr(t.tokenAddress || '');
        return (
          normalizedFaAddress === normalizedCoinAddress ||
          normalizedTokenAddress === normalizedCoinAddress
        );
      });

      if (token) {
        return {
          symbol: token.symbol,
          name: token.name,
          logoUrl: token.logoUrl || null,
          decimals: token.decimals,
          usdPrice: null,
        };
      }

      return null;
    },
    [fallbackTokenInfo]
  );

  const getRewardTokenInfoHelper = useCallback((tokenSymbol: string) => {
    const token = (tokenList as { data: { data: Array<{ symbol: string; name: string; tokenAddress: string | null; faAddress: string; logoUrl: string; decimals: number }> } }).data.data.find(
      (tok) =>
        tok.symbol.toLowerCase() === tokenSymbol.toLowerCase() ||
        tok.name.toLowerCase().includes(tokenSymbol.toLowerCase())
    );

    if (!token) {
      return undefined;
    }

    return {
      address: token.tokenAddress,
      faAddress: token.faAddress,
      symbol: token.symbol,
      icon_uri: token.logoUrl,
      decimals: token.decimals,
      price: null as string | null,
    };
  }, []);

  const calculateRewardsValue = useCallback(() => {
    if (!rewardsData || rewardsData.length === 0) {
      return 0;
    }

    let totalValue = 0;

    rewardsData.forEach((reward) => {
      const tokenInfo = getRewardTokenInfoHelper(reward.token);
      if (!tokenInfo) {
        return;
      }

      const price = getTokenPrice(tokenInfo.faAddress || tokenInfo.address || '');
      if (!price || price === '0') {
        return;
      }

      const value = reward.amount * parseFloat(price);
      totalValue += value;
    });

    return totalValue;
  }, [rewardsData, getRewardTokenInfoHelper, getTokenPrice]);

  const getAllTokenAddresses = useCallback(() => {
    const addresses = new Set<string>();

    positions.forEach((position) => {
      let cleanAddress = position.coin;
      if (cleanAddress.startsWith('@')) {
        cleanAddress = cleanAddress.slice(1);
      }
      if (!cleanAddress.startsWith('0x')) {
        cleanAddress = `0x${cleanAddress}`;
      }
      addresses.add(normalizeAddr(cleanAddress));
    });

    rewardsData.forEach((reward) => {
      const tokenInfo = getRewardTokenInfoHelper(reward.token);
      if (tokenInfo?.faAddress) {
        addresses.add(normalizeAddr(tokenInfo.faAddress));
      }
      if (tokenInfo?.address) {
        addresses.add(normalizeAddr(tokenInfo.address));
      }
    });

    return Array.from(addresses);
  }, [positions, rewardsData, getRewardTokenInfoHelper]);

  useEffect(() => {
    const timeoutId = setTimeout(async () => {
      const addresses = getAllTokenAddresses();
      if (addresses.length === 0 || !walletAddress || walletAddress.length < 10) return;

      try {
        const response = await pricesService.getPrices(1, addresses);
        let prices: Record<string, string> = {};
        if (response.data) {
          prices = createDualAddressPriceMap(response.data);
          setTokenPrices(prices);
        }

        const missingPrices: string[] = [];
        addresses.forEach((addr) => {
          const normalizedAddr = addr.replace(/^0+/, '0x') || '0x0';
          if (!prices[addr] && !prices[normalizedAddr]) {
            missingPrices.push(addr);
          }
        });

        if (missingPrices.length > 0) {
          const service = TokenInfoService.getInstance();
          const fallbackPrices: Record<string, string> = {};

          await Promise.all(
            missingPrices.map(async (addr) => {
              try {
                const info = await service.getTokenInfo(addr);
                if (info && info.price) {
                  fallbackPrices[addr] = info.price.toString();
                  const normalizedAddr = addr.replace(/^0+/, '0x') || '0x0';
                  fallbackPrices[normalizedAddr] = info.price.toString();
                }
              } catch {
                // ignore
              }
            })
          );

          if (Object.keys(fallbackPrices).length > 0) {
            setTokenPrices((prev) => ({
              ...prev,
              ...fallbackPrices,
            }));
          }
        }
      } catch {
        // ignore
      }
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [getAllTokenAddresses, pricesService, walletAddress]);

  useEffect(() => {
    const loadUnknownTokens = async () => {
      if (positions.length === 0) return;

      const unknownTokens: string[] = [];
      positions.forEach((position) => {
        const normalizedAddr = normalizeAddr(position.coin);

        if (fallbackTokenInfo[normalizedAddr] || fallbackTokenInfo[position.coin]) {
          return;
        }

        const inTokenList = tokenList.data.data.find((t) => {
          const normalizedFaAddress = normalizeAddr(t.faAddress || '');
          const normalizedTokenAddress = normalizeAddr(t.tokenAddress || '');
          return normalizedFaAddress === normalizedAddr || normalizedTokenAddress === normalizedAddr;
        });

        if (!inTokenList) {
          unknownTokens.push(position.coin);
        }
      });

      if (unknownTokens.length === 0) return;

      const service = TokenInfoService.getInstance();
      const newTokenInfo: Record<string, TokenInfo> = {};

      await Promise.all(
        unknownTokens.map(async (tokenAddr) => {
          try {
            const info = await service.getTokenInfo(tokenAddr);
            if (info) {
              const normalizedAddr = normalizeAddr(tokenAddr);
              const tokenInfo: TokenInfo = {
                symbol: info.symbol,
                name: info.name,
                logoUrl: info.logoUrl,
                decimals: info.decimals,
                usdPrice: null,
              };
              newTokenInfo[normalizedAddr] = tokenInfo;
              newTokenInfo[tokenAddr] = tokenInfo;
            }
          } catch {
            // ignore
          }
        })
      );

      if (Object.keys(newTokenInfo).length > 0) {
        setFallbackTokenInfo((prev) => ({
          ...prev,
          ...newTokenInfo,
        }));
      }
    };

    loadUnknownTokens();
  }, [positions]);

  const rewardsValueUsd = useMemo(() => calculateRewardsValue(), [calculateRewardsValue]);

  const positionsOnlyValue = useMemo(() => {
    return positions.reduce((sum, position) => {
      const tokenInfo = getTokenInfo(position.coin);
      const isBorrow = position.type === 'borrow';
      const rawAmount = isBorrow
        ? (position.borrow ?? position.amount ?? 0)
        : (position.supply ?? position.amount ?? 0);
      const amount = rawAmount / (tokenInfo?.decimals ? 10 ** tokenInfo.decimals : 1e8);
      const price = getTokenPrice(position.coin);
      const value = price ? amount * parseFloat(price) : 0;
      if (isBorrow) {
        return sum - value;
      }
      return sum + value;
    }, 0);
  }, [positions, getTokenInfo, getTokenPrice]);

  const totalValue = useMemo(() => {
    return positionsOnlyValue + rewardsValueUsd;
  }, [positionsOnlyValue, rewardsValueUsd]);

  const { protocolPositions, modalRows } = useMemo(() => {
    const mapped = positions.map((position, index) => {
      const tokenInfo = getTokenInfo(position.coin);
      const isBorrow = position.type === 'borrow';
      const rawAmount = isBorrow
        ? (position.borrow ?? position.amount ?? 0)
        : (position.supply ?? position.amount ?? 0);
      const amount = rawAmount / (tokenInfo?.decimals ? 10 ** tokenInfo.decimals : 1e8);
      const priceRaw = getTokenPrice(position.coin);
      const price = priceRaw && priceRaw !== '0' ? parseFloat(priceRaw) : undefined;
      const value = price ? amount * price : 0;
      const positionType: 'supply' | 'borrow' = isBorrow ? 'borrow' : 'supply';
      const apr = getAprForPosition(position);

      return {
        id: `echelon-${position.coin}-${position.type ?? 'position'}-${index}`,
        label: tokenInfo?.symbol || position.coin.substring(0, 4).toUpperCase(),
        value,
        logoUrl: tokenInfo?.logoUrl || undefined,
        amountLabel: formatNumber(amount, 4),
        price,
        apr,
        type: positionType,
        _modal: {
          id: `echelon-${position.coin}-${position.type ?? 'position'}-${index}`,
          symbol: tokenInfo?.symbol || position.coin.substring(0, 4).toUpperCase(),
          tokenLogoUrl: tokenInfo?.logoUrl || undefined,
          valueUsd: value,
          amountLabel: formatNumber(amount, 4),
          positionType,
          marketObj: String(position.market ?? ''),
          canEmergencyWithdraw:
            positionType === 'supply' && (position.supply ?? position.amount ?? 0) > 0,
        } satisfies EchelonModalRow,
      };
    });

    const modalRowsLocal = mapped.map((m) => m._modal);
    const forCard = mapped.map(({ _modal: _m, ...rest }) => rest);

    return {
      protocolPositions: mapEchelonToProtocolPositions(forCard),
      modalRows: modalRowsLocal,
    };
  }, [positions, getTokenInfo, getTokenPrice, getAprForPosition]);

  const totalRewardsUsdFormatted =
    rewardsValueUsd > 0
      ? rewardsValueUsd < 1
        ? '<$1'
        : formatCurrency(rewardsValueUsd, 2)
      : undefined;

  const echelonRewardRows = useMemo((): EchelonRewardRow[] => {
    const out: EchelonRewardRow[] = [];
    for (const reward of rewardsData) {
      const ti = getRewardTokenInfoHelper(reward.token);
      if (!ti) continue;
      const priceStr = getTokenPrice(ti.faAddress || ti.address || '');
      if (!priceStr || priceStr === '0') continue;
      const usd = reward.amount * parseFloat(priceStr);
      if (!Number.isFinite(usd) || usd <= 0) continue;
      out.push({
        symbol: ti.symbol,
        amount: reward.amount,
        usdValue: usd,
        ...(ti.icon_uri ? { logoUrl: ti.icon_uri } : {}),
      });
    }
    return out;
  }, [rewardsData, getRewardTokenInfoHelper, getTokenPrice]);

  const isLoading = positionsLoading || rewardsLoading || poolsLoading;
  const isFetching = positionsFetching || rewardsFetching || poolsFetching;
  const hasError = Boolean(positionsError);

  return {
    positions: positions as EchelonPosition[],
    rewardsData: rewardsData as EchelonReward[],
    protocolPositions,
    modalRows,
    totalValue,
    positionsOnlyValue,
    rewardsValueUsd,
    totalRewardsUsdFormatted,
    isLoading,
    isFetching,
    hasError,
    getTokenInfo,
    getTokenPrice,
    calculateRewardsValue,
    echelonRewardRows,
  };
}
