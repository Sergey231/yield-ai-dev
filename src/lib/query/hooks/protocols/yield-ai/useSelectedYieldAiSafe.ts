"use client";

import { useEffect, useMemo, useState } from "react";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";

function storageKey(owner: string) {
  return `yield-ai:selectedSafe:${owner.toLowerCase()}`;
}

export const SELECT_SAFE_EVENT = 'yield-ai:select-safe';

export function dispatchSelectYieldAiSafe(owner: string, safeAddress: string) {
  if (typeof window === 'undefined') return;
  const v = toCanonicalAddress(safeAddress);
  try {
    window.localStorage.setItem(storageKey(owner), v);
  } catch {
    // ignore
  }
  window.dispatchEvent(
    new CustomEvent(SELECT_SAFE_EVENT, {
      detail: { owner: owner.toLowerCase(), safeAddress: v },
    })
  );
}

export function useSelectedYieldAiSafe(params: {
  owner: string | undefined;
  safeAddresses: string[];
  /**
   * After the safes list query has settled at least once. While false, an empty
   * `safeAddresses` array is treated as "still loading" so we do not clear a
   * persisted selection from localStorage (fixes multi-safe wallets flashing to
   * the first safe before the list arrives).
   */
  safesListFetched?: boolean;
}) {
  const { owner, safeAddresses, safesListFetched = true } = params;
  const [selected, setSelected] = useState<string | null>(null);

  const normalizedSafes = useMemo(
    () => safeAddresses.map((a) => toCanonicalAddress(a)),
    [safeAddresses]
  );

  // Combined load + reconcile. We always re-read localStorage as the source of
  // truth so external writes (e.g. dispatchSelectYieldAiSafe) win over a stale
  // in-memory `selected`. If the persisted value is missing from the safe list,
  // fall back to the first available safe.
  useEffect(() => {
    if (!owner) {
      setSelected(null);
      return;
    }
    if (!safesListFetched) {
      return;
    }
    let persisted: string | null = null;
    try {
      const raw = window.localStorage.getItem(storageKey(owner));
      persisted = raw ? toCanonicalAddress(raw) : null;
    } catch {
      persisted = null;
    }
    const first = normalizedSafes[0] ?? null;
    const exists = persisted ? normalizedSafes.includes(persisted) : false;
    const next = exists ? persisted : first;
    setSelected((prev) => (prev === next ? prev : next));
    if (next) {
      try {
        window.localStorage.setItem(storageKey(owner), next);
      } catch {
        // ignore
      }
    }
  }, [owner, normalizedSafes, safesListFetched]);

  // External callers (e.g. the Decibel AI agent card "Manage Position" button)
  // can dispatch SELECT_SAFE_EVENT to switch the selection while the consumer
  // component stays mounted. The handler also runs the load+reconcile effect
  // above on the next render via setSelected.
  useEffect(() => {
    if (!owner) return;
    const ownerLc = owner.toLowerCase();
    const onSelect = (e: Event) => {
      const detail = (e as CustomEvent<{ owner: string; safeAddress: string }>).detail;
      if (!detail || detail.owner.toLowerCase() !== ownerLc) return;
      setSelected(toCanonicalAddress(detail.safeAddress));
    };
    window.addEventListener(SELECT_SAFE_EVENT, onSelect);
    return () => window.removeEventListener(SELECT_SAFE_EVENT, onSelect);
  }, [owner]);

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

