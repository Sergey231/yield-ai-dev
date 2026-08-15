'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { SegmentedControl, Box } from "@radix-ui/themes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { InvestmentData } from '@/types/investments';
import tokenList from "@/lib/data/tokenList.json";
import { Input } from "@/components/ui/input";
import { Search, Funnel, X } from "lucide-react";
import { ExternalLink, Gift } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DepositButton } from "@/components/ui/deposit-button";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import Image from "next/image";
import Link from "next/link";
import { ManagePositions } from "./protocols/manage-positions/ManagePositions";
import { useProtocol } from "@/lib/contexts/ProtocolContext";
import { useDragDrop } from "@/contexts/DragDropContext";
import { DragData } from "@/types/dragDrop";
import { cn } from "@/lib/utils";
import { CollapsibleProvider } from "@/contexts/CollapsibleContext";
import { useMobileManagement } from "@/contexts/MobileManagementContext";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { AirdropInfoTooltip } from "@/components/ui/airdrop-info-tooltip";
import { YieldAiAgentWalletBlock, YieldAiStablecoinAgentAction } from "@/components/ui/yield-ai-agent-wallet-block";
import { DecibelAiAgentWalletBlock } from "@/components/ui/decibel-ai-agent-wallet-block";
import { HyperionAiAgentWalletBlock } from "@/components/ui/hyperion-ai-agent-wallet-block";
import { Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InvestmentsDashboardLoading } from "./InvestmentsDashboardLoading";
import { DecibelIdeasBlock } from "./decibel-ideas-block";
import { TokenInfoService, type TokenInfo } from "@/lib/services/tokenInfoService";
import { useSolanaPortfolio } from "@/hooks/useSolanaPortfolio";
import { useEchelonPools } from "@/lib/query/hooks/protocols/echelon/useEchelonPools";
import { USD1_FA_METADATA_MAINNET } from "@/lib/constants/yieldAiVault";
import { normalizeAddress } from "@/lib/utils/addressNormalization";

// Ideas exclusions for protocols and Echelon assets that must not accept new deposits.
const HIDDEN_IDEAS_PROTOCOLS = new Set(["Earnium", "Auro Finance", "Aries", "Meso Finance", "Moar Market", "Tapp Exchange", "Kofi Finance", "Joule", "Panora"]);
const EXCLUDED_ECHELON_IDEA_SYMBOLS = new Set(['kapt', 'stkapt', 'goapt']);
const EXCLUDED_ECHELON_IDEA_TOKENS = new Set([
  "0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa::asset::USDT",
  "0xf22bede237a07e121b56d91a491eb7bcdfd1f5907926a9e58338f964a01b17fa::asset::USDC",
  "0x2b3be0a97a73c87ff62cbdd36837a9fb5bbd1d7f06a73b7ed62ec15c5326c1b8",
  "0x5e156f1207d0ebfa19a9eeff00d62a282278fb8719f4fab3a586a0a2c0fffbea::coin::T",
  "0x54fc0d5fa5ad975ede1bf8b1c892ae018745a1afd4a4da9b70bb6e5448509fc0",
  "0x821c94e69bc7ca058c913b7b5e6b0a5c9fd1523d58723a966fb8c1f5ea888105",
  "0x42556039b88593e768c97ab1a3ab0c6a17230825769304482dff8fdebe4c002b",
  "0x5b5c9ec5e88ddd6697b5b2f9f0a8e03eae1186c47fa4d934798632dc2987b249",
]);
const USDC_LOGO_APTOS = "https://assets.panora.exchange/tokens/aptos/USDC.svg";
const MIN_VISIBLE_TVL_USD = 10000;
type PoolTypeFilter = "Lending" | "DEX";
type ChainFilter = "Aptos" | "Solana";

function isHiddenIdeasPool(item: InvestmentData): boolean {
  if (item.protocol === 'Kofi Finance') return true;
  if (item.protocol !== 'Echelon') return false;

  if (EXCLUDED_ECHELON_IDEA_SYMBOLS.has(item.asset.toLowerCase())) return true;

  return [item.token, item.coinAddress, item.faAddress].some(
    (address) => address && EXCLUDED_ECHELON_IDEA_TOKENS.has(address)
  );
}

interface InvestmentsDashboardProps {
  className?: string;
}

interface Token {
  chainId: number;
  panoraId: string;
  tokenAddress: string;
  faAddress: string;
  name: string;
  symbol: string;
  decimals: number;
  bridge: null;
  panoraSymbol: string;
  usdPrice: string;
  isBanned: boolean;
  logoUrl?: string;
}

function getChainLogoForProtocol(protocolName: string): { src: string; alt: string } {
  const protocol = getProtocolByName(protocolName);
  const normalizedProtocol = (protocol?.name || protocolName).toLowerCase();
  const isSolana =
    normalizedProtocol === "jupiter" ||
    normalizedProtocol === "kamino" ||
    normalizedProtocol === "orca" ||
    normalizedProtocol === "tramplin";
  return isSolana
    ? { src: "/chain_ico/solana.png?v=1", alt: "Solana" }
    : { src: "/chain_ico/aptos.png?v=1", alt: "Aptos" };
}


function getChainForProtocol(protocolName: string): ChainFilter {
  return getChainLogoForProtocol(protocolName).alt === "Solana" ? "Solana" : "Aptos";
}

function getPoolTypeFilter(item: InvestmentData): PoolTypeFilter {
  const poolType = String(item.poolType || "").toLowerCase();
  const itemWithTokens = item as InvestmentData & { tokensInfo?: TokenInfo[] };
  const hasDexTokens = !!(item.token1Info && item.token2Info) || !!itemWithTokens.tokensInfo?.length;
  return hasDexTokens || poolType.includes("dex") || poolType.includes("clmm") ? "DEX" : "Lending";
}

