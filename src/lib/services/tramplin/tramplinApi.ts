/**
 * Tramplin (Solana) API helpers.
 *
 * Tramplin is a no-loss staking lottery: users delegate native SOL stake to the
 * Tramplin validator and periodically win prize draws. This module only reads
 * public data — staking and reward claims are not implemented (Phase 1: view-only).
 *
 * See docs/tramplin-wallet-data.md for endpoint/field documentation.
 */

export const TRAMPLIN_API_BASE = "https://api.tramplin.io/api";
export const TRAMPLIN_VOTE_ACCOUNT = "TRAMp1Z9EXyWQQNwNjjoNvVksMUHKioVU7ky61yNsEq";
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const LAMPORTS_PER_SOL = 1_000_000_000;

export type TramplinPublicStats = {
  totalStakeAmount?: number;
  totalPoints?: number;
  effectiveStake?: number;
  effectiveStakeLamports?: number;
  apr?: number;
  totalWinLamports?: number;
  totalWinSol?: number;
  multiplier?: number;
  isAttendingRegularDraw?: boolean;
  isAttendingEpochDraw?: boolean;
  isAttendingBigDraw?: boolean;
};

export type TramplinWin = {
  walletAddress?: string;
  stakeId?: number | string;
  winnerId?: number | string;
  /** Native stake at snapshot — passed verbatim into the claim instruction. */
  stake?: number | string;
  prizeLamports?: string;
  /** "regular" | "epoch" | "big" — the kind of draw this win came from. */
  drawType?: "regular" | "epoch" | "big" | string;
  /** Slot (for regular) or epoch number (for big/epoch) — identifies the draw. */
  epochOrSlot?: number | string;
  epochNumber?: number;
  revealedAt?: string;
  revealedAtSlot?: string;
  isClaimed?: boolean;
  claimedAt?: string | null;
  claimPda?: string;
  drawPda?: string;
  /** Base58-encoded 32-byte merkle proof elements. */
  merkleProofs?: string[];
  snapshotUrl?: string;
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchTramplinStats(wallet: string): Promise<TramplinPublicStats | null> {
  return getJson<TramplinPublicStats>(
    `${TRAMPLIN_API_BASE}/readPublicStats?walletAddress=${encodeURIComponent(wallet)}`,
  );
}

export async function fetchTramplinWins(
  wallet: string,
  opts?: { isClaimed?: boolean; limit?: number },
): Promise<TramplinWin[]> {
  const params = new URLSearchParams({ walletAddress: wallet });
  if (typeof opts?.isClaimed === "boolean") params.set("isClaimed", String(opts.isClaimed));
  params.set("limit", String(opts?.limit ?? 250));
  const rows = await getJson<TramplinWin[]>(`${TRAMPLIN_API_BASE}/indexPublicWins?${params.toString()}`);
  return Array.isArray(rows) ? rows : [];
}

/** Best-effort SOL/USD price via Jupiter; returns null when unavailable. */
export async function fetchSolPriceUsd(): Promise<number | null> {
  const rows = await getJson<Array<{ id?: string; usdPrice?: number }>>(
    `https://api.jup.ag/tokens/v2/search?query=${SOL_MINT}`,
  );
  if (!Array.isArray(rows)) return null;
  const sol = rows.find((r) => r?.id === SOL_MINT);
  const price = typeof sol?.usdPrice === "number" ? sol.usdPrice : null;
  return price != null && Number.isFinite(price) && price > 0 ? price : null;
}
