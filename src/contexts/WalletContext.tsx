'use client';

import { createContext, useContext, ReactNode, useEffect, useState, useCallback } from 'react';
import { AptosPortfolioService } from '@/lib/services/aptos/portfolio';
import { useEffectiveWalletAddresses } from "@/lib/hooks/useEffectiveWalletAddresses";

interface PortfolioToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  amount: string;
  price: string | null;
  value: string | null;
}

interface WalletContextType {
  address?: string;
  tokens: PortfolioToken[];
  refreshPortfolio: () => Promise<void>;
  isRefreshing: boolean;
}

const WalletDataContext = createContext<WalletContextType | undefined>(undefined);

export function WalletDataProvider({ children }: { children: ReactNode }) {
  const { effectiveAptosAddress } = useEffectiveWalletAddresses();
  const [tokens, setTokens] = useState<PortfolioToken[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchWalletData = useCallback(async () => {
    if (!effectiveAptosAddress) {
      setTokens([]);
      return;
    }

    try {
      setIsRefreshing(true);
      const portfolioService = new AptosPortfolioService();
      const { tokens: fetchedTokens } = await portfolioService.getPortfolio(effectiveAptosAddress);
      setTokens(fetchedTokens);
    } catch (error) {
      console.error('Error fetching wallet data:', error);
      setTokens([]);
    } finally {
      setIsRefreshing(false);
    }
  }, [effectiveAptosAddress]);

  const refreshPortfolio = useCallback(async () => {
    console.log('[WalletContext] Manual refresh triggered');
    await fetchWalletData();
  }, [fetchWalletData]);

  useEffect(() => {
    fetchWalletData();
  }, [fetchWalletData]);

  const walletData: WalletContextType = {
    address: effectiveAptosAddress ?? undefined,
    tokens,
    refreshPortfolio,
    isRefreshing,
  };

  return (
    <WalletDataContext.Provider value={walletData}>
      {children}
    </WalletDataContext.Provider>
  );
}

export function useWalletData() {
  const context = useContext(WalletDataContext);
  if (context === undefined) {
    throw new Error('useWalletData must be used within a WalletDataProvider');
  }
  return context;
} 