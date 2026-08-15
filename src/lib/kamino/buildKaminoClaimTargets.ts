import { extractKvaultVaultAddress } from "@/lib/kamino/kvaultVaultAddress";
import type { KaminoClaimTarget } from "@/lib/kamino/kaminoClaimTypes";
import { isMeaningfulKaminoRewardUsd } from "@/lib/kamino/kaminoRewardUsd";

export function extractKaminoEarnVaultAddresses(
  rows: Array<{ source?: string; vaultAddress?: string; position?: unknown }>
): string[] {
  const out = new Set<string>();
  for (const row of rows) {
    const fromRow = typeof row.vaultAddress === "string" ? row.vaultAddress.trim() : "";
    if (fromRow) {
      out.add(fromRow);
      continue;
    }
    if (row.source === "kamino-earn" && row.position) {
      const fromPosition = extractKvaultVaultAddress(row.position);
      if (fromPosition) out.add(fromPosition.trim());
    }
  }
  return Array.from(out);
}

export function buildKaminoClaimTargets(params: {
  apiTargets: KaminoClaimTarget[];
  earnVaultAddresses: string[];
  totalRewardsUsd: number;
}): KaminoClaimTarget[] {
  const { apiTargets, earnVaultAddresses, totalRewardsUsd } = params;
  if (!isMeaningfulKaminoRewardUsd(totalRewardsUsd)) return apiTargets;

  const existingIds = new Set(apiTargets.map((t) => t.id));
  const merged = [...apiTargets];

  for (const vaultAddress of earnVaultAddresses) {
    const v = vaultAddress.trim();
    if (!v) continue;
    const id = `vault:${v}`;
    if (existingIds.has(id)) continue;
    existingIds.add(id);
    merged.push({
      id,
      source: "vault",
      vaultAddress: v,
      rewards: [],
    });
  }

  return merged;
}
