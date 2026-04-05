import tokenList from "@/lib/data/tokenList.json";

const APTOS_API_KEY = process.env.APTOS_API_KEY;

const MOAR_FARMING_PKG =
  "0xa3afc59243afb6deeac965d40b25d509bb3aebc12f502b8592c283070abc2e07";
const MOAR_STAKER_RESOURCE = `${MOAR_FARMING_PKG}::farming::Staker`;
const MOAR_CLAIMABLE_REWARD_FN = `${MOAR_FARMING_PKG}::farming::claimable_reward_amount`;

const FULLNODE_BASE = "https://fullnode.mainnet.aptoslabs.com/v1";

export async function callMoarView(
  functionFullname: string,
  args: unknown[]
): Promise<unknown> {
  const url = `${FULLNODE_BASE}/view`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (APTOS_API_KEY) {
    headers.Authorization = `Bearer ${APTOS_API_KEY}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      function: functionFullname,
      type_arguments: [],
      arguments: args,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(
      "[Moar Market] VIEW ERROR:",
      functionFullname,
      "args:",
      JSON.stringify(args),
      "->",
      res.status,
      text.slice(0, 500)
    );
    throw new Error(`VIEW ERROR ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Parse Moar claimable_reward_amount view output (string | number | u64 array, etc.). */
export function parseClaimableOctas(value: unknown): bigint | null {
  if (value == null) return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    try {
      return BigInt(Math.trunc(value));
    } catch {
      return null;
    }
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (!t || t === "0") return t === "0" ? 0n : null;
    try {
      return BigInt(t);
    } catch {
      return null;
    }
  }
  if (Array.isArray(value)) {
    for (const el of value) {
      const p = parseClaimableOctas(el);
      if (p != null) return p;
    }
    return null;
  }
  return null;
}

export function getMoarTokenInfo(tokenAddress: string) {
  const token = (tokenList as any).data?.data?.find(
    (t: any) => t.tokenAddress === tokenAddress || t.faAddress === tokenAddress
  );

  if (token) {
    return {
      symbol: token.symbol,
      name: token.name,
      logoUrl: token.logoUrl || null,
      decimals: token.decimals || 8,
    };
  }

  return {
    symbol: tokenAddress.includes("::")
      ? tokenAddress.split("::").pop()?.replace(">", "") || "UNKNOWN"
      : "UNKNOWN",
    name: tokenAddress,
    logoUrl: null,
    decimals: 8,
  };
}

export type MoarFarmingRewardRow = {
  reward_id: string;
  farming_identifier: string;
  tokenAddress: string;
  claimableAmount: unknown;
};

/**
 * Moar farming rewards for an account (same sources as GET /api/protocols/moar/rewards),
 * without Panora prices — direct fullnode reads only.
 */
export async function getMoarFarmingRewardRows(
  accountAddress: string
): Promise<MoarFarmingRewardRow[]> {
  const resourceHeaders: Record<string, string> = {};
  if (APTOS_API_KEY) {
    resourceHeaders.Authorization = `Bearer ${APTOS_API_KEY}`;
  }

  const resourceResponse = await fetch(
    `${FULLNODE_BASE}/accounts/${accountAddress}/resource/${MOAR_STAKER_RESOURCE}`,
    { headers: resourceHeaders }
  );

  if (!resourceResponse.ok) {
    if (resourceResponse.status === 404) {
      return [];
    }
    throw new Error(`Failed to fetch Staker resource: ${resourceResponse.status}`);
  }

  const stakerResource = await resourceResponse.json();
  const userPools = stakerResource.data?.user_pools;
  if (!userPools?.entries?.length) {
    return [];
  }

  const rows: MoarFarmingRewardRow[] = [];

  for (const poolEntry of userPools.entries) {
    const farmingIdentifier = poolEntry.value.farming_identifier;
    const poolRewards = poolEntry.value.rewards;

    if (!poolRewards?.entries) continue;

    for (const rewardEntry of poolRewards.entries) {
      const rewardId = rewardEntry.key;

      try {
        const claimableAmount = await callMoarView(MOAR_CLAIMABLE_REWARD_FN, [
          accountAddress,
          rewardId,
          farmingIdentifier,
        ]);

        const octas = parseClaimableOctas(claimableAmount);
        if (octas == null || octas === 0n) continue;

        const tokenAddress = rewardId.includes("APT")
          ? "0x1::aptos_coin::AptosCoin"
          : `0x1::coin::CoinInfo<${rewardId}>`;

        rows.push({
          reward_id: rewardId,
          farming_identifier: farmingIdentifier,
          tokenAddress,
          claimableAmount,
        });
      } catch (err) {
        console.warn(`[Moar] claimable amount error for ${rewardId}:`, err);
      }
    }
  }

  return rows;
}
