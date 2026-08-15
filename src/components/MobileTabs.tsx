"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import DashboardPanel from "./DashboardPanel";
import ChatPanelWrapper from "./ChatPanelWrapper";
import { WalletSelector } from "./WalletSelector";
import { PortfolioCard } from "./portfolio/PortfolioCard";
import { SolanaWalletCard } from "./portfolio/SolanaWalletCard";
import { SolanaSignMessageButton } from "./SolanaSignMessageButton";
import { PositionsList as HyperionPositionsList } from "./protocols/hyperion/PositionsList";
import { PositionsList as EchelonPositionsList } from "./protocols/echelon/PositionsList";
import { PositionsList as AriesPositionsList } from "./protocols/aries/PositionsList";
import { PositionsList as JoulePositionsList } from "./protocols/joule/PositionsList";
import { PositionsList as TappPositionsList } from "./protocols/tapp/PositionsList";
import { PositionsList as MesoPositionsList } from "./protocols/meso/PositionsList";
import { PositionsList as AuroPositionsList } from "./protocols/auro/PositionsList";
import { PositionsList as AmnisPositionsList } from "./protocols/amnis/PositionsList";
import { PositionsList as EarniumPositionsList } from "./protocols/earnium/PositionsList";
import { PositionsList as AavePositionsList } from "./protocols/aave/PositionsList";
import { PositionsList as MoarPositionsList } from "./protocols/moar/PositionsList";
import { PositionsList as ThalaPositionsList } from "./protocols/thala/PositionsList";
import { PositionsList as EchoPositionsList } from "./protocols/echo/PositionsList";
import { PositionsList as DecibelPositionsList } from "./protocols/decibel/PositionsList";
import { PositionsList as AptreePositionsList } from "./protocols/aptree/PositionsList";
import { PositionsList as JupiterPositionsList } from "./protocols/jupiter/PositionsList";
import { PositionsList as KaminoPositionsList } from "./protocols/kamino/PositionsList";
import { PositionsList as MeteoraPositionsList } from "./protocols/meteora/PositionsList";
import { PositionsList as RaydiumPositionsList } from "./protocols/raydium/PositionsList";
import { PositionsList as OrcaPositionsList } from "./protocols/orca/PositionsList";
import { PositionsList as TramplinPositionsList } from "./protocols/tramplin/PositionsList";
import { PositionsList as ExponentPositionsList } from "./protocols/exponent/PositionsList";
import { PositionsList as YieldAIPositionsList } from "./protocols/yield-ai/PositionsList";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useAptosNativeRestore } from "@/hooks/useAptosNativeRestore";
import { AptosPortfolioService } from "@/lib/services/aptos/portfolio";
import { Token } from "@/lib/types/token";
import { Logo } from "./ui/logo";
//import { AlphaBadge } from "./ui/alpha-badge";
import { CollapsibleProvider } from "@/contexts/CollapsibleContext";
import { MobileManagementProvider } from "@/contexts/MobileManagementContext";
import { useSolanaPortfolio } from "@/hooks/useSolanaPortfolio";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
import { ProtocolIcon } from "@/shared/ProtocolIcon/ProtocolIcon";
import { useEffectiveWalletAddresses } from "@/lib/hooks/useEffectiveWalletAddresses";
import { formatCurrency } from "@/lib/utils/numberFormat";
import { useAptosHasTransactions } from "@/lib/query/hooks/aptos/useAptosHasTransactions";
import { isDerivedAptosWalletReliable } from "@/lib/aptosWalletUtils";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { Button } from "./ui/button";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { CollapsibleControls } from "./ui/collapsible-controls";

