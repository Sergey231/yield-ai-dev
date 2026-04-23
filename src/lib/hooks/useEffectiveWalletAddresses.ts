"use client";

import { useMemo } from "react";
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

  const isInWebView = useMemo(() => {
    if (typeof window === "undefined") return false;
    return Boolean((window as any)?.ReactNativeWebView?.postMessage);
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

