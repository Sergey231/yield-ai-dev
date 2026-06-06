import { TokenItem } from "@/components/portfolio/TokenItem";
import { Token } from "@/lib/types/token";
import { getYieldRequestKeys } from "@/lib/yields/tokenYields";
import type { TokenYieldMap } from "@/lib/yields/tokenYields";
import { useEffect, useMemo, useState } from "react";

interface TokenListProps {
  tokens: Token[];
  disableDrag?: boolean;
  /** Optional: return badge text for the right side of a token row (e.g. "AGENT WALLET" for USDC) */
  getRightBadge?: (token: Token) => string | undefined;
}

export function TokenList({ tokens, disableDrag = false, getRightBadge }: TokenListProps) {
  const [stakingAprs, setStakingAprs] = useState<Record<string, { aprPct: number; source: string }>>({});
  const [tokenYields, setTokenYields] = useState<TokenYieldMap>({});
  const yieldRequestKeys = useMemo(() => getYieldRequestKeys(tokens), [tokens]);
  const yieldRequestKey = yieldRequestKeys.join(",");

  useEffect(() => {
    let isCancelled = false;

    const fetchStakingAprs = async () => {
      try {
        const response = await fetch('/api/protocols/echelon/v2/pools');
        if (!response.ok) return;
        const data = await response.json();
        if (!isCancelled && data && data.success) {
          setStakingAprs(data.stakingAprs || {});
        }
      } catch (_) {
        // silently ignore
      }
    };

    fetchStakingAprs();
    return () => { isCancelled = true; };
  }, []);

  useEffect(() => {
    if (!yieldRequestKey) {
      setTokenYields({});
      return;
    }

    let isCancelled = false;

    const fetchTokenYields = async () => {
      try {
        const response = await fetch(`/api/yields?mints=${encodeURIComponent(yieldRequestKey)}`);
        if (!response.ok) return;
        const data = await response.json();
        if (!isCancelled && data && typeof data === 'object') {
          setTokenYields(data as TokenYieldMap);
        }
      } catch (_) {
        // silently ignore
      }
    };

    fetchTokenYields();
    return () => { isCancelled = true; };
  }, [yieldRequestKey]);

  // Sort tokens by USD value in descending order (highest first)
  const sortedTokens = [...tokens].sort((a, b) => {
    const valueA = a.value ? parseFloat(a.value) : 0;
    const valueB = b.value ? parseFloat(b.value) : 0;
    return valueB - valueA;
  });

  return (
    <div className="space-y-2">
      {sortedTokens.map((token) => (
        <TokenItem
          key={token.address}
          token={token}
          stakingAprs={stakingAprs}
          tokenYields={tokenYields}
          disableDrag={disableDrag}
          rightBadge={getRightBadge?.(token)}
        />
      ))}
    </div>
  );
}