export function InvestmentsDashboard({ className }: InvestmentsDashboardProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showOnlyStablePools, setShowOnlyStablePools] = useState(true);
  const [activeTab, setActiveTab] = useState<"lite" | "pro">("lite");
  const { selectedProtocol, setSelectedProtocol } = useProtocol();

  const allowSolanaAddressOverride =
    process.env.NEXT_PUBLIC_KAMINO_REWARDS_MOCK === "1" ||
    process.env.NEXT_PUBLIC_KAMINO_REWARDS_MOCK === "true";
  const isLikelySolanaAddress = (input: string): boolean => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input);
  const [solanaAddressOverride, setSolanaAddressOverride] = useState<string | null>(null);
  useEffect(() => {
    if (!allowSolanaAddressOverride) {
      setSolanaAddressOverride(null);
      return;
    }
    try {
      const sp = new URLSearchParams(window.location.search);
      const raw = (sp.get("solanaAddress") || sp.get("solana") || "").trim();
      setSolanaAddressOverride(raw && isLikelySolanaAddress(raw) ? raw : null);
    } catch {
      setSolanaAddressOverride(null);
    }
  }, [allowSolanaAddressOverride]);

  const { address: solanaConnectedAddress, tokens: solanaTokens, refresh: refreshSolana } = useSolanaPortfolio({
    overrideAddress: solanaAddressOverride,
  });

  // New states for progressive loading
  // Initialize loading states immediately to show tabs and skeletons right away
  const [protocolsLoading, setProtocolsLoading] = useState<Record<string, boolean>>({
    'Hyperion': true,
    'Thala': true,
    'Amnis Finance': true,
    'Echelon': true,
    'Aave': true,
    'Decibel': true,
    'Echo Protocol': true,
    'APTree': true,
    'Jupiter': true,
    'Kamino': true,
    'Orca': true,
  });
  const [protocolsError, setProtocolsError] = useState<Record<string, string | null>>({});
  const [protocolsData, setProtocolsData] = useState<Record<string, InvestmentData[]>>({});
  const [protocolsLogos, setProtocolsLogos] = useState<Record<string, string>>({
    'Hyperion': '/protocol_ico/hyperion.png',
    'Thala': '/protocol_ico/thala.png',
    'Amnis Finance': '/protocol_ico/amnis.png',
    'Echelon': '/protocol_ico/echelon.png',
    'Aave': '/protocol_ico/aave.ico',
    'Decibel': '/protocol_ico/decibel.png',
    'Echo Protocol': '/protocol_ico/echo.png',
    'APTree': '/protocol_ico/aptree.png',
    'Jupiter': '/protocol_ico/jupiter.png',
    'Kamino': '/protocol_ico/kamino.png',
    'Orca': '/protocol_ico/orca.ico',
  });
  // For Echelon (e.g. DLP) tokenList.json may not contain the token.
  // Resolve missing token metadata from /api/tokens/info to show correct icons and decimals.
  const tokenInfoService = TokenInfoService.getInstance();
  const [resolvedTokenInfos, setResolvedTokenInfos] = useState<Record<string, TokenInfo>>({});
  const requestedResolvedTokenInfosRef = useRef<Set<string>>(new Set());
  const { data: echelonPoolsResp } = useEchelonPools();
  const yieldAiStablecoinApr = useMemo(() => {
    const target = normalizeAddress(USD1_FA_METADATA_MAINNET);
    const pool = echelonPoolsResp?.data?.find(
      (p) => p.token && normalizeAddress(p.token) === target
    );
    return pool?.depositApy ?? null;
  }, [echelonPoolsResp]);

  const [showSearchOptions, setShowSearchOptions] = useState(false);
  const [protocolFilterSearch, setProtocolFilterSearch] = useState('');
  const [selectedFilterProtocols, setSelectedFilterProtocols] = useState<string[]>([]);
  const [selectedPoolTypeFilters, setSelectedPoolTypeFilters] = useState<PoolTypeFilter[]>([]);
  const [selectedChainFilters, setSelectedChainFilters] = useState<ChainFilter[]>([]);
  const [hideSmallTvlPools, setHideSmallTvlPools] = useState(true);
  const [yieldAiTvlUSD, setYieldAiTvlUSD] = useState<number | null>(null);
  const [isMobileProLayout, setIsMobileProLayout] = useState(false);

  // Column visibility settings for Pro tab
  const [showBorrowColumn, setShowBorrowColumn] = useState(false);
  const [showTypeColumn, setShowTypeColumn] = useState(false);
  const [showTvlColumn, setShowTvlColumn] = useState(true);

  const { state, handleDrop, validateDrop } = useDragDrop();
  const { account } = useWallet();
  const { setActiveTab: setMobileTab } = useMobileManagement();

  const togglePoolTypeFilter = (filter: PoolTypeFilter) => {
    setSelectedPoolTypeFilters((prev) =>
      prev.includes(filter) ? prev.filter((item) => item !== filter) : [...prev, filter]
    );
  };

  const toggleChainFilter = (filter: ChainFilter) => {
    setSelectedChainFilters((prev) =>
      prev.includes(filter) ? prev.filter((item) => item !== filter) : [...prev, filter]
    );
  };

  const hasAptosWallet = Boolean(account?.address);
  const hasSolanaWallet = Boolean(solanaConnectedAddress);
  const isSolanaProtocolName = (name: string) =>
    name === "Jupiter" || name === "Kamino" || name === "Orca";
  const uiProtocolsLoading = (() => {
    // Ideas "Checking pools" indicator should reflect connected chains:
    // - only Solana connected -> show only Solana protocols
    // - only Aptos connected -> show only Aptos protocols
    // - both connected -> show all
    // - none connected -> keep showing all (Ideas can still load pools)
    if (!hasAptosWallet && !hasSolanaWallet) return protocolsLoading;
    if (hasAptosWallet && hasSolanaWallet) return protocolsLoading;
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(protocolsLoading)) {
      const isSol = isSolanaProtocolName(k);
      out[k] = hasSolanaWallet ? (isSol ? v : false) : hasAptosWallet ? (!isSol ? v : false) : v;
    }
    return out;
  })();

  const getTokenInfo = (asset: string, tokenAddress?: string): Token | undefined => {
    if (tokenAddress) {
      return (tokenList.data.data as Token[]).find(token =>
        token.tokenAddress === tokenAddress || token.faAddress === tokenAddress
      );
    }
    return undefined;
  };

  const isStablePool = (item: InvestmentData): boolean => {
    // Для DEX-пулов проверяем, являются ли они стабильными парами
    if (item.token1Info && item.token2Info) {
      const symbol1 = item.token1Info.symbol.toLowerCase();
      const symbol2 = item.token2Info.symbol.toLowerCase();

      // Проверяем стабильные токены
      const stableTokens = ['usdt', 'usdc', 'dai', 'busd', 'tusd', 'gusd', 'frax'];
      const isStable1 = stableTokens.some(token => symbol1.includes(token));
      const isStable2 = stableTokens.some(token => symbol2.includes(token));

      // Если оба токена стабильные, это стабильная пара
      if (isStable1 && isStable2) {
        return true;
      }

      // Ищем совпадающие символы (минимум 3 символа подряд) для других случаев
      for (let i = 0; i <= symbol1.length - 3; i++) {
        const substring = symbol1.substring(i, i + 3);
        if (symbol2.includes(substring)) {
          return true;
        }
      }
    }

    // Для лендинговых пулов (не DEX) считаем стабильными
    if (!item.token1Info && !item.token2Info) {
      return true;
    }

    // Echelon пулы считаем стабильными (они все лендинговые)
    if (item.protocol === 'Echelon') {
      return true;
    }

    return false;
  };

  const handleProtocolSelect = (protocolName: string) => {
    setSelectedFilterProtocols(prev =>
      prev.includes(protocolName)
        ? prev.filter(p => p !== protocolName)
        : [...prev, protocolName]
    );
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
  };

  const clearSearchByProtocols = () => {
    setSelectedFilterProtocols([]);
    setProtocolFilterSearch('');
  };

  // Start loading immediately when component mounts
  useEffect(() => {
    if (typeof window === 'undefined') return; // Extra check for SSR

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        setProtocolsError({});
        setProtocolsData({});

        // Define protocol endpoints
        const protocolEndpoints = [
          // Joule disabled - data loading moved to positions component
          // {
          //   name: 'Joule',
          //   url: '/api/protocols/primary-yield?protocol=Joule',
          //   logoUrl: '/protocol_ico/joule.png',
          //   transform: (data: any) => data.data || []
          // },
          {
            name: 'Hyperion',
            url: '/api/protocols/hyperion/pools',
			logoUrl: '/protocol_ico/hyperion.png',
            transform: (data: any) => {
              const filtered = (data.data || [])
                .filter((pool: any) => {
                  const dailyVolume = parseFloat(pool.dailyVolumeUSD || "0");
                  return dailyVolume > 1000;
                });

              return filtered.map((pool: any) => {
                const feeAPR = parseFloat(pool.feeAPR || "0");
                const farmAPR = parseFloat(pool.farmAPR || "0");
                const totalAPY = feeAPR + farmAPR;

                const token1Info = pool.pool?.token1Info || pool.token1Info;
                const token2Info = pool.pool?.token2Info || pool.token2Info;

                return {
                  asset: `${token1Info?.symbol || 'Unknown'}/${token2Info?.symbol || 'Unknown'}`,
                  provider: 'Hyperion',
                  totalAPY: totalAPY,
                  depositApy: totalAPY,
                  borrowAPY: 0,
                  token: pool.poolId || pool.id,
                  protocol: 'Hyperion',
                  dailyVolumeUSD: parseFloat(pool.dailyVolumeUSD || "0"),
                  tvlUSD: parseFloat(pool.tvlUSD || "0"),
                  token1Info: token1Info,
                  token2Info: token2Info
                };
              });
            }
          },
          {
            name: 'Thala',
            url: '/api/protocols/thala/pools',
            logoUrl: '/protocol_ico/thala.png',
            transform: (data: any) => {
              const pools = data.data || [];
              const filtered = pools.filter((pool: any) => {
                const tvl = parseFloat(pool.tvl || "0");
                return tvl > 1000;
              });

              return filtered.map((pool: any) => {
                const totalAPY = parseFloat(pool.apr || "0") * 100;
                const coinAddresses = Array.isArray(pool.coinAddresses) ? pool.coinAddresses : [];
                const tokenAAddress = coinAddresses[0] || '';
                const tokenBAddress = coinAddresses[1] || '';
                const tokenAInfo = getTokenInfo('', tokenAAddress);
                const tokenBInfo = getTokenInfo('', tokenBAddress);

                const token1Info = tokenAInfo ? {
                  symbol: tokenAInfo.symbol,
                  name: tokenAInfo.name,
                  logoUrl: tokenAInfo.logoUrl,
                  decimals: tokenAInfo.decimals
                } : {
                  symbol: pool.token_a || 'Unknown',
                  name: pool.token_a || 'Unknown',
                  logoUrl: undefined,
                  decimals: 8
                };

                const token2Info = tokenBInfo ? {
                  symbol: tokenBInfo.symbol,
                  name: tokenBInfo.name,
                  logoUrl: tokenBInfo.logoUrl,
                  decimals: tokenBInfo.decimals
                } : {
                  symbol: pool.token_b || 'Unknown',
                  name: pool.token_b || 'Unknown',
                  logoUrl: undefined,
                  decimals: 8
                };

                return {
                  asset: `${token1Info.symbol}/${token2Info.symbol}`,
                  provider: 'Thala',
                  totalAPY: totalAPY,
                  depositApy: totalAPY,
                  borrowAPY: 0,
                  token: pool.pool_id || pool.lptAddress || '',
                  protocol: 'Thala',
                  dailyVolumeUSD: parseFloat(pool.volume1d || "0"),
                  tvlUSD: parseFloat(pool.tvl || "0"),
                  token1Info,
                  token2Info,
                  poolType: pool.poolType || 'DEX',
                  swapFee: pool.swapFee,
                  aprSources: pool.aprSources,
                  lptAddress: pool.lptAddress,
                  originalPool: pool
                };
              });
            }
          },
          {
            name: 'Amnis Finance',
            url: '/api/protocols/amnis/pools',
			logoUrl: '/protocol_ico/amnis.png',
            transform: (data: any) => {
              const pools = data.pools || [];

              return pools.map((pool: any) => {
                return {
                  asset: pool.asset || 'Unknown',
                  provider: 'Amnis Finance',
                  totalAPY: pool.apr || 0,
                  depositApy: pool.apr || 0,
                  borrowAPY: 0,
                  token: pool.token || '',
                  protocol: 'Amnis Finance',
                  poolType: 'Staking',
                  stakingToken: pool.stakingToken,
                  totalStaked: pool.totalStaked,
                  minStake: pool.minStake,
                  maxStake: pool.maxStake,
                  isActive: pool.isActive
                };
              });
            }
          },
          {
            name: 'Echelon',
            url: '/api/protocols/echelon/v2/pools',
			logoUrl: '/protocol_ico/echelon.png',
            transform: (data: any) => {
              const pools = data.data || [];

              return pools.map((pool: any) => {
                // Echelon borrow APR should be displayed as net:
                // borrowAPY (interest) minus borrowRewardsApr (rewards influence).
                const netBorrowAPY =
                  (typeof pool.borrowAPY === 'number' ? pool.borrowAPY : 0) -
                  (typeof pool.borrowRewardsApr === 'number' ? pool.borrowRewardsApr : 0);
                return {
                  asset: pool.asset || 'Unknown',
                  provider: pool.provider || 'Echelon',
                  totalAPY: pool.totalAPY || 0,
                  borrowAPY: netBorrowAPY,
                  token: pool.token || '',
                  coinAddress: pool.coinAddress || undefined,
                  faAddress: pool.faAddress || undefined,
                  protocol: 'Echelon',
                  poolType: pool.poolType || 'Lending',
                  tvlUSD: pool.tvlUSD || 0,
                  dailyVolumeUSD: pool.dailyVolumeUSD || 0,
                  // Echelon-specific fields
                  supplyCap: pool.supplyCap,
                  borrowCap: pool.borrowCap,
                  supplyRewardsApr: pool.supplyRewardsApr,
                  borrowRewardsApr: pool.borrowRewardsApr,
                  marketAddress: pool.marketAddress,
                  totalSupply: pool.totalSupply,
                  totalBorrow: pool.totalBorrow,
                  // APR breakdown fields
                  depositApy: pool.depositApy || 0,
                  stakingApr: pool.stakingApr,
                  totalSupplyApr: pool.totalSupplyApr || 0,
                  // Individual APR components for tooltip
                  lendingApr: pool.lendingApr || 0,
                  stakingAprOnly: pool.stakingAprOnly || 0,
                  // Note: LTV fields not available in current API response
                };
              });
            }
          },
          {
            name: 'Aave',
            url: '/api/protocols/aave/pools',
			logoUrl: '/protocol_ico/aave.ico',
            transform: (data: any) => {
              const pools = data.data || [];

              return pools.map((pool: any) => {
                return {
                  asset: pool.asset || 'Unknown',
                  provider: pool.provider || 'Aave',
                  totalAPY: pool.totalAPY || 0,
                  depositApy: pool.depositApy || 0,
                  borrowAPY: pool.borrowAPY || 0,
                  token: pool.token || '',
                  protocol: pool.protocol || 'Aave',
                  poolType: pool.poolType || 'Lending',
                  // Добавить недостающие поля
                  tvlUSD: pool.tvlUSD || 0,
                  dailyVolumeUSD: pool.dailyVolumeUSD || 0,
                  // AAVE-специфичные поля
                  liquidityRate: pool.liquidityRate,
                  variableBorrowRate: pool.variableBorrowRate,
                  decimals: pool.decimals,
                  marketAddress: pool.marketAddress || pool.token
                };
              });
            }
          },
          {
            name: 'Decibel',
            // We only render the single "Decibel Protocol Vault" pool. The
            // proxy accepts `vault_address` and `limit` — filter server-side
            // so the dashboard does not wait for 50 vaults to download just
            // to discard 49 of them. This was the slowest pool fetch and
            // gated the entire "Checking pools" placeholder.
            url: '/api/protocols/decibel/vaults?vault_address=0x06ad70a9a4f30349b489791e2f2bcf58363dad30e54a9d2d4095d6213d7a9bf9&limit=1',
            logoUrl: '/protocol_ico/decibel.png',
            transform: (data: any) => {
              const items = data?.data?.items ?? [];
              // Belt-and-braces: still resolve by name/address in case the
              // upstream API returns siblings (e.g. when vault_address is
              // unknown to it and it falls back to the unfiltered list).
              const vault = items.find(
                (v: { name?: string; address?: string }) =>
                  v.name === 'Decibel Protocol Vault' ||
                  v.address === '0x06ad70a9a4f30349b489791e2f2bcf58363dad30e54a9d2d4095d6213d7a9bf9'
              ) ?? items[0];
              if (!vault) return [];
              // API returns apr in % (e.g. 2.98 = 2.98%), do not multiply by 100
              const aprPct = typeof vault.apr === 'number' ? vault.apr : 0;
              const allTimeReturn = typeof (vault as { all_time_return?: number }).all_time_return === 'number'
                ? (vault as { all_time_return: number }).all_time_return
                : undefined;
              const vaultPnl = typeof (vault as { all_time_pnl?: number }).all_time_pnl === 'number'
                ? (vault as { all_time_pnl: number }).all_time_pnl
                : undefined;
              return [
                {
                  asset: 'USDC',
                  provider: 'Decibel',
                  totalAPY: aprPct,
                  depositApy: aprPct,
                  borrowAPY: 0,
                  token: '0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b',
                  protocol: 'Decibel',
                  tvlUSD: typeof vault.tvl === 'number' ? vault.tvl : 0,
                  marketAddress: vault.address,
                  decibelAllTimeReturn: allTimeReturn,
                  decibelVaultPnl: vaultPnl
                }
              ];
            }
          },
          {
            name: 'Echo Protocol',
            url: '/api/protocols/echo/reserves',
            logoUrl: '/protocol_ico/echo.png',
            transform: (data: any) => {
              const list = data?.data ?? data ?? [];
              return list.map((r: any) => ({
                asset: r.symbol ?? 'Unknown',
                provider: 'Echo Protocol',
                totalAPY: r.supplyApy ?? 0,
                depositApy: r.supplyApy ?? 0,
                borrowAPY: r.borrowApy ?? 0,
                token: r.token ?? r.underlyingAddress ?? '',
                protocol: 'Echo Protocol',
                poolType: 'Lending',
                tvlUSD: 0,
              }));
            }
          },
          {
            name: 'APTree',
            url: '/api/protocols/aptree/pools',
            logoUrl: '/protocol_ico/aptree.png',
            transform: (data: any) => {
              const pools = Array.isArray(data?.data) ? data.data : [];
              return pools.map((pool: any) => {
                const aprPct = (typeof pool.apr === 'number' ? pool.apr : 0) * 100;
                return {
                  asset: 'USDT',
                  provider: 'APTree',
                  totalAPY: aprPct,
                  depositApy: aprPct,
                  borrowAPY: 0,
                  token: '0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b',
                  protocol: 'APTree',
                  tvlUSD: typeof pool.tvl === 'number' ? pool.tvl : 0,
                  poolType: 'Yield'
                };
              });
            }
          },
          {
            name: 'Jupiter',
            url: '/api/protocols/jupiter/pools',
            logoUrl: '/protocol_ico/jupiter.png',
            transform: (data: any) => {
              const pools = Array.isArray(data?.data) ? data.data : [];
              return pools.map((pool: any) => ({
                asset: pool.asset || 'Unknown',
                provider: 'Jupiter',
                totalAPY: typeof pool.totalAPY === 'number' ? pool.totalAPY : 0,
                depositApy: typeof pool.depositApy === 'number' ? pool.depositApy : 0,
                borrowAPY: typeof pool.borrowAPY === 'number' ? pool.borrowAPY : 0,
                token: pool.token || '',
                tokenDecimals: typeof pool.tokenDecimals === 'number' ? pool.tokenDecimals : undefined,
                protocol: 'Jupiter',
                logoUrl: pool.logoUrl || undefined,
                tvlUSD: typeof pool.tvlUSD === 'number' ? pool.tvlUSD : 0,
                poolType: 'Lending',
              }));
            }
          },
          {
            name: 'Kamino',
            url: '/api/protocols/kamino/pools',
            logoUrl: '/protocol_ico/kamino.png',
            transform: (data: any) => {
              const pools = Array.isArray(data?.data) ? data.data : [];
              return pools.map((pool: any) => ({
                asset: pool.asset || 'Unknown',
                provider: 'Kamino',
                totalAPY: typeof pool.totalAPY === 'number' ? pool.totalAPY : 0,
                depositApy: typeof pool.depositApy === 'number' ? pool.depositApy : 0,
                borrowAPY: typeof pool.borrowAPY === 'number' ? pool.borrowAPY : 0,
                token: pool.token || '',
                tokenDecimals: typeof pool.tokenDecimals === 'number' ? pool.tokenDecimals : undefined,
                protocol: 'Kamino',
                logoUrl: pool.logoUrl || undefined,
                tvlUSD: typeof pool.tvlUSD === 'number' ? pool.tvlUSD : 0,
                poolType: pool.poolType || 'Vault',
                originalPool: pool.originalPool,
              }));
            }
          },
          {
            name: 'Orca',
            url: '/api/protocols/orca/pools',
            logoUrl: '/protocol_ico/orca.ico',
            transform: (data: any) => {
              const pools = Array.isArray(data?.data) ? data.data : [];
              return pools.map((pool: any) => ({
                asset: pool.asset || 'Unknown',
                provider: 'Orca',
                totalAPY: typeof pool.totalAPY === 'number' ? pool.totalAPY : 0,
                depositApy: typeof pool.depositApy === 'number' ? pool.depositApy : 0,
                borrowAPY: typeof pool.borrowAPY === 'number' ? pool.borrowAPY : 0,
                token: pool.token || '',
                protocol: 'Orca',
                tvlUSD: typeof pool.tvlUSD === 'number' ? pool.tvlUSD : 0,
                dailyVolumeUSD: typeof pool.dailyVolumeUSD === 'number' ? pool.dailyVolumeUSD : 0,
                poolType: pool.poolType || 'DEX',
                feeTier: typeof pool.feeTier === 'number' ? pool.feeTier : undefined,
                token1Info: pool.token1Info,
                token2Info: pool.token2Info,
                originalPool: pool.originalPool,
              }));
            }
          }
        ];

        // When NEXT_PUBLIC_DEBUG_PROTOCOLS is set (e.g. "decibel"), fetch only those protocols' pools
        const debugProtocolKeys =
          typeof process.env.NEXT_PUBLIC_DEBUG_PROTOCOLS === "string"
            ? process.env.NEXT_PUBLIC_DEBUG_PROTOCOLS.split(",")
                .map((p) => p.trim().toLowerCase())
                .filter(Boolean)
            : null;
        const endpointsToFetch =
          debugProtocolKeys?.length && debugProtocolKeys.length > 0
            ? protocolEndpoints.filter((ep) => {
                const key = getProtocolByName(ep.name)?.key;
                return key && debugProtocolKeys.includes(key.toLowerCase());
              })
            : protocolEndpoints;

        // Fetch all protocols in parallel
        const fetchPromises = endpointsToFetch.map(async (endpoint) => {
          try {
            const response = await fetch(endpoint.url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
              }
            });

            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            const transformedData = endpoint.transform(data);

            // Update state progressively
            setProtocolsData(prev => ({
              ...prev,
              [endpoint.name]: transformedData
            }));

			setProtocolsLogos(prev => ({
             ...prev,
             [endpoint.name]: endpoint.logoUrl
            }));

            setProtocolsLoading(prev => ({
              ...prev,
              [endpoint.name]: false
            }));

            return { name: endpoint.name, data: transformedData, success: true };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`❌ Error fetching ${endpoint.name}:`, error);

            setProtocolsError(prev => ({
              ...prev,
              [endpoint.name]: errorMessage
            }));

			setProtocolsLogos(prev => ({
             ...prev,
             [endpoint.name]: endpoint.logoUrl
            }));

            setProtocolsLoading(prev => ({
              ...prev,
              [endpoint.name]: false
            }));

            return { name: endpoint.name, data: [], success: false, error };
          }
        });

        // Wait for all promises to settle
        const results = await Promise.allSettled(fetchPromises);

        // Combine all successful results
        const allPools: InvestmentData[] = [];
        results.forEach((result) => {
          if (result.status === 'fulfilled' && result.value.success) {
            allPools.push(...result.value.data);
          }
        });

        setLoading(false);
      } catch (error) {
        setError('Failed to load investment opportunities');
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch('/api/protocols/yield-ai/defillama');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const tvl = Number(data?.tvlUSD);
        if (!cancelled && Number.isFinite(tvl) && tvl > 0) {
          setYieldAiTvlUSD(tvl);
        }
      } catch (error) {
        console.error('[Yield AI Ideas] DeFi Llama TVL fetch failed:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobileProLayout(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const handleDragOver = (e: React.DragEvent, investment: InvestmentData) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragLeave = () => {
    // Убираем эту логику, так как подсветка теперь глобальная
  };

  const handleDropEvent = (e: React.DragEvent, investment: InvestmentData) => {
    e.preventDefault();

    try {
      const dragData = JSON.parse(e.dataTransfer.getData('application/json')) as DragData;
      handleDrop(dragData, investment);
    } catch (error) {
    }
  };

  const getDropZoneClassName = (investment: InvestmentData) => {
    if (!state.dragData) {
      return "transition-colors hover:bg-accent/50";
    }

    const validation = validateDrop(state.dragData, investment);
    const protocol = getProtocolByName(investment.protocol);

    // In Pro tab, pools with external deposit (only via link) must remain red
    if (activeTab === 'pro' && protocol && protocol.depositType !== 'native') {
      return "transition-colors bg-error-muted border-error hover:bg-error-muted/80";
    }

    if (validation.isValid) {
      // Direct deposit (same token)
      return "transition-colors bg-success-muted border-success hover:bg-success-muted/80";
    }

    if ((validation as any).requiresSwap) {
      // Requires swap + deposit → highlight in yellow
      return "transition-colors bg-warning-muted border-warning hover:bg-warning-muted/80";
    }

    // Invalid drop
    return "transition-colors bg-error-muted border-error hover:bg-error-muted/80";
  };

  // Combine all loaded protocol data
  const allLoadedData = Object.values(protocolsData).flat();

  const filteredData = allLoadedData.filter(item => {

    // Фильтруем исключенные токены Echelon
    if (isHiddenIdeasPool(item)) {
      return false;
    }

    // Фильтруем по стабильным пулам, если включен чекбокс
    if (showOnlyStablePools && !isStablePool(item)) {
      return false;
    }

    if (hideSmallTvlPools) {
      // Treat a missing/zero TVL as "unknown" rather than "small": some
      // protocols (e.g. APTree) don't report TVL, so they arrive as 0. Only
      // hide pools that report a real, positive TVL below the threshold.
      const tvl = typeof item.tvlUSD === "number" ? item.tvlUSD : 0;
      if (tvl > 0 && tvl < MIN_VISIBLE_TVL_USD) return false;
    }

    if (
      selectedPoolTypeFilters.length > 0 &&
      !selectedPoolTypeFilters.includes(getPoolTypeFilter(item))
    ) {
      return false;
    }

    if (
      selectedChainFilters.length > 0 &&
      !selectedChainFilters.includes(getChainForProtocol(item.protocol))
    ) {
      return false;
    }

    const tokenInfo = getTokenInfo(item.asset, item.token);
    const displaySymbol = tokenInfo?.symbol || item.asset;
	const displayProtocol = item.protocol;

    return (
      (selectedFilterProtocols.length === 0 ||
       selectedFilterProtocols.some(protocol =>
         displayProtocol?.toLowerCase().includes(protocol.toLowerCase())
       )) &&
      (!searchQuery || displaySymbol.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  });

  // Данные для текущей вкладки
  const currentTabData = activeTab === "lite"
    ? allLoadedData.filter(item => {
        // Фильтруем исключенные токены Echelon
        if (isHiddenIdeasPool(item)) {
          return false;
        }

        // Показываем только протоколы с нативным депозитом в Lite вкладке
        const protocol = getProtocolByName(item.protocol);
        if (!protocol || protocol.depositType !== 'native') {
          return false;
        }

        const tokenInfo = getTokenInfo(item.asset, item.token);
        const displaySymbol = tokenInfo?.symbol || item.asset;
        return displaySymbol.toLowerCase().includes(searchQuery.toLowerCase());
      })
    : filteredData; // В Pro вкладке используем все отфильтрованные данные

  // Resolve token metadata for Echelon pools that are missing from tokenList.
  // This mimics the managed-positions fallback behavior (token -> /api/tokens/info -> Echelon icon).
  useEffect(() => {
    if (activeTab !== 'pro') return;

    const echelonItems = allLoadedData.filter((item) => item.protocol === 'Echelon' && !isHiddenIdeasPool(item));
    const toResolve: string[] = [];

    for (const item of echelonItems) {
      const depositTokenAddress = item.coinAddress ?? item.token;
      if (!depositTokenAddress) continue;

      // If tokenList already knows it, no need to resolve.
      const listTokenInfo = getTokenInfo(item.asset, depositTokenAddress);
      if (listTokenInfo) continue;

      if (requestedResolvedTokenInfosRef.current.has(depositTokenAddress)) continue;

      requestedResolvedTokenInfosRef.current.add(depositTokenAddress);
      toResolve.push(depositTokenAddress);
    }

    if (toResolve.length === 0) return;

    let cancelled = false;

    (async () => {
      const map = await tokenInfoService.getTokenInfoBatch(toResolve);
      if (cancelled) return;

      setResolvedTokenInfos((prev) => {
        const next = { ...prev };
        toResolve.forEach((addr) => {
          const info = map.get(addr);
          if (info) next[addr] = info;
        });
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, protocolsData]);

  if (error) {
    return (
      <div className="text-center p-4 text-red-500">
        {error}
      </div>
    );
  }

  // Show the skeleton "Checking pools" placeholder only while we have zero
  // data. As soon as any protocol resolves, render the dashboard with the
  // partial result — the inline header indicator ("Loading X protocols…
  // (Y pools loaded)") communicates that more is on the way. This stops a
  // single slow upstream (e.g. Decibel) from gating the whole UI.
  const hasAnyProtocolData = Object.keys(protocolsData).length > 0;
  const showLoadingIndicators =
    loading && !hasAnyProtocolData && Object.values(uiProtocolsLoading).some(Boolean);
  const protocolNames = [
    ...new Set(
      Object.values(protocolsData)
        .flat()
        .filter((item) => !isHiddenIdeasPool(item))
        .map((item) => item.protocol)
    ),
  ]
    .filter((name) => name && !HIDDEN_IDEAS_PROTOCOLS.has(name))
    .sort((a, b) => a.localeCompare(b));
  const searchByProtocols = selectedFilterProtocols.length > 0;
  const proVisibleData = activeTab === "pro"
    ? currentTabData
        .filter(item => {
          const depositTokenAddress =
            item.protocol === 'Echelon' ? (item.coinAddress ?? item.token) : item.token;

          const tokenInfo = getTokenInfo(item.asset, depositTokenAddress);
          const hasTokenInfo = !!tokenInfo;
          const hasAssetColon = item.asset.includes('::');
          const hasDexTokens = !!(item.token1Info && item.token2Info) || !!(item as any).tokensInfo?.length;

          // Include whitelisted protocols that may not resolve tokenInfo yet.
          return hasAssetColon || hasTokenInfo || hasDexTokens || item.protocol === 'Echelon' || item.protocol === 'Decibel' || item.protocol === 'Echo Protocol' || item.protocol === 'APTree' || item.protocol === 'Jupiter' || item.protocol === 'Kamino' || item.protocol === 'Orca';
        })
        .sort((a, b) => b.totalAPY - a.totalAPY)
    : [];

  if (showLoadingIndicators) {
    return (
      <InvestmentsDashboardLoading
        className={className}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        protocolsLoading={uiProtocolsLoading}
        protocolsError={protocolsError}
        protocolsData={protocolsData}
        protocolsLogos={protocolsLogos}
      />
    );
  }

  return (
    <div className={className}>
      {selectedProtocol && (
        <CollapsibleProvider>
          <ManagePositions
            protocol={selectedProtocol}
            onClose={() => {
              setSelectedProtocol(null);
              if (setMobileTab) {
                setMobileTab('assets');
              }
            }}
          />
        </CollapsibleProvider>
      )}

      {/* These cards live in the constrained middle dashboard panel whose width
          varies with the Tools panel, so we let the grid auto-fit columns by
          available width instead of guessing viewport breakpoints. Falls back to
          1 column on narrow panels and goes up to 3 when there's room. */}
      <div className="mb-6 grid gap-4 grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-stretch">
        <YieldAiAgentWalletBlock />
        <DecibelAiAgentWalletBlock />
        <HyperionAiAgentWalletBlock />
      </div>

      <div className="mb-4 pl-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Ideas</h2>
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                {Object.values(uiProtocolsLoading).filter(Boolean).length > 0 && (
                  <>
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                    <span>Loading {Object.values(uiProtocolsLoading).filter(Boolean).length} protocols...</span>
                  </>
                )}
              </div>
              <span className="text-xs">
                ({Object.values(protocolsData).flat().length} pools loaded)
              </span>
            </div>
          )}
        </div>
      </div>
      <Box pt="2" pb="3">
        <SegmentedControl.Root
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as "lite" | "pro")}
          style={{ width: '100%' }}
          radius="full"
        >
          <SegmentedControl.Item value="lite" style={{ flex: 1 }}>Lite</SegmentedControl.Item>
          <SegmentedControl.Item value="pro" style={{ flex: 1 }}>Pro</SegmentedControl.Item>
        </SegmentedControl.Root>
      </Box>

      <Box pt="3">
        {activeTab === "lite" && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-4">Fundamentals</h3>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {([
                  { key: 'APT', symbol: 'APT', exact: false },
                  { key: 'BTC', symbol: 'BTC', exact: false },
                  {
                    key: 'stable',
                    stable: true as const,
                  },
                ] as const).map((item) => {
                  const bestPool = 'stable' in item && item.stable
                    ? allLoadedData
                        .filter(pool => {
                          if (isHiddenIdeasPool(pool)) return false;
                          const protocol = getProtocolByName(pool.protocol);
                          if (!protocol || protocol.depositType !== 'native') return false;
                          return pool.asset.toUpperCase().includes('USDT') ||
                            pool.asset.toUpperCase().includes('USDC') ||
                            pool.asset.toUpperCase().includes('DAI') ||
                            pool.asset.toUpperCase().includes('SUSD');
                        })
                        .sort((a, b) => b.totalAPY - a.totalAPY)[0]
                    : allLoadedData
                        .filter(pool => {
                          if (isHiddenIdeasPool(pool)) return false;
                          const protocol = getProtocolByName(pool.protocol);
                          if (!protocol || protocol.depositType !== 'native') return false;
                          if (!('symbol' in item) || !('exact' in item)) return false;
                          return item.exact
                            ? pool.asset.toUpperCase() === item.symbol
                            : pool.asset.toUpperCase().includes(item.symbol);
                        })
                        .sort((a, b) => b.totalAPY - a.totalAPY)[0];

                  if (!bestPool) return null;

                  const tokenInfo = getTokenInfo(bestPool.asset, bestPool.token);
                  const displaySymbol = tokenInfo?.symbol || bestPool.asset;
                  const logoUrl = tokenInfo?.logoUrl || bestPool.logoUrl;
                  const protocol = getProtocolByName(bestPool.protocol);
                  const chainLogo = getChainLogoForProtocol(bestPool.protocol);

                  // Check if this is a DEX pool with two tokens
                  const isDex = !!(bestPool.token1Info && bestPool.token2Info);


                  return (
                    <Card
                      key={item.key}
                      className={cn("border-2 min-w-0 overflow-hidden", getDropZoneClassName(bestPool))}
                      onDragOver={(e) => handleDragOver(e, bestPool)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDropEvent(e, bestPool)}
                    >
                      <CardHeader className="min-w-0">
                        <CardTitle className="flex items-center gap-2 w-full flex-wrap min-w-0 text-sm md:text-base">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger className="cursor-default min-w-0 flex-1 text-left">
                                <div className="flex items-start gap-2 min-w-0 flex-wrap">
                                  {isDex ? (
                                    // DEX pool display with up to three tokens
                                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                      <div className="flex shrink-0">
                                        {(bestPool as any).tokensInfo?.slice(0,3)?.map((t: any, idx: number) => (
                                          <Avatar key={idx} className={`w-6 h-6 ${idx > 0 ? '-ml-2' : ''}`}>
                                            {t.logoUrl ? (
                                              <img src={t.logoUrl} alt={t.symbol} className="object-contain" />
                                            ) : null}
                                          </Avatar>
                                        )) || (
                                          <>
                                            {bestPool.token1Info?.logoUrl && (
                                              <Avatar className="w-6 h-6">
                                                <img src={bestPool.token1Info.logoUrl} alt={bestPool.token1Info.symbol} className="object-contain" />
                                              </Avatar>
                                            )}
                                            {bestPool.token2Info?.logoUrl && (
                                              <Avatar className="w-6 h-6 -ml-2">
                                                <img src={bestPool.token2Info.logoUrl} alt={bestPool.token2Info.symbol} className="object-contain" />
                                              </Avatar>
                                            )}
                                          </>
                                        )}
                                      </div>
                                      <span className="break-words">{((bestPool as any).tokensInfo?.slice(0,3)?.map((t: any) => t.symbol) || [bestPool.token1Info?.symbol, bestPool.token2Info?.symbol]).filter(Boolean).join(' / ')}</span>
                                    </div>
                                  ) : (
                                    // Lending pool display (existing logic)
                                    <>
                                      {logoUrl && (
                                        <div className="w-6 h-6 relative shrink-0">
                                          <Image
                                            src={logoUrl}
                                            alt={displaySymbol}
                                            width={24}
                                            height={24}
                                            className="object-contain"
                                          />
                                        </div>
                                      )}
                                      <span className="break-words">{displaySymbol}</span>
                                    </>
                                  )}
                                </div>
                              </TooltipTrigger>
                            </Tooltip>
                          </TooltipProvider>
                          <div className="shrink-0 flex items-center gap-2 flex-wrap justify-end">
                            <img
                              src={chainLogo.src}
                              alt={chainLogo.alt}
                              width={18}
                              height={18}
                              className="rounded-full shrink-0"
                            />
                            <Badge variant="outline" className="text-xs whitespace-normal break-words max-w-full">{bestPool.protocol}</Badge>
                            {protocol?.airdropInfo && (
                              <AirdropInfoTooltip airdropInfo={protocol.airdropInfo} size="sm">
                                <div className="flex items-center justify-center w-5 h-5 rounded-full bg-muted hover:bg-muted/80 transition-colors cursor-help">
                                  <Gift className="h-3 w-3 text-muted-foreground" />
                                </div>
                              </AirdropInfoTooltip>
                            )}
                          </div>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-lg md:text-2xl font-bold whitespace-nowrap">{bestPool.totalAPY?.toFixed(2) || "0.00"}%</div>
                        <p className="text-xs text-muted-foreground">Total APR</p>
                        <DepositButton
                          protocol={protocol!}
                          className="mt-4 w-full"
                          tokenIn={{
                            symbol: isDex ? (bestPool.token1Info?.symbol || 'Unknown') : displaySymbol,
                            logo: isDex ? (bestPool.token1Info?.logoUrl || '/file.svg') : (logoUrl || '/file.svg'),
                            decimals:
                              isDex
                                ? (bestPool.token1Info?.decimals || 8)
                                : (protocol?.name === 'Jupiter'
                                    ? (bestPool.tokenDecimals ?? tokenInfo?.decimals ?? 6)
                                    : (tokenInfo?.decimals || 8)),
                            address: bestPool.token
                          }}
                          balance={BigInt(1000000000)} // TODO: Get real balance
                          priceUSD={Number(tokenInfo?.usdPrice || 0)}
                          solanaTokensOverride={solanaTokens}
                          refreshSolanaOverride={refreshSolana}
                        />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-4">
                <h3 className="text-lg font-semibold">Decibel Perps</h3>
                <Link
                  href="/decibel/funding"
                  className="text-sm text-primary hover:underline shrink-0"
                >
                  Funding chart
                </Link>
              </div>
              <DecibelIdeasBlock />
            </div>
          </div>
        )}

        {activeTab === "pro" && (
          <>
          <div className="flex flex-wrap items-center gap-2 mb-2">

            {/* Token search */}
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search tokens…"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-8"
              />
            </div>

            {/* Quick token shortcuts */}
            <div className="flex gap-1 flex-none">
              {(['USD', 'APT', 'BTC'] as const).map((token) => (
                <Button
                  key={token}
                  variant={searchQuery.toUpperCase().includes(token) ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleSearchChange(searchQuery.toUpperCase().includes(token) ? '' : token)}
                  className="h-9 px-3 text-xs font-medium"
                >
                  {token}
                </Button>
              ))}
            </div>

            {/* Protocol faceted filter */}
            <Popover open={showSearchOptions} onOpenChange={setShowSearchOptions}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    'h-9 gap-1.5 border-dashed',
                    selectedFilterProtocols.length > 0 && 'border-solid border-primary/50 bg-primary/5'
                  )}
                >
                  <Funnel className="h-3.5 w-3.5" />
                  Protocols
                  {selectedFilterProtocols.length > 0 && (
                    <Badge variant="secondary" className="ml-0.5 rounded-sm px-1 py-0 text-xs font-medium">
                      {selectedFilterProtocols.length}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-60 p-3">
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Search protocols…"
                      value={protocolFilterSearch}
                      onChange={(e) => setProtocolFilterSearch(e.target.value)}
                      className="pl-7 h-8 text-sm"
                    />
                  </div>
                  <div className="max-h-56 overflow-y-auto space-y-0.5 pr-0.5">
                    {protocolNames
                      .filter((name) => name.toLowerCase().includes(protocolFilterSearch.toLowerCase()))
                      .map((protocolName) => {
                        const proto = getProtocolByName(protocolName);
                        const isSelected = selectedFilterProtocols.includes(protocolName);
                        return (
                          <button
                            key={protocolName}
                            onClick={() => handleProtocolSelect(protocolName)}
                            className={cn(
                              'w-full flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors text-left',
                              isSelected
                                ? 'bg-primary/10 text-primary font-medium'
                                : 'hover:bg-accent text-foreground/80'
                            )}
                          >
                            {proto?.logoUrl ? (
                              <Image
                                src={proto.logoUrl}
                                alt={protocolName}
                                width={16}
                                height={16}
                                className="rounded-sm shrink-0 object-contain"
                                unoptimized
                              />
                            ) : (
                              <div className="h-4 w-4 rounded-sm bg-muted shrink-0" />
                            )}
                            <span className="truncate flex-1">{protocolName}</span>
                            {isSelected && (
                              <span className="ml-auto text-primary text-xs shrink-0">✓</span>
                            )}
                          </button>
                        );
                      })}
                  </div>
                  {selectedFilterProtocols.length > 0 && (
                    <>
                      <div className="h-px bg-border" />
                      <button
                        onClick={clearSearchByProtocols}
                        className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-0.5"
                      >
                        Clear {selectedFilterProtocols.length} selected
                      </button>
                    </>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            {/* Type filter */}
            <div className="flex gap-1 flex-none">
              {(['Lending', 'DEX'] as PoolTypeFilter[]).map((filter) => (
                <Button
                  key={filter}
                  variant={selectedPoolTypeFilters.includes(filter) ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => togglePoolTypeFilter(filter)}
                  className="h-9 px-3 text-xs"
                >
                  {filter}
                </Button>
              ))}
            </div>

            {/* Chain filter */}
            <div className="flex gap-1 flex-none">
              {(['Aptos', 'Solana'] as ChainFilter[]).map((filter) => (
                <Button
                  key={filter}
                  variant={selectedChainFilters.includes(filter) ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => toggleChainFilter(filter)}
                  className="h-9 px-3 text-xs"
                >
                  {filter}
                </Button>
              ))}
            </div>

            {/* Stables toggle */}
            <Button
              variant={showOnlyStablePools ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowOnlyStablePools(!showOnlyStablePools)}
              className="h-9 px-3 text-xs flex-none"
            >
              Stables only
            </Button>

            {/* Column settings */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 flex-none">
                  <Settings className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Columns</div>
                <DropdownMenuCheckboxItem
                  checked={hideSmallTvlPools}
                  onCheckedChange={(checked) => setHideSmallTvlPools(!!checked)}
                >
                  Hide TVL &lt; $10,000
                </DropdownMenuCheckboxItem>
                <div className="my-1 h-px bg-border" />
                <DropdownMenuCheckboxItem
                  checked={showTvlColumn}
                  onCheckedChange={(checked) => setShowTvlColumn(!!checked)}
                >
                  TVL
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={showBorrowColumn}
                  onCheckedChange={(checked) => setShowBorrowColumn(!!checked)}
                >
                  Borrow APR
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem
                  checked={showTypeColumn}
                  onCheckedChange={(checked) => setShowTypeColumn(!!checked)}
                >
                  Type
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Active filter chips */}
          {(selectedFilterProtocols.length > 0 || selectedPoolTypeFilters.length > 0 || selectedChainFilters.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              {selectedFilterProtocols.map((name) => (
                <button
                  key={name}
                  onClick={() => handleProtocolSelect(name)}
                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                >
                  {name}
                  <X className="h-3 w-3 shrink-0" />
                </button>
              ))}
              {selectedPoolTypeFilters.map((f) => (
                <button
                  key={f}
                  onClick={() => togglePoolTypeFilter(f)}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium hover:bg-accent transition-colors"
                >
                  {f}
                  <X className="h-3 w-3 shrink-0" />
                </button>
              ))}
              {selectedChainFilters.map((f) => (
                <button
                  key={f}
                  onClick={() => toggleChainFilter(f)}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium hover:bg-accent transition-colors"
                >
                  {f}
                  <X className="h-3 w-3 shrink-0" />
                </button>
              ))}
              <button
                onClick={() => {
                  clearSearchByProtocols();
                  setSelectedPoolTypeFilters([]);
                  setSelectedChainFilters([]);
                }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-1"
              >
                Clear all
              </button>
            </div>
          )}

          {isMobileProLayout && (
          <div className="space-y-3">
            {showOnlyStablePools && (
              <div className="rounded-md border border-emerald-200 bg-emerald-50/80 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/30">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar className="h-8 w-8 ring-2 ring-emerald-200 dark:ring-emerald-800">
                      <AvatarImage src={USDC_LOGO_APTOS} />
                      <AvatarFallback>US</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="font-semibold leading-tight">Yield AI Stablecoin Agent</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Featured</Badge>
                        <Badge variant="outline">Yield AI</Badge>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-semibold">
                      {yieldAiStablecoinApr != null ? `${yieldAiStablecoinApr.toFixed(2)}%` : "-"}
                    </div>
                    <div className="text-xs text-muted-foreground">Supply</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">TVL</div>
                    <div>
                      {yieldAiTvlUSD != null && yieldAiTvlUSD > 0
                        ? `$${Math.round(yieldAiTvlUSD).toLocaleString()}`
                        : "-"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Type</div>
                    <div>Lending</div>
                  </div>
                </div>
                <YieldAiStablecoinAgentAction className="mt-3" />
              </div>
            )}

            {proVisibleData.map((item, index) => {
              const depositTokenAddress =
                item.protocol === 'Echelon' ? (item.coinAddress ?? item.token) : item.token;

              const tokenInfo = getTokenInfo(item.asset, depositTokenAddress);
              const resolvedTokenInfo = resolvedTokenInfos[depositTokenAddress];
              const displaySymbol = tokenInfo?.symbol || resolvedTokenInfo?.symbol || item.asset;
              const logoUrl = tokenInfo?.logoUrl || resolvedTokenInfo?.logoUrl || item.logoUrl;
              const decimals = tokenInfo?.decimals ?? resolvedTokenInfo?.decimals ?? 8;
              const priceUSD =
                tokenInfo?.usdPrice != null
                  ? Number(tokenInfo.usdPrice || 0)
                  : (resolvedTokenInfo?.price ?? 0);
              const protocol = getProtocolByName(item.protocol);
              const chainLogo = getChainLogoForProtocol(item.protocol);
              const isDex = !!(item.token1Info && item.token2Info) || !!(item as any).tokensInfo?.length;

              return (
                <div
                  key={`mobile-${index}`}
                  className={cn("rounded-md border p-3", getDropZoneClassName(item))}
                  onDragOver={(e) => handleDragOver(e, item)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDropEvent(e, item)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {isDex ? (
                          <>
                            <div className="flex shrink-0">
                              {(item as any).tokensInfo?.slice(0,3)?.map((t: any, idx: number) => (
                                <Avatar key={idx} className={`h-6 w-6 ${idx > 0 ? '-ml-2' : ''}`}>
                                  {t.logoUrl ? <img src={t.logoUrl} alt={t.symbol} className="object-contain" /> : null}
                                </Avatar>
                              )) || (
                                <>
                                  {item.token1Info?.logoUrl && (
                                    <Avatar className="h-6 w-6">
                                      <img src={item.token1Info.logoUrl} alt={item.token1Info.symbol} className="object-contain" />
                                    </Avatar>
                                  )}
                                  {item.token2Info?.logoUrl && (
                                    <Avatar className="h-6 w-6 -ml-2">
                                      <img src={item.token2Info.logoUrl} alt={item.token2Info.symbol} className="object-contain" />
                                    </Avatar>
                                  )}
                                </>
                              )}
                            </div>
                            <span className="min-w-0 break-words font-medium">
                              {((item as any).tokensInfo?.slice(0,3)?.map((t: any) => t.symbol) || [item.token1Info?.symbol, item.token2Info?.symbol]).filter(Boolean).join(' / ')}
                            </span>
                          </>
                        ) : (
                          <>
                            <Avatar className="h-6 w-6 shrink-0">
                              {logoUrl ? <AvatarImage src={logoUrl} /> : <AvatarFallback>{displaySymbol.slice(0, 2)}</AvatarFallback>}
                            </Avatar>
                            <span className="min-w-0 break-words font-medium">{displaySymbol}</span>
                          </>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <img
                          src={chainLogo.src}
                          alt={chainLogo.alt}
                          width={16}
                          height={16}
                          className="rounded-full shrink-0"
                        />
                        <Badge variant="outline" className="text-xs">{item.protocol}</Badge>
                        <Badge variant="secondary" className="text-xs">{getPoolTypeFilter(item)}</Badge>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-semibold">{item.depositApy ? `${item.depositApy.toFixed(2)}%` : "-"}</div>
                      <div className="text-xs text-muted-foreground">Supply</div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    {showTvlColumn && (
                      <div>
                        <div className="text-xs text-muted-foreground">TVL</div>
                        <div>
                          {typeof item.tvlUSD === "number" && item.tvlUSD > 0
                            ? `$${Math.round(item.tvlUSD).toLocaleString()}`
                            : "-"}
                        </div>
                      </div>
                    )}
                    {showBorrowColumn && (
                      <div>
                        <div className="text-xs text-muted-foreground">Borrow</div>
                        <div>{item.borrowAPY ? `${item.borrowAPY.toFixed(2)}%` : "-"}</div>
                      </div>
                    )}
                  </div>

                  <div className="mt-3">
                    {protocol ? (
                      isDex ? (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            if (item.protocol === 'Hyperion') {
                              window.open(`https://hyperion.xyz/pool/${item.token}`, '_blank');
                            } else if (item.protocol === 'Orca') {
                              window.open(`https://www.orca.so/pools/${item.token}`, '_blank');
                            } else if (item.protocol === 'Tapp Exchange') {
                              window.open(`https://tapp.exchange/pool`, '_blank');
                            } else if (item.protocol === 'Thala') {
                              const poolAddress = (item as any).lptAddress || item.token;
                              if (poolAddress) {
                                window.open(`https://app.thala.fi/pools/${poolAddress}`, '_blank');
                              }
                            }
                          }}
                          className="w-full"
                        >
                          Deposit
                          <ExternalLink className="ml-2 h-4 w-4" />
                        </Button>
                      ) : (
                        <DepositButton
                          protocol={protocol}
                          className="w-full"
                          tokenIn={{
                            symbol:
                              item.protocol === "Kamino"
                                ? String(item.originalPool?.tokenSymbol ?? displaySymbol)
                                : displaySymbol,
                            logo: logoUrl || '/file.svg',
                            decimals:
                              protocol?.name === 'Jupiter' || protocol?.name === 'Kamino'
                                ? (item.tokenDecimals ?? tokenInfo?.decimals ?? resolvedTokenInfo?.decimals ?? 6)
                                : decimals,
                            address:
                              protocol?.name === 'Jupiter' ? item.token : depositTokenAddress
                          }}
                          balance={BigInt(1000000000)}
                          priceUSD={
                            protocol?.name === 'Jupiter'
                              ? Number(tokenInfo?.usdPrice || 0)
                              : priceUSD
                          }
                          solanaTokensOverride={solanaTokens}
                          refreshSolanaOverride={refreshSolana}
                          kaminoVaultAddress={
                            item.protocol === 'Kamino' && item.originalPool?.vaultAddress
                              ? String(item.originalPool.vaultAddress)
                              : undefined
                          }
                          kaminoVaultLabel={
                            item.protocol === "Kamino"
                              ? String(item.originalPool?.tokenSymbol ?? displaySymbol)
                              : undefined
                          }
                          kaminoDepositApy={item.protocol === 'Kamino' ? item.depositApy : undefined}
                        />
                      )
                    ) : (
                      <Button disabled className="w-full">
                        Protocol not found
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          )}

          {!isMobileProLayout && (
          <TooltipProvider>
            <div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Token</TableHead>
                  <TableHead>
					Protocol
					{searchByProtocols ? (
				      <TooltipProvider>
				        <Tooltip>
				          <TooltipTrigger asChild>
					        <Button
						      variant="ghost"
						      size="sm"
						      onClick={() => setShowSearchOptions(true)}
						      className="h-4 w-4 p-0 hover:bg-transparent hover:text-foreground/60 opacity-80 transition-colors cursor-pointer"
						    >
						      <Funnel className={cn(
							   "h-3 w-3"
						      )} />
						    </Button>
						  </TooltipTrigger>
						  <TooltipContent>
						    <p>Filter by protocol</p>
						  </TooltipContent>
					    </Tooltip>
					  </TooltipProvider>
					) : (
					  <TooltipProvider>
				        <Tooltip>
				          <TooltipTrigger asChild>
					        <Button
						      variant="ghost"
						      size="sm"
						      onClick={() => setShowSearchOptions(true)}
						      className="h-4 w-4 p-0 text-muted-foreground hover:bg-transparent hover:text-foreground/60 opacity-80 transition-colors cursor-pointer"
						    >
						      <Funnel className={cn(
							   "h-3 w-3"
						      )} />
						    </Button>
						  </TooltipTrigger>
						  <TooltipContent>
						    <p>Filter by protocol</p>
						  </TooltipContent>
					    </Tooltip>
					  </TooltipProvider>
					)}
				</TableHead>
                  <TableHead>
                    <Tooltip>
                      <TooltipTrigger>Supply</TooltipTrigger>
                      <TooltipContent>APR - Annual % yield from supply</TooltipContent>
                    </Tooltip>
                  </TableHead>
                  {showBorrowColumn && (
                    <TableHead>
                      <Tooltip>
                        <TooltipTrigger>Borrow</TooltipTrigger>
                        <TooltipContent>APR - Annual % cost or reward from borrowing</TooltipContent>
                      </Tooltip>
                    </TableHead>
                  )}
                  {showTvlColumn && <TableHead>TVL</TableHead>}
                  {showTypeColumn && <TableHead>Type</TableHead>}
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {showOnlyStablePools && (
                  <TableRow className="border-y border-emerald-200 bg-emerald-50/80 hover:bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/40">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-7 w-7 ring-2 ring-emerald-200 dark:ring-emerald-800">
                          <AvatarImage src={USDC_LOGO_APTOS} />
                          <AvatarFallback>US</AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="font-semibold">Yield AI Stablecoin Agent</span>
                          <span className="text-xs text-muted-foreground">USDC strategy</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <img
                          src={getChainLogoForProtocol("AI agent").src}
                          alt="Aptos"
                          width={18}
                          height={18}
                          className="rounded-full shrink-0"
                        />
                        <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                          Featured
                        </Badge>
                        <Badge variant="outline">Yield AI</Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      {yieldAiStablecoinApr != null ? `${yieldAiStablecoinApr.toFixed(2)}%` : "-"}
                    </TableCell>
                    {showBorrowColumn && <TableCell>-</TableCell>}
                    {showTvlColumn && (
                      <TableCell>
                        {yieldAiTvlUSD != null && yieldAiTvlUSD > 0
                          ? `$${Math.round(yieldAiTvlUSD).toLocaleString()}`
                          : "-"}
                      </TableCell>
                    )}
                    {showTypeColumn && (
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          Lending
                        </Badge>
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <YieldAiStablecoinAgentAction />
                    </TableCell>
                  </TableRow>
                )}
                {proVisibleData.map((item, index) => {

                    const depositTokenAddress =
                      item.protocol === 'Echelon' ? (item.coinAddress ?? item.token) : item.token;

                    const tokenInfo = getTokenInfo(item.asset, depositTokenAddress);
                    const resolvedTokenInfo = resolvedTokenInfos[depositTokenAddress];
                    const displaySymbol = tokenInfo?.symbol || resolvedTokenInfo?.symbol || item.asset;
                    const logoUrl = tokenInfo?.logoUrl || resolvedTokenInfo?.logoUrl || item.logoUrl;
                    const decimals = tokenInfo?.decimals ?? resolvedTokenInfo?.decimals ?? 8;
                    const priceUSD =
                      tokenInfo?.usdPrice != null
                        ? Number(tokenInfo.usdPrice || 0)
                        : (resolvedTokenInfo?.price ?? 0);
                    const protocol = getProtocolByName(item.protocol);
                    const chainLogo = getChainLogoForProtocol(item.protocol);

                    // Check if this is a DEX pool with two or more tokens
                    const isDex = !!(item.token1Info && item.token2Info) || !!(item as any).tokensInfo?.length;


                    return (
                      <TableRow
                        key={index}
                        className={cn("transition-colors", getDropZoneClassName(item))}
                        onDragOver={(e) => handleDragOver(e, item)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDropEvent(e, item)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {isDex ? (
                              // DEX pool display with up to three tokens
                              <div className="flex items-center gap-2">
                                <div className="flex">
                                  {(item as any).tokensInfo?.slice(0,3)?.map((t: any, idx: number) => (
                                    <Avatar key={idx} className={`w-6 h-6 ${idx > 0 ? '-ml-2' : ''}`}>
                                      {t.logoUrl ? (
                                        <img src={t.logoUrl} alt={t.symbol} className="object-contain" />
                                      ) : null}
                                    </Avatar>
                                  )) || (
                                    <>
                                      {item.token1Info?.logoUrl && (
                                        <Avatar className="w-6 h-6">
                                          <img src={item.token1Info.logoUrl} alt={item.token1Info.symbol} className="object-contain" />
                                        </Avatar>
                                      )}
                                      {item.token2Info?.logoUrl && (
                                        <Avatar className="w-6 h-6 -ml-2">
                                          <img src={item.token2Info.logoUrl} alt={item.token2Info.symbol} className="object-contain" />
                                        </Avatar>
                                      )}
                                    </>
                                  )}
                                </div>
                                <span>{((item as any).tokensInfo?.slice(0,3)?.map((t: any) => t.symbol) || [item.token1Info?.symbol, item.token2Info?.symbol]).filter(Boolean).join(' / ')}</span>
                              </div>
                            ) : (
                              // Lending pool display (existing logic)
                              <>
                                <Avatar className="h-6 w-6">
                                  {logoUrl ? (
                                    <AvatarImage src={logoUrl} />
                                  ) : (
                                    <AvatarFallback>{displaySymbol.slice(0, 2)}</AvatarFallback>
                                  )}
                                </Avatar>
                                <div className="flex flex-col">
                                  <span>{displaySymbol}</span>
                                </div>
                              </>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <img
                              src={chainLogo.src}
                              alt={chainLogo.alt}
                              width={18}
                              height={18}
                              className="rounded-full shrink-0"
                            />
                            <Badge variant="outline">
                              {item.protocol}
                            </Badge>
                            {protocol?.airdropInfo && (
                              <AirdropInfoTooltip airdropInfo={protocol.airdropInfo} size="sm">
                                <div className="flex items-center justify-center w-5 h-5 rounded-full bg-muted hover:bg-muted/80 transition-colors cursor-help">
                                  <Gift className="h-3 w-3 text-muted-foreground" />
                                </div>
                              </AirdropInfoTooltip>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {item.depositApy ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="cursor-help">
                                    {item.depositApy.toFixed(2)}%
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="bg-black text-white border-gray-700 max-w-xs">
                                  <div className="text-xs font-semibold mb-1">Supply APR Breakdown:</div>
                                  <div className="space-y-1">
                                    {(typeof item.lendingApr === 'number' && item.lendingApr > 0) && (
                                      <div className="flex justify-between">
                                        <span>Lending APR:</span>
                                        <span className="text-green-400">{item.lendingApr.toFixed(2)}%</span>
                                      </div>
                                    )}
                                    {(typeof item.stakingApr === 'number' && item.stakingApr > 0) && (
                                      <div className="flex justify-between">
                                        <span>Staking APR:</span>
                                        <span className="text-blue-400">{item.stakingApr.toFixed(2)}%</span>
                                      </div>
                                    )}
                                    {(typeof item.supplyRewardsApr === 'number' && item.supplyRewardsApr > 0) && (
                                      <div className="flex justify-between">
                                        <span>Rewards APR:</span>
                                        <span className="text-yellow-400">{item.supplyRewardsApr.toFixed(2)}%</span>
                                      </div>
                                    )}
                                    {/* Moar Market specific breakdown */}
                                    {(typeof item.interestRateComponent === 'number' && item.interestRateComponent > 0) && (
                                      <div className="flex justify-between">
                                        <span>Interest Rate:</span>
                                        <span className="text-green-400">{item.interestRateComponent.toFixed(2)}%</span>
                                      </div>
                                    )}
                                    {(typeof item.farmingAPY === 'number' && item.farmingAPY > 0) && (
                                      <div className="flex justify-between">
                                        <span>Farming APY:</span>
                                        <span className="text-yellow-400">{item.farmingAPY.toFixed(2)}%</span>
                                      </div>
                                    )}
                                    {item.protocol === 'Decibel' && (typeof (item as any).decibelAllTimeReturn === 'number' || typeof (item as any).decibelVaultPnl === 'number') && (
                                      <>
                                        {(item as any).decibelAllTimeReturn != null && (
                                          <div className="flex justify-between">
                                            <span>All time return:</span>
                                            <span className="text-white">{Number((item as any).decibelAllTimeReturn).toFixed(2)}%</span>
                                          </div>
                                        )}
                                        {(item as any).decibelVaultPnl != null && (
                                          <div className="flex justify-between">
                                            <span>Vault PnL:</span>
                                            <span className="text-white">${Number((item as any).decibelVaultPnl).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                                          </div>
                                        )}
                                      </>
                                    )}
                                    <div className="border-t border-gray-600 pt-1 mt-1">
                                      <div className="flex justify-between font-semibold">
                                        <span>Total:</span>
                                        <span className="text-white">{item.depositApy.toFixed(2)}%</span>
                                      </div>
                                    </div>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : "-"}
                        </TableCell>
                        {showBorrowColumn && (
                          <TableCell>
                            {item.borrowAPY ? `${item.borrowAPY.toFixed(2)}%` : "-"}
                          </TableCell>
                        )}
                        {showTvlColumn && (
                          <TableCell>
                            {typeof item.tvlUSD === "number" && item.tvlUSD > 0
                              ? `$${Math.round(item.tvlUSD).toLocaleString()}`
                              : "-"}
                          </TableCell>
                        )}
                        {showTypeColumn && (
                          <TableCell>
                            {isDex ? (
                              <Badge variant="secondary" className="text-xs">
                                {item.poolType || 'DEX'}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">
                                Lending
                              </Badge>
                            )}
                          </TableCell>
                        )}
                        <TableCell className="text-right">
                          <div>
                            {protocol ? (
                              isDex ? (
                                // Для DEX-пулов - прямая ссылка на пул
                                <Button
                                  variant="secondary"
                                  onClick={() => {
                                    if (item.protocol === 'Hyperion') {
                                      window.open(`https://hyperion.xyz/pool/${item.token}`, '_blank');
                                    } else if (item.protocol === 'Orca') {
                                      window.open(`https://www.orca.so/pools/${item.token}`, '_blank');
                                    } else if (item.protocol === 'Tapp Exchange') {
                                      window.open(`https://tapp.exchange/pool`, '_blank');
                                    } else if (item.protocol === 'Thala') {
                                      const poolAddress = (item as any).lptAddress || item.token;
                                      if (poolAddress) {
                                        window.open(`https://app.thala.fi/pools/${poolAddress}`, '_blank');
                                      }
                                    }
                                  }}
                                  className="w-full"
                                >
                                  Deposit
                                  <ExternalLink className="ml-2 h-4 w-4" />
                                </Button>
                              ) : (
                                // Для лендинговых пулов - обычная кнопка Deposit
                                <DepositButton
                                  protocol={protocol}
                                  className="w-full"
                                  tokenIn={{
                                    symbol:
                                      item.protocol === "Kamino"
                                        ? String(item.originalPool?.tokenSymbol ?? displaySymbol)
                                        : displaySymbol,
                                    logo: logoUrl || '/file.svg',
                                    decimals:
                                      protocol?.name === 'Jupiter' || protocol?.name === 'Kamino'
                                        ? (item.tokenDecimals ?? tokenInfo?.decimals ?? resolvedTokenInfo?.decimals ?? 6)
                                        : decimals,
                                    address:
                                      protocol?.name === 'Jupiter' ? item.token : depositTokenAddress
                                  }}
                                  balance={BigInt(1000000000)} // TODO: Get real balance
                                  priceUSD={
                                    protocol?.name === 'Jupiter'
                                      ? Number(tokenInfo?.usdPrice || 0)
                                      : priceUSD
                                  }
                                  solanaTokensOverride={solanaTokens}
                                  refreshSolanaOverride={refreshSolana}
                                  kaminoVaultAddress={
                                    item.protocol === 'Kamino' && item.originalPool?.vaultAddress
                                      ? String(item.originalPool.vaultAddress)
                                      : undefined
                                  }
                                  kaminoVaultLabel={
                                    item.protocol === "Kamino"
                                      ? String(item.originalPool?.tokenSymbol ?? displaySymbol)
                                      : undefined
                                  }
                                  kaminoDepositApy={item.protocol === 'Kamino' ? item.depositApy : undefined}
                                />
                              )
                            ) : (
                              <Button disabled className="w-full">
                                Protocol not found
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
            </div>
          </TooltipProvider>
          )}
          </>
        )}
      </Box>
    </div>
  );
}
