import { APTOS_COIN_TYPE } from "@/lib/constants/yieldAiVault";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";
import {
  getMoarFarmingRewardRows,
  parseClaimableOctas,
} from "@/lib/protocols/moar/moarFarmingRewardsCore";

export type MoarAptClaimLine = {
  reward_id: string;
  farming_identifier: string;
  claimable_amount: string;
};

function isMoarAptRewardRow(row: {
  tokenAddress: string;
  reward_id: string;
}): boolean {
  return (
    row.tokenAddress === APTOS_COIN_TYPE ||
    (typeof row.reward_id === "string" && row.reward_id.includes("APT"))
  );
}

/**
 * Moar farming APT lines with claimable strictly greater than minClaimableOctas.
 * Reads chain directly (fullnode) — same data as /api/protocols/moar/rewards, no HTTP self-call.
 */
export async function fetchMoarAptRewardsAboveThreshold(
  safeAddress: string,
  minClaimableOctas: bigint
): Promise<MoarAptClaimLine[]> {
  const addr = toCanonicalAddress(safeAddress);
  let rows;
  try {
    rows = await getMoarFarmingRewardRows(addr);
  } catch (e) {
    console.error("[Yield AI] Moar farming reward rows error:", {
      address: addr,
      error: e instanceof Error ? e.message : String(e),
    });
    return [];
  }

  const out: MoarAptClaimLine[] = [];
  for (const row of rows) {
    if (!isMoarAptRewardRow(row)) continue;
    const raw = parseClaimableOctas(row.claimableAmount);
    if (raw == null) {
      console.warn("[Yield AI] Moar rewards: skip row (unparsed claimable)", {
        reward_id: row.reward_id,
        claimableAmount: row.claimableAmount,
      });
      continue;
    }
    if (raw <= minClaimableOctas) continue;
    out.push({
      reward_id: row.reward_id,
      farming_identifier: row.farming_identifier,
      claimable_amount: String(raw),
    });
  }
  return out;
}
