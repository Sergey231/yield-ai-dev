"use client";

import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";

export type InjectedChain = "aptos" | "solana";

export interface NativeWalletState {
  aptosAddress: string | null;
  solanaAddress: string | null;
  aptosWalletId: string | null;
  solanaWalletId: string | null;

  setConnected: (input: {
    chain: InjectedChain;
    address: string;
    walletId?: string | null;
  }) => void;
  setDisconnected: (chain: InjectedChain) => void;
  reset: () => void;
}

function normalizeAddress(addr: string): string {
  return (addr || "").trim();
}

export const useNativeWalletStore = create<NativeWalletState>()(
  devtools(
    persist(
      (set) => ({
        aptosAddress: null,
        solanaAddress: null,
        aptosWalletId: null,
        solanaWalletId: null,

        setConnected: ({ chain, address, walletId }) => {
          const a = normalizeAddress(address);
          if (!a) return;
          if (chain === "aptos") {
            set({ aptosAddress: a, aptosWalletId: walletId ?? null });
            return;
          }
          set({ solanaAddress: a, solanaWalletId: walletId ?? null });
        },

        setDisconnected: (chain) => {
          if (chain === "aptos") {
            set({ aptosAddress: null, aptosWalletId: null });
            return;
          }
          set({ solanaAddress: null, solanaWalletId: null });
        },

        reset: () => {
          set({
            aptosAddress: null,
            solanaAddress: null,
            aptosWalletId: null,
            solanaWalletId: null,
          });
        },
      }),
      {
        name: "native-wallet-storage",
        storage: createJSONStorage(() => sessionStorage),
        partialize: (state) => ({
          aptosAddress: state.aptosAddress,
          solanaAddress: state.solanaAddress,
          aptosWalletId: state.aptosWalletId,
          solanaWalletId: state.solanaWalletId,
        }),
      },
    ),
    { name: "nativeWalletStore" },
  ),
);

