"use client";
import { PortfolioPageCard } from "./portfolio/PortfolioPageCard";
import { PortfolioPageSkeleton } from "./portfolio/PortfolioPageSkeleton";
import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { AptosPortfolioService } from "@/lib/services/aptos/portfolio";
import { Token } from "@/lib/types/token";
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PortfolioChart } from './chart/PortfolioChart';
import { ArrowLeft, Wallet, ImageDown } from 'lucide-react';
import { cn } from "@/lib/utils";
import { CollapsibleProvider } from "@/contexts/CollapsibleContext";
import { PortfolioAmountsPrivacyProvider } from "@/contexts/PortfolioAmountsPrivacyContext";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";
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
import { PositionsList as YieldAIPositionsList } from "./protocols/yield-ai/PositionsList";
import { CardTitle } from '@/components/ui/card';
import { usePortfolioAddressResolver } from '@/lib/hooks/usePortfolioAddressResolver';
import { YieldCalculatorModal } from '@/components/ui/yield-calculator-modal';
import { useWalletStore } from "@/lib/stores/walletStore";
import { ProtocolIcon } from "@/shared/ProtocolIcon/ProtocolIcon";
import { SolanaWalletCard } from "./portfolio/SolanaWalletCard";
import { PortfolioWalletAddressBar } from "./portfolio/PortfolioWalletAddressBar";
import { SolanaSignMessageButton } from "./SolanaSignMessageButton";
import { useSolanaPortfolio } from "@/hooks/useSolanaPortfolio";
import { useAptosNativeRestore } from "@/hooks/useAptosNativeRestore";
import { getTokenUsdValue } from "@/lib/utils/tokenUsdValue";


