'use client';

import { useEffect, useState } from 'react';
import { marketNameForFundingApi } from '@/lib/protocols/decibel/fundingApr';
import { resolveMarketLogoUrl } from '@/lib/protocols/decibel/marketIcon';

/**
 * Resolves Decibel market logos: static overrides first, then CDN slug icons when they exist.
 */
export function useDecibelMarketLogosMap(
  marketNames: string[],
  knownLogos: Record<string, string>,
): Record<string, string | undefined> {
  const [logoByKey, setLogoByKey] = useState<Record<string, string | undefined>>(() => {
    const initial: Record<string, string | undefined> = {};
    for (const name of marketNames) {
      const key = marketNameForFundingApi(name);
      initial[key] = knownLogos[key];
    }
    return initial;
  });

  const namesKey = marketNames.map((n) => marketNameForFundingApi(n)).join('\0');

  useEffect(() => {
    let cancelled = false;

    const initial: Record<string, string | undefined> = {};
    for (const name of marketNames) {
      const key = marketNameForFundingApi(name);
      initial[key] = knownLogos[key];
    }
    setLogoByKey(initial);

    if (marketNames.length === 0) return;

    void Promise.all(
      marketNames.map(async (name) => {
        const key = marketNameForFundingApi(name);
        const url = await resolveMarketLogoUrl(name, knownLogos);
        return { key, url };
      }),
    ).then((results) => {
      if (cancelled) return;
      setLogoByKey((prev) => {
        const next = { ...prev };
        for (const { key, url } of results) {
          if (url) next[key] = url;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable join of market keys
  }, [namesKey, knownLogos]);

  return logoByKey;
}
