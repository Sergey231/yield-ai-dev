import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWallet as useAptosWallet } from "@aptos-labs/wallet-adapter-react";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { getSolanaWalletAddress } from "@/lib/wallet/getSolanaWalletAddress";
import { Token } from "@/lib/types/token";

/** Same key as @solana/wallet-adapter-react WalletProvider `localStorageKey` (see SolanaProvider). */
const SOLANA_WALLET_NAME_STORAGE_KEY = "walletName";

function readPersistedSolanaWalletName(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem(SOLANA_WALLET_NAME_STORAGE_KEY);
    if (raw == null || raw === "") return "";
    try {
      const parsed = JSON.parse(raw) as unknown;
      return typeof parsed === "string" && parsed.length > 0 ? parsed : "";
    } catch {
      return raw.length > 0 ? raw : "";
    }
  } catch {
    return "";
  }
}

interface SolanaPortfolioState {
  address: string | null;
  /**
   * Use for Kamino/Jupiter fetches and sidebar "checking":
   * - null until client mount and while adapter is connecting/disconnecting
   * - Trusted session = React `connected` + publicKey, OR (saved `walletName` + adapter connected
   *   + publicKey) so Phantom works; cold domains without `walletName` skip adapter-only ghosts.
   */
  protocolsAddress: string | null;
  tokens: Token[];
  totalValueUsd: number | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

interface UseSolanaPortfolioOptions {
  enabled?: boolean;
  /**
   * Read-only portfolio for this Solana address (from /portfolio/[address] URL).
   * When set, connected wallet address is ignored for data fetching.
   */
  overrideAddress?: string | null;
}

export function useSolanaPortfolio(options?: UseSolanaPortfolioOptions): SolanaPortfolioState {
  const enabled = options?.enabled ?? true;
  const overrideAddress = options?.overrideAddress?.trim() || null;
  // 1) Aptos cross-chain wallet (Trust / derived) — даёт solanaWallet внутри себя.
  const { wallet: aptosWallet } = useAptosWallet();
  // 2) Обычный Solana-адаптер — независимое подключение Solana.
  const {
    publicKey: solanaPublicKey,
    connected: solanaConnected,
    connecting: solanaConnecting,
    disconnecting: solanaDisconnecting,
    wallet: solanaWallet,
  } = useSolanaWallet();
  const [address, setAddress] = useState<string | null>(null);
  const [clientReady, setClientReady] = useState(false);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [totalValueUsd, setTotalValueUsd] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const addressRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    setClientReady(true);
  }, []);

  // Force re-render trigger for adapter state changes (Phantom doesn't trigger React updates)
  const [, forceUpdate] = useState(0);

  const computeEffectiveAddress = useCallback((): string | null => {
    const derivedAddress = getSolanaWalletAddress(aptosWallet ?? null);

    // Try multiple sources for Solana address:
    // 1) Hook's publicKey (may be out of sync with adapter)
    // 2) Adapter's publicKey directly (more reliable for Phantom)
    const hookAddress = solanaConnected && solanaPublicKey ? solanaPublicKey.toBase58() : null;
    const adapterAddress =
      solanaWallet?.adapter?.connected ? (solanaWallet.adapter.publicKey?.toBase58() ?? null) : null;
    const fallbackAddress = hookAddress ?? adapterAddress;

    // IMPORTANT: when a direct Solana adapter is connected (Phantom/Solflare/Trust),
    // it should take priority over the Aptos-derived cross-chain address.
    // Otherwise, switching wallets can leave a stale address from previous adapter.
    const hasDirectSolanaSession = !!solanaConnected || !!solanaWallet?.adapter?.connected;
    return hasDirectSolanaSession ? (fallbackAddress ?? derivedAddress) : (derivedAddress ?? fallbackAddress);
  }, [aptosWallet, solanaConnected, solanaPublicKey, solanaWallet]);

  useEffect(() => {
    if (!enabled) {
      setAddress(null);
      addressRef.current = null;
      setTokens([]);
      setTotalValueUsd(null);
      setIsLoading(false);
      return;
    }

    if (overrideAddress) {
      setAddress(overrideAddress);
      addressRef.current = overrideAddress;
      return;
    }

    const effectiveAddress = computeEffectiveAddress();
    setAddress(effectiveAddress);
    addressRef.current = effectiveAddress;
    if (!effectiveAddress) {
      setTokens([]);
      setTotalValueUsd(null);
    }
  }, [enabled, overrideAddress, computeEffectiveAddress]);

  // Poll adapter state for Phantom (which doesn't trigger React state updates properly).
  // This must handle BOTH connect and disconnect to avoid stale "connected" sessions.
  useEffect(() => {
    if (!enabled || overrideAddress) return;
    if (!solanaWallet?.adapter) return;
    
    const checkAdapter = () => {
      const next = computeEffectiveAddress();
      if (next !== addressRef.current) {
        setAddress(next);
        addressRef.current = next;
        if (!next) {
          setTokens([]);
          setTotalValueUsd(null);
        }
        forceUpdate((n) => n + 1);
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
  }, [enabled, overrideAddress, solanaWallet, computeEffectiveAddress]);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setTokens([]);
      setTotalValueUsd(null);
      setIsLoading(false);
      return;
    }

    if (!addressRef.current) {
      setTokens([]);
      setTotalValueUsd(null);
      return;
    }

    const currentAddress = addressRef.current;
    setIsLoading(true);

    try {
      const response = await fetch(
        `/api/solana/portfolio?address=${currentAddress}`,
        { cache: "no-store" },
      );

      const data = await response.json();
      
      console.log(`[useSolanaPortfolio] 📥 API response received:`, {
        ok: response.ok,
        status: response.status,
        tokensCount: data.tokens?.length || 0,
        totalValueUsd: data.totalValueUsd,
        tokens: data.tokens?.map((t: any) => ({
          address: t.address,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          price: t.price,
          value: t.value,
          hasLogoUrl: !!t.logoUrl,
          logoUrl: t.logoUrl,
        })) || [],
      });
      
      if (addressRef.current !== currentAddress) {
        return;
      }

      // Even if response is not ok, try to use the data if available
      // This allows partial data to be displayed if RPC fails but we have cached data
      if (!response.ok) {
        console.warn("Solana portfolio API returned error:", response.status, data.error);
        // Don't throw error, just use empty/default data
        setTokens(data.tokens ?? []);
        setTotalValueUsd(
          typeof data.totalValueUsd === "number" ? data.totalValueUsd : null,
        );
        return;
      }

      console.log(`[useSolanaPortfolio] ✅ Setting tokens and totalValueUsd:`, {
        tokensCount: data.tokens?.length || 0,
        totalValueUsd: data.totalValueUsd,
      });
      
      setTokens(data.tokens ?? []);
      setTotalValueUsd(
        typeof data.totalValueUsd === "number" ? data.totalValueUsd : null,
      );
    } catch (error) {
      console.error("Error fetching Solana portfolio:", error);
      // Don't clear existing tokens on temporary errors to avoid flaky UI state.
    } finally {
      if (addressRef.current === currentAddress) {
        setIsLoading(false);
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled && address) {
      refresh();
    }
  }, [enabled, address, refresh]);

  const persistedWalletName = clientReady ? readPersistedSolanaWalletName() : "";
  const sessionFromReact = solanaConnected && !!solanaPublicKey;
  const adapterPk = solanaWallet?.adapter?.publicKey;
  const hasAnyPublicKey = !!(solanaPublicKey ?? adapterPk);
  const sessionFromAdapterWhenPersisted =
    persistedWalletName.length > 0 &&
    !!solanaWallet?.adapter?.connected &&
    hasAnyPublicKey;

  const protocolsAddress =
    overrideAddress && clientReady && address === overrideAddress
      ? overrideAddress
      : clientReady &&
          !solanaConnecting &&
          !solanaDisconnecting &&
          address &&
          (sessionFromReact || sessionFromAdapterWhenPersisted)
        ? address
        : null;

  return {
    address,
    protocolsAddress,
    tokens,
    totalValueUsd,
    isLoading,
    refresh,
  };
}

