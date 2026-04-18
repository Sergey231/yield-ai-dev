"use client";
import { WalletSelector } from "./WalletSelector";
import { PortfolioCard } from "./portfolio/PortfolioCard";
import { SolanaWalletCard } from "./portfolio/SolanaWalletCard";
import { SolanaSignMessageButton } from "./SolanaSignMessageButton";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useEffect, useMemo, useState, useCallback, type ReactNode } from "react";
import { useAptosNativeRestore } from "@/hooks/useAptosNativeRestore";
import { AptosPortfolioService } from "@/lib/services/aptos/portfolio";
import { Token } from "@/lib/types/token";
import { Logo } from "./ui/logo";
import { AlphaBadge } from "./ui/alpha-badge";
import { CollapsibleProvider } from "@/contexts/CollapsibleContext";
import { useWalletStore } from "@/lib/stores/walletStore";
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
import { PositionsList as MoarPositionsList } from "./protocols/moar/PositionsList";
import { PositionsList as AavePositionsList } from "./protocols/aave/PositionsList";
import { PositionsList as ThalaPositionsList } from "./protocols/thala/PositionsList";
import { PositionsList as EchoPositionsList } from "./protocols/echo/PositionsList";
import { PositionsList as DecibelPositionsList } from "./protocols/decibel/PositionsList";
import { PositionsList as AptreePositionsList } from "./protocols/aptree/PositionsList";
import { PositionsList as JupiterPositionsList } from "./protocols/jupiter/PositionsList";
import { PositionsList as KaminoPositionsList } from "./protocols/kamino/PositionsList";
import { PositionsList as YieldAIPositionsList } from "./protocols/yield-ai/PositionsList";
import { useSolanaPortfolio } from "@/hooks/useSolanaPortfolio";
import { ProtocolIcon } from "@/shared/ProtocolIcon/ProtocolIcon";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RefreshCw } from "lucide-react";
import { CollapsibleControls } from "@/components/ui/collapsible-controls";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/numberFormat";
import { isDerivedAptosWalletReliable } from "@/lib/aptosWalletUtils";

function shortenHexAddress(addr: string, head = 4, tail = 4): string {
  if (!addr) return "Unknown";
  if (!addr.startsWith("0x")) return addr;
  if (addr.length <= 2 + head + tail + 1) return addr;
  return `${addr.slice(0, 2 + head)}…${addr.slice(-tail)}`;
}

