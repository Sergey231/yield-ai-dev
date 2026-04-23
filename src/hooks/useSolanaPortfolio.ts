import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWallet as useAptosWallet } from "@aptos-labs/wallet-adapter-react";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { getSolanaWalletAddress } from "@/lib/wallet/getSolanaWalletAddress";
import { Token } from "@/lib/types/token";
import { useNativeWalletStore } from "@/lib/stores/nativeWalletStore";

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
  const injectedSolanaAddress = useNativeWalletStore((s) => s.solanaAddress);
  const effectiveOverrideAddress = injectedSolanaAddress?.trim() || overrideAddress;
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

    if (effectiveOverrideAddress) {
      setAddress(effectiveOverrideAddress);
      addressRef.current = effectiveOverrideAddress;
      return;
    }

    const effectiveAddress = computeEffectiveAddress();
    setAddress(effectiveAddress);
    addressRef.current = effectiveAddress;
    if (!effectiveAddress) {
      setTokens([]);
      setTotalValueUsd(null);
    }
  }, [enabled, effectiveOverrideAddress, computeEffectiveAddress]);

  // Poll adapter state for Phantom (which doesn't trigger React state updates properly).
  // This must handle BOTH connect and disconnect to avoid stale "connected" sessions.
  useEffect(() => {
    if (!enabled || effectiveOverrideAddress) return;
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
  }, [enabled, effectiveOverrideAddress, solanaWallet, computeEffectiveAddress]);

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
      const storageKey = `solana_portfolio_cache:${currentAddress}`;

      const readLocalSnapshot = (): { atMs: number; tokens: Token[]; totalValueUsd: number | null } | null => {
        if (typeof window === "undefined") return null;
        try {
          const raw = window.localStorage.getItem(storageKey);
          if (!raw) return null;
          const parsed = JSON.parse(raw) as any;
          const atMs = typeof parsed?.atMs === "number" ? parsed.atMs : 0;
          const tokens = Array.isArray(parsed?.tokens) ? (parsed.tokens as Token[]) : [];
          const tv = typeof parsed?.totalValueUsd === "number" ? parsed.totalValueUsd : null;
          if (!Number.isFinite(atMs) || tokens.length === 0) return null;
          return { atMs, tokens, totalValueUsd: tv };
        } catch {
          return null;
        }
      };

      const writeLocalSnapshot = (tokens: Token[], totalValueUsd: number | null) => {
        if (typeof window === "undefined") return;
        try {
          window.localStorage.setItem(
            storageKey,
            JSON.stringify({
              atMs: Date.now(),
              tokens,
              totalValueUsd,
            })
          );
        } catch {
          // ignore
        }
      };

      const mergeWithLocalSnapshot = (incoming: Token[], snapshot: Token[]): Token[] => {
        const byMint = new Map<string, Token>();
        for (const t of snapshot) {
          if (t?.address) byMint.set(t.address, t);
        }
        return incoming.map((t) => {
          const cached = t?.address ? byMint.get(t.address) : undefined;
          if (!cached) return t;
          return {
            ...t,
            // Only fill gaps; never override fresh data.
            symbol: (t.symbol || "").trim() ? t.symbol : cached.symbol,
            name: (t.name || "").trim() ? t.name : cached.name,
            decimals: Number.isFinite(t.decimals) ? t.decimals : cached.decimals,
            logoUrl: t.logoUrl || cached.logoUrl,
            price: t.price != null ? t.price : cached.price,
            value: t.value != null ? t.value : cached.value,
          };
        });
      };

      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const shouldRetry = (data: any) => {
        const tokens = Array.isArray(data?.tokens) ? data.tokens : [];
        // Retry if response is "structurally" missing data that normally exists:
        // - empty tokens (often transient on cold start)
        // - OR tokens exist but all have null/undefined price AND value (price fetch transient)
        if (tokens.length === 0) return true;
        const hasAnyPriced = tokens.some((t: any) => t?.price != null || t?.value != null);
        if (!hasAnyPriced) return true;
        return false;
      };

      let response: Response | null = null;
      let data: any = null;

      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        response = await fetch(`/api/solana/portfolio?address=${currentAddress}`, { cache: "no-store" });
        try {
          data = await response.json();
        } catch {
          data = null;
        }
        
        // Stop if address changed mid-flight.
        if (addressRef.current !== currentAddress) return;

        const ok = Boolean(response.ok);
        const retryable = !ok || shouldRetry(data);
        if (!retryable || attempt === maxAttempts) break;

        // Exponential-ish backoff (2s, 4s) to ride out cold starts / transient RPC/Jupiter hiccups.
        const delayMs = attempt === 1 ? 2000 : 4000;
        await sleep(delayMs);
      }
      
      console.log(`[useSolanaPortfolio] 📥 API response received:`, {
        ok: response?.ok,
        status: response?.status,
        tokensCount: data?.tokens?.length || 0,
        totalValueUsd: data?.totalValueUsd,
        tokens: data?.tokens?.map((t: any) => ({
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
      if (!response?.ok) {
        console.warn("Solana portfolio API returned error:", response?.status, data?.error);
        // Don't overwrite existing tokens on temporary errors to avoid flaky UI state (N/A).
        return;
      }

      const incomingTokens: Token[] = Array.isArray(data?.tokens) ? (data.tokens as Token[]) : [];
      const snapshot = readLocalSnapshot();
      const mergedTokens = snapshot ? mergeWithLocalSnapshot(incomingTokens, snapshot.tokens) : incomingTokens;
      const mergedHasAnyPriced = mergedTokens.some((t) => t?.price != null || t?.value != null);
      const mergedHasAnyLogo = mergedTokens.some((t) => Boolean(t?.logoUrl));
      const incomingLooksCold = shouldRetry({ tokens: incomingTokens });

      // If server responded OK but looks like a cold/partial payload (prices/logos missing),
      // prefer showing the last local snapshot until the next refresh fills in the gaps.
      if (incomingLooksCold && snapshot && (mergedHasAnyPriced || mergedHasAnyLogo)) {
        setTokens(snapshot.tokens);
        setTotalValueUsd(snapshot.totalValueUsd);
        return;
      }

      console.log(`[useSolanaPortfolio] ✅ Setting tokens and totalValueUsd:`, {
        tokensCount: mergedTokens.length || 0,
        totalValueUsd: data?.totalValueUsd,
      });
      
      setTokens(mergedTokens);
      setTotalValueUsd(
        typeof data?.totalValueUsd === "number" ? data.totalValueUsd : null,
      );

      // Persist snapshot for offline/cold-start UI fallback (icons, symbols, last known prices).
      if (mergedTokens.length > 0) {
        writeLocalSnapshot(mergedTokens, typeof data?.totalValueUsd === "number" ? data.totalValueUsd : null);
      }
    } catch (error) {
      console.error("Error fetching Solana portfolio:", error);
      // Don't clear existing tokens on temporary errors to avoid flaky UI state.
    } finally {
      if (addressRef.current === currentAddress) {
        setIsLoading(false);
      }
    }
  }, [enabled]);

  // Allow other parts of the app (e.g. SwapModal) to trigger a refresh for all hook instances.
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ address?: string | null }>;
      const target = ce?.detail?.address ?? null;
      const current = addressRef.current ?? null;
      // If address is specified, refresh only matching sessions. If not specified, refresh current session.
      if (target && current && target !== current) return;
      void refresh();
    };

    window.addEventListener("solana-portfolio:refresh", handler as EventListener);
    return () => window.removeEventListener("solana-portfolio:refresh", handler as EventListener);
  }, [enabled, refresh]);

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
    effectiveOverrideAddress && clientReady && address === effectiveOverrideAddress
      ? effectiveOverrideAddress
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

