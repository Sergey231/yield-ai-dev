"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { formatCurrency } from "@/lib/utils/numberFormat";

/** Shown instead of USD amounts when privacy mode is on */
export const PORTFOLIO_MASKED_AMOUNT = "****";

type PortfolioAmountsPrivacyContextValue = {
  amountsHidden: boolean;
  toggleAmountsHidden: () => void;
  /** Hide any pre-formatted currency string */
  maskUsd: (display: string) => string;
  /** Hide token quantity / balance text (same placeholder as USD when privacy is on) */
  maskBalance: (display: string) => string;
  /** Format a numeric USD amount, or mask */
  formatUsd: (value: number, decimals?: number) => string;
};

const PortfolioAmountsPrivacyContext =
  createContext<PortfolioAmountsPrivacyContextValue | null>(null);

export function PortfolioAmountsPrivacyProvider({ children }: { children: ReactNode }) {
  const [amountsHidden, setAmountsHidden] = useState(false);

  const toggleAmountsHidden = useCallback(() => {
    setAmountsHidden((v) => !v);
  }, []);

  const maskDisplay = useCallback(
    (display: string) => (amountsHidden ? PORTFOLIO_MASKED_AMOUNT : display),
    [amountsHidden]
  );

  const formatUsd = useCallback(
    (value: number, decimals = 2) =>
      amountsHidden ? PORTFOLIO_MASKED_AMOUNT : formatCurrency(value, decimals),
    [amountsHidden]
  );

  const value = useMemo(
    () => ({
      amountsHidden,
      toggleAmountsHidden,
      maskUsd: maskDisplay,
      maskBalance: maskDisplay,
      formatUsd,
    }),
    [amountsHidden, toggleAmountsHidden, maskDisplay, formatUsd]
  );

  return (
    <PortfolioAmountsPrivacyContext.Provider value={value}>
      {children}
    </PortfolioAmountsPrivacyContext.Provider>
  );
}

/**
 * Portfolio tracker privacy toggle. Outside the provider, amounts are always visible.
 */
export function usePortfolioAmountsPrivacy(): PortfolioAmountsPrivacyContextValue {
  const ctx = useContext(PortfolioAmountsPrivacyContext);
  const noop = useCallback(() => {}, []);

  return useMemo(
    () =>
      ctx ?? {
        amountsHidden: false,
        toggleAmountsHidden: noop,
        maskUsd: (display: string) => display,
        maskBalance: (display: string) => display,
        formatUsd: (v: number, d = 2) => formatCurrency(v, d),
      },
    [ctx, noop]
  );
}
