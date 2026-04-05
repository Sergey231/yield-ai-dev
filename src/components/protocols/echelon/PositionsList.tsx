import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import tokenList from "@/lib/data/tokenList.json";
import { PanoraPricesService } from "@/lib/services/panora/prices";
import { createDualAddressPriceMap } from "@/lib/utils/addressNormalization";
import { TokenInfoService } from "@/lib/services/tokenInfoService";
import { formatNumber } from "@/lib/utils/numberFormat";
import { ProtocolCard } from "@/shared/ProtocolCard";
import { queryKeys } from "@/lib/query/queryKeys";
import {
  useEchelonPositions,
  useEchelonRewards,
} from "@/lib/query/hooks/protocols/echelon";
import { mapEchelonToProtocolPositions } from "./mapEchelonToProtocolPositions";

interface PositionsListProps {
  address?: string;
  onPositionsValueChange?: (value: number) => void;
  refreshKey?: number;
  onPositionsCheckComplete?: () => void;
  showManageButton?: boolean;
}

interface Position {
  market: string;
  coin: string;
  supply: number;
  borrow?: number;
  amount?: number;
  type?: "supply" | "borrow";
}

interface TokenInfo {
  symbol: string;
  name: string;
  logoUrl: string | null;
  decimals: number;
  usdPrice: string | null;
}

