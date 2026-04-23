"use client";

import {
  AboutAptosConnect,
  AboutAptosConnectEducationScreen,
  AdapterNotDetectedWallet,
  AdapterWallet,
  AptosPrivacyPolicy,
  WalletSortingOptions,
  groupAndSortWallets,
  isInstallRequired,
  useWallet,
} from "@aptos-labs/wallet-adapter-react";
import { isRedirectable, WalletReadyState } from "@aptos-labs/wallet-adapter-core";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { WalletName } from "@solana/wallet-adapter-base";
import { Button } from "@/components/ui/button";
import {
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { getAptosWalletNameFromStorage, isDerivedAptosWalletReliable } from "@/lib/aptosWalletUtils";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";

export type WalletConnectChainTab = "aptos" | "solana" | "all";

const APTOS_CONNECT_GOOGLE = "Continue with Google";
const APTOS_CONNECT_APPLE = "Continue with Apple";

/**
 * Open the current page in Jupiter Wallet in-app browser (experimental).
 * TODO: replace with @jup-ag/jup-mobile-adapter / official Jupiter mobile flow when integrated.
 */
function buildJupiterBrowseDeeplink(pageUrl: string): string {
  return `jupiter://browse?url=${encodeURIComponent(pageUrl)}`;
}

const JUPITER_WALLET_ICON_URL = "https://jup.ag/favicon.ico";

/**
 * Mobile: safe-area insets, avoid vertical center under notch, close button inset.
 * Scroll lives inside CustomAptosConnectDialogContent (not on DialogContent) for smoother iOS touch scrolling.
 */
export const WALLET_CONNECT_MODAL_DIALOG_CLASS = cn(
  "flex w-[calc(100vw-1rem)] max-w-lg flex-col overflow-hidden gap-0",
  "max-h-[min(92dvh,100svh)] sm:max-h-[min(90vh,100dvh)]",
  "max-sm:top-[max(0.75rem,env(safe-area-inset-top,0px))] max-sm:translate-y-0",
  "max-sm:max-h-[calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-1.5rem)]",
  "p-0 pt-[max(0.75rem,env(safe-area-inset-top,0px))] px-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] sm:p-6",
  "[&>button]:top-[max(0.625rem,env(safe-area-inset-top,0px))] [&>button]:right-[max(0.625rem,env(safe-area-inset-right,0px))]",
);

function shouldShowAptosWalletRow(wallet: AdapterWallet | AdapterNotDetectedWallet): boolean {
  const isWalletReady = wallet.readyState === WalletReadyState.Installed;
  const mobileSupport = "deeplinkProvider" in wallet && Boolean(
    (wallet as AdapterWallet & { deeplinkProvider?: unknown }).deeplinkProvider,
  );
  if (!isWalletReady && isRedirectable() && !mobileSupport) return false;
  return true;
}

const SOLANA_DERIVED_APTOS_SUFFIX = " (Solana)";

/** Decibel Aptos extension list (native rows, no chain suffix). */
const DECIBEL_APTOS_EXTENSION_ORDER = [
  "petra",
  "okx wallet",
  "nightly",
  "backpack",
  "bitget wallet",
  "gate wallet",
  "cosmostation wallet",
  "pontem wallet",
  "trust wallet",
] as const;

/** Decibel Solana list — rows use `${name} (Solana)` from cross-chain adapter. */
const DECIBEL_SOLANA_EXTENSION_BASE_ORDER = [
  "jupiter",
  "solflare",
  "metamask",
  "backpack",
  "phantom",
  "pontem wallet",
  "nightly",
  "bitget wallet",
  "gate wallet",
  "okx wallet",
  "cosmostation wallet",
  "trust",
] as const;

/** Aptos tab cross-chain list order. */
const APTOS_XCHAIN_BASE_ORDER = [
  "backpack",
  "phantom",
  "pontem wallet",
  "nightly",
  "bitget wallet",
  "gate wallet",
  "okx wallet",
  "cosmostation wallet",
  "trust",
] as const;

/** Cross-chain options to expose under Aptos tab (Aptos derived via Solana). */
const XCHAIN_APTOS_DERIVED_BASE_ORDER = APTOS_XCHAIN_BASE_ORDER;
const XCHAIN_APTOS_DERIVED_BASE_KEYS = new Set<string>(XCHAIN_APTOS_DERIVED_BASE_ORDER);

const SOLANA_TOP_BASE_ORDER = ["jupiter", "solflare", "metamask"] as const;
const SOLANA_XCHAIN_BASE_ORDER = [
  "backpack",
  "phantom",
  "pontem wallet",
  "nightly",
  "bitget wallet",
  "gate wallet",
  "okx wallet",
  "cosmostation wallet",
  "trust",
] as const;
const SOLANA_XCHAIN_BASE_KEYS = new Set<string>(SOLANA_XCHAIN_BASE_ORDER);

const DECIBEL_APTOS_EXTENSION_KEYS = new Set<string>(DECIBEL_APTOS_EXTENSION_ORDER);

/** Adapter may use a shorter label than Decibel UI. */
const DECIBEL_APTOS_NAME_ALIASES: Record<string, string> = {
  cosmostation: "cosmostation wallet",
  gate: "gate wallet",
  bitget: "bitget wallet",
  okx: "okx wallet",
  pontem: "pontem wallet",
  trust: "trust wallet",
};

const DECIBEL_SOLANA_BASE_KEYS = new Set<string>([
  ...DECIBEL_SOLANA_EXTENSION_BASE_ORDER,
  "trust wallet",
  "coinbase wallet",
  "okx",
  "bitget",
  "pontem",
]);

/** Map adapter base label → order key in DECIBEL_SOLANA_EXTENSION_BASE_ORDER. */
const DECIBEL_SOLANA_BASE_SORT_ALIASES: Record<string, string> = {
  "trust wallet": "trust",
  "coinbase wallet": "coinbase",
  okx: "okx wallet",
  bitget: "bitget wallet",
  "jupiter wallet": "jupiter",
  pontem: "pontem wallet",
  cosmostation: "cosmostation wallet",
  gate: "gate wallet",
  metamask: "metamask",
  "metamask wallet": "metamask",
};

function titleCaseWalletBase(base: string): string {
  const s = base.trim();
  if (!s) return s;
  if (s.toLowerCase() === "okx wallet") return "OKX Wallet";
  if (s.toLowerCase() === "metamask") return "MetaMask";
  if (s.toLowerCase() === "trust") return "Trust Wallet";
  return s
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeWalletListKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Hide EVM cross-chain rows until we support them (e.g. Phantom (Ethereum)). */
function isCrossChainEthereumExtensionRow(name: string): boolean {
  return /\(\s*ethereum\s*\)/i.test(name);
}

function decibelAptosSortKey(name: string): string {
  const key = normalizeWalletListKey(name);
  return DECIBEL_APTOS_NAME_ALIASES[key] ?? key;
}

function decibelSolanaBaseSortKey(name: string): string | null {
  if (!name.trim().toLowerCase().endsWith(" (solana)")) return null;
  const base = name.slice(0, -SOLANA_DERIVED_APTOS_SUFFIX.length);
  return normalizeWalletListKey(base);
}

function decibelSolanaOrderKey(name: string): string | null {
  const base = decibelSolanaBaseSortKey(name);
  if (!base) return null;
  return DECIBEL_SOLANA_BASE_SORT_ALIASES[base] ?? base;
}

function isOnDecibelAptosExtensionList(name: string): boolean {
  const key = decibelAptosSortKey(name);
  return DECIBEL_APTOS_EXTENSION_KEYS.has(key);
}

function isOnDecibelSolanaExtensionList(name: string): boolean {
  const base = decibelSolanaBaseSortKey(name);
  return base !== null && DECIBEL_SOLANA_BASE_KEYS.has(base);
}

function sortByDecibelOrder<T extends { name: string }>(
  items: T[],
  order: readonly string[],
  keyFn: (name: string) => string | null,
): T[] {
  const rank = new Map<string, number>();
  order.forEach((k, i) => rank.set(k, i));
  return [...items].sort((a, b) => {
    const ka = keyFn(a.name);
    const kb = keyFn(b.name);
    const ra = ka !== null ? rank.get(ka) ?? 999 : 999;
    const rb = kb !== null ? rank.get(kb) ?? 999 : 999;
    return ra - rb || a.name.localeCompare(b.name);
  });
}

function isWalletInstalled(wallet: AdapterWallet | AdapterNotDetectedWallet): boolean {
  return wallet.readyState === WalletReadyState.Installed;
}

function isDerivedAptosWalletName(name?: string): boolean {
  if (!name) return false;
  const normalized = name.toLowerCase();
  return normalized.includes("derived wallet") || normalized.endsWith(" (solana)");
}

/** Aptos adapter names Solana-derived accounts as `${SolanaAdapterName} (Solana)`. */
function solanaAdapterNameFromSolanaDerivedAptosRow(name: string): string | null {
  if (!name.endsWith(SOLANA_DERIVED_APTOS_SUFFIX)) return null;
  const base = name.slice(0, -SOLANA_DERIVED_APTOS_SUFFIX.length).trim();
  return base || null;
}

function isConnectedWithNativeAptos(
  aptosConnected: boolean,
  selected: AdapterWallet | null | undefined,
): boolean {
  if (!aptosConnected || !selected?.name) return false;
  if (selected.isAptosNativeWallet === true) return true;
  if (selected.isAptosNativeWallet === false) return false;
  return !isDerivedAptosWalletName(selected.name);
}

function getWalletLabel(
  walletName: string,
  isConnected: boolean,
  isDerivedSelected: boolean,
): string {
  const normalized = walletName.trim().toLowerCase();
  if (normalized === "aptos") {
    return isConnected && isDerivedSelected ? "APTOS (Derived Wallet)" : "APTOS";
  }
  return walletName;
}

export interface CustomAptosConnectDialogContentProps extends WalletSortingOptions {
  close: () => void;
  isConnecting?: boolean;
  /** Mirrors deposit-button: different labels / “Connected” for derived Aptos */
  mode?: "default" | "deposit";
  /** When true, chain tab resets from `initialChainTabOnOpen` (e.g. after open). */
  dialogOpen?: boolean;
  /** Tab to show when the dialog opens; default Aptos if omitted. */
  initialChainTabOnOpen?: WalletConnectChainTab;
}

/**
 * Aptos connect UI without WalletItem — same layout and connect(onConnect) behavior as the adapter’s WalletItem.
 */
export function CustomAptosConnectDialogContent({
  close,
  isConnecting = false,
  mode = "default",
  dialogOpen,
  initialChainTabOnOpen,
  ...walletSortingOptions
}: CustomAptosConnectDialogContentProps) {
  const { wallets = [], notDetectedWallets = [], connect, wallet: selectedWallet, connected } = useWallet();
  const {
    connected: solanaConnected,
    publicKey: solanaPublicKey,
    wallets: solanaWallets,
  } = useSolanaWallet();

  const hasConnectedSolanaWallet = useMemo(() => {
    if (solanaConnected && solanaPublicKey) return true;
    return (solanaWallets ?? []).some((w) => w?.adapter?.connected && w?.adapter?.publicKey);
  }, [solanaConnected, solanaPublicKey, solanaWallets]);

  const storedAptosWalletName = mode === "deposit" ? getAptosWalletNameFromStorage() : null;

  const isDerivedSelected =
    mode === "deposit" &&
    connected &&
    !!selectedWallet &&
    (isDerivedAptosWalletReliable(selectedWallet as { name?: string } | null) ||
      String(storedAptosWalletName || "").trim().endsWith(" (Solana)"));

  const { aptosConnectWallets, availableWallets, installableWallets } = groupAndSortWallets(
    [...wallets, ...notDetectedWallets],
    walletSortingOptions,
  );

  const { googleAppleSocialWallets, otherAptosConnectWallets } = useMemo(() => {
    const google = aptosConnectWallets.find((w) => w.name === APTOS_CONNECT_GOOGLE);
    const apple = aptosConnectWallets.find((w) => w.name === APTOS_CONNECT_APPLE);
    const pair: AdapterWallet[] = [];
    if (google) pair.push(google);
    if (apple) pair.push(apple);
    const other = aptosConnectWallets.filter(
      (w) => w.name !== APTOS_CONNECT_GOOGLE && w.name !== APTOS_CONNECT_APPLE,
    );
    return { googleAppleSocialWallets: pair, otherAptosConnectWallets: other };
  }, [aptosConnectWallets]);

  const hasAptosConnectWallets = !!aptosConnectWallets.length;

  const [chainTab, setChainTab] = useState<WalletConnectChainTab>("aptos");

  useEffect(() => {
    if (dialogOpen) {
      setChainTab(initialChainTabOnOpen ?? "aptos");
    }
  }, [dialogOpen, initialChainTabOnOpen]);

  /** After mount — avoids SSR/client mismatch; matches Aptos core: mobile browser, not wallet in-app WebView. */
  const [solanaMobileBrowserRedirectable, setSolanaMobileBrowserRedirectable] = useState(false);
  useEffect(() => {
    setSolanaMobileBrowserRedirectable(isRedirectable());
  }, []);

  const { aptosTabExtensionWallets, solanaTabExtensionWallets, aptosXChainDerivedWallets } = useMemo(() => {
    const combined = [...availableWallets, ...installableWallets];
    const aptos: (AdapterWallet | AdapterNotDetectedWallet)[] = [];
    const solana: (AdapterWallet | AdapterNotDetectedWallet)[] = [];
    const xchainAptosDerived: (AdapterWallet | AdapterNotDetectedWallet)[] = [];
    for (const w of combined) {
      if (isCrossChainEthereumExtensionRow(w.name)) continue;
      const solanaBase = decibelSolanaBaseSortKey(w.name);
      if (solanaBase !== null) {
        if (isOnDecibelSolanaExtensionList(w.name)) solana.push(w);
        const orderKey = decibelSolanaOrderKey(w.name);
        if (orderKey && XCHAIN_APTOS_DERIVED_BASE_KEYS.has(orderKey)) {
          xchainAptosDerived.push(w);
        }
        continue;
      }
      if (isOnDecibelAptosExtensionList(w.name)) aptos.push(w);
    }
    return {
      aptosTabExtensionWallets: sortByDecibelOrder(
        aptos,
        DECIBEL_APTOS_EXTENSION_ORDER,
        (n) => decibelAptosSortKey(n),
      ),
      solanaTabExtensionWallets: sortByDecibelOrder(
        solana,
        DECIBEL_SOLANA_EXTENSION_BASE_ORDER,
        decibelSolanaOrderKey,
      ),
      aptosXChainDerivedWallets: sortByDecibelOrder(
        xchainAptosDerived,
        XCHAIN_APTOS_DERIVED_BASE_ORDER,
        decibelSolanaOrderKey,
      ),
    };
  }, [availableWallets, installableWallets]);
  
  const curatedAptosRows = useMemo(() => {
    const nativeOrder = [
      "petra",
      "okx wallet",
      "nightly",
      "pontem wallet",
      "backpack",
      "bitget wallet",
      "gate wallet",
      "cosmostation wallet",
    ] as const;
    const nativeKeySet = new Set<string>(nativeOrder as unknown as string[]);

    const nativeByKey = new Map<string, AdapterWallet | AdapterNotDetectedWallet>();
    for (const w of aptosTabExtensionWallets) {
      const key = decibelAptosSortKey(w.name);
      if (!nativeKeySet.has(key)) continue;
      if (!nativeByKey.has(key)) nativeByKey.set(key, w);
    }

    const derivedWanted = [
      "okx wallet",
      "nightly",
      "pontem wallet",
      "backpack",
      "bitget wallet",
      "gate wallet",
      "cosmostation wallet",
      "phantom",
    ] as const;
    const derivedKeySet = new Set<string>(derivedWanted as unknown as string[]);
    const derivedByKey = new Map<string, AdapterWallet | AdapterNotDetectedWallet>();
    for (const w of aptosXChainDerivedWallets) {
      const key = decibelSolanaOrderKey(w.name);
      if (!key || !derivedKeySet.has(key)) continue;
      if (!derivedByKey.has(key)) derivedByKey.set(key, w);
    }

    const rows: {
      key: string;
      wallet: AdapterWallet | AdapterNotDetectedWallet;
      label: string;
      forceShow?: boolean;
    }[] = [];

    for (const key of nativeOrder) {
      const w = nativeByKey.get(key);
      if (!w) continue;
      rows.push({ key: `aptos-native-${key}`, wallet: w, label: `${titleCaseWalletBase(key)} (Aptos)` });
      if (hasConnectedSolanaWallet) {
        const d = derivedByKey.get(key);
        if (d) {
          const derivedLabel =
            key === "cosmostation wallet"
              ? "Cosmostation Wallet (Derived Aptos)"
              : `${titleCaseWalletBase(key)} (Aptos Derived)`;
          rows.push({
            key: `aptos-derived-${key}`,
            wallet: d,
            label: derivedLabel,
            // Derived rows can be hidden on mobile by "Installed" heuristics; force-show when Solana is connected.
            forceShow: true,
          });
        }
      }
    }

    if (hasConnectedSolanaWallet) {
      const phantom = derivedByKey.get("phantom");
      if (phantom) {
        rows.push({
          key: "aptos-derived-phantom",
          wallet: phantom,
          label: "Phantom (Derived Aptos)",
          forceShow: true,
        });
      }
    }

    return [...rows].sort((a, b) => {
      const ka = a.key;
      const kb = b.key;
      const aIsPetra = ka === "aptos-native-petra";
      const bIsPetra = kb === "aptos-native-petra";
      if (aIsPetra !== bIsPetra) return aIsPetra ? -1 : 1;
      const aInstalled = isWalletInstalled(a.wallet);
      const bInstalled = isWalletInstalled(b.wallet);
      if (aInstalled !== bInstalled) return aInstalled ? -1 : 1;
      return 0;
    });
  }, [aptosTabExtensionWallets, aptosXChainDerivedWallets, hasConnectedSolanaWallet]);

  const curatedSolanaRows = useMemo(() => {
    const solanaOrder = [
      "okx wallet",
      "nightly",
      "pontem wallet",
      "backpack",
      "bitget wallet",
      "gate wallet",
      "cosmostation wallet",
      "phantom",
      // Installed-only wallets (must be Solana tab only)
      "jupiter",
      "solflare",
      "trust",
    ] as const;
    const solanaKeySet = new Set<string>(solanaOrder as unknown as string[]);

    const byKey = new Map<string, AdapterWallet | AdapterNotDetectedWallet>();
    for (const w of solanaTabExtensionWallets) {
      const key = decibelSolanaOrderKey(w.name);
      if (!key || !solanaKeySet.has(key)) continue;
      if (!byKey.has(key)) byKey.set(key, w);
    }

    const rows: { key: string; wallet: AdapterWallet | AdapterNotDetectedWallet; label: string }[] = [];
    for (const key of solanaOrder) {
      const w = byKey.get(key);
      if (!w) continue;
      rows.push({ key: `solana-${key}`, wallet: w, label: `${titleCaseWalletBase(key)} (Solana)` });
    }
    const installedPriority = new Map<string, number>([
      ["jupiter", 0],
      ["trust", 1],
      ["solflare", 2],
    ]);
    return [...rows].sort((a, b) => {
      const ka = a.key.replace(/^solana-/, "");
      const kb = b.key.replace(/^solana-/, "");
      const aIsPhantom = ka === "phantom";
      const bIsPhantom = kb === "phantom";
      if (aIsPhantom !== bIsPhantom) return aIsPhantom ? -1 : 1;

      const aInstalledRank = installedPriority.get(ka);
      const bInstalledRank = installedPriority.get(kb);
      const aInstalled = isWalletInstalled(a.wallet);
      const bInstalled = isWalletInstalled(b.wallet);
      const aIsPreferredInstalled = aInstalled && aInstalledRank !== undefined;
      const bIsPreferredInstalled = bInstalled && bInstalledRank !== undefined;
      if (aIsPreferredInstalled && bIsPreferredInstalled) return aInstalledRank - bInstalledRank;
      if (aIsPreferredInstalled !== bIsPreferredInstalled) return aIsPreferredInstalled ? -1 : 1;

      if (aInstalled !== bInstalled) return aInstalled ? -1 : 1;
      return 0;
    });
  }, [solanaTabExtensionWallets]);

  const extensionWalletsForTab: (AdapterWallet | AdapterNotDetectedWallet)[] = [];

  return (
    <AboutAptosConnect renderEducationScreen={renderEducationScreen}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <DialogHeader className="shrink-0 space-y-1.5 pb-2 pr-10 pt-1 text-center sm:pr-0 sm:text-left">
          <DialogTitle className="flex flex-col text-center leading-snug">
            {hasAptosConnectWallets ? (
              <>
                <span className="hidden" aria-hidden="true">
                  <span className="block">Log in or sign up</span>
                  <span className="block">with Social + Aptos Connect</span>
                </span>
                <span>Wallet Connect</span>
              </>
            ) : (
              "Connect Wallet"
            )}
          </DialogTitle>
        </DialogHeader>

        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]",
            "touch-pan-y [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
          )}
        >
      {hasAptosConnectWallets && (chainTab === "aptos" || chainTab === "all") && (
        <div className="flex flex-col gap-2 pt-3">
          {googleAppleSocialWallets.length > 0 && (
            <div className="flex flex-col gap-2 sm:flex-row sm:gap-2.5 sm:items-stretch">
              {googleAppleSocialWallets.map((wallet) => (
                <CustomAptosConnectSocialRow
                  key={wallet.name}
                  wallet={wallet}
                  onConnect={close}
                  isConnecting={isConnecting}
                  mode={mode}
                  isDerivedSelected={!!isDerivedSelected}
                  compact
                  buttonClassName="w-full sm:flex-1 sm:min-w-0"
                />
              ))}
            </div>
          )}
          {otherAptosConnectWallets.map((wallet) => (
            <CustomAptosConnectSocialRow
              key={wallet.name}
              wallet={wallet}
              onConnect={close}
              isConnecting={isConnecting}
              mode={mode}
              isDerivedSelected={!!isDerivedSelected}
            />
          ))}
          <p className="flex gap-1 justify-center items-center text-muted-foreground text-sm">
            Learn more about{" "}
            <AboutAptosConnect.Trigger className="flex gap-1 py-3 items-center text-foreground">
              Aptos Connect <ArrowRight size={16} />
            </AboutAptosConnect.Trigger>
          </p>
          <AptosPrivacyPolicy className="hidden" aria-hidden="true">
            <p className="text-xs leading-5">
              <AptosPrivacyPolicy.Disclaimer />{" "}
              <AptosPrivacyPolicy.Link className="text-muted-foreground underline underline-offset-4" />
              <span className="text-muted-foreground">.</span>
            </p>
            <AptosPrivacyPolicy.PoweredBy className="flex gap-1.5 items-center text-xs leading-5 text-muted-foreground" />
          </AptosPrivacyPolicy>
        </div>
      )}

      <div className={cn(hasAptosConnectWallets ? "pt-3" : "pt-1")}>
        <WalletChainSegmentedControl value={chainTab} onChange={setChainTab} />
      </div>

      {chainTab === "aptos" && (
        <>
          <div className="flex flex-col gap-3 pt-3">
            {curatedAptosRows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No Aptos wallets in this list.
              </p>
            ) : (
              curatedAptosRows.map((row) => (
                <CustomExtensionWalletRow
                  key={row.key}
                  wallet={row.wallet}
                  onConnect={close}
                  isConnecting={isConnecting}
                  mode={mode}
                  isConnected={connected && selectedWallet?.name === row.wallet.name}
                  isDerivedSelected={!!isDerivedSelected}
                  displayNameOverride={row.label}
                  forceShow={row.forceShow}
                />
              ))
            )}
          </div>
        </>
      )}

      {chainTab === "solana" && (
        <>
          <div className="flex flex-col gap-3 pt-3">
            {curatedSolanaRows.length > 0 ? (
              curatedSolanaRows.map((row) => (
                <CustomExtensionWalletRow
                  key={row.key}
                  wallet={row.wallet}
                  onConnect={close}
                  isConnecting={isConnecting}
                  mode={mode}
                  isConnected={connected && selectedWallet?.name === row.wallet.name}
                  isDerivedSelected={!!isDerivedSelected}
                  displayNameOverride={row.label}
                  forceShow
                  preferSolanaConnect
                />
              ))
            ) : !solanaMobileBrowserRedirectable ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No Solana wallets in this list.
              </p>
            ) : null}
          </div>
        </>
      )}

      {chainTab === "all" && (
        <div className="flex flex-col gap-3 pt-3">
          {extensionWalletsForTab.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No wallets available.
            </p>
          ) : (
            extensionWalletsForTab.map((wallet) => (
              <CustomExtensionWalletRow
                key={wallet.name}
                wallet={wallet}
                onConnect={close}
                isConnecting={isConnecting}
                mode={mode}
                isConnected={connected && selectedWallet?.name === wallet.name}
                isDerivedSelected={!!isDerivedSelected}
              />
            ))
          )}
        </div>
      )}

        </div>
      </div>
    </AboutAptosConnect>
  );
}

/** Decibel-style pill switcher for Aptos vs Solana extension lists. */
function WalletChainSegmentedControl({
  value,
  onChange,
}: {
  value: WalletConnectChainTab;
  onChange: (next: WalletConnectChainTab) => void;
}) {
  const tabs: { id: WalletConnectChainTab; label: string }[] = [
    { id: "aptos", label: "Aptos" },
    { id: "solana", label: "Solana" },
  ];

  return (
    <div
      role="tablist"
      aria-label="Blockchain"
      className="flex w-full rounded-full border border-border bg-muted/30 p-1"
    >
      {tabs.map((tab) => {
        const selected = value === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={cn(
              "min-h-9 flex-1 rounded-full px-2 py-1.5 text-sm font-medium transition-colors",
              "outline-none focus-visible:outline-none focus-visible:ring-0",
              selected
                ? "bg-muted text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function CustomAptosConnectSocialRow({
  wallet,
  onConnect,
  isConnecting,
  mode,
  isDerivedSelected,
  compact = false,
  buttonClassName,
}: {
  wallet: AdapterWallet;
  onConnect?: () => void;
  isConnecting?: boolean;
  mode: "default" | "deposit";
  isDerivedSelected: boolean;
  /** Smaller control height/text; used for Google + Apple pair on ≥sm screens. */
  compact?: boolean;
  buttonClassName?: string;
}) {
  const { connect } = useWallet();
  const label =
    mode === "deposit"
      ? getWalletLabel(wallet.name, false, isDerivedSelected)
      : wallet.name;

  const handleClick = () => {
    connect(wallet.name);
    onConnect?.();
  };

  return (
    <Button
      type="button"
      size={compact ? "sm" : "lg"}
      variant="outline"
      className={cn(
        compact ? "h-10 gap-2 px-3 font-normal" : "w-full gap-4",
        buttonClassName,
      )}
      disabled={isConnecting}
      onClick={handleClick}
    >
      {isConnecting ? (
        <>
          <Loader2 className={cn("animate-spin shrink-0", compact ? "h-4 w-4" : "h-5 w-5")} />
          <span className={cn("font-normal", compact ? "text-sm" : "text-base")}>Connecting...</span>
        </>
      ) : (
        <>
          {wallet.icon ? (
            <img
              src={wallet.icon}
              alt=""
              className={cn("rounded shrink-0", compact ? "h-4 w-4" : "h-5 w-5")}
            />
          ) : null}
          <span className={cn("font-normal truncate", compact ? "text-sm" : "text-base")}>{label}</span>
        </>
      )}
    </Button>
  );
}

/**
 * Hardcoded Jupiter row for mobile Safari/Chrome only (`isRedirectable`).
 * TODO: swap for @jup-ag/jup-mobile-adapter once integrated.
 */
function SolanaJupiterDeeplinkRow({ onNavigate }: { onNavigate?: () => void }) {
  const handleConnect = () => {
    if (typeof window === "undefined") return;
    window.location.href = buildJupiterBrowseDeeplink(window.location.href);
    onNavigate?.();
  };

  return (
    <div className="flex items-center justify-between px-4 py-3 gap-4 border rounded-md">
      <div className="flex items-center gap-4 min-w-0">
        <img src={JUPITER_WALLET_ICON_URL} alt="" className="h-6 w-6 rounded shrink-0" />
        <span className="text-base font-normal truncate">Jupiter</span>
      </div>
      <Button size="sm" type="button" onClick={handleConnect}>
        Connect
      </Button>
    </div>
  );
}

function CustomExtensionWalletRow({
  wallet,
  onConnect,
  isConnecting,
  mode,
  isConnected,
  isDerivedSelected,
  displayNameOverride,
  forceShow,
  preferSolanaConnect,
}: {
  wallet: AdapterWallet | AdapterNotDetectedWallet;
  onConnect?: () => void;
  isConnecting?: boolean;
  mode: "default" | "deposit";
  isConnected: boolean;
  isDerivedSelected: boolean;
  /** Optional display label override (e.g. show x-chain derived as "(Aptos)"). */
  displayNameOverride?: string;
  /** Bypass mobile hiding rules for curated rows (e.g. show installable wallets). */
  forceShow?: boolean;
  /**
   * For `(Solana)` cross-chain rows, prefer connecting via Solana wallet-adapter
   * instead of Aptos adapter's cross-chain connect. Needed for `/bridge`.
   */
  preferSolanaConnect?: boolean;
}) {
  const { connect, wallet: selectedAptosWallet, connected: aptosConnected } = useWallet();
  const { select: selectSolana, connect: connectSolana, wallets: solanaWallets } = useSolanaWallet();

  if (!forceShow && !shouldShowAptosWalletRow(wallet)) return null;

  const handleConnect = () => {
    const solanaName = solanaAdapterNameFromSolanaDerivedAptosRow(wallet.name);
    const solanaAdapterExists = solanaName && solanaWallets.some((w) => w.adapter.name === solanaName);
    const allowSolanaOnlyConnect =
      !!preferSolanaConnect || isConnectedWithNativeAptos(aptosConnected, selectedAptosWallet as AdapterWallet);
    if (solanaName && solanaAdapterExists && allowSolanaOnlyConnect) {
      if (typeof window !== "undefined") {
        try {
          window.sessionStorage.removeItem("skip_auto_connect_solana");
          window.sessionStorage.removeItem("skip_auto_connect_derived_aptos");
          window.localStorage.setItem("walletName", JSON.stringify(solanaName));
        } catch {
          /* ignore */
        }
      }
      selectSolana(solanaName as WalletName);
      setTimeout(() => {
        connectSolana().catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          // If adapter thinks it's already connected, treat it as success (no-op connect).
          if (typeof msg === "string" && msg.toLowerCase().includes("already connected")) return;
          /* Phantom etc. often resolve via restore even if this throws */
        });
      }, 100);

      // If user is not connected with a native Aptos wallet, connect the derived Aptos wallet row too.
      // This matches /bridge expectations: selecting "Phantom (Solana)" should yield a derived Aptos account.
      const hasNativeAptos = isConnectedWithNativeAptos(aptosConnected, selectedAptosWallet as AdapterWallet);
      if (preferSolanaConnect && !hasNativeAptos) {
        setTimeout(() => {
          try {
            connect(wallet.name);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            if (typeof msg === "string" && msg.toLowerCase().includes("already connected")) return;
          }
        }, 200);
      }

      onConnect?.();
      return;
    }
    if (typeof window !== "undefined" && isDerivedAptosWalletName(wallet.name)) {
      try {
        window.sessionStorage.removeItem("skip_auto_connect_derived_aptos");
      } catch {
        /* ignore */
      }
    }
    connect(wallet.name);
    onConnect?.();
  };

  const isDerived = isDerivedAptosWalletName(wallet.name);
  const walletLabel =
    mode === "deposit"
      ? getWalletLabel(wallet.name, isConnected, isDerivedSelected)
      : wallet.name;
  const displayLabel = displayNameOverride ?? walletLabel;

  return (
    <div className="flex items-center justify-between px-4 py-3 gap-4 border rounded-md">
      <div className="flex items-center gap-4 min-w-0">
        {wallet.icon ? (
          <img src={wallet.icon} alt="" className="h-6 w-6 rounded shrink-0" />
        ) : null}
        <span className="text-base font-normal truncate">{displayLabel}</span>
      </div>
      {isInstallRequired(wallet) ? (
        <Button size="sm" variant="ghost" asChild>
          <a href={wallet.url} target="_blank" rel="noopener noreferrer">
            Install
          </a>
        </Button>
      ) : mode === "deposit" && isConnected && isDerived ? (
        <Button size="sm" variant="secondary" disabled>
          Connected
        </Button>
      ) : (
        <Button size="sm" type="button" disabled={isConnecting} onClick={handleConnect}>
          {isConnecting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Connecting...
            </>
          ) : (
            "Connect"
          )}
        </Button>
      )}
    </div>
  );
}

function renderEducationScreen(screen: AboutAptosConnectEducationScreen) {
  return (
    <>
      <DialogHeader className="grid grid-cols-[1fr_4fr_1fr] items-center space-y-0">
        <Button variant="ghost" size="icon" onClick={screen.cancel}>
          <ArrowLeft />
        </Button>
        <DialogTitle className="leading-snug text-base text-center">About Aptos Connect</DialogTitle>
      </DialogHeader>

      <div className="flex h-[162px] pb-3 items-end justify-center">
        <screen.Graphic />
      </div>
      <div className="flex flex-col gap-2 text-center pb-4">
        <screen.Title className="text-xl" />
        <screen.Description className="text-sm text-muted-foreground [&>a]:underline [&>a]:underline-offset-4 [&>a]:text-foreground" />
      </div>

      <div className="grid grid-cols-3 items-center">
        <Button size="sm" variant="ghost" onClick={screen.back} className="justify-self-start">
          Back
        </Button>
        <div className="flex items-center gap-2 place-self-center">
          {screen.screenIndicators.map((ScreenIndicator, i) => (
            <ScreenIndicator key={i} className="py-4">
              <div className="h-0.5 w-6 transition-colors bg-muted [[data-active]>&]:bg-foreground" />
            </ScreenIndicator>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={screen.next} className="gap-2 justify-self-end">
          {screen.screenIndex === screen.totalScreens - 1 ? "Finish" : "Next"}
          <ArrowRight size={16} />
        </Button>
      </div>
    </>
  );
}