function needsAddressLabel(token: Token): boolean {
  const s = (token.symbol ?? "").trim();
  if (!s) return true;
  if (s === "Unknown") return true;
  // When we fall back to displaying raw types/segments, it can get extremely long.
  if (s.includes("::")) return true;
  if (s.length > 16) return true;
  return false;
}
export default function Sidebar() {
  // Use native restore hook to ensure native Aptos wallets are reconnected
  const { account } = useAptosNativeRestore();
  // Also keep useWallet for other functionality
  const { wallet: aptosWallet } = useWallet(); // Keep adapter state synced + detect derived wallet
  const {
    address: solanaAddress,
    protocolsAddress: solanaProtocolsAddress,
    tokens: solanaTokens,
    totalValueUsd: solanaTotalValue,
    isLoading: isSolanaLoading,
    refresh: refreshSolana,
  } = useSolanaPortfolio();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [totalValue, setTotalValue] = useState(0);
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
  const [yieldAIValue, setYieldAIValue] = useState(0);
  const [jupiterValue, setJupiterValue] = useState(0);
  const [kaminoValue, setKaminoValue] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [checkingProtocols, setCheckingProtocols] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const setTotalAssetsStore = useWalletStore((s) => s.setTotalAssets);

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

  // When set (e.g. "decibel" or "decibel,thala"), only these protocols are shown in the positions list
  const debugProtocolKeys =
    typeof process.env.NEXT_PUBLIC_DEBUG_PROTOCOLS === "string"
      ? process.env.NEXT_PUBLIC_DEBUG_PROTOCOLS.split(",")
          .map((p) => p.trim().toLowerCase())
          .filter(Boolean)
      : null;

  const resetChecking = useCallback(() => {
    setCheckingProtocols(
      solanaProtocolsAddress
        ? [...APTOS_PROTOCOL_NAMES, ...SOLANA_PROTOCOL_NAMES]
        : [...APTOS_PROTOCOL_NAMES]
    );
  }, [solanaProtocolsAddress]);

  const loadPortfolio = useCallback(async () => {
    if (!account?.address) {
      setTokens([]);
      setTotalValue(0);
      return;
    }

    try {
      setIsRefreshing(true);
      const portfolioService = new AptosPortfolioService();
      const portfolio = await portfolioService.getPortfolio(account.address.toString());
      // Sidebar UI: for unknown/very long symbols, show a shortened address label instead.
      const displayTokens = (portfolio.tokens || []).map((t) => {
        if (needsAddressLabel(t)) {
          return {
            ...t,
            symbol: shortenHexAddress(t.address),
          };
        }
        return t;
      });
      setTokens(displayTokens);

      // Вычисляем общую стоимость из токенов
      const total = displayTokens.reduce((sum, token) => {
        return sum + (token.value ? parseFloat(token.value) : 0);
      }, 0);
      setTotalValue(total);
    } catch (error) {
      setTokens([]);
      setTotalValue(0);
    } finally {
      setIsRefreshing(false);
    }
  }, [account?.address]);

  const handleRefresh = useCallback(async () => {
    await loadPortfolio();
    // Сбрасываем значения протоколов, чтобы они перезагрузились
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
    setThalaValue(0);
	setEchoValue(0);
    setDecibelValue(0);
    setDecibelMainnetValue(0);
    setAptreeValue(0);
    setYieldAIValue(0);
    setJupiterValue(0);
    setKaminoValue(0);
    resetChecking();
    setRefreshKey((k) => k + 1);
  }, [loadPortfolio, resetChecking]);

  useEffect(() => {
    loadPortfolio();
    // Initialize checking list when account changes
    if (account?.address) {
      resetChecking();
    } else {
      setCheckingProtocols([]);
    }
  }, [loadPortfolio, account?.address, resetChecking]);

  useEffect(() => {
    if (!account?.address) return;
    // Keep checking list in sync when Solana wallet connects/disconnects
    resetChecking();
  }, [account?.address, solanaProtocolsAddress, resetChecking]);

  const handleHyperionValueChange = useCallback((value: number) => {
    setHyperionValue(Number.isFinite(value) ? value : 0);
  }, []);

  const handleEchelonValueChange = useCallback((value: number) => {
    setEchelonValue(Number.isFinite(value) ? value : 0);
  }, []);

  const handleAriesValueChange = useCallback((value: number) => {
    setAriesValue(Number.isFinite(value) ? value : 0);
  }, []);

  const handleJouleValueChange = useCallback((value: number) => {
    setJouleValue(Number.isFinite(value) ? value : 0);
  }, []);

  const handleTappValueChange = useCallback((value: number) => {
    setTappValue(Number.isFinite(value) ? value : 0);
  }, []);

  const handleMesoValueChange = useCallback((value: number) => {
    setMesoValue(Number.isFinite(value) ? value : 0);
  }, []);

  const handleAuroValueChange = useCallback((value: number) => {
    setAuroValue(Number.isFinite(value) ? value : 0);
  }, []);

  const handleAmnisValueChange = useCallback((value: number) => {
    setAmnisValue(Number.isFinite(value) ? value : 0);
  }, []);
  const handleEarniumValueChange = useCallback((value: number) => {
    setEarniumValue(Number.isFinite(value) ? value : 0);
  }, []);

  const handleAaveValueChange = useCallback((value: number) => {
    setAaveValue(Number.isFinite(value) ? value : 0);
  }, []);

  const handleMoarValueChange = useCallback((value: number) => {
    setMoarValue(Number.isFinite(value) ? value : 0);
  }, []);
  const handleThalaValueChange = useCallback((value: number) => {
    setThalaValue(Number.isFinite(value) ? value : 0);
  }, []);
  const handleEchoValueChange = useCallback((value: number) => {
    setEchoValue(Number.isFinite(value) ? value : 0);
  }, []);
  const handleDecibelValueChange = useCallback((value: number) => {
    setDecibelValue(Number.isFinite(value) ? value : 0);
  }, []);
  const handleDecibelMainnetValueChange = useCallback((value: number) => {
    setDecibelMainnetValue(Number.isFinite(value) ? value : 0);
  }, []);
  const handleAptreeValueChange = useCallback((value: number) => {
    setAptreeValue(Number.isFinite(value) ? value : 0);
  }, []);
  const handleYieldAIValueChange = useCallback((value: number) => {
    setYieldAIValue(Number.isFinite(value) ? value : 0);
  }, []);

  const handleJupiterValueChange = useCallback((value: number) => {
    setJupiterValue(Number.isFinite(value) ? value : 0);
  }, []);

  const handleKaminoValueChange = useCallback((value: number) => {
    setKaminoValue(Number.isFinite(value) ? value : 0);
  }, []);

  // Считаем сумму по кошельку
  const walletTotal = tokens.reduce((sum, token) => {
    const value = token.value ? parseFloat(token.value) : 0;
    return sum + (isNaN(value) ? 0 : value);
  }, 0);

  // Считаем сумму по всем протоколам (Decibel: full assets when available, else pre-deposit fallback)
  const decibelTotalRaw = decibelValue > 0 ? decibelValue : decibelMainnetValue;
  const decibelTotal = Number.isFinite(decibelTotalRaw) ? decibelTotalRaw : 0;
  const totalProtocolsValue =
    (Number.isFinite(hyperionValue) ? hyperionValue : 0) +
    (Number.isFinite(echelonValue) ? echelonValue : 0) +
    (Number.isFinite(ariesValue) ? ariesValue : 0) +
    (Number.isFinite(jouleValue) ? jouleValue : 0) +
    (Number.isFinite(tappValue) ? tappValue : 0) +
    (Number.isFinite(mesoValue) ? mesoValue : 0) +
    (Number.isFinite(auroValue) ? auroValue : 0) +
    (Number.isFinite(amnisValue) ? amnisValue : 0) +
    (Number.isFinite(earniumValue) ? earniumValue : 0) +
    (Number.isFinite(aaveValue) ? aaveValue : 0) +
    (Number.isFinite(moarValue) ? moarValue : 0) +
    (Number.isFinite(thalaValue) ? thalaValue : 0) +
    (Number.isFinite(echoValue) ? echoValue : 0) +
    decibelTotal +
    (Number.isFinite(aptreeValue) ? aptreeValue : 0) +
    (Number.isFinite(yieldAIValue) ? yieldAIValue : 0);

  // Итоговая сумма
  const totalAssets = walletTotal + totalProtocolsValue;

  // Solana total = wallet tokens value + protocol positions value (Jupiter/Kamino)
  const solanaProtocolsTotal =
    (Number.isFinite(jupiterValue) ? jupiterValue : 0) +
    (Number.isFinite(kaminoValue) ? kaminoValue : 0);
  const solanaTotalAssets = (Number.isFinite(solanaTotalValue) ? (solanaTotalValue ?? 0) : 0) + solanaProtocolsTotal;

  useEffect(() => {
    setTotalAssetsStore(totalAssets);
  }, [totalAssets, setTotalAssetsStore]);

  // Shared UI state: hide assets <1$ for all wallets (Aptos + Solana)
  const [hideSmallAssets, setHideSmallAssets] = useState(true);

  const hasAnyWalletCard = Boolean(account?.address || solanaAddress);

  const handleGlobalRefresh = useCallback(async () => {
    // Обновляем Aptos-портфель (если есть) и Solana-портфель
    if (account?.address) {
      await handleRefresh();
    }
    if (solanaAddress) {
      await refreshSolana();
    }
  }, [account?.address, handleRefresh, refreshSolana, solanaAddress]);

  const aptosBlock = account?.address ? (
    <div className="space-y-4">
      <PortfolioCard
        totalValue={totalAssets.toString()}
        tokens={tokens}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        hasSolanaWallet={!!solanaAddress}
        isDerived={isDerivedAptosWalletReliable(aptosWallet)}
        hideSmallAssets={hideSmallAssets}
        onHideSmallAssetsChange={setHideSmallAssets}
        showHeaderControls={false}
      />
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
      {(() => {
        const positionsListItems = [
          { component: HyperionPositionsList, value: hyperionValue, name: "Hyperion" },
          { component: EchelonPositionsList, value: echelonValue, name: "Echelon" },
          { component: AriesPositionsList, value: ariesValue, name: "Aries" },
          { component: JoulePositionsList, value: jouleValue, name: "Joule" },
          { component: TappPositionsList, value: tappValue, name: "Tapp Exchange" },
          { component: MesoPositionsList, value: mesoValue, name: "Meso Finance" },
          { component: AuroPositionsList, value: auroValue, name: "Auro Finance" },
          { component: AmnisPositionsList, value: amnisValue, name: "Amnis Finance" },
          { component: EarniumPositionsList, value: earniumValue, name: "Earnium" },
          { component: AavePositionsList, value: aaveValue, name: "Aave" },
          { component: MoarPositionsList, value: moarValue, name: "Moar Market" },
          { component: ThalaPositionsList, value: thalaValue, name: "Thala" },
          { component: EchoPositionsList, value: echoValue, name: "Echo Protocol" },
          { component: DecibelPositionsList, value: decibelValue, name: "Decibel" },
          { component: AptreePositionsList, value: aptreeValue, name: "APTree" },
          { component: YieldAIPositionsList, value: yieldAIValue, name: "AI agent" },
        ];
        const listToRender =
          debugProtocolKeys?.length && debugProtocolKeys.length > 0
            ? positionsListItems.filter((item) => {
                const key = getProtocolByName(item.name)?.key;
                return key && debugProtocolKeys.includes(key.toLowerCase());
              })
            : positionsListItems;
        return listToRender
          .sort((a, b) => b.value - a.value)
          .map(({ component: Component, name }) => (
            <Component
              key={name}
              address={account!.address.toString()}
              walletTokens={tokens}
              refreshKey={refreshKey}
              onPositionsValueChange={
                name === "Hyperion"
                  ? handleHyperionValueChange
                  : name === "Echelon"
                    ? handleEchelonValueChange
                    : name === "Aries"
                      ? handleAriesValueChange
                      : name === "Joule"
                        ? handleJouleValueChange
                        : name === "Tapp Exchange"
                          ? handleTappValueChange
                          : name === "Meso Finance"
                            ? handleMesoValueChange
                            : name === "Auro Finance"
                              ? handleAuroValueChange
                              : name === "Amnis Finance"
                                ? handleAmnisValueChange
                                : name === "Earnium"
                                  ? handleEarniumValueChange
                                  : name === "Aave"
                                    ? handleAaveValueChange
                                    : name === "Moar Market"
                                      ? handleMoarValueChange
                                      : name === "Thala"
                                        ? handleThalaValueChange
                                        : name === "Echo Protocol"
                                          ? handleEchoValueChange
                                          : name === "Decibel"
                                            ? handleDecibelValueChange
                                            : name === "APTree"
                                              ? handleAptreeValueChange
                                              : name === "AI agent"
                                                ? handleYieldAIValueChange
                                                : undefined
              }
              onMainnetValueChange={name === "Decibel" ? handleDecibelMainnetValueChange : undefined}
              onPositionsCheckComplete={() =>
                setCheckingProtocols((prev) => prev.filter((p) => p !== name))
              }
            />
          ));
      })()}
    </div>
  ) : (
    <div className="mt-4 p-4 bg-muted rounded-lg space-y-2">
      <p className="text-sm text-muted-foreground">
        Connect your Aptos wallet to view your assets and positions in DeFi protocols
      </p>
    </div>
  );

  const solanaBlock = solanaAddress ? (
    <div className="space-y-2">
      <SolanaWalletCard
        tokens={solanaTokens}
        totalValueUsd={solanaTotalValue}
        onRefresh={refreshSolana}
        isRefreshing={isSolanaLoading}
        hideSmallAssets={hideSmallAssets}
        onHideSmallAssetsChange={setHideSmallAssets}
      />
      {(
        [
          {
            name: "Jupiter" as const,
            value: jupiterValue,
            component: (
              <JupiterPositionsList
                key="Jupiter"
                address={solanaProtocolsAddress ?? undefined}
                onPositionsValueChange={handleJupiterValueChange}
                onPositionsCheckComplete={() =>
                  setCheckingProtocols((prev) => prev.filter((p) => p !== "Jupiter"))
                }
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
                onPositionsValueChange={handleKaminoValueChange}
                onPositionsCheckComplete={() =>
                  setCheckingProtocols((prev) => prev.filter((p) => p !== "Kamino"))
                }
              />
            ),
          },
        ] as const
      )
        .slice()
        .sort((a, b) => b.value - a.value)
        .map((x) => x.component)}
      <SolanaSignMessageButton />
    </div>
  ) : null;

  const walletBlocks = useMemo(() => {
    const blocks: Array<{ key: "aptos" | "solana"; total: number; node: ReactNode }> = [];
    if (account?.address) blocks.push({ key: "aptos", total: totalAssets, node: aptosBlock });
    if (solanaAddress) blocks.push({ key: "solana", total: solanaTotalAssets, node: solanaBlock });
    return blocks.sort((a, b) => b.total - a.total);
  }, [account?.address, solanaAddress, totalAssets, solanaTotalAssets, aptosBlock, solanaBlock]);

  return (
    <CollapsibleProvider>
      <div className="hidden md:flex w-[360px] p-4 border-r h-screen flex-col">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-start gap-1">
              <div className="flex items-center gap-2">
                <Logo size="md" />
                <h2 className="text-xl font-bold">Yield AI</h2>
              </div>
              <AlphaBadge />
            </div>
          </div>
          <WalletSelector />
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          <div className="mt-4 space-y-4">
            {hasAnyWalletCard && (
              <div className="flex items-center justify-between mb-2">
                <span className="text-lg font-medium">Total Assets</span>
                <span className="text-lg font-medium">
                  {formatCurrency(
                    (account?.address ? totalAssets : 0) + (solanaAddress ? (solanaTotalValue ?? 0) : 0),
                    2
                  )}
                </span>
              </div>
            )}
            {hasAnyWalletCard && (
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="hideSmallAssetsGlobal"
                    checked={hideSmallAssets}
                    onCheckedChange={(checked) => setHideSmallAssets(!!checked)}
                  />
                  <Label htmlFor="hideSmallAssetsGlobal" className="text-sm">
                    Hide assets {'<'}1$
                  </Label>
                </div>
                <div className="flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
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
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Refresh Aptos & Solana</p>
                    </TooltipContent>
                  </Tooltip>
                  <CollapsibleControls />
                </div>
              </div>
            )}

            {walletBlocks.map((b) => (
              <div key={b.key} className={b.key === "aptos" ? "space-y-4" : "space-y-2"}>
                {b.node}
              </div>
            ))}
          </div>
        </div>
      </div>
    </CollapsibleProvider>
  );
}
