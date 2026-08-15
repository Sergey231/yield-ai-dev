'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import tokenList from "@/lib/data/tokenList.json";
import { useWithdraw } from "@/lib/hooks/useWithdraw";
import { WithdrawModal } from "@/components/ui/withdraw-modal";
import echelonMarkets from "@/lib/data/echelonMarkets.json";
import { useDragDrop } from "@/contexts/DragDropContext";
import { PanoraPricesService } from "@/lib/services/panora/prices";
import { ClaimAllRewardsEchelonModal } from "@/components/ui/claim-all-rewards-echelon-modal";
import { DepositModal } from "@/components/ui/deposit-modal";
import { ProtocolKey } from "@/lib/transactions/types";
import { createDualAddressPriceMap } from "@/lib/utils/addressNormalization";
import { TokenInfoService } from "@/lib/services/tokenInfoService";
import { queryKeys } from "@/lib/query/queryKeys";
import { LendingProtocolCard } from "@/shared/ProtocolCard";
import {
  useEchelonPositions,
  useEchelonRewards,
  useEchelonPools,
  useEchelonAccountEmode,
} from "@/lib/query/hooks/protocols/echelon";
import type { EchelonPosition } from "@/lib/query/hooks/protocols/echelon/useEchelonPositions";
import { CACHE_TIME, STALE_TIME } from "@/lib/query/config";
import {
  useEchelonLendingCardModel,
  type EchelonLendingRow,
} from "./useEchelonLendingCardModel";

