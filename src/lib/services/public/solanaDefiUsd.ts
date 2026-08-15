/**
 * Server-side USD valuation helpers for the public Solana protocols API.
 *
 * Most Solana protocols (Jupiter, Kamino, Raydium, Orca, Meteora) expose a USD
 * total their upstream route already computes, so the generic aggregator handles
 * them. Tramplin is the exception: its `userPositions` returns a single object
 * (staked SOL) and winnings live in a separate `/rewards` endpoint, mirroring the
 * Sidebar's `stakeUsd + Σ rewards.usdValue` total.
 */

export type TramplinUsdResult = {
  valueUSD: number;
  hasPosition: boolean;
  valueUSDComplete: boolean;
  positions: unknown[];
};

async function fetchJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Tramplin total = staked SOL (USD) + unclaimed draw winnings (USD).
 * Matches `computeTramplinPositionsUsd + computeTramplinRewardsUsd` on the client.
 */
export async function computeTramplinUsd(
  address: string,
  origin: string
): Promise<TramplinUsdResult> {
  const enc = encodeURIComponent(address);
  const [posPayload, rewardsPayload] = await Promise.all([
    fetchJson(`${origin}/api/protocols/tramplin/userPositions?address=${enc}`),
    fetchJson(`${origin}/api/protocols/tramplin/rewards?address=${enc}`),
  ]);

  const data = (posPayload as { data?: Record<string, unknown> } | null)?.data;
  const hasPosition = Boolean(data?.hasPosition);
  const stakeUsd = toNumberOrNull(data?.stakeUsd);

  const rewardRows =
    (rewardsPayload as { data?: Array<{ usdValue?: unknown }> } | null)?.data ?? [];
  let rewardsUsd = 0;
  let rewardsComplete = true;
  if (Array.isArray(rewardRows)) {
    for (const row of rewardRows) {
      const v = toNumberOrNull(row?.usdValue);
      if (v == null) rewardsComplete = false;
      else rewardsUsd += v;
    }
  }

  const valueUSD = (stakeUsd ?? 0) + rewardsUsd;
  const positions = hasPosition
    ? [
        {
          stakeSol: toNumberOrNull(data?.stakeSol) ?? 0,
          stakeUsd: stakeUsd ?? 0,
          rewardsUsd,
        },
      ]
    : [];

  return {
    valueUSD,
    hasPosition,
    // Complete unless we hold a position whose SOL price (stake or rewards) was missing.
    valueUSDComplete: !hasPosition || (stakeUsd != null && rewardsComplete),
    positions,
  };
}
