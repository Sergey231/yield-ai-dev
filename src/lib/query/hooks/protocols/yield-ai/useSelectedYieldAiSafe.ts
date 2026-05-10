"use client";

import { useEffect, useMemo, useState } from "react";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";

function storageKey(owner: string) {
  return `yield-ai:selectedSafe:${owner.toLowerCase()}`;
}

export function useSelectedYieldAiSafe(params: {
  owner: string | undefined;
  safeAddresses: string[];
}) {
  const { owner, safeAddresses } = params;
  const [selected, setSelected] = useState<string | null>(null);

  const normalizedSafes = useMemo(
    () => safeAddresses.map((a) => toCanonicalAddress(a)),
    [safeAddresses]
  );

  // Load from localStorage when owner changes.
  useEffect(() => {
    if (!owner) {
      setSelected(null);
      return;
    }
    try {
      const raw = window.localStorage.getItem(storageKey(owner));
      setSelected(raw ? toCanonicalAddress(raw) : null);
    } catch {
      setSelected(null);
    }
  }, [owner]);

  // Reconcile: if selected is missing from the list, fall back to first safe.
  useEffect(() => {
    if (!owner) return;
    const first = normalizedSafes[0] ?? null;
    const hasSelected = selected ? normalizedSafes.includes(toCanonicalAddress(selected)) : false;
    const next = hasSelected ? selected : first;
    if (next !== selected) setSelected(next);
    if (next) {
      try {
        window.localStorage.setItem(storageKey(owner), next);
      } catch {
        // ignore
      }
    }
  }, [owner, normalizedSafes, selected]);

  const setSelectedSafe = (addr: string) => {
    const v = toCanonicalAddress(addr);
    setSelected(v);
    if (owner) {
      try {
        window.localStorage.setItem(storageKey(owner), v);
      } catch {
        // ignore
      }
    }
  };

  return {
    selectedSafeAddress: selected,
    setSelectedSafeAddress: setSelectedSafe,
    safeAddresses: normalizedSafes,
  };
}