export function PositionsList({ address, onPositionsValueChange, refreshKey, onPositionsCheckComplete, showManageButton=true }: PositionsListProps) {
  const { account } = useWallet();
  const queryClient = useQueryClient();
  const [tokenPrices, setTokenPrices] = useState<Record<string, string>>({});
  const onValueRef = useRef(onPositionsValueChange);
  const onCompleteRef = useRef(onPositionsCheckComplete);
  onValueRef.current = onPositionsValueChange;
  onCompleteRef.current = onPositionsCheckComplete;

  const [fallbackTokenInfo, setFallbackTokenInfo] = useState<Record<string, TokenInfo>>({});
  const pricesService = PanoraPricesService.getInstance();
  const walletAddress = address || account?.address?.toString();
  const protocol = getProtocolByName("Echelon");

  const {
    data: positions = [],
    isLoading: positionsLoading,
    isFetching: positionsFetching,
    error: positionsError,
  } = useEchelonPositions(walletAddress);
  const {
    data: rewardsData = [],
    isLoading: rewardsLoading,
    isFetching: rewardsFetching,
  } = useEchelonRewards(walletAddress);

  const getTokenPrice = (coinAddress: string): string => {
    let cleanAddress = coinAddress;
    if (cleanAddress.startsWith('@')) {
      cleanAddress = cleanAddress.slice(1);
    }
    if (!cleanAddress.startsWith('0x')) {
      cleanAddress = `0x${cleanAddress}`;
    }

    // Normalize address by removing leading zeros after 0x
    const normalizeAddress = (addr: string) => {
      if (!addr || !addr.startsWith('0x')) return addr;
      return '0x' + addr.slice(2).replace(/^0+/, '') || '0x0';
    };

    const normalizedAddress = normalizeAddress(cleanAddress);

    // Try both original and normalized addresses
    const price = tokenPrices[cleanAddress] || tokenPrices[normalizedAddress] || '0';
    return price;
  };

  // Функция для поиска информации о токене (без цены)
  const getTokenInfo = (coinAddress: string): TokenInfo | null => {
    // Normalize addresses by removing leading zeros after 0x
    const normalizeAddress = (addr: string) => {
      if (!addr || !addr.startsWith('0x')) return addr;
      return '0x' + addr.slice(2).replace(/^0+/, '') || '0x0';
    };

    const normalizedCoinAddress = normalizeAddress(coinAddress);

    // First, check fallback token info (from protocol APIs)
    if (fallbackTokenInfo[normalizedCoinAddress] || fallbackTokenInfo[coinAddress]) {
      const fallbackInfo = fallbackTokenInfo[normalizedCoinAddress] || fallbackTokenInfo[coinAddress];
      return {
        symbol: fallbackInfo.symbol,
        name: fallbackInfo.name,
        logoUrl: fallbackInfo.logoUrl || null,
        decimals: fallbackInfo.decimals,
        usdPrice: null // Цена будет получена динамически
      };
    }

    // Then check tokenList
    const token = tokenList.data.data.find((t) => {
      const normalizedFaAddress = normalizeAddress(t.faAddress || '');
      const normalizedTokenAddress = normalizeAddress(t.tokenAddress || '');

      return normalizedFaAddress === normalizedCoinAddress ||
             normalizedTokenAddress === normalizedCoinAddress;
    });

    if (token) {
      return {
        symbol: token.symbol,
        name: token.name,
        logoUrl: token.logoUrl || null,
        decimals: token.decimals,
        usdPrice: null // Цена будет получена динамически
      };
    }

    return null;
  };

  // Функция для получения информации о токене наград
  const getRewardTokenInfoHelper = useCallback((tokenSymbol: string) => {
    const token = (tokenList as any).data.data.find((token: any) =>
      token.symbol.toLowerCase() === tokenSymbol.toLowerCase() ||
      token.name.toLowerCase().includes(tokenSymbol.toLowerCase())
    );

    if (!token) {
      return undefined;
    }

    const result = {
      address: token.tokenAddress,
      faAddress: token.faAddress,
      symbol: token.symbol,
      icon_uri: token.logoUrl,
      decimals: token.decimals,
      price: null // Цена будет получена динамически
    };

    return result;
  }, []);

  // Функция для расчета стоимости наград
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

      // Получаем цену динамически
      const price = getTokenPrice(tokenInfo.faAddress || tokenInfo.address || '');
      if (!price || price === '0') {
        return;
      }

      const value = reward.amount * parseFloat(price);
      totalValue += value;
    });

    return totalValue;
  }, [rewardsData, getRewardTokenInfoHelper, tokenPrices]);

  // Получаем все уникальные адреса токенов из позиций
  const getAllTokenAddresses = useCallback(() => {
    const addresses = new Set<string>();

    // Normalize address function
    const normalizeAddress = (addr: string) => {
      if (!addr || !addr.startsWith('0x')) return addr;
      return '0x' + addr.slice(2).replace(/^0+/, '') || '0x0';
    };

    positions.forEach(position => {
      let cleanAddress = position.coin;
      if (cleanAddress.startsWith('@')) {
        cleanAddress = cleanAddress.slice(1);
      }
      if (!cleanAddress.startsWith('0x')) {
        cleanAddress = `0x${cleanAddress}`;
      }

      // Add only normalized address (like Wallet does)
      addresses.add(normalizeAddress(cleanAddress));
    });

    // Добавляем адреса токенов наград
    rewardsData.forEach((reward) => {
      const tokenInfo = getRewardTokenInfoHelper(reward.token);
      if (tokenInfo?.faAddress) {
        addresses.add(normalizeAddress(tokenInfo.faAddress));
      }
      if (tokenInfo?.address) {
        addresses.add(normalizeAddress(tokenInfo.address));
      }
    });

    const arr = Array.from(addresses);
    return arr;
  }, [positions, rewardsData, getRewardTokenInfoHelper]);

  // Получаем цены токенов через Panora API с fallback к Echelon API
  useEffect(() => {
    const timeoutId = setTimeout(async () => {
      const addresses = getAllTokenAddresses();
      console.log('Requesting prices for addresses:', addresses);
      if (addresses.length === 0 || !walletAddress || walletAddress.length < 10) return;

      try {
        // First try Panora API
        const response = await pricesService.getPrices(1, addresses);
        let prices: Record<string, string> = {};
        if (response.data) {
          prices = createDualAddressPriceMap(response.data);
          setTokenPrices(prices);
        }

        // Check for missing prices and try Echelon API fallback
        const missingPrices: string[] = [];
        addresses.forEach(addr => {
          const normalizedAddr = addr.replace(/^0+/, '0x') || '0x0';
          if (!prices[addr] && !prices[normalizedAddr]) {
            missingPrices.push(addr);
          }
        });

        if (missingPrices.length > 0) {
          console.log('[EchelonPositionsList] Missing prices for tokens, trying Echelon API:', missingPrices);

          // Try to get prices from Echelon API for missing tokens
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
                  console.log('[EchelonPositionsList] Got price from Echelon:', info.symbol, info.price);
                }
              } catch (error) {
                console.warn('[EchelonPositionsList] Failed to get price for', addr, error);
              }
            })
          );

          if (Object.keys(fallbackPrices).length > 0) {
            setTokenPrices(prev => ({
              ...prev,
              ...fallbackPrices
            }));
          }
        }
      } catch (error) {
        console.error('Failed to fetch token prices:', error);
      }
    }, 1000); // Дебаунсинг 1 секунда

    return () => clearTimeout(timeoutId);
  }, [getAllTokenAddresses, pricesService]);

  // Load token info for unknown tokens using fallback APIs
  useEffect(() => {
    const loadUnknownTokens = async () => {
      if (positions.length === 0) return;

      const normalizeAddress = (addr: string) => {
        if (!addr || !addr.startsWith('0x')) return addr;
        return '0x' + addr.slice(2).replace(/^0+/, '') || '0x0';
      };

      // Find tokens not in tokenList
      const unknownTokens: string[] = [];
      positions.forEach(position => {
        const normalizedAddr = normalizeAddress(position.coin);

        // Skip if already in fallback cache
        if (fallbackTokenInfo[normalizedAddr] || fallbackTokenInfo[position.coin]) {
          return;
        }

        // Check if in tokenList
        const inTokenList = tokenList.data.data.find((t) => {
          const normalizedFaAddress = normalizeAddress(t.faAddress || '');
          const normalizedTokenAddress = normalizeAddress(t.tokenAddress || '');
          return normalizedFaAddress === normalizedAddr || normalizedTokenAddress === normalizedAddr;
        });

        if (!inTokenList) {
          unknownTokens.push(position.coin);
        }
      });

      if (unknownTokens.length === 0) return;

      console.log('[EchelonPositionsList] Loading info for unknown tokens:', unknownTokens);

      // Load token info from protocol APIs
      const service = TokenInfoService.getInstance();
      const newTokenInfo: Record<string, TokenInfo> = {};

      await Promise.all(
        unknownTokens.map(async (tokenAddr) => {
          try {
            const info = await service.getTokenInfo(tokenAddr);
            if (info) {
              const normalizedAddr = normalizeAddress(tokenAddr);
              const tokenInfo: TokenInfo = {
                symbol: info.symbol,
                name: info.name,
                logoUrl: info.logoUrl,
                decimals: info.decimals,
                usdPrice: null
              };
              newTokenInfo[normalizedAddr] = tokenInfo;
              newTokenInfo[tokenAddr] = tokenInfo; // Also store under original address
              console.log('[EchelonPositionsList] Loaded token info:', info.symbol, 'from', info.source);
            }
          } catch (error) {
            console.warn('[EchelonPositionsList] Failed to load token info for', tokenAddr, error);
          }
        })
      );

      if (Object.keys(newTokenInfo).length > 0) {
        setFallbackTokenInfo(prev => ({
          ...prev,
          ...newTokenInfo
        }));
      }
    };

    loadUnknownTokens();
  }, [positions]);

  // Мемоизируем расчет общей суммы
  const totalValue = useMemo(() => {
    const positionsValue = positions.reduce((sum, position) => {
      const tokenInfo = getTokenInfo(position.coin);
      const isBorrow = position.type === 'borrow';
      const rawAmount = isBorrow ? (position.borrow ?? position.amount ?? 0) : (position.supply ?? position.amount ?? 0);
      const amount = rawAmount / (tokenInfo?.decimals ? 10 ** tokenInfo.decimals : 1e8);
      const price = getTokenPrice(position.coin);
      const value = price ? amount * parseFloat(price) : 0;
      if (isBorrow) {
        return sum - value;
      }
      return sum + value;
    }, 0);

    return positionsValue + calculateRewardsValue();
  }, [positions, tokenPrices, calculateRewardsValue]);

  const protocolPositions = useMemo(() => {
    const mapped = positions.map((position, index) => {
      const tokenInfo = getTokenInfo(position.coin);
      const isBorrow = position.type === "borrow";
      const rawAmount = isBorrow
        ? (position.borrow ?? position.amount ?? 0)
        : (position.supply ?? position.amount ?? 0);
      const amount =
        rawAmount / (tokenInfo?.decimals ? 10 ** tokenInfo.decimals : 1e8);
      const priceRaw = getTokenPrice(position.coin);
      const price =
        priceRaw && priceRaw !== "0" ? parseFloat(priceRaw) : undefined;
      const value = price ? amount * price : 0;
      const positionType: "supply" | "borrow" = isBorrow ? "borrow" : "supply";

      return {
        id: `echelon-${position.coin}-${position.type ?? "position"}-${index}`,
        label: tokenInfo?.symbol || position.coin.substring(0, 4).toUpperCase(),
        value,
        logoUrl: tokenInfo?.logoUrl || undefined,
        amountLabel: formatNumber(amount, 4),
        price,
        type: positionType,
      };
    });
    return mapEchelonToProtocolPositions(mapped);
  }, [positions, tokenPrices, fallbackTokenInfo]);

  const isLoading = positionsLoading || rewardsLoading;
  const isFetching = positionsFetching || rewardsFetching;
  const hasError = Boolean(positionsError);

  useEffect(() => {
    onValueRef.current?.(totalValue);
  }, [totalValue]);

  useEffect(() => {
    if (!isFetching) {
      onCompleteRef.current?.();
    }
  }, [isFetching]);

  useEffect(() => {
    if (refreshKey != null && walletAddress) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.echelon.userPositions(walletAddress),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.echelon.rewards(walletAddress),
      });
    }
  }, [refreshKey, walletAddress, queryClient]);

  if (isLoading && positions.length === 0 && rewardsData.length === 0) return null;
  if (hasError) return null;
  if (positions.length === 0 && calculateRewardsValue() === 0) return null;
  if (!protocol) return null;

  const totalRewardsUsd =
    calculateRewardsValue() > 0 ? `$${formatNumber(calculateRewardsValue(), 2)}` : undefined;

  return (
    <ProtocolCard
      protocol={protocol}
      totalValue={totalValue}
      positions={protocolPositions}
      totalRewardsUsd={totalRewardsUsd}
      isLoading={isLoading && positions.length === 0 && rewardsData.length === 0}
      showManageButton={showManageButton}
    />
  );
}
