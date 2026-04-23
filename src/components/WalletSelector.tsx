"use client";

import { WalletSortingOptions, truncateAddress, useWallet } from "@aptos-labs/wallet-adapter-react";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import {
  Copy,
  LogOut,
  Loader2,
} from "lucide-react";
import { useCallback, useState, useEffect, useMemo } from "react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { useToast } from "./ui/use-toast";
import { getSolanaWalletAddress } from "@/lib/wallet/getSolanaWalletAddress";
import { isDerivedAptosWalletReliable } from "@/lib/aptosWalletUtils";
import {
  CustomAptosConnectDialogContent,
  WALLET_CONNECT_MODAL_DIALOG_CLASS,
  type WalletConnectChainTab,
} from "@/components/wallet/customAptosConnectDialogContent";
import { useNativeWalletStore } from "@/lib/stores/nativeWalletStore";

interface WalletSelectorProps extends WalletSortingOptions {
  /** External control for dialog open state */
  externalOpen?: boolean;
  /** Callback when dialog open state changes (for external control) */
  onExternalOpenChange?: (open: boolean) => void;
  /** When opening via `externalOpen`, which chain tab to show initially. */
  externalInitialChainTab?: WalletConnectChainTab;
}

export function WalletSelector({ externalOpen, onExternalOpenChange, externalInitialChainTab, ...walletSortingOptions }: WalletSelectorProps) {
  const { account, connected: aptosConnected, disconnect, wallet } = useWallet();
  const { publicKey: solanaPublicKey, connected: solanaConnected, wallet: solanaWallet, disconnect: disconnectSolana, wallets: solanaWallets, select: selectSolana, connect: connectSolana } = useSolanaWallet();
  const [internalDialogOpen, setInternalDialogOpen] = useState(false);
  const [pendingChainTab, setPendingChainTab] = useState<WalletConnectChainTab>("aptos");
  const injectedAptosAddress = useNativeWalletStore((s) => s.aptosAddress);
  const injectedSolanaAddress = useNativeWalletStore((s) => s.solanaAddress);
  const setInjectedDisconnected = useNativeWalletStore((s) => s.setDisconnected);
  const hasAnyConnectedWalletForWebView =
    aptosConnected || solanaConnected || !!injectedAptosAddress || !!injectedSolanaAddress;

  // Use external control if provided, otherwise use internal state
  const isDialogOpen = externalOpen !== undefined ? externalOpen : internalDialogOpen;

  const setDialogOpen = useCallback(
    (open: boolean) => {
      // WebView: only trigger native connect flow when NO wallet is connected.
      // If at least one wallet is already connected, avoid opening native connect UI (e.g. user may be disconnecting).
      if (open && !hasAnyConnectedWalletForWebView && (window as any)?.ReactNativeWebView?.postMessage) {
        const w = window as any;
        if (w?.YieldAIBridge?.post) {
          w.YieldAIBridge.post("connect_wallet", { chain: pendingChainTab });
        }
        return;
      }
      if (onExternalOpenChange !== undefined) {
        onExternalOpenChange(open);
      } else {
        setInternalDialogOpen(open);
      }
      if (!open) {
        setPendingChainTab("aptos");
      }
    },
    [onExternalOpenChange, pendingChainTab, hasAnyConnectedWalletForWebView],
  );

  useEffect(() => {
    if (isDialogOpen && externalOpen !== undefined && externalInitialChainTab) {
      setPendingChainTab(externalInitialChainTab);
    }
  }, [isDialogOpen, externalOpen, externalInitialChainTab]);
  const [mounted, setMounted] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const { toast } = useToast();

  // Cross-chain Solana address (from Aptos derived wallet)
  const crossChainSolanaAddress = useMemo(() => getSolanaWalletAddress(wallet), [wallet]);
  
  // Direct Solana address (from Solana adapter)
  const directSolanaAddress = useMemo(() => {
    if (!solanaConnected || !solanaPublicKey) return null;
    return solanaPublicKey.toBase58();
  }, [solanaConnected, solanaPublicKey]);
  
  // Also check adapter state directly for wallets where hook state can lag.
  const adapterSolanaAddress = useMemo(() => {
    if (!solanaWallet?.adapter?.connected) return null;
    return solanaWallet.adapter.publicKey?.toBase58() ?? null;
  }, [solanaWallet]);
  
  // Polled address state for Phantom (which doesn't trigger React updates properly)
  const [polledSolanaAddress, setPolledSolanaAddress] = useState<string | null>(null);
  
  // Effective Solana address - prefer cross-chain, then direct, then adapter, then polled
  const solanaAddress =
    injectedSolanaAddress ??
    crossChainSolanaAddress ??
    directSolanaAddress ??
    adapterSolanaAddress ??
    polledSolanaAddress;

  const aptosAddress = injectedAptosAddress ?? account?.address?.toString() ?? null;
  
  // Check if any wallet is connected
  const isAnyWalletConnected = aptosConnected || solanaConnected || !!solanaAddress || !!aptosAddress;
  const isAptosDerived = aptosConnected && !!wallet && isDerivedAptosWalletReliable(wallet);
  const aptosDisplayTitle = isAptosDerived ? "Aptos (Derived Wallet)" : "Aptos";

  useEffect(() => {
    setMounted(true);
  }, []);

  const isInWebView = useMemo(() => {
    if (!mounted) return false;
    return !!(window as any)?.ReactNativeWebView?.postMessage;
  }, [mounted]);

  const isWebViewNow = useCallback(() => {
    if (typeof window === "undefined") return false;
    return Boolean((window as any)?.ReactNativeWebView?.postMessage);
  }, []);

  const requestNativeConnectWallet = useCallback((chainTab: WalletConnectChainTab) => {
    const w = window as any;
    if (w?.YieldAIBridge?.post) {
      w.YieldAIBridge.post("connect_wallet", { chain: chainTab });
    }
  }, []);

  // Poll adapter state for Phantom (which doesn't trigger React state updates properly)
  useEffect(() => {
    if (!solanaWallet?.adapter) return;
    
    // If we already have an address from other sources, no need to poll
    if (crossChainSolanaAddress || directSolanaAddress || adapterSolanaAddress) {
      setPolledSolanaAddress(null);
      return;
    }
    
    const checkAdapter = () => {
      if (!solanaWallet.adapter.connected) {
        setPolledSolanaAddress(null);
        return;
      }
      const adapterPk = solanaWallet.adapter.publicKey?.toBase58() ?? null;
      if (adapterPk && adapterPk !== polledSolanaAddress) {
        console.log('[WalletSelector] Adapter publicKey detected via polling:', adapterPk);
        setPolledSolanaAddress(adapterPk);
      }
    };
    
    // Check immediately and then poll
    checkAdapter();
    const interval = setInterval(checkAdapter, 500);
    
    // Stop polling after 10 seconds
    const timeout = setTimeout(() => clearInterval(interval), 10000);
    
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [solanaWallet, crossChainSolanaAddress, directSolanaAddress, adapterSolanaAddress, polledSolanaAddress]);

  // Reset connecting state when wallet connects
  useEffect(() => {
    if (aptosConnected || solanaConnected) {
      // connecting state from wallet adapter will be reset automatically
    }
  }, [aptosConnected, solanaConnected]);

  const closeDialog = useCallback(() => setDialogOpen(false), [setDialogOpen]);

  const copyAddress = useCallback(async () => {
    if (!aptosAddress) return;
    try {
      await navigator.clipboard.writeText(aptosAddress);
      toast({
        title: "Success",
        description: "Copied wallet address to clipboard",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to copy wallet address",
      });
    }
  }, [aptosAddress, toast]);

  const copySolanaAddress = useCallback(async () => {
    if (!solanaAddress) return;
    try {
      await navigator.clipboard.writeText(solanaAddress);
      toast({
        title: "Success",
        description: "Copied Solana address to clipboard",
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to copy Solana address",
      });
    }
  }, [solanaAddress, toast]);

  const handleDisconnect = useCallback(async () => {
    try {
      // WebView mode: native owns wallet sessions; request native disconnect and exit.
      if (isWebViewNow()) {
        (window as any)?.YieldAIBridge?.post?.("disconnect_wallet", { chain: "all" });
        return;
      }
      // Disconnect both Aptos and Solana if connected
      if (aptosConnected) {
        await disconnect();
      }
      if (injectedAptosAddress) {
        setInjectedDisconnected("aptos");
      }
      if (solanaConnected || solanaWallet?.adapter?.connected || !!solanaAddress) {
        try {
          await disconnectSolana();
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          const name = (error as { name?: string })?.name;
          const isBenign =
            name === "WalletDisconnectedError" ||
            name === "WalletNotConnectedError" ||
            msg.includes("WalletDisconnectedError") ||
            msg.includes("WalletNotConnectedError");
          if (!isBenign) throw error;
        }
      }
      if (injectedSolanaAddress) {
        setInjectedDisconnected("solana");
      }
      setPolledSolanaAddress(null);
      toast({
        title: "Success",
        description: "Wallet disconnected successfully",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to disconnect wallet",
      });
    }
  }, [
    aptosConnected,
    solanaConnected,
    solanaWallet,
    solanaAddress,
    disconnect,
    disconnectSolana,
    toast,
    injectedAptosAddress,
    injectedSolanaAddress,
    setInjectedDisconnected,
  ]);

  // Handler for disconnecting only Solana (mirrors /bridge handleDisconnectSolana)
  const handleDisconnectSolanaOnly = useCallback(async () => {
    try {
      // WebView mode: native owns wallet sessions; request native disconnect and exit.
      if (isWebViewNow()) {
        (window as any)?.YieldAIBridge?.post?.("disconnect_wallet", { chain: "solana" });
        return;
      }
      // Determine if current Aptos is derived
      const isAptosDerived = aptosConnected && wallet && isDerivedAptosWalletReliable(wallet);
      
      // Get native Aptos name (if any) to preserve it
      let savedAptosNativeName: string | null = null;
      if (typeof window !== "undefined") {
        const rawAptos = window.localStorage.getItem("AptosWalletName");
        if (rawAptos) {
          try {
            let parsed = rawAptos;
            try { parsed = JSON.parse(rawAptos) as string; } catch {}
            if (parsed && !parsed.endsWith(' (Solana)')) {
              savedAptosNativeName = parsed;
            }
          } catch {}
        }
      }
      if (!savedAptosNativeName && wallet?.name && !wallet.name.endsWith(' (Solana)') && aptosConnected) {
        savedAptosNativeName = wallet.name;
      }
      
      console.log('[WalletSelector] handleDisconnectSolanaOnly:', { isAptosDerived, savedAptosNativeName });
      
      // Set skip flags BEFORE disconnect
      if (typeof window !== "undefined") {
        try { window.sessionStorage.setItem("skip_auto_connect_solana", "1"); } catch {}
      }
      
      // If Aptos is derived, disconnect it first (it depends on Solana)
      if (isAptosDerived) {
        console.log('[WalletSelector] Disconnecting derived Aptos before Solana');
        if (typeof window !== "undefined") {
          try {
            sessionStorage.setItem("skip_auto_connect_derived_aptos", "1");
          } catch {}
        }
        try {
          await disconnect();
        } catch (e) {
          console.log('[WalletSelector] disconnect derived Aptos error (benign):', e);
        }
        if (typeof window !== "undefined") {
          try { window.localStorage.removeItem("AptosWalletName"); } catch {}
        }
      }
      
      // Disconnect Solana
      if (solanaConnected || solanaWallet?.adapter?.connected || !!solanaAddress) {
        try {
          await disconnectSolana();
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          const name = (error as { name?: string })?.name;
          const isBenign =
            name === "WalletDisconnectedError" ||
            name === "WalletNotConnectedError" ||
            msg.includes("WalletDisconnectedError") ||
            msg.includes("WalletNotConnectedError");
          if (!isBenign) throw error;
        }
      }
      if (injectedSolanaAddress) {
        setInjectedDisconnected("solana");
      }
      setPolledSolanaAddress(null);
      
      // Clean up localStorage
      if (typeof window !== "undefined") {
        try { window.localStorage.removeItem("walletName"); } catch {}
      }
      
      toast({ title: "Success", description: "Solana wallet disconnected" });
      
      // If native Aptos was connected, ensure its AptosWalletName is preserved
      // (cascade disconnect from Solana might have cleared it)
      if (savedAptosNativeName) {
        setTimeout(() => {
          if (typeof window !== "undefined") {
            try { window.localStorage.setItem("AptosWalletName", savedAptosNativeName!); } catch {}
          }
        }, 500);
      }
      
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to disconnect Solana wallet",
      });
    }
  }, [
    solanaConnected,
    solanaWallet,
    solanaAddress,
    aptosConnected,
    wallet,
    disconnectSolana,
    disconnect,
    toast,
    injectedSolanaAddress,
    setInjectedDisconnected,
  ]);

  // Handler for disconnecting only Aptos (mirrors /bridge handleDisconnectAptos)
  const handleDisconnectAptosOnly = useCallback(async () => {
    // WebView mode: native owns wallet sessions; request native disconnect and exit.
    if (isWebViewNow()) {
      (window as any)?.YieldAIBridge?.post?.("disconnect_wallet", { chain: "aptos" });
      return;
    }
    const isDerived = wallet && isDerivedAptosWalletReliable(wallet);
    console.log('[WalletSelector] handleDisconnectAptosOnly:', { isDerived, walletName: wallet?.name });
    
    // Set skip flag to prevent derived auto-reconnect
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem("skip_auto_connect_derived_aptos", "1");
      } catch {}
    }

    // Remove AptosWalletName from localStorage BEFORE disconnect
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem("AptosWalletName");
      } catch {}
    }
    
    let disconnectSucceeded = false;
    
    // Derived Aptos disconnect can call into Solana adapter disconnect() internally.
    // We must keep Solana connected, so we temporarily no-op Solana disconnect for this action.
    const solanaAdapter = (solanaWallet as unknown as { adapter?: { disconnect?: () => Promise<void>; connected?: boolean } })?.adapter;
    const shouldShieldSolanaDisconnect = Boolean(isDerived && solanaAdapter?.connected && typeof solanaAdapter?.disconnect === "function");
    const originalSolanaDisconnect = shouldShieldSolanaDisconnect ? solanaAdapter!.disconnect : undefined;
    if (shouldShieldSolanaDisconnect) {
      solanaAdapter!.disconnect = async () => {
        console.log("[WalletSelector] Shielded Solana disconnect during derived Aptos disconnect");
      };
    }

    // Some derived flows call Phantom provider directly (window.solana.disconnect()).
    // Shield those too, otherwise Solana will still drop.
    const win = typeof window !== "undefined" ? (window as unknown as any) : null;
    const wSolana = win?.solana;
    const wPhantomSolana = win?.phantom?.solana;
    const shouldShieldWindowSolanaDisconnect =
      Boolean(isDerived && (wSolana?.isPhantom || wPhantomSolana?.isPhantom) && (typeof wSolana?.disconnect === "function" || typeof wPhantomSolana?.disconnect === "function"));
    const originalWindowSolanaDisconnect = shouldShieldWindowSolanaDisconnect && typeof wSolana?.disconnect === "function" ? wSolana.disconnect : undefined;
    const originalWindowPhantomSolanaDisconnect = shouldShieldWindowSolanaDisconnect && typeof wPhantomSolana?.disconnect === "function" ? wPhantomSolana.disconnect : undefined;
    if (shouldShieldWindowSolanaDisconnect) {
      if (typeof wSolana?.disconnect === "function") {
        wSolana.disconnect = async () => {
          console.log("[WalletSelector] Shielded window.solana.disconnect during derived Aptos disconnect");
        };
      }
      if (typeof wPhantomSolana?.disconnect === "function") {
        wPhantomSolana.disconnect = async () => {
          console.log("[WalletSelector] Shielded window.phantom.solana.disconnect during derived Aptos disconnect");
        };
      }
    }

    try {
      if (aptosConnected) {
        await disconnect();
      }
      if (injectedAptosAddress) {
        setInjectedDisconnected("aptos");
      }
      disconnectSucceeded = true;
      toast({ title: "Success", description: "Aptos wallet disconnected" });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const name = (error as { name?: string })?.name;
      const isBenign =
        name === "WalletDisconnectedError" ||
        name === "WalletNotConnectedError" ||
        msg.includes("WalletDisconnectedError") ||
        msg.includes("WalletNotConnectedError");
      const isUserRejected =
        msg === "User has rejected the request" ||
        msg.includes("User rejected") ||
        msg.includes("rejected the request");
      const isDerivedSoftError = isDerived && !isUserRejected;
      
      console.log('[WalletSelector] disconnect Aptos error:', { msg, isBenign, isDerivedSoftError, isUserRejected });
      
      if (isUserRejected) {
        return; // User rejected - don't continue
      } else if (isBenign || isDerivedSoftError) {
        disconnectSucceeded = true;
        if (injectedAptosAddress) {
          setInjectedDisconnected("aptos");
        }
        toast({ title: "Success", description: "Aptos wallet disconnected" });
      } else {
        toast({
          variant: "destructive",
          title: "Error",
          description: msg || "Failed to disconnect Aptos wallet",
        });
        return;
      }
    } finally {
      if (shouldShieldSolanaDisconnect && originalSolanaDisconnect) {
        solanaAdapter!.disconnect = originalSolanaDisconnect;
      }
      if (shouldShieldWindowSolanaDisconnect) {
        if (originalWindowSolanaDisconnect && wSolana) wSolana.disconnect = originalWindowSolanaDisconnect;
        if (originalWindowPhantomSolanaDisconnect && wPhantomSolana) wPhantomSolana.disconnect = originalWindowPhantomSolanaDisconnect;
      }
    }
  }, [
    aptosConnected,
    wallet,
    solanaWallet,
    solanaWallets,
    selectSolana,
    connectSolana,
    disconnect,
    toast,
    injectedAptosAddress,
    setInjectedDisconnected,
  ]);

  if (!mounted) {
    return null;
  }

  // Determine what address to show in the button
  const displayAddress = account?.ansName || 
    truncateAddress(aptosAddress || undefined) || 
    (solanaAddress ? truncateAddress(solanaAddress) : null) ||
    "Unknown";

  return (
    <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>
      <div className="flex items-center gap-2">
        {isAnyWalletConnected ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button>
              {displayAddress}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {/* Solana Block */}
            <div className="px-3 py-2 border-b">
              <p className="text-xs font-medium uppercase text-muted-foreground mb-2">
                Solana
              </p>
              {solanaAddress ? (
                <>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="font-mono text-sm truncate">
                      {truncateAddress(solanaAddress)}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      onClick={copySolanaAddress}
                      aria-label="Copy Solana address"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
                    onClick={handleDisconnectSolanaOnly}
                  >
                    <LogOut className="h-4 w-4" /> Disconnect
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() => {
                    setPendingChainTab("solana");
                    if (isWebViewNow()) {
                      requestNativeConnectWallet("solana");
                      return;
                    }
                    setDialogOpen(true);
                  }}
                >
                  Connect Solana
                </Button>
              )}
            </div>

            {/* Aptos Block */}
            <div className="px-3 py-2">
              <p className="text-xs font-medium uppercase text-muted-foreground mb-2">
                {aptosDisplayTitle}
              </p>
              {aptosAddress ? (
                <>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="font-mono text-sm truncate">
                      {truncateAddress(aptosAddress || undefined)}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      onClick={copyAddress}
                      aria-label="Copy Aptos address"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
                    onClick={handleDisconnectAptosOnly}
                  >
                    <LogOut className="h-4 w-4" /> Disconnect
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() => {
                    setPendingChainTab("aptos");
                    if (isWebViewNow()) {
                      requestNativeConnectWallet("aptos");
                      return;
                    }
                    setDialogOpen(true);
                  }}
                >
                  Connect Aptos
                </Button>
              )}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        isInWebView ? (
          <Button
            disabled={isConnecting}
            data-action="connect_wallet"
            onClick={() => requestNativeConnectWallet("all")}
          >
            {isConnecting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Connecting...
              </>
            ) : (
              "Connect Wallet"
            )}
          </Button>
        ) : (
          <DialogTrigger asChild>
            <Button disabled={isConnecting} data-action="connect_wallet">
              {isConnecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                "Connect Wallet"
              )}
            </Button>
          </DialogTrigger>
        )
      )}
      </div>

      <DialogContent className={WALLET_CONNECT_MODAL_DIALOG_CLASS}>
        <CustomAptosConnectDialogContent
          close={closeDialog}
          isConnecting={isConnecting}
          dialogOpen={isDialogOpen}
          initialChainTabOnOpen={pendingChainTab}
          {...walletSortingOptions}
        />
      </DialogContent>
    </Dialog>
  );
}
