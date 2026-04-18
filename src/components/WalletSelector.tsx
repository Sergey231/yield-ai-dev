"use client";

import { WalletSortingOptions, truncateAddress, useWallet } from "@aptos-labs/wallet-adapter-react";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import {
  Copy,
  LogOut,
  Loader2,
  Smartphone,
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

interface WalletSelectorProps extends WalletSortingOptions {
  /** External control for dialog open state */
  externalOpen?: boolean;
  /** Callback when dialog open state changes (for external control) */
  onExternalOpenChange?: (open: boolean) => void;
  /** When opening via `externalOpen`, which chain tab to show initially. */
  externalInitialChainTab?: WalletConnectChainTab;
  /** When true, show a mobile icon button to the left that opens Solana wallet picker (for Mobile Tabs) */
  showMobileWalletButton?: boolean;
}

export function WalletSelector({ externalOpen, onExternalOpenChange, externalInitialChainTab, showMobileWalletButton, ...walletSortingOptions }: WalletSelectorProps) {
  const { account, connected: aptosConnected, disconnect, wallet } = useWallet();
  const { publicKey: solanaPublicKey, connected: solanaConnected, wallet: solanaWallet, disconnect: disconnectSolana, wallets: solanaWallets, select: selectSolana, connect: connectSolana } = useSolanaWallet();
  const [internalDialogOpen, setInternalDialogOpen] = useState(false);
  const [pendingChainTab, setPendingChainTab] = useState<WalletConnectChainTab>("aptos");

  // Use external control if provided, otherwise use internal state
  const isDialogOpen = externalOpen !== undefined ? externalOpen : internalDialogOpen;

  const setDialogOpen = useCallback(
    (open: boolean) => {
      if (onExternalOpenChange !== undefined) {
        onExternalOpenChange(open);
      } else {
        setInternalDialogOpen(open);
      }
      if (!open) {
        setPendingChainTab("aptos");
      }
    },
    [onExternalOpenChange],
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
  const solanaAddress = crossChainSolanaAddress ?? directSolanaAddress ?? adapterSolanaAddress ?? polledSolanaAddress;
  
  // Check if any wallet is connected
  const isAnyWalletConnected = aptosConnected || solanaConnected || !!solanaAddress;
  const isAptosDerived = aptosConnected && !!wallet && isDerivedAptosWalletReliable(wallet);
  const aptosDisplayTitle = isAptosDerived ? "Aptos (Derived Wallet)" : "Aptos";

  useEffect(() => {
    setMounted(true);
  }, []);

  const isAndroidChrome = useMemo(() => {
    if (!mounted) return false;
    const ua = navigator.userAgent || "";
    const isAndroid = /Android/i.test(ua);
    const isChromeMobile = /Chrome\/[.0-9]* Mobile/i.test(ua);
    const isEdge = /Edg/i.test(ua);
    return isAndroid && isChromeMobile && !isEdge;
  }, [mounted]);

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
    if (!account?.address) return;
    try {
      await navigator.clipboard.writeText(account.address.toString());
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
  }, [account?.address, toast]);

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
      // Disconnect both Aptos and Solana if connected
      if (aptosConnected) {
        await disconnect();
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
  }, [aptosConnected, solanaConnected, solanaWallet, solanaAddress, disconnect, disconnectSolana, toast]);

  // Handler for disconnecting only Solana (mirrors /bridge handleDisconnectSolana)
  const handleDisconnectSolanaOnly = useCallback(async () => {
    try {
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
  }, [solanaConnected, solanaWallet, solanaAddress, aptosConnected, wallet, disconnectSolana, disconnect, toast]);

  // Handler for disconnecting only Aptos (mirrors /bridge handleDisconnectAptos)
  const handleDisconnectAptosOnly = useCallback(async () => {
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
        // Clear Solana skip flag so Solana can restore if needed
        window.sessionStorage.removeItem("skip_auto_connect_solana");
      } catch {}
    }
    
    // Save Solana wallet name in case derived disconnect cascades
    let savedSolanaName: string | null = null;
    if (isDerived && typeof window !== "undefined") {
      const fromAdapter = solanaWallet?.adapter?.name;
      const fromStorage = window.localStorage.getItem("walletName");
      let raw = fromAdapter ?? fromStorage;
      if (typeof raw === "string" && raw.startsWith('"') && raw.endsWith('"')) {
        try { raw = JSON.parse(raw) as string; } catch {}
      }
      savedSolanaName = (typeof raw === "string" ? raw.trim() : null) || null;
    }
    
    let disconnectSucceeded = false;
    
    try {
      if (aptosConnected) {
        await disconnect();
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
        toast({ title: "Success", description: "Aptos wallet disconnected" });
      } else {
        toast({
          variant: "destructive",
          title: "Error",
          description: msg || "Failed to disconnect Aptos wallet",
        });
        return;
      }
    }
    
    // Restore Solana if derived disconnect cascaded and cleared walletName
    if (disconnectSucceeded && isDerived && savedSolanaName && typeof window !== "undefined") {
      // Clear skip flag so SolanaWalletRestore can reconnect
      try { window.sessionStorage.removeItem("skip_auto_connect_solana"); } catch {}
      
      const restoreSolana = (attempt: number) => {
        try {
          const currentWalletName = window.localStorage.getItem("walletName");
          const adapterConnected = solanaWallet?.adapter?.connected ?? false;
          console.log(`[WalletSelector] Solana restore check (attempt ${attempt}):`, { savedSolanaName, currentWalletName, adapterConnected });
          
          if (!currentWalletName || !adapterConnected) {
            console.log('[WalletSelector] Restoring Solana walletName:', savedSolanaName);
            window.localStorage.setItem("walletName", JSON.stringify(savedSolanaName));
            // Also try to re-select and connect the wallet directly
            const targetWallet = solanaWallets.find(w => w.adapter.name === savedSolanaName);
            if (targetWallet) {
              selectSolana(savedSolanaName as any);
              setTimeout(async () => {
                try {
                  await connectSolana();
                  console.log('[WalletSelector] Solana reconnected after derived Aptos disconnect');
                } catch (e) {
                  console.log('[WalletSelector] Solana reconnect attempt failed (benign):', e);
                }
              }, 200);
            }
          }
        } catch (e) {
          console.log('[WalletSelector] Error restoring Solana:', e);
        }
      };
      
      // Try at multiple intervals — cascade disconnect is async
      setTimeout(() => restoreSolana(1), 500);
      setTimeout(() => restoreSolana(2), 1500);
      setTimeout(() => restoreSolana(3), 3000);
    }
  }, [aptosConnected, wallet, solanaWallet, solanaWallets, selectSolana, connectSolana, disconnect, toast]);

  if (!mounted) {
    return null;
  }

  // Determine what address to show in the button
  const displayAddress = account?.ansName || 
    truncateAddress(account?.address?.toString()) || 
    (solanaAddress ? truncateAddress(solanaAddress) : null) ||
    "Unknown";

  return (
    <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>
      <div className="flex items-center gap-2">
        {showMobileWalletButton && isAndroidChrome && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setPendingChainTab("aptos");
              setDialogOpen(true);
            }}
            aria-label="Connect wallet"
          >
            <Smartphone className="h-4 w-4" />
          </Button>
        )}
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
              {aptosConnected && account?.address ? (
                <>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="font-mono text-sm truncate">
                      {truncateAddress(account.address.toString())}
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
