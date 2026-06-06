"use client";

import { useEffect, useState } from "react";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import type { PublicKey, Transaction } from "@solana/web3.js";

export interface ResolvedSolanaWallet {
  publicKey: PublicKey | null;
  connected: boolean;
  signTransaction?: (tx: Transaction) => Promise<Transaction>;
}

/**
 * Robust replacement for `useWallet()` from @solana/wallet-adapter-react.
 *
 * The hook's `publicKey` / `connected` frequently lag the actual adapter
 * state in this app (multiple providers + autoConnect + restore), so a
 * connected wallet can read as disconnected for a render or two — or until
 * a manual refresh. This resolves the effective state from, in order:
 *   1. the hook value,
 *   2. the selected wallet's adapter,
 *   3. any connected adapter in the list,
 * and polls briefly while nothing is resolved so the connection is picked
 * up without a page reload.
 */
export function useSolanaWalletResolved(): ResolvedSolanaWallet {
  const { publicKey, connected, wallet, wallets, signTransaction } = useSolanaWallet();
  const [, force] = useState(0);

  const adapterPk = wallet?.adapter?.publicKey ?? null;
  const connectedAdapter =
    wallets.find((w) => w.adapter.connected && w.adapter.publicKey)?.adapter ?? null;

  const resolvedPublicKey: PublicKey | null =
    publicKey ?? adapterPk ?? connectedAdapter?.publicKey ?? null;

  const resolvedConnected =
    connected || (wallet?.adapter?.connected ?? false) || connectedAdapter != null;

  // Poll briefly while no key is resolved — re-renders pick up adapter state.
  useEffect(() => {
    if (resolvedPublicKey) return;
    let n = 0;
    const id = setInterval(() => {
      force((x) => x + 1);
      if (++n >= 12) clearInterval(id); // ~6s
    }, 500);
    return () => clearInterval(id);
  }, [resolvedPublicKey, wallet]);

  const adapterSign = (
    (wallet?.adapter as { signTransaction?: unknown })?.signTransaction ??
    (connectedAdapter as { signTransaction?: unknown } | null)?.signTransaction
  ) as ((tx: Transaction) => Promise<Transaction>) | undefined;

  const adapterForSign = wallet?.adapter ?? connectedAdapter ?? null;
  const resolvedSignTransaction =
    signTransaction ??
    (adapterSign && adapterForSign
      ? (adapterSign.bind(adapterForSign) as (tx: Transaction) => Promise<Transaction>)
      : undefined);

  return {
    publicKey: resolvedPublicKey,
    connected: resolvedConnected,
    signTransaction: resolvedSignTransaction,
  };
}