export default function PortfolioPage() {

   useEffect(() => {
    const forceScroll = () => {
      if (window.innerWidth <= 767) {
        document.body.style.overflowY = 'auto';
      }
    };

    forceScroll();
    window.addEventListener('resize', forceScroll);

    return () => window.removeEventListener('resize', forceScroll);
  }, []);

  const [tokens, setTokens] = useState<Token[]>([]);
  const { address: connectedAptosAddress } = useAptosNativeRestore();
  const [hyperionValue, setHyperionValue] = useState(0);
  const [echelonValue, setEchelonValue] = useState(0);
  const [ariesValue, setAriesValue] = useState(0);
  const [jouleValue, setJouleValue] = useState(0);
  const [tappValue, setTappValue] = useState(0);
  const [mesoValue, setMesoValue] = useState(0);
  const [auroValue, setAuroValue] = useState(0);
  const [amnisValue, setAmnisValue] = useState(0);
  const [earniumValue, setEarniumValue] = useState(0);
  const [aaveValue, setAaveValue] = useState(0);
  const [moarValue, setMoarValue] = useState(0);
  const [thalaValue, setThalaValue] = useState(0);
  const [echoValue, setEchoValue] = useState(0);
  const [decibelValue, setDecibelValue] = useState(0);
  const [decibelMainnetValue, setDecibelMainnetValue] = useState(0);
  const [aptreeValue, setAptreeValue] = useState(0);
  const [jupiterValue, setJupiterValue] = useState(0);
  const [kaminoValue, setKaminoValue] = useState(0);
  const [yieldAIValue, setYieldAIValue] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [checkingProtocols, setCheckingProtocols] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isYieldCalcOpen, setIsYieldCalcOpen] = useState(false);
  const [hideSmallAssets, setHideSmallAssets] = useState(true);
  const setTotalAssetsStore = useWalletStore((s) => s.setTotalAssets);

  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeAddress = ((params?.address as string | undefined) ?? "").trim();
  const queryAddress = (searchParams?.get("address") || "").trim();
  const requestedAddress = routeAddress || queryAddress;
  const isTrackerMode = requestedAddress.toLowerCase() === "tracker";
  const input = isTrackerMode ? (connectedAptosAddress || "") : requestedAddress;

  const [aptosResolveInput, setAptosResolveInput] = useState(input);
  useEffect(() => {
    setAptosResolveInput(input);
  }, [input]);

  const [aptosDraft, setAptosDraft] = useState("");
  const [solanaManual, setSolanaManual] = useState<string | null>(null);
  const [solanaDraft, setSolanaDraft] = useState("");
  const [solanaFieldError, setSolanaFieldError] = useState("");

  useEffect(() => {
    setSolanaManual(null);
    setSolanaDraft("");
    setSolanaFieldError("");
    setAptosDraft("");
  }, [input, requestedAddress]);

  const allowEmptyAptosResolver = isTrackerMode && !aptosResolveInput.trim();

  /** Solana-from-aptos-line only when the page slug is that same value (shared /portfolio/:address). */
  const acceptSolanaFromAptosInput =
    !isTrackerMode &&
    requestedAddress.trim() !== "" &&
    requestedAddress.trim() === aptosResolveInput.trim();

  const {
    aptosAddress: resolvedAptosAddress,
    solanaUrlAddress,
    aptosAnsLabel,
    solanaDomainLabel,
    isLoading: addrResolveLoading,
    error: resolveError,
    solanaOnlyAsAptosInput,
  } = usePortfolioAddressResolver(aptosResolveInput, {
    allowEmpty: allowEmptyAptosResolver,
    acceptSolanaFromAptosInput,
  });

  const resolveErrorIsFromRouteSlug =
    !isTrackerMode &&
    requestedAddress.trim() !== "" &&
    requestedAddress.trim() === aptosResolveInput.trim();

  const aptosFieldError =
    (solanaOnlyAsAptosInput ? "Invalid Aptos wallet address or domain format" : "") ||
    (!resolveErrorIsFromRouteSlug && resolveError && aptosResolveInput.trim() ? resolveError : "");

  const solanaHookOverride =
    solanaManual !== null ? solanaManual : isTrackerMode ? null : solanaUrlAddress;

  const {
    address: solanaAddress,
    protocolsAddress: solanaProtocolsAddress,
    tokens: solanaTokens,
    totalValueUsd: solanaTotalValue,
    isLoading: isSolanaLoading,
    refresh: refreshSolana,
  } = useSolanaPortfolio({ overrideAddress: solanaHookOverride });

  const applyAptosFromField = useCallback(() => {
    const t = aptosDraft.trim();
    if (!t) {
      setAptosResolveInput(input);
      return;
    }
    setAptosResolveInput(t);
  }, [aptosDraft, input]);

  const applySolanaFromField = useCallback(async () => {
    setSolanaFieldError("");
    const t = solanaDraft.trim();
    if (!t) {
      setSolanaManual(null);
      setSolanaDraft("");
      return;
    }
    try {
      const res = await fetch("/api/portfolio/resolve-input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: t }),
      });
      const data = (await res.json()) as { solanaAddress?: string; aptosAddress?: string; error?: string };
      if (!res.ok) {
        setSolanaFieldError(
          res.status === 404 ? "Address or domain not found" : "Invalid Solana wallet address",
        );
        return;
      }
      if (data.solanaAddress) {
        setSolanaManual(data.solanaAddress);
        return;
      }
      if (data.aptosAddress) {
        setSolanaFieldError("Invalid Solana wallet address");
        return;
      }
      setSolanaFieldError("Invalid Solana wallet address");
    } catch {
      setSolanaFieldError("Could not resolve");
    }
  }, [solanaDraft]);

  const formatAddress = (addr: string) => {
    return `${addr.slice(0, 8)}...${addr.slice(-8)}`;
  };

  const hasAnyPortfolio = !!(resolvedAptosAddress || solanaAddress);
  const showPortfolioShell = hasAnyPortfolio || isTrackerMode;
  const aptosBarPlaceholder =
    resolvedAptosAddress.length >= 16 ? formatAddress(resolvedAptosAddress) : "Aptos address or .apt domain";
  const solanaBarPlaceholder =
    solanaAddress && solanaAddress.length >= 16 ? formatAddress(solanaAddress) : "Solana address";
  const showChartDownload = showPortfolioShell;
  const mobileChartRef = useRef<HTMLDivElement | null>(null);
  const desktopChartRef = useRef<HTMLDivElement | null>(null);

  const downloadPortfolioChartPng = useCallback(async () => {
    if (typeof window === "undefined") return;

    const isVisible = (node: HTMLDivElement | null) =>
      !!node && node.offsetParent !== null && node.getClientRects().length > 0;

    const node = (isVisible(desktopChartRef.current) ? desktopChartRef.current : mobileChartRef.current) ??
      desktopChartRef.current ??
      mobileChartRef.current;

    if (!node) return;

    const { toPng } = await import("html-to-image");
    const dataUrl = await toPng(node, { cacheBust: true, pixelRatio: 2, backgroundColor: "#ffffff" });

    const a = document.createElement("a");
    const date = new Date();
    const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    a.download = `portfolio-chart-${ymd}.png`;
    a.href = dataUrl;
    a.click();
  }, []);

  const isInitialLoading = addrResolveLoading || isRefreshing;

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
  const SOLANA_PROTOCOL_NAMES = ["Jupiter", "Kamino"];

  const resetChecking = useCallback(() => {
    const next: string[] = [];
    if (resolvedAptosAddress) next.push(...APTOS_PROTOCOL_NAMES);
    if (solanaProtocolsAddress) next.push(...SOLANA_PROTOCOL_NAMES);
    setCheckingProtocols(next);
  }, [resolvedAptosAddress, solanaProtocolsAddress]);

  const loadPortfolio = useCallback(async () => {
    if (!resolvedAptosAddress) {
      setTokens([]);
      return;
    }

    try {
      setIsRefreshing(true);
      const portfolioService = new AptosPortfolioService();
      const portfolio = await portfolioService.getPortfolio(resolvedAptosAddress);
      setTokens(portfolio.tokens);

    } catch (error) {
      console.error('Error loading portfolio:', error);
      setTokens([]);
    } finally {
      setIsRefreshing(false);
    }
  }, [resolvedAptosAddress]);

  const handleRefresh = useCallback(async () => {
    await loadPortfolio();
    await refreshSolana();
    setHyperionValue(0);
    setEchelonValue(0);
    setAriesValue(0);
    setJouleValue(0);
    setTappValue(0);
    setMesoValue(0);
    setAuroValue(0);
    setAmnisValue(0);
    setEarniumValue(0);
    setAaveValue(0);
    setMoarValue(0);
    setThalaValue(0);
    setEchoValue(0);
    setDecibelValue(0);
    setDecibelMainnetValue(0);
    setAptreeValue(0);
    setJupiterValue(0);
    setKaminoValue(0);
    setYieldAIValue(0);
    resetChecking();
    setRefreshKey((k) => k + 1);
  }, [loadPortfolio, refreshSolana, resetChecking]);

  useEffect(() => {
    void loadPortfolio();
  }, [loadPortfolio]);

  useEffect(() => {
    if (resolvedAptosAddress || solanaProtocolsAddress) {
      resetChecking();
    } else {
      setCheckingProtocols([]);
    }
  }, [resolvedAptosAddress, solanaProtocolsAddress, resetChecking]);

  useEffect(() => {
    if (!solanaProtocolsAddress) {
      setJupiterValue(0);
      setKaminoValue(0);
    }
  }, [solanaProtocolsAddress]);

  // Handle query parameter to open calculator
  useEffect(() => {
    if (!searchParams) return;
    const calculatorParam = searchParams.get('calculator');
    if (calculatorParam === 'true') {
      setIsYieldCalcOpen(true);
    }
  }, [searchParams]);

  // Handle closing calculator and removing query parameter
  const handleCloseCalculator = useCallback(() => {
    setIsYieldCalcOpen(false);
    // Remove calculator parameter from URL
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.delete('calculator');
    params.delete('apr');
    params.delete('deposit');
    const newSearch = params.toString();
    const newUrl = newSearch ? `${window.location.pathname}?${newSearch}` : window.location.pathname;
    router.replace(newUrl);
  }, [searchParams, router]);

  const handleHyperionValueChange = useCallback((value: number) => {
    setHyperionValue(value);
  }, []);

  const handleEchelonValueChange = useCallback((value: number) => {
    setEchelonValue(value);
  }, []);

  const handleAriesValueChange = useCallback((value: number) => {
    setAriesValue(value);
  }, []);

  const handleJouleValueChange = useCallback((value: number) => {
    setJouleValue(value);
  }, []);

  const handleTappValueChange = useCallback((value: number) => {
    setTappValue(value);
  }, []);

  const handleMesoValueChange = useCallback((value: number) => {
    setMesoValue(value);
  }, []);

  const handleAuroValueChange = useCallback((value: number) => {
    setAuroValue(value);
  }, []);

  const handleAmnisValueChange = useCallback((value: number) => {
    setAmnisValue(value);
  }, []);
  const handleEarniumValueChange = useCallback((value: number) => {
    setEarniumValue(value);
  }, []);

  const handleAaveValueChange = useCallback((value: number) => {
    setAaveValue(value);
  }, []);

  const handleMoarValueChange = useCallback((value: number) => {
    setMoarValue(value);
  }, []);
  const handleThalaValueChange = useCallback((value: number) => {
    setThalaValue(value);
  }, []);
  const handleEchoValueChange = useCallback((value: number) => {
    setEchoValue(value);
  }, []);

  const handleDecibelValueChange = useCallback((value: number) => {
    setDecibelValue(value);
  }, []);
  const handleDecibelMainnetValueChange = useCallback((value: number) => {
    setDecibelMainnetValue(value);
  }, []);
  const handleAptreeValueChange = useCallback((value: number) => {
    setAptreeValue(value);
  }, []);
  const handleYieldAIValueChange = useCallback((value: number) => {
    setYieldAIValue(value);
  }, []);
  const handleJupiterValueChange = useCallback((value: number) => {
    setJupiterValue(value);
  }, []);

  const handleKaminoValueChange = useCallback((value: number) => {
    setKaminoValue(Number.isFinite(value) ? value : 0);
  }, []);

  // Считаем сумму по кошельку (value или amount × price — как в Solana)
  const walletTotal = tokens.reduce((sum, token) => {
    const value = getTokenUsdValue(token);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  // Считаем сумму по всем протоколам (Decibel: full assets when available, else pre-deposit fallback)
  const decibelTotal = decibelValue > 0 ? decibelValue : decibelMainnetValue;
  const totalProtocolsValue =
    hyperionValue +
    echelonValue +
    ariesValue +
    jouleValue +
    tappValue +
    mesoValue +
    auroValue +
    amnisValue +
    earniumValue +
    aaveValue +
    moarValue +
    thalaValue +
    echoValue +
    decibelTotal +
    aptreeValue +
    yieldAIValue;

  // Итоговая сумма
  const totalAssets = walletTotal + totalProtocolsValue;
  const chartTotalAssets = totalAssets + (solanaTotalValue ?? 0) + jupiterValue + kaminoValue;

  useEffect(() => {
    setTotalAssetsStore(totalAssets);
  }, [totalAssets, setTotalAssetsStore]);

  // Данные для чарта: кошелек + каждый протокол отдельным сектором
  const chartSectors = [
    { name: 'Aptos Wallet', value: walletTotal },
    { name: 'Solana Wallet', value: solanaTotalValue ?? 0 },
    { name: 'Hyperion', value: hyperionValue },
    { name: 'Echelon', value: echelonValue },
    { name: 'Aries', value: ariesValue },
    { name: 'Joule', value: jouleValue },
    { name: 'Tapp Exchange', value: tappValue },
    { name: 'Meso Finance', value: mesoValue },
    { name: 'Auro Finance', value: auroValue },
    { name: 'Amnis Finance', value: amnisValue },
    { name: 'Earnium', value: earniumValue },
    { name: 'Aave', value: aaveValue },
    { name: 'Moar Market', value: moarValue },
    { name: 'Thala', value: thalaValue },
    { name: 'Echo Protocol', value: echoValue },
    { name: 'Decibel', value: decibelTotal },
    { name: 'APTree', value: aptreeValue },
    { name: 'Jupiter', value: jupiterValue },
    { name: 'Kamino', value: kaminoValue, color: '#000000' },
    { name: 'AI agent', value: yieldAIValue },
  ];

  if (resolveError && resolveErrorIsFromRouteSlug && !addrResolveLoading) {
    return (
      <CollapsibleProvider>
        <div className="container mx-auto px-4 py-8 max-w-lg">
          <Button variant="ghost" onClick={() => router.push("/")} className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div className="p-4 rounded-lg border border-red-200 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900">
            {resolveError}
          </div>
        </div>
      </CollapsibleProvider>
    );
  }

  if (isInitialLoading && input) {
    return (
      <CollapsibleProvider>
        <PortfolioPageSkeleton />
      </CollapsibleProvider>
    );
  }

  return (
	<CollapsibleProvider>
	  <PortfolioAmountsPrivacyProvider>
	  <div className="container mx-auto px-4 py-4">

	    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="w-full">

	        <div className="max-w-4xl mx-auto space-y-6">

			  <div className="container mx-auto">
                <div className="mx-auto">
                  <div className="flex items-left">
                    <Button
                      variant="ghost"
                      onClick={() => router.push('/')}
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Yield AI Dashboard — manage your portfolio
                    </Button>
                  </div>
                </div>
              </div>

              <div className="min-h-screen to-slate-100 dark:from-slate-900 dark:to-slate-800">
                <div className="flex-1 overflow-y-auto mt-1 mx-4 mb-4">
                  {showPortfolioShell ? (
                    <>

					<div className="mt-2 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900">
                            <Wallet className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                          </div>
                          <div>
                            <CardTitle className="text-xl pt-2 ml-2">Portfolio</CardTitle>
                          </div>
                        </div>
                        {resolvedAptosAddress ? (
                        <Button
                          variant="outline"
                          onClick={() => setIsYieldCalcOpen(true)}
                          className="flex items-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          Yield Calculator
                        </Button>
                        ) : null}
                      </div>
			        </div>

				    {aptosAnsLabel ? (
				      <div className="mt-2 px-2">
				        <div className="flex items-center gap-2 text-sm text-muted-foreground">
				          <span className="font-medium">Aptos name:</span>
				          <span className="font-mono bg-muted px-2 py-1 rounded text-foreground">
				            {aptosAnsLabel}
				          </span>
				        </div>
				      </div>
				    ) : null}
				    {solanaDomainLabel ? (
				      <div className="mt-2 px-2">
				        <div className="flex items-center gap-2 text-sm text-muted-foreground">
				          <span className="font-medium">Solana domain:</span>
				          <span className="font-mono bg-muted px-2 py-1 rounded text-foreground">
				            {solanaDomainLabel}
				          </span>
				        </div>
				      </div>
				    ) : null}

				    <div className="block lg:hidden mb-4">
				      <div className="flex flex-col items-center justify-center">
                <div ref={mobileChartRef} className="flex items-center justify-center pr-4">
                  <PortfolioChart
                    data={chartSectors}
                    totalValue={chartTotalAssets.toString()}
                    isLoading={checkingProtocols.length > 0 || isRefreshing}
                  />
                </div>
                {showChartDownload ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void downloadPortfolioChartPng()}
                    className="mt-3 gap-2 touch-manipulation min-h-10 px-4"
                    title="Save chart as PNG"
                    aria-label="Save chart as PNG"
                  >
                    <ImageDown className="h-4 w-4 shrink-0" />
                    <span className="text-sm font-medium">Save PNG</span>
                  </Button>
                ) : null}
              </div>
			      </div>

				    <div className="flex flex-col lg:flex-row gap-4">
				      <div className="flex-1">
                        <div className="mt-2 space-y-4">
                          {(resolvedAptosAddress || isTrackerMode) ? (
                          <PortfolioPageCard
                            totalValue={totalAssets.toString()}
                            tokens={tokens}
                            onRefresh={handleRefresh}
                            isRefreshing={isRefreshing}
                            hideSmallAssets={hideSmallAssets}
                            onHideSmallAssetsChange={setHideSmallAssets}
                            walletAddress={resolvedAptosAddress}
                            explorerUrl={
                              resolvedAptosAddress
                                ? `https://explorer.aptoslabs.com/account/${resolvedAptosAddress}`
                                : ""
                            }
                            addressBarEditable={true}
                            addressDraft={aptosDraft}
                            onAddressDraftChange={setAptosDraft}
                            onAddressApply={applyAptosFromField}
                            addressPlaceholder={aptosBarPlaceholder}
                            addressApplyLabel="Load portfolio for this Aptos address or domain"
                            addressFieldError={aptosFieldError}
                          />
                          ) : null}
                          {checkingProtocols.length > 0 && (
                            <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                              <span className="whitespace-nowrap">Checking positions on</span>
                              <div className="flex items-center gap-1">
                                {checkingProtocols.map((name) => {
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
                          {resolvedAptosAddress ? [
                            {
					          component: HyperionPositionsList,
					          value: hyperionValue,
					          name: 'Hyperion',
					          showManageButton: false
					        },
                            {
					          component: EchelonPositionsList,
					          value: echelonValue,
					          name: 'Echelon',
					          showManageButton: false
					        },
                            {
					          component: AriesPositionsList,
					          value: ariesValue,
					          name: 'Aries',
					          showManageButton: false
					        },
                            {
					          component: JoulePositionsList,
					          value: jouleValue,
					          name: 'Joule',
					          showManageButton: false
					        },
                            {
					          component: TappPositionsList,
					          value: tappValue,
					          name: 'Tapp Exchange',
					          showManageButton: false
					        },
                            {
					          component: MesoPositionsList,
					          value: mesoValue,
					          name: 'Meso Finance',
					          showManageButton: false
					        },
                            {
					          component: AuroPositionsList,
					          value: auroValue,
					          name: 'Auro Finance',
					          showManageButton: false
					        },
                            {
					          component: AmnisPositionsList,
					          value: amnisValue,
					          name: 'Amnis Finance',
					          showManageButton: false
					        },
                            {
					          component: EarniumPositionsList,
					          value: earniumValue,
					          name: 'Earnium',
					          showManageButton: false
					        },
                            {
					          component: AavePositionsList,
					          value: aaveValue,
					          name: 'Aave',
					          showManageButton: false
					        },
                            {
					          component: MoarPositionsList,
					          value: moarValue,
					          name: 'Moar Market',
					          showManageButton: false
					        },
                            {
					          component: ThalaPositionsList,
					          value: thalaValue,
					          name: 'Thala',
					          showManageButton: false
					        },
                            {
					          component: EchoPositionsList,
					          value: echoValue,
					          name: 'Echo Protocol',
					          showManageButton: false
					        },
                            {
					          component: DecibelPositionsList,
					          value: decibelValue,
					          name: 'Decibel',
					          showManageButton: false
					        },
                            {
					          component: AptreePositionsList,
					          value: aptreeValue,
					          name: 'APTree',
					          showManageButton: false
					        },
                            {
					          component: YieldAIPositionsList,
					          value: yieldAIValue,
					          name: 'AI agent',
					          showManageButton: false
					        },
                          ]
                          .sort((a, b) => b.value - a.value)
                          .map(({ component: Component, name }) => (
                            <Component
                              key={name}
                              address={resolvedAptosAddress ?? ""}
                              walletTokens={tokens}
                              refreshKey={refreshKey}
						      showManageButton={false}
                              onPositionsValueChange={
                                name === 'Hyperion' ? handleHyperionValueChange :
                                name === 'Echelon' ? handleEchelonValueChange :
                                name === 'Aries' ? handleAriesValueChange :
                                name === 'Joule' ? handleJouleValueChange :
                                name === 'Tapp Exchange' ? handleTappValueChange :
                                name === 'Meso Finance' ? handleMesoValueChange :
                                name === 'Auro Finance' ? handleAuroValueChange :
                                name === 'Amnis Finance' ? handleAmnisValueChange :
                                name === 'Earnium' ? handleEarniumValueChange :
                                name === 'Aave' ? handleAaveValueChange :
                                name === 'Moar Market' ? handleMoarValueChange :
                                name === 'Thala' ? handleThalaValueChange :
                                name === 'Echo Protocol' ? handleEchoValueChange :
                                name === 'Decibel' ? handleDecibelValueChange :
                                name === 'APTree' ? handleAptreeValueChange :
                                name === 'AI agent' ? handleYieldAIValueChange :
                                undefined
                              }
                              onMainnetValueChange={name === 'Decibel' ? handleDecibelMainnetValueChange : undefined}
                              onPositionsCheckComplete={() =>
                                setCheckingProtocols((prev) => prev.filter((p) => p !== name))
                              }
                            />
                          )) : null}
                        </div>
				      </div>
                    </div>
                    </>
                  ) : (
                    <div className="mt-4 p-4 bg-muted rounded-lg">
                      <p className="text-sm text-muted-foreground">
                        Enter a valid Aptos or Solana address or domain to view portfolio
                      </p>
                    </div>
                  )}
                  {/* Solana: поле адреса и в трекере без кошелька */}
                  {(isTrackerMode || solanaAddress) && (
                    <div className="space-y-2 mt-6">
                      <PortfolioWalletAddressBar
                        resolvedAddress={solanaAddress ?? ""}
                        explorerUrl={
                          solanaAddress ? `https://solscan.io/account/${solanaAddress}` : ""
                        }
                        explorerOpenLabel="View on Solscan"
                        editable={true}
                        draft={solanaDraft}
                        onDraftChange={setSolanaDraft}
                        onApply={() => void applySolanaFromField()}
                        placeholder={solanaBarPlaceholder}
                        applyLabel="Load portfolio for this Solana address"
                      />
                      {solanaFieldError ? (
                        <p className="text-sm text-destructive px-1">{solanaFieldError}</p>
                      ) : null}
                      <SolanaWalletCard
                        tokens={solanaTokens}
                        totalValueUsd={solanaTotalValue}
                        onRefresh={refreshSolana}
                        isRefreshing={isSolanaLoading}
                        hideSmallAssets={hideSmallAssets}
                        onHideSmallAssetsChange={setHideSmallAssets}
                      />
                      {[
                        {
                          component: JupiterPositionsList,
                          name: "Jupiter" as const,
                          value: jupiterValue,
                          onValue: handleJupiterValueChange,
                        },
                        {
                          component: KaminoPositionsList,
                          name: "Kamino" as const,
                          value: kaminoValue,
                          onValue: handleKaminoValueChange,
                        },
                      ]
                        .sort((a, b) => b.value - a.value)
                        .map(({ component: SolanaProtocol, name, onValue }) => (
                          <SolanaProtocol
                            key={name}
                            address={solanaProtocolsAddress ?? undefined}
                            showManageButton={false}
                            onPositionsValueChange={onValue}
                            onPositionsCheckComplete={() =>
                              setCheckingProtocols((prev) => prev.filter((p) => p !== name))
                            }
                          />
                        ))}
                      {solanaManual === null && !solanaUrlAddress && solanaAddress ? (
                        <SolanaSignMessageButton />
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

	        </div>

		  </div>

          <div className="w-full">

			<div className="hidden lg:block mb-4 mt-17">
			  <div className="h-[500px] flex flex-col items-center justify-center to-slate-100 dark:from-slate-900 dark:to-slate-800 rounded p-8">
          <div ref={desktopChartRef} className="flex items-center justify-center pr-4">
            <PortfolioChart
              data={chartSectors}
              totalValue={chartTotalAssets.toString()}
              isLoading={checkingProtocols.length > 0 || isRefreshing}
            />
          </div>
          {showChartDownload ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void downloadPortfolioChartPng()}
                  className={cn(
                    "mt-2 h-4 w-4 p-0 text-muted-foreground hover:bg-transparent hover:text-foreground/60 opacity-80 transition-colors"
                  )}
                  aria-label="Save chart as PNG"
                >
                  <ImageDown className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Save chart as PNG</p>
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>

			</div>

          </div>

        </div>
	  </div>
      <YieldCalculatorModal
        isOpen={isYieldCalcOpen}
        onClose={handleCloseCalculator}
        tokens={tokens}
        totalAssets={totalAssets}
        walletTotal={walletTotal}
        initialApr={(() => {
          const aprParam = searchParams?.get('apr');
          if (!aprParam) return undefined;
          const aprValue = parseFloat(aprParam);
          return Number.isFinite(aprValue) && aprValue > 0 ? aprValue : undefined;
        })()}
        initialDeposit={(() => {
          const depositParam = searchParams?.get('deposit');
          if (!depositParam) return undefined;
          const depositValue = parseFloat(depositParam);
          return Number.isFinite(depositValue) && depositValue >= 0 ? depositValue : undefined;
        })()}
      />
	  </PortfolioAmountsPrivacyProvider>
    </CollapsibleProvider>
  );
}