export function EchelonPositions() {
  const { account } = useWallet();
  const queryClient = useQueryClient();
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showClaimAllModal, setShowClaimAllModal] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<EchelonPosition | null>(null);
  const [selectedDepositMarketAddress, setSelectedDepositMarketAddress] = useState<string | undefined>(undefined);
  const [tokenPrices, setTokenPrices] = useState<Record<string, string>>({});
  const [fallbackTokenInfo, setFallbackTokenInfo] = useState<Record<string, any>>({});
  const { withdraw, isLoading: isWithdrawing } = useWithdraw();
  const { closePositionModal, closeAllModals } = useDragDrop();
  const isModalOpenRef = useRef(false);
  const pricesService = PanoraPricesService.getInstance();
  const walletAddress = account?.address?.toString();

  const {
    data: positions = [],
    isLoading: positionsLoading,
    error: positionsError,
  } = useEchelonPositions(walletAddress, {
    refetchOnMount: "always",
    staleTime: STALE_TIME.POSITIONS * 3,
    gcTime: CACHE_TIME.VERY_LONG,
  });
  const { data: rewardsData = [], isLoading: rewardsLoading } = useEchelonRewards(
    walletAddress,
    {
      refetchOnMount: "always",
      staleTime: STALE_TIME.POSITIONS * 3,
      gcTime: CACHE_TIME.VERY_LONG,
    }
  );
  const { data: poolsResponse } = useEchelonPools();
  // Active Echelon efficiency mode (e.g. 2 = stable) — boosts the liquidation threshold for
  // eligible markets (USD1/USDt: 82% base → 95% in eMode 2). Health Factor must use the
  // eMode-adjusted LT when the account has actually opted in, or it understates HF.
  const { data: accountEmodeId } = useEchelonAccountEmode(walletAddress);

  const loading = positionsLoading || rewardsLoading;
  const error = positionsError ? "Failed to load Echelon positions" : null;

  const apyData = useMemo(() => {
    const map: Record<string, any> = {};
    if (!poolsResponse?.data) return map;
    poolsResponse.data.forEach((pool: any) => {
      const assetKey = pool.asset;
      const tokenKey = pool.token;
      if (!assetKey) return;

      const poolData = {
        supplyAPY: pool.depositApy,
        borrowAPY: pool.borrowAPY,
        supplyRewardsApr: pool.supplyRewardsApr,
        borrowRewardsApr: pool.borrowRewardsApr,
        marketAddress: pool.marketAddress,
        asset: pool.asset,
        poolType: pool.poolType,
        hasSupply: pool.depositApy > 0,
        hasBorrow: pool.borrowAPY > 0,
        hasStaking: pool.stakingApr > 0,
        lendingApr: pool.lendingApr || 0,
        stakingAprOnly: pool.stakingAprOnly || 0,
        totalSupplyApr: pool.totalSupplyApr || pool.depositApy || 0,
        ltv: pool.ltv,
        lt: pool.lt,
        emodeLtv: pool.emodeLtv,
        emodeLt: pool.emodeLt,
      };

      map[assetKey] = poolData;
      if (tokenKey) map[tokenKey] = poolData;
      if (assetKey === "APT" && pool.aptAlternativeAddresses) {
        pool.aptAlternativeAddresses.forEach((altAddress: string) => {
          map[altAddress] = poolData;
        });
      }
    });
    return map;
  }, [poolsResponse?.data]);

  // Функция для нормализации адресов токенов
  const normalizeTokenAddress = (coinAddress: string): string => {
    // Специальная обработка для APT токена
    if (coinAddress === '0xa' || coinAddress === '0x1') {
      return '0x1::aptos_coin::AptosCoin';
    }
    return coinAddress;
  };

  // Функция для получения информации о токене наград
  const getRewardTokenInfoHelper = (tokenName: string) => {
    const token = (tokenList as any).data.data.find(
      (t: any) => 
        t.symbol.toLowerCase() === tokenName.toLowerCase() ||
        t.name.toLowerCase().includes(tokenName.toLowerCase())
    );
    
    if (!token) return undefined;
    
    return {
      address: token.tokenAddress,
      faAddress: token.faAddress,
      symbol: token.symbol,
      icon_uri: token.logoUrl,
      decimals: token.decimals,
      usdPrice: getTokenPrice(token.faAddress || token.tokenAddress || '')
    };
  };

  // Получаем все уникальные адреса токенов из позиций и наград
  const getAllTokenAddresses = useCallback(() => {
    const addresses = new Set<string>();
    
    // Normalize address function
    const normalizeAddress = (addr: string) => {
      if (!addr || !addr.startsWith('0x')) return addr;
      return '0x' + addr.slice(2).replace(/^0+/, '') || '0x0';
    };
    
    // Добавляем адреса токенов позиций
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
      // IMPORTANT:
      // Для загрузки tokenPrices нам нужны только адреса наград.
      // Не используем getRewardTokenInfoHelper, потому что он зависит от getTokenPrice/tokenPrices
      // и может вызывать лишние перезапуски эффекта загрузки цен (условный "инфинит-лооп").
      const token = (tokenList as any).data.data.find(
        (t: any) =>
          t.symbol.toLowerCase() === reward.token.toLowerCase() ||
          t.name.toLowerCase().includes(reward.token.toLowerCase())
      );

      if (token?.faAddress) {
        addresses.add(normalizeAddress(token.faAddress));
      }
      if (token?.tokenAddress) {
        addresses.add(normalizeAddress(token.tokenAddress));
      }
    });

    return Array.from(addresses);
  }, [positions, rewardsData]);

  // Получаем цену токена из кэша
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
    return tokenPrices[cleanAddress] || tokenPrices[normalizedAddress] || '0';
  };



  // Расчет стоимости rewards
  const calculateRewardsValue = useCallback(() => {
    return rewardsData.reduce((sum, reward) => {
      const tokenInfo = getRewardTokenInfoHelper(reward.token);
      if (!tokenInfo) return sum;
      
      const price = getTokenPrice(tokenInfo.faAddress || tokenInfo.address || '');
      const value = price && price !== '0' ? reward.amount * parseFloat(price) : 0;
      
      return sum + value;
    }, 0);
  }, [rewardsData, tokenPrices]);

    // Расчет Health Factor
  const calculateHealthFactor = useCallback(() => {
    // Проверяем, есть ли borrow позиции
    const hasBorrowPositions = positions.some(p => p.type === 'borrow');
    if (!hasBorrowPositions) return null;

    // Собираем коллатераль (supply позиции)
    const collateral = positions.filter(p => p.type === 'supply');
    const liabilities = positions.filter(p => p.type === 'borrow');

    let accountMargin = 0;
    let totalLiabilities = 0;

    // Считаем account margin (коллатераль × LT)
    collateral.forEach(position => {
      const tokenInfo = getTokenInfo(position.coin);
      const amount = parseFloat(String(position.amount)) / (tokenInfo?.decimals ? 10 ** tokenInfo.decimals : 1e8);
      const price = getTokenPrice(position.coin);
      const value = price ? amount * parseFloat(price) : 0;
      
      // Получаем LT для токена
      let poolData = apyData[position.coin];
      if (!poolData) {
        const normalizedCoin = normalizeTokenAddress(position.coin);
        poolData = apyData[normalizedCoin];
      }
      if (!poolData && tokenInfo?.symbol) {
        poolData = apyData[tokenInfo.symbol];
      }
      // eMode boosts the liquidation threshold on eligible markets (e.g. USD1/USDt 82% → 95%
      // in eMode 2) — only apply it when the account is actually opted into that eMode.
      const isEmodeActive = Boolean(accountEmodeId && accountEmodeId > 0);
      const lt = (isEmodeActive ? poolData?.emodeLt : undefined) ?? poolData?.lt ?? 0.75; // fallback 75%

      accountMargin += value * lt;
    });

    // Считаем общую задолженность
    liabilities.forEach(position => {
      const tokenInfo = getTokenInfo(position.coin);
      const amount = parseFloat(String(position.amount)) / (tokenInfo?.decimals ? 10 ** tokenInfo.decimals : 1e8);
      const price = getTokenPrice(position.coin);
      const value = price ? amount * parseFloat(price) : 0;
      
      totalLiabilities += value;
    });

    // Если нет долгов, возвращаем null
    if (totalLiabilities <= 0) return null;

    const healthFactor = accountMargin / totalLiabilities;
    
    return {
      healthFactor,
      accountMargin,
      totalLiabilities,
      isLiquidatable: healthFactor < 1
    };
  }, [positions, apyData, tokenPrices, accountEmodeId]);

  // Получаем цены токенов через Panora API с fallback к Echelon API
  useEffect(() => {
    const timeoutId = setTimeout(async () => {
      const addresses = getAllTokenAddresses();
      console.log('Requesting prices for addresses:', addresses);
      if (addresses.length === 0 || !account?.address) return;

      try {
        // First try Panora API
        const response = await pricesService.getPrices(1, addresses);
        let prices: Record<string, string> = {};
        if (response.data) {
          prices = createDualAddressPriceMap(response.data);
          console.log('Token prices saved from Panora:', Object.keys(prices).length, 'entries');
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
          console.log('[EchelonPositions] Missing prices for tokens, trying Echelon API:', missingPrices);
          
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
                  console.log('[EchelonPositions] Got price from Echelon:', info.symbol, info.price);
                }
              } catch (error) {
                console.warn('[EchelonPositions] Failed to get price for', addr, error);
              }
            })
          );

          if (Object.keys(fallbackPrices).length > 0) {
            console.log('Token prices saved from Echelon:', Object.keys(fallbackPrices).length, 'entries');
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
  }, [getAllTokenAddresses, pricesService, account?.address]);

  // Подписка на глобальное событие обновления позиций
  useEffect(() => {
    const handleRefresh = (event: CustomEvent) => {
      if (event.detail?.protocol === 'echelon') {
        if (walletAddress) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.protocols.echelon.userPositions(walletAddress),
          });
          queryClient.invalidateQueries({
            queryKey: queryKeys.protocols.echelon.rewards(walletAddress),
          });
        }
      }
    };

    window.addEventListener('refreshPositions', handleRefresh as unknown as EventListener);
    return () => {
      window.removeEventListener('refreshPositions', handleRefresh as unknown as EventListener);
    };
  }, [walletAddress, queryClient]);

  const getTokenInfo = (coinAddress: string) => {
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
        address: fallbackInfo.address,
        symbol: fallbackInfo.symbol,
        logoUrl: fallbackInfo.logoUrl,
        decimals: fallbackInfo.decimals,
        usdPrice: getTokenPrice(coinAddress) // Используем динамическую цену
      };
    }
    
    // Then check tokenList
    const token = (tokenList as any).data.data.find((t: any) => {
      const normalizedFaAddress = normalizeAddress(t.faAddress || '');
      const normalizedTokenAddress = normalizeAddress(t.tokenAddress || '');
      
      return normalizedFaAddress === normalizedCoinAddress || 
             normalizedTokenAddress === normalizedCoinAddress;
    });
    
    if (!token) return undefined;
    return {
      address: token.tokenAddress,
      symbol: token.symbol,
      logoUrl: token.logoUrl,
      decimals: token.decimals,
      usdPrice: getTokenPrice(coinAddress) // Используем динамическую цену
    };
  };
  
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
        const inTokenList = (tokenList as any).data.data.find((t: any) => {
          const normalizedFaAddress = normalizeAddress(t.faAddress || '');
          const normalizedTokenAddress = normalizeAddress(t.tokenAddress || '');
          return normalizedFaAddress === normalizedAddr || normalizedTokenAddress === normalizedAddr;
        });
        
        if (!inTokenList) {
          unknownTokens.push(position.coin);
        }
      });
      
      if (unknownTokens.length === 0) return;
      
      console.log('[EchelonPositions] Loading info for unknown tokens:', unknownTokens);
      
      // Load token info from protocol APIs
      const service = TokenInfoService.getInstance();
      const newTokenInfo: Record<string, any> = {};
      
      await Promise.all(
        unknownTokens.map(async (tokenAddr) => {
          try {
            const info = await service.getTokenInfo(tokenAddr);
            if (info) {
              const normalizedAddr = normalizeAddress(tokenAddr);
              newTokenInfo[normalizedAddr] = info;
              newTokenInfo[tokenAddr] = info; // Also store under original address
              console.log('[EchelonPositions] Loaded token info:', info.symbol, 'from', info.source);
            }
          } catch (error) {
            console.warn('[EchelonPositions] Failed to load token info for', tokenAddr, error);
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
  }, [positions]); // Removed fallbackTokenInfo from dependencies to prevent infinite loops

      // Получить APR для позиции (обновленная функция)
  const getApyForPosition = (position: any) => {
    // Ищем данные в APR маппинге по адресу токена
    let poolData = apyData[position.coin];
    
    // Если не найдено по адресу, попробуем найти по нормализованному адресу
    if (!poolData && position.coin) {
      const normalizedCoin = normalizeTokenAddress(position.coin);
      poolData = apyData[normalizedCoin];
    }
    
    // Если не найдено по нормализованному адресу, попробуем найти по символу токена
    if (!poolData && position.coin) {
      const tokenInfo = getTokenInfo(position.coin);
      if (tokenInfo?.symbol) {
        poolData = apyData[tokenInfo.symbol];
      }
    }
    
    if (poolData) {
      if (position.type === 'supply') {
        const apy = poolData.supplyAPY / 100; // Конвертируем из процентов в десятичную форму
        return apy;
      } else if (position.type === 'borrow') {
        const borrowInterestAprPct =
          typeof poolData.borrowAPY === 'number' && Number.isFinite(poolData.borrowAPY) ? poolData.borrowAPY : 0;
        const borrowRewardsAprPct =
          typeof poolData.borrowRewardsApr === 'number' && Number.isFinite(poolData.borrowRewardsApr) ? poolData.borrowRewardsApr : 0;

        // For borrow positions we show net APR: interest APR minus rewards APR.
        return (borrowInterestAprPct - borrowRewardsAprPct) / 100;
      }
    }
    return null;
  };

  // Сортируем позиции по значению от большего к меньшему
  const sortedPositions = [...positions].sort((a, b) => {
    const tokenInfoA = getTokenInfo(a.coin);
    const tokenInfoB = getTokenInfo(b.coin);
    const amountA = parseFloat(String(a.amount)) / (tokenInfoA?.decimals ? 10 ** tokenInfoA.decimals : 1e8);
    const amountB = parseFloat(String(b.amount)) / (tokenInfoB?.decimals ? 10 ** tokenInfoB.decimals : 1e8);
    const priceA = getTokenPrice(a.coin);
    const priceB = getTokenPrice(b.coin);
    const valueA = priceA ? amountA * parseFloat(priceA) : 0;
    const valueB = priceB ? amountB * parseFloat(priceB) : 0;
    return valueB - valueA;
  });

  const openClaimAllModal = useCallback(() => {
    setShowClaimAllModal(true);
  }, []);

  const { tiles, sections } = useEchelonLendingCardModel({
    sortedPositions,
    getTokenInfo,
    getTokenPrice,
    getApyForPosition,
    calculateHealthFactor,
    calculateRewardsValue,
    rewardsDataLength: rewardsData.length,
    isClaiming: false,
    onOpenClaimModal: openClaimAllModal,
  });

  // Обработчик открытия модального окна withdraw
  const handleWithdrawClick = (position: EchelonPosition) => {
    setSelectedPosition(position);
    setShowWithdrawModal(true);
  };

  // Обработчик открытия модального окна deposit
  const handleDepositClick = (position: EchelonPosition) => {
    
         // Попробуем найти market address для депозита
     let marketAddress = position.market;
     if (!marketAddress) {
       let poolData = apyData[position.coin];
       
       // Если не найдено по адресу, попробуем найти по нормализованному адресу
       if (!poolData) {
         const normalizedCoin = normalizeTokenAddress(position.coin);
         poolData = apyData[normalizedCoin];
       }
       
       // Если не найдено по нормализованному адресу, попробуем найти по символу токена
       if (!poolData) {
         const tokenInfo = getTokenInfo(position.coin);
         if (tokenInfo?.symbol) {
           poolData = apyData[tokenInfo.symbol];
         }
       }
       if (poolData?.marketAddress) {
         marketAddress = poolData.marketAddress;
       }
     }
     
     // Если все еще нет market address, попробуем найти в локальных данных
       if (!marketAddress) {
         const normalizedCoin = normalizeTokenAddress(position.coin);
         const localMarket = echelonMarkets.markets.find((m: any) => m.coin === normalizedCoin);
         if (localMarket?.market) {
           marketAddress = localMarket.market;
         }
       }
    
    setSelectedPosition(position);
    setSelectedDepositMarketAddress(marketAddress);
    setShowDepositModal(true);
  };

  // Обработчик подтверждения withdraw
  const handleWithdrawConfirm = async (amount: bigint) => {
    if (!selectedPosition) return;
    
    try {
      // console.log('Withdraw confirm - marketData:', marketData); // This line is removed
      
      // Если market address нет в позиции, получаем его из API
      let marketAddress = selectedPosition.market;
      
      if (!marketAddress) {
        // const market = marketData.find((m: any) => m.coin === selectedPosition.coin); // This line is removed
        // console.log('Withdraw confirm - found market:', market); // This line is removed
        // marketAddress = market?.market; // This line is removed
        // console.log('Withdraw confirm - marketAddress from marketData:', marketAddress); // This line is removed
      }
      
                    // Если все еще нет market address, попробуем получить его из apyData
        if (!marketAddress) {
          let poolData = apyData[selectedPosition.coin];
          
          // Если не найдено по адресу, попробуем найти по нормализованному адресу
          if (!poolData) {
            const normalizedCoin = normalizeTokenAddress(selectedPosition.coin);
            poolData = apyData[normalizedCoin];
          }
          
          // Если не найдено по нормализованному адресу, попробуем найти по символу токена
          if (!poolData) {
            const tokenInfo = getTokenInfo(selectedPosition.coin);
            if (tokenInfo?.symbol) {
              poolData = apyData[tokenInfo.symbol];
            }
          }
          
          if (poolData?.marketAddress) {
            marketAddress = poolData.marketAddress;
          }
        }
      
             // Если все еще нет market address, используем локальные данные
       if (!marketAddress) {
         const normalizedCoin = normalizeTokenAddress(selectedPosition.coin);
         const localMarket = echelonMarkets.markets.find((m: any) => m.coin === normalizedCoin);
         if (localMarket?.market) {
           marketAddress = localMarket.market;
         }
       }
      
      if (!marketAddress) {
        // console.error('Withdraw confirm - marketData length:', marketData.length); // This line is removed
        // console.error('Withdraw confirm - marketData coins:', marketData.map((m: any) => m.coin)); // This line is removed
        throw new Error('Market address not found for this token');
      }
      
      
      await withdraw('echelon', marketAddress, amount, selectedPosition.coin);
      setShowWithdrawModal(false);
      setSelectedPosition(null);
      isModalOpenRef.current = false;
      closePositionModal(selectedPosition.coin);
      const addr = account?.address?.toString();
      if (addr) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.protocols.echelon.userPositions(addr),
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.protocols.echelon.rewards(addr),
        });
      }
    } catch {
    }
  };

  if (loading) {
    return <div>Loading positions...</div>;
  }

  if (error) {
    return <div className="text-red-500">{error}</div>;
  }

  if (positions.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 text-base">
      <LendingProtocolCard<EchelonLendingRow>
        headerVariant="minimal"
        tiles={tiles}
        sections={sections}
        onDeposit={(row) => handleDepositClick(row._position)}
        onWithdraw={(row) => handleWithdrawClick(row._position)}
        withdrawDisabled={isWithdrawing}
      />

      {/* Deposit Modal */}
      {selectedPosition && (
        <DepositModal
          isOpen={showDepositModal}
          onClose={() => {
            setShowDepositModal(false);
            setSelectedPosition(null);
            setSelectedDepositMarketAddress(undefined);
          }}
          protocol={{
            name: "Echelon",
            logo: "/echelon-favicon.ico",
            apy: (() => {
              const apyValue = getApyForPosition(selectedPosition) ? getApyForPosition(selectedPosition)! * 100 : 0;
              return apyValue;
            })(),
            key: "echelon" as ProtocolKey
          }}
          tokenIn={{
            symbol: getTokenInfo(selectedPosition.coin)?.symbol || selectedPosition.coin.substring(0, 4).toUpperCase(),
            logo: getTokenInfo(selectedPosition.coin)?.logoUrl || '/file.svg',
            decimals: getTokenInfo(selectedPosition.coin)?.decimals || 8,
            address: selectedPosition.coin
          }}
          tokenOut={{
            symbol: getTokenInfo(selectedPosition.coin)?.symbol || selectedPosition.coin.substring(0, 4).toUpperCase(),
            logo: getTokenInfo(selectedPosition.coin)?.logoUrl || '/file.svg',
            decimals: getTokenInfo(selectedPosition.coin)?.decimals || 8,
            address: selectedPosition.coin
          }}
          priceUSD={parseFloat(getTokenPrice(selectedPosition.coin)) || 0}
          poolAddress={selectedDepositMarketAddress}
        />
      )}

      {/* Withdraw Modal */}
      {selectedPosition && (
        <WithdrawModal
          isOpen={showWithdrawModal}
          onClose={() => {
            setShowWithdrawModal(false);
            setSelectedPosition(null);
            isModalOpenRef.current = false;
            if (selectedPosition) {
              closePositionModal(selectedPosition.coin);
            }
            closeAllModals();
          }}
          onConfirm={handleWithdrawConfirm}
          protocol={{ name: "Echelon", logo: "/protocol_ico/echelon.png" }}
          position={{ ...selectedPosition, supply: String(selectedPosition.amount) }}
          tokenInfo={getTokenInfo(selectedPosition.coin)}
          isLoading={isWithdrawing}
          userAddress={account?.address?.toString()}
        />
      )}

      {/* Claim All Rewards Modal */}
      <ClaimAllRewardsEchelonModal
        isOpen={showClaimAllModal}
        onClose={() => setShowClaimAllModal(false)}
        rewards={rewardsData}
        tokenPrices={tokenPrices}
      />
    </div>
  );
} 