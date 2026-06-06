"use client";

import { useEffect, useRef } from "react";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import type { WalletName } from "@solana/wallet-adapter-base";

/**
 * Re-establishes the previously-used Solana wallet connection on mount.
 *
 * The layout's `SolanaWalletRestore` only restores once per session, so when
 * the wallet ends up disconnected later (e.g. after the bridge's derived-wallet
 * juggling) it never re-restores on other pages. This component re-attempts the
 * restore from the saved `walletName` whenever it mounts (i.e. on /minting).
 */
export function SolanaReconnect() {
  const { connected, connecting, wallet, wallets, select, connect } = useSolanaWallet();
  const selectTriggered = useRef(false);
  const connectTriggered = useRef(false);

  // 1) Select the saved wallet if nothing is connected.
  useEffect(() => {
    if (selectTriggered.current) return;
    if (connected || connecting || wallet?.adapter?.connected) {
      selectTriggered.current = true;
      return;
    }

    let saved: string | null = null;
    try {
      const raw = window.localStorage.getItem("walletName");
      if (raw) {
        try {
          saved = JSON.parse(raw) as string;
        } catch {
          saved = raw;
        }
      }
    } catch {
      /* ignore */
    }
    if (!saved || !wallets.some((w) => String(w.adapter.name) === saved)) return;

    selectTriggered.current = true;
    try {
      select(saved as WalletName);
    } catch {
      /* ignore */
    }
  }, [connected, connecting, wallet, wallets, select]);

  // 2) Connect once a wallet is selected but not yet connected.
  useEffect(() => {
    if (connectTriggered.current) return;
    if (connected || connecting || !wallet || wallet.adapter?.connected) return;

    connectTriggered.current = true;
    const t = setTimeout(() => {
      connect().catch(() => {
        // Allow another attempt if this one failed (e.g. adapter not ready yet).
        connectTriggered.current = false;
      });
    }, 200);
    return () => clearTimeout(t);
  }, [wallet, connected, connecting, connect]);

  return null;
}