function MobileTabsContent() {
  const [tab, setTab] = useState<"ideas" | "assets" | "chat">("assets");
  // Use native restore hook to ensure native Aptos wallets are reconnected
  const { account } = useAptosNativeRestore();
  // Also keep useWallet for other functionality
  const { wallet: aptosWallet } = useWallet(); // Keep adapter state synced
  const { effectiveAptosAddress, effectiveSolanaOverrideAddress } = useEffectiveWalletAddresses();
  const isAptosDerived = isDerivedAptosWalletReliable(aptosWallet);
  const aptosHasTxQuery = useAptosHasTransactions(effectiveAptosAddress ?? undefined, {
    enabled: Boolean(effectiveAptosAddress) && isAptosDerived,
  });
  const shouldCheckAptosProtocols = !isAptosDerived || Boolean(aptosHasTxQuery.data?.hasTransactions);
  const {
    address: solanaAddress,
    protocolsAddress: solanaProtocolsAddress,
    tokens: solanaTokens,
    totalValueUsd: solanaTotalValue,
    isLoading: isSolanaLoading,
    refresh: refreshSolana,
  } = useSolanaPortfolio({ overrideAddress: effectiveSolanaOverrideAddress });
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [totalValue, setTotalValue] = useState<string>("0");
  const [hyperionValue, setHyperionValue] = useState<number>(0);
  const [echelonValue, setEchelonValue] = useState<number>(0);
  const [ariesValue, setAriesValue] = useState<number>(0);
  const [jouleValue, setJouleValue] = useState<number>(0);
  const [tappValue, setTappValue] = useState<number>(0);
  const [mesoValue, setMesoValue] = useState<number>(0);
  const [auroValue, setAuroValue] = useState<number>(0);
  const [amnisValue, setAmnisValue] = useState<number>(0);
  const [earniumValue, setEarniumValue] = useState<number>(0);
  const [aaveValue, setAaveValue] = useState<number>(0);
  const [moarValue, setMoarValue] = useState<number>(0);
  const [thalaValue, setThalaValue] = useState<number>(0);
  const [echoValue, setEchoValue] = useState<number>(0);
  const [decibelValue, setDecibelValue] = useState<number>(0);
  const [aptreeValue, setAptreeValue] = useState<number>(0);
  const [yieldAIValue, setYieldAIValue] = useState<number>(0);
  const [jupiterValue, setJupiterValue] = useState<number>(0);
  const [kaminoValue, setKaminoValue] = useState<number>(0);
  const [meteoraValue, setMeteoraValue] = useState<number>(0);
  const [raydiumValue, setRaydiumValue] = useState<number>(0);
  const [orcaValue, setOrcaValue] = useState<number>(0);
  const [tramplinValue, setTramplinValue] = useState<number>(0);
  const [exponentValue, setExponentValue] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [checkingAptosProtocols, setCheckingAptosProtocols] = useState<string[]>([]);
  const [checkingSolanaProtocols, setCheckingSolanaProtocols] = useState<string[]>([]);
  const [aptosCheckRunId, setAptosCheckRunId] = useState(0);
  const [solanaCheckRunId, setSolanaCheckRunId] = useState(0);
  // Shared "hide small assets" state for both wallet cards (mirrors desktop Sidebar)
  const [hideSmallAssets, setHideSmallAssets] = useState(true);

  const APTOS_PROTOCOL_NAMES = [
    "Hyperion",
    "Echelon",
    "Aries",
    "Joule",
    "Tapp Exchange",
    "Meso Finance",
    "Auro Finance",
    "Amnis Finance",
    "Earnium",
    "Aave",
    "Moar Market",
    "Thala",
    "Echo Protocol",
    "Decibel",
    "APTree",
    "AI agent",
  ];
  const SOLANA_PROTOCOL_NAMES = ["Jupiter", "Kamino", "Meteora", "Raydium", "Orca", "Tramplin", "Exponent"];

  const resetAptosChecking = useCallback(() => {
    setAptosCheckRunId((x) => x + 1);
    setCheckingAptosProtocols(shouldCheckAptosProtocols ? [...APTOS_PROTOCOL_NAMES] : []);
  }, [shouldCheckAptosProtocols]);

  const resetSolanaChecking = useCallback(() => {
    setSolanaCheckRunId((x) => x + 1);
    setCheckingSolanaProtocols([...SOLANA_PROTOCOL_NAMES]);
  }, []);

  useEffect(() => {
    if (!effectiveAptosAddress || checkingAptosProtocols.length === 0) return;
    const runId = aptosCheckRunId;
    const t = window.setTimeout(() => {
      setCheckingAptosProtocols((prev) => (aptosCheckRunId === runId ? [] : prev));
    }, 30_000);
    return () => window.clearTimeout(t);
  }, [aptosCheckRunId, checkingAptosProtocols.length, effectiveAptosAddress]);

  useEffect(() => {
    if (!solanaAddress || checkingSolanaProtocols.length === 0) return;
    const runId = solanaCheckRunId;
    const t = window.setTimeout(() => {
      setCheckingSolanaProtocols((prev) => (solanaCheckRunId === runId ? [] : prev));
    }, 30_000);
    return () => window.clearTimeout(t);
  }, [solanaCheckRunId, checkingSolanaProtocols.length, solanaAddress]);

  // When set (e.g. "decibel" or "decibel,thala"), only these protocols are shown and fetched
  const debugProtocolKeys =
    typeof process.env.NEXT_PUBLIC_DEBUG_PROTOCOLS === "string"
      ? process.env.NEXT_PUBLIC_DEBUG_PROTOCOLS.split(",")
          .map((p) => p.trim().toLowerCase())
          .filter(Boolean)
      : null;

  // Функция для скролла к верху
  const scrollToTop = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    async function loadPortfolio() {
      if (!effectiveAptosAddress) return;

      try {
        const portfolioService = new AptosPortfolioService();
        const portfolio = await portfolioService.getPortfolio(effectiveAptosAddress);
        
        const total = portfolio.tokens.reduce((sum, token) => {
          const value = token.value ? parseFloat(token.value) : 0;
          return sum + (isNaN(value) ? 0 : value);
        }, 0);

        setTokens(portfolio.tokens);
        // Wallet tokens only — protocol position values are added once in aptosTotalMobile.
        setTotalValue(total.toFixed(2));
      } catch {
      }
    }

    loadPortfolio();
  }, [effectiveAptosAddress]);

  // In WebView mode, refresh read-only data after native wallet_connected.
  useEffect(() => {
    const onWalletChanged = () => {
      if (effectiveAptosAddress) resetAptosChecking();
      if (solanaAddress) resetSolanaChecking();
      // Fire-and-forget; individual hooks/services handle their own loading states.
      refreshSolana().catch(() => {});
    };
    window.addEventListener("yieldai:wallet-changed", onWalletChanged as EventListener);
    return () => window.removeEventListener("yieldai:wallet-changed", onWalletChanged as EventListener);
  }, [effectiveAptosAddress, refreshSolana, resetAptosChecking, resetSolanaChecking, solanaAddress]);

  useEffect(() => {
    if (effectiveAptosAddress) {
      resetAptosChecking();
    } else {
      setCheckingAptosProtocols([]);
    }
  }, [effectiveAptosAddress, resetAptosChecking]);

  useEffect(() => {
    if (!solanaAddress) {
      setCheckingSolanaProtocols([]);
      return;
    }
    resetSolanaChecking();
  }, [resetSolanaChecking, solanaAddress]);

  useEffect(() => {
    if (!solanaProtocolsAddress) {
      setJupiterValue(0);
      setKaminoValue(0);
      setMeteoraValue(0);
      setRaydiumValue(0);
      setOrcaValue(0);
      setTramplinValue(0);
      setExponentValue(0);
    }
  }, [solanaProtocolsAddress]);

  const resetProtocolValues = useCallback(() => {
    setHyperionValue(0);
    setEchelonValue(0);
    setAriesValue(0);
    setJouleValue(0);
    setTappValue(0);
    setMesoValue(0);
    setAuroValue(0);
    setEarniumValue(0);
    setAaveValue(0);
    setMoarValue(0);
    setThalaValue(0);
    setEchoValue(0);
    setDecibelValue(0);
    setAptreeValue(0);
    setYieldAIValue(0);
  }, []);

  useEffect(() => {
    resetProtocolValues();
  }, [effectiveAptosAddress, resetProtocolValues]);

  // Обработчики изменения суммы позиций в протоколах
  const handleHyperionValueChange = (value: number) => {
    setHyperionValue(value);
  };

  const handleEchelonValueChange = (value: number) => {
    setEchelonValue(value);
  };

  const handleAriesValueChange = (value: number) => {
    setAriesValue(value);
  };

  const handleJouleValueChange = (value: number) => {
    setJouleValue(value);
  };

  const handleTappValueChange = (value: number) => {
    setTappValue(value);
  };

  const handleMesoValueChange = (value: number) => {
    setMesoValue(value);
  };

  const handleAuroValueChange = (value: number) => {
    setAuroValue(value);
  };

  const handleAmnisValueChange = (value: number) => {
    setAmnisValue(value);
  };

  const handleEarniumValueChange = (value: number) => {
    setEarniumValue(value);
  };

  const handleAaveValueChange = (value: number) => {
    setAaveValue(value);
  };

  const handleMoarValueChange = (value: number) => {
    setMoarValue(value);
  };
  const handleThalaValueChange = (value: number) => {
    setThalaValue(value);
  };

  const handleEchoValueChange = (value: number) => {
    setEchoValue(value);
  };

  const handleDecibelValueChange = (value: number) => {
    setDecibelValue(value);
  };
  const handleAptreeValueChange = (value: number) => {
    setAptreeValue(value);
  };

  const handleYieldAIValueChange = (value: number) => {
    setYieldAIValue(value);
  };

  // Refresh function
  const handleRefresh = async () => {
    if (!account?.address) return;
    
    setIsRefreshing(true);
    try {
      const portfolioService = new AptosPortfolioService();
      const portfolio = await portfolioService.getPortfolio(account.address.toString());
      
      const total = portfolio.tokens.reduce((sum, token) => {
        const value = token.value ? parseFloat(token.value) : 0;
        return sum + (isNaN(value) ? 0 : value);
      }, 0);

      setTokens(portfolio.tokens);
      
      resetProtocolValues();
      if (effectiveAptosAddress) resetAptosChecking();
      if (solanaAddress) resetSolanaChecking();
      setRefreshKey((k) => k + 1);

      setTotalValue(total.toFixed(2));
    } catch (error) {
      console.error('Error refreshing portfolio:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleGlobalRefresh = async () => {
    if (effectiveAptosAddress) await handleRefresh();
    if (solanaAddress) await refreshSolana();
  };

  const aptosTotalMobile =
    (parseFloat(totalValue || "0") || 0) +
    [
      hyperionValue, echelonValue, ariesValue, jouleValue, tappValue, mesoValue,
      auroValue, amnisValue, earniumValue, aaveValue, moarValue, thalaValue,
      echoValue, decibelValue, aptreeValue, yieldAIValue,
    ].reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0);
  const solanaTotalMobile =
    (Number.isFinite(solanaTotalValue) ? (solanaTotalValue ?? 0) : 0) +
    [jupiterValue, kaminoValue, meteoraValue, raydiumValue, orcaValue, tramplinValue, exponentValue]
      .reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0);
  // Richer wallet first; on a tie (e.g. both empty) the wallet the user
  // connected themselves wins — a derived Aptos wallet goes below Solana.
  const aptosFirstMobile =
    aptosTotalMobile !== solanaTotalMobile
      ? aptosTotalMobile > solanaTotalMobile
      : !isAptosDerived;

  return (
    <MobileManagementProvider setActiveTab={setTab} scrollToTop={scrollToTop}>
      <CollapsibleProvider>
        <div className="flex flex-col min-h-screen max-h-screen w-full min-w-0 max-w-full overflow-x-hidden">
          {/* Header - fixed at top */}
          <div className="flex-shrink-0 p-4 border-b bg-background">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Logo size="md" />
                <div className="flex items-center gap-2 min-w-0">
                  <h1 className="text-xl font-bold truncate">Yield AI</h1>
                  { /*<AlphaBadge />*/ }
                </div>
              </div>

              <div className="shrink-0">
                <WalletSelector />
              </div>
            </div>
          </div>
          
          {/* Content area - scrollable */}
          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto min-h-0 pb-[calc(72px+env(safe-area-inset-bottom))] sm:pb-0">
            <div className={tab === "ideas" ? "block w-full max-w-full" : "hidden w-full max-w-full"}>
              <DashboardPanel />
            </div>
            <div className={tab === "assets" ? "block w-full max-w-full" : "hidden w-full max-w-full"}>
              <div className="p-4 flex flex-col gap-4 w-full max-w-full">
                {/* Global Assets header for both wallets (mirrors desktop Sidebar) */}
                {(effectiveAptosAddress || solanaAddress) && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-lg font-medium">Assets</span>
                      <span className="text-lg font-medium">
                        {formatCurrency(aptosTotalMobile + solanaTotalMobile, 2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Checkbox
                          id="hideSmallAssetsMobile"
                          checked={hideSmallAssets}
                          onCheckedChange={(checked) => setHideSmallAssets(!!checked)}
                        />
                        <Label htmlFor="hideSmallAssetsMobile" className="text-sm">
                          Hide assets {'<'}1$
                        </Label>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleGlobalRefresh}
                          disabled={isRefreshing || isSolanaLoading}
                          className="h-4 w-4 p-0 text-muted-foreground hover:bg-transparent hover:text-foreground/60 opacity-80 transition-colors"
                        >
                          <RefreshCw
                            className={cn(
                              "h-3 w-3",
                              (isRefreshing || isSolanaLoading) && "animate-spin"
                            )}
                          />
                        </Button>
                        <CollapsibleControls />
                      </div>
                    </div>
                  </div>
                )}
                {/* Aptos wallet card and protocols - only when Aptos is connected */}
                {effectiveAptosAddress && (
                  <div className={cn("space-y-4", aptosFirstMobile ? "order-1" : "order-2")}>
                    <PortfolioCard
                      totalValue={totalValue}
                      tokens={tokens}
                      onRefresh={handleRefresh}
                      isRefreshing={isRefreshing}
                      hasSolanaWallet={!!solanaAddress}
                      isDerived={isAptosDerived}
                      address={effectiveAptosAddress}
                      hideSmallAssets={hideSmallAssets}
                      onHideSmallAssetsChange={setHideSmallAssets}
                      showHeaderControls={false}
                    />
                    {checkingAptosProtocols.length > 0 && (
                      <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                        <span className="whitespace-nowrap">Checking positions on</span>
                        <div className="flex items-center gap-1">
                          {checkingAptosProtocols.map((name) => {
                            const proto = getProtocolByName(name);
                            const logo =
                              name === "Kamino" ? "/protocol_ico/kamino.png" : proto?.logoUrl || "/favicon.ico";
                            return (
                              <ProtocolIcon
                                key={name}
                                logoUrl={logo}
                                name={name}
                                size="sm"
                                isLoading={true}
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {shouldCheckAptosProtocols ? (() => {
                      const protocolItems = [
                        { component: HyperionPositionsList, value: hyperionValue, name: 'Hyperion', handler: handleHyperionValueChange },
                        { component: EchelonPositionsList, value: echelonValue, name: 'Echelon', handler: handleEchelonValueChange },
                        { component: AriesPositionsList, value: ariesValue, name: 'Aries', handler: handleAriesValueChange },
                        { component: JoulePositionsList, value: jouleValue, name: 'Joule', handler: handleJouleValueChange },
                        { component: TappPositionsList, value: tappValue, name: 'Tapp Exchange', handler: handleTappValueChange },
                        { component: MesoPositionsList, value: mesoValue, name: 'Meso Finance', handler: handleMesoValueChange },
                        { component: AuroPositionsList, value: auroValue, name: 'Auro Finance', handler: handleAuroValueChange },
                        { component: AmnisPositionsList, value: amnisValue, name: 'Amnis Finance', handler: handleAmnisValueChange },
                        { component: EarniumPositionsList, value: earniumValue, name: 'Earnium', handler: handleEarniumValueChange },
                        { component: AavePositionsList, value: aaveValue, name: 'Aave', handler: handleAaveValueChange },
                        { component: MoarPositionsList, value: moarValue, name: 'Moar Market', handler: handleMoarValueChange },
                        { component: ThalaPositionsList, value: thalaValue, name: 'Thala', handler: handleThalaValueChange },
                        { component: EchoPositionsList, value: echoValue, name: 'Echo Protocol', handler: handleEchoValueChange },
                        { component: DecibelPositionsList, value: decibelValue, name: 'Decibel', handler: handleDecibelValueChange },
                        { component: AptreePositionsList, value: aptreeValue, name: 'APTree', handler: handleAptreeValueChange },
                        { component: YieldAIPositionsList, value: yieldAIValue, name: 'AI agent', handler: handleYieldAIValueChange },
                      ];
                      const listToRender =
                        debugProtocolKeys?.length && debugProtocolKeys.length > 0
                          ? protocolItems.filter((item) => {
                              const key = getProtocolByName(item.name)?.key;
                              return key && debugProtocolKeys.includes(key.toLowerCase());
                            })
                          : protocolItems;
                      return listToRender
                        .sort((a, b) => b.value - a.value)
                        .map(({ component: Component, name, handler, value }) => (
                          <div
                            key={name}
                            // Hide small (<$1) cards when the toggle is on;
                            // collapse empty (no-position) wrappers with
                            // `contents` so they add no layout gap. The
                            // component stays mounted to keep reporting value.
                            className={cn(
                              hideSmallAssets && value < 1
                                ? "hidden"
                                : value === 0
                                  ? "contents"
                                  : undefined
                            )}
                          >
                          <Component
                            address={effectiveAptosAddress}
                            onPositionsValueChange={handler}
                            walletTokens={tokens}
                            refreshKey={refreshKey}
                            onPositionsCheckComplete={() => {
                              const runId = aptosCheckRunId;
                              setCheckingAptosProtocols((prev) => {
                                if (aptosCheckRunId !== runId) return prev;
                                if (!prev.includes(name)) return prev;
                                return prev.filter((p) => p !== name);
                              });
                            }}
                          />
                          </div>
                        ));
                    })() : null}
                  </div>
                )}

                {/* Solana wallet card - INDEPENDENT of Aptos */}
                {solanaAddress && (
                  <div className={cn("space-y-2", aptosFirstMobile ? "order-2" : "order-1")}>
                    <SolanaWalletCard
                      tokens={solanaTokens}
                      totalValueUsd={solanaTotalValue}
                      onRefresh={refreshSolana}
                      isRefreshing={isSolanaLoading}
                      hideSmallAssets={hideSmallAssets}
                      onHideSmallAssetsChange={setHideSmallAssets}
                    />
                    {checkingSolanaProtocols.length > 0 && (
                      <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                        <span className="whitespace-nowrap">Checking positions on</span>
                        <div className="flex items-center gap-1">
                          {checkingSolanaProtocols.map((name) => {
                            const proto = getProtocolByName(name);
                            const logo =
                              name === "Kamino" ? "/protocol_ico/kamino.png" : proto?.logoUrl || "/favicon.ico";
                            return (
                              <ProtocolIcon
                                key={name}
                                logoUrl={logo}
                                name={name}
                                size="sm"
                                isLoading={true}
                              />
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {(
                      [
                        {
                          name: "Jupiter" as const,
                          value: jupiterValue,
                          component: (
                            <JupiterPositionsList
                              key="Jupiter"
                              address={solanaProtocolsAddress ?? undefined}
                              onPositionsValueChange={(v) => setJupiterValue(Number.isFinite(v) ? v : 0)}
                              onPositionsCheckComplete={() => {
                                const runId = solanaCheckRunId;
                                setCheckingSolanaProtocols((prev) => (solanaCheckRunId === runId ? prev.filter((p) => p !== "Jupiter") : prev));
                              }}
                            />
                          ),
                        },
                        {
                          name: "Kamino" as const,
                          value: kaminoValue,
                          component: (
                            <KaminoPositionsList
                              key="Kamino"
                              address={solanaProtocolsAddress ?? undefined}
                              onPositionsValueChange={(v) => setKaminoValue(Number.isFinite(v) ? v : 0)}
                              onPositionsCheckComplete={() => {
                                const runId = solanaCheckRunId;
                                setCheckingSolanaProtocols((prev) => (solanaCheckRunId === runId ? prev.filter((p) => p !== "Kamino") : prev));
                              }}
                            />
                          ),
                        },
                        {
                          name: "Meteora" as const,
                          value: meteoraValue,
                          component: (
                            <MeteoraPositionsList
                              key="Meteora"
                              address={solanaProtocolsAddress ?? undefined}
                              onPositionsValueChange={(v) => setMeteoraValue(Number.isFinite(v) ? v : 0)}
                              onPositionsCheckComplete={() => {
                                const runId = solanaCheckRunId;
                                setCheckingSolanaProtocols((prev) => (solanaCheckRunId === runId ? prev.filter((p) => p !== "Meteora") : prev));
                              }}
                            />
                          ),
                        },
                        {
                          name: "Raydium" as const,
                          value: raydiumValue,
                          component: (
                            <RaydiumPositionsList
                              key="Raydium"
                              address={solanaProtocolsAddress ?? undefined}
                              onPositionsValueChange={(v) => setRaydiumValue(Number.isFinite(v) ? v : 0)}
                              onPositionsCheckComplete={() => {
                                const runId = solanaCheckRunId;
                                setCheckingSolanaProtocols((prev) => (solanaCheckRunId === runId ? prev.filter((p) => p !== "Raydium") : prev));
                              }}
                            />
                          ),
                        },
                        {
                          name: "Orca" as const,
                          value: orcaValue,
                          component: (
                            <OrcaPositionsList
                              key="Orca"
                              address={solanaProtocolsAddress ?? undefined}
                              onPositionsValueChange={(v) => setOrcaValue(Number.isFinite(v) ? v : 0)}
                              onPositionsCheckComplete={() => {
                                const runId = solanaCheckRunId;
                                setCheckingSolanaProtocols((prev) => (solanaCheckRunId === runId ? prev.filter((p) => p !== "Orca") : prev));
                              }}
                            />
                          ),
                        },
                        {
                          name: "Tramplin" as const,
                          value: tramplinValue,
                          component: (
                            <TramplinPositionsList
                              key="Tramplin"
                              address={solanaProtocolsAddress ?? undefined}
                              onPositionsValueChange={(v) => setTramplinValue(Number.isFinite(v) ? v : 0)}
                              onPositionsCheckComplete={() => {
                                const runId = solanaCheckRunId;
                                setCheckingSolanaProtocols((prev) => (solanaCheckRunId === runId ? prev.filter((p) => p !== "Tramplin") : prev));
                              }}
                            />
                          ),
                        },
                        {
                          name: "Exponent" as const,
                          value: exponentValue,
                          component: (
                            <ExponentPositionsList
                              key="Exponent"
                              address={solanaProtocolsAddress ?? undefined}
                              onPositionsValueChange={(v) => setExponentValue(Number.isFinite(v) ? v : 0)}
                              onPositionsCheckComplete={() => {
                                const runId = solanaCheckRunId;
                                setCheckingSolanaProtocols((prev) => (solanaCheckRunId === runId ? prev.filter((p) => p !== "Exponent") : prev));
                              }}
                            />
                          ),
                        },
                      ] as const
                    )
                      .slice()
                      .sort((a, b) => b.value - a.value)
                      .map((x) => (
                        <div
                          key={x.name}
                          // See Aptos block above: hide <$1 cards when the
                          // toggle is on, collapse empty wrappers so no gap.
                          className={cn(
                            hideSmallAssets && x.value < 1
                              ? "hidden"
                              : x.value === 0
                                ? "contents"
                                : undefined
                          )}
                        >
                          {x.component}
                        </div>
                      ))}
                    <SolanaSignMessageButton />
                  </div>
                )}
                
                {/* Message when no wallets connected */}
                {!effectiveAptosAddress && !solanaAddress && (
                  <div className="mt-6 p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      Connect your Aptos or Solana wallet to view your assets and positions in DeFi protocols
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className={tab === "chat" ? "block" : "hidden"}>
              <ChatPanelWrapper />
            </div>
            {/* Spacer to ensure content never hides under bottom nav */}
            <div className="h-[calc(72px+env(safe-area-inset-bottom))] sm:h-0" />
          </div>
          
          {/* Bottom navigation - fixed at bottom */}
          <div className="flex-shrink-0 flex border-t bg-background safe-area-bottom mobile-bottom-nav">
            <button
              className={`flex-1 p-4 text-center transition-colors cursor-pointer ${tab === "ideas" ? "text-primary bg-primary/5" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setTab("ideas")}
            >
              <div className="flex flex-col items-center gap-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <span className="text-xs font-medium">Ideas</span>
              </div>
            </button>
            <button
              className={`flex-1 p-4 text-center transition-colors cursor-pointer ${tab === "assets" ? "text-primary bg-primary/5" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setTab("assets")}
            >
              <div className="flex flex-col items-center gap-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-xs font-medium">Assets</span>
              </div>
            </button>
            <button
              className={`flex-1 p-4 text-center transition-colors cursor-pointer ${tab === "chat" ? "text-primary bg-primary/5" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setTab("chat")}
            >
              <div className="flex flex-col items-center gap-1">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-xs font-medium">Tools</span>
              </div>
            </button>
          </div>
        </div>
      </CollapsibleProvider>
    </MobileManagementProvider>
  );
}

export default function MobileTabs() {
  return <MobileTabsContent />;
} 
