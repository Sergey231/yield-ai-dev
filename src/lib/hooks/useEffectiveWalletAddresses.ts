"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallet as useAptosWallet } from "@aptos-labs/wallet-adapter-react";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { useNativeWalletStore } from "@/lib/stores/nativeWalletStore";

export interface EffectiveWalletAddresses {
  effectiveAptosAddress: string | null;
  effectiveSolanaOverrideAddress: string | null;
  isInWebView: boolean;
}

export function useEffectiveWalletAddresses(): EffectiveWalletAddresses {
  const { account } = useAptosWallet();
  const { publicKey, connected, wallet } = useSolanaWallet();

  const injectedAptosAddress = useNativeWalletStore((s) => s.aptosAddress);
  const injectedSolanaAddress = useNativeWalletStore((s) => s.solanaAddress);

  const [isInWebView, setIsInWebView] = useState(false);

  useEffect(() => {
    const readIsNativeWrapper = () => {
      if (typeof window === "undefined") return false;
      return Boolean(
        (window as any)?.ReactNativeWebView?.postMessage &&
        (window as any)?.__YIELDAI_NATIVE_APP__ === true,
      );
    };

    setIsInWebView(readIsNativeWrapper());
    const onNativeReady = () => setIsInWebView(readIsNativeWrapper());
    window.addEventListener("yieldai:native-ready", onNativeReady);
    return () => {
      window.removeEventListener("yieldai:native-ready", onNativeReady);
    };
  }, []);

  const effectiveAptosAddress = injectedAptosAddress ?? account?.address?.toString() ?? null;

  const adapterSolanaAddress =
    connected && publicKey ? publicKey.toBase58() : wallet?.adapter?.publicKey?.toBase58() ?? null;

  return {
    effectiveAptosAddress,
    effectiveSolanaOverrideAddress: injectedSolanaAddress ?? null,
    isInWebView,
  };
}
