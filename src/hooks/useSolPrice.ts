"use client";

import { useEffect, useState } from "react";

/**
 * Fetches the current SOL/USD price via our server-side proxy
 * (`/api/solana/sol-price`, Jupiter Price API v3).
 * Returns null until loaded (or on failure) — the USD figure is cosmetic.
 */
export function useSolPrice(): number | null {
  const [price, setPrice] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/solana/sol-price");
        if (!res.ok) return;
        const data = await res.json();
        const p = Number(data?.price);
        if (!cancelled && Number.isFinite(p) && p > 0) setPrice(p);
      } catch {
        /* price is cosmetic — ignore failures */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return price;
}
