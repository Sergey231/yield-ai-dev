import {
  YIELD_AI_PACKAGE_ADDRESS,
  USDC_FA_METADATA_MAINNET,
} from "@/lib/constants/yieldAiVault";
import {
  normalizeAddress,
  toCanonicalAddress,
} from "@/lib/utils/addressNormalization";

const INDEXER_GRAPHQL = "https://indexer.mainnet.aptoslabs.com/v1/graphql";

const VAULT_SWAP_FN_ID = `${YIELD_AI_PACKAGE_ADDRESS}::vault::execute_swap_fa_to_fa`;

/**
 * Window of versions to scan after `closeDecibelTxVersion`. The close swap is the
 * very next executor action for this safe, so even a small window is enough — but we
 * scan more rows in case other safes' txs interleave.
 */
const SCAN_LIMIT = 25;

export type CloseSwapResolution =
  | {
      status: "resolved";
      usdcOutBaseUnits: string;
      swapTxVersion: string;
      note: string;
    }
  | {
      status: "not_found";
      note: string;
    }
  | {
      status: "skipped";
      note: string;
    };

interface ActivityRow {
  transaction_version: string | number;
  asset_type: string;
  type: string;
  amount: string | number;
}

/**
 * Resolve "USDC received on close" for a closed delta-neutral position by scanning
 * indexer fungible-asset activities for the safe after `closeDecibelTxVersion`.
 *
 * Match criteria for a candidate transaction version V:
 *   - V > closeDecibelTxVersion
 *   - tx is a successful `vault::execute_swap_fa_to_fa` call
 *   - safe's `spotAssetMetadata` shows a Withdraw-type activity at V (outflow)
 *   - safe's USDC FA shows a Deposit-type activity at V (inflow) → its amount is the result
 *
 * Returns the first matching version (lowest > closeDecibelTxVersion). Heuristic but tight:
 * `entry_function_id_str` is permissioned (only the executor signs it), and the Withdraw+Deposit
 * pair on the SAME tx version uniquely identifies the close swap leg.
 */
export async function resolveCloseSwapUsdcOut(params: {
  safeAddress: string;
  spotAssetMetadata: string;
  closeDecibelTxVersion: string;
  aptosApiKey?: string | null;
}): Promise<CloseSwapResolution> {
  const { safeAddress, spotAssetMetadata, closeDecibelTxVersion, aptosApiKey } = params;

  const minVersion = (() => {
    if (!/^\d+$/.test(closeDecibelTxVersion)) return null;
    const v = BigInt(closeDecibelTxVersion);
    return v > BigInt(0) ? v.toString() : null;
  })();

  if (!minVersion) {
    return {
      status: "skipped",
      note: "closeDecibelTxVersion is missing — cannot scope indexer scan window.",
    };
  }

  const safeNorm = toCanonicalAddress(safeAddress);
  const spotNorm = normalizeAddress(toCanonicalAddress(spotAssetMetadata));
  const usdcNorm = normalizeAddress(toCanonicalAddress(USDC_FA_METADATA_MAINNET));
  if (!spotNorm || spotNorm === normalizeAddress("0x0")) {
    return {
      status: "skipped",
      note: "Spot asset metadata is empty on the registry record.",
    };
  }

  const query = `
    query CloseSwapActivities(
      $safeAddress: String!,
      $entryFn: String!,
      $minVersion: bigint!,
      $limit: Int!
    ) {
      fungible_asset_activities(
        where: {
          owner_address: { _eq: $safeAddress }
          entry_function_id_str: { _eq: $entryFn }
          is_transaction_success: { _eq: true }
          transaction_version: { _gt: $minVersion }
        }
        order_by: { transaction_version: asc }
        limit: $limit
      ) {
        transaction_version
        asset_type
        type
        amount
      }
    }
  `;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (aptosApiKey) headers.Authorization = `Bearer ${aptosApiKey}`;

  let rows: ActivityRow[];
  try {
    const res = await fetch(INDEXER_GRAPHQL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query,
        variables: {
          safeAddress: safeNorm,
          entryFn: VAULT_SWAP_FN_ID,
          minVersion,
          limit: SCAN_LIMIT,
        },
      }),
    });
    if (!res.ok) {
      return {
        status: "not_found",
        note: `Indexer request failed: ${res.status}.`,
      };
    }
    const json = (await res.json()) as {
      data?: { fungible_asset_activities?: ActivityRow[] };
      errors?: { message?: string }[];
    };
    if (json.errors?.length) {
      return {
        status: "not_found",
        note: `Indexer error: ${json.errors[0]?.message ?? "unknown"}.`,
      };
    }
    rows = json.data?.fungible_asset_activities ?? [];
  } catch (e) {
    return {
      status: "not_found",
      note: `Indexer fetch failed: ${e instanceof Error ? e.message : "unknown"}.`,
    };
  }

  if (rows.length === 0) {
    return {
      status: "not_found",
      note: "No vault swap activities for this safe after the close version.",
    };
  }

  // Group by transaction_version → check for matching Withdraw(spot) + Deposit(USDC) pair.
  type Bucket = { withdrewSpot: boolean; usdcInBaseUnits: bigint };
  const byVersion = new Map<string, Bucket>();

  const isDeposit = (t: string) => t.endsWith("Deposit") || t.endsWith("DepositEvent");
  const isWithdraw = (t: string) => t.endsWith("Withdraw") || t.endsWith("WithdrawEvent");

  for (const row of rows) {
    const version = String(row.transaction_version);
    const assetNorm = normalizeAddress(toCanonicalAddress(row.asset_type ?? ""));
    if (!assetNorm) continue;
    const bucket = byVersion.get(version) ?? {
      withdrewSpot: false,
      usdcInBaseUnits: BigInt(0),
    };

    if (assetNorm === spotNorm && isWithdraw(row.type)) {
      bucket.withdrewSpot = true;
    } else if (assetNorm === usdcNorm && isDeposit(row.type)) {
      const amt = row.amount;
      let parsed: bigint | null = null;
      if (typeof amt === "string" && /^\d+$/.test(amt)) parsed = BigInt(amt);
      else if (typeof amt === "number" && Number.isFinite(amt) && amt >= 0) {
        parsed = BigInt(Math.trunc(amt));
      }
      if (parsed != null) {
        bucket.usdcInBaseUnits += parsed;
      }
    }
    byVersion.set(version, bucket);
  }

  // Versions are inserted in asc order; pick the first one that has both legs.
  for (const [version, bucket] of byVersion) {
    if (bucket.withdrewSpot && bucket.usdcInBaseUnits > BigInt(0)) {
      return {
        status: "resolved",
        usdcOutBaseUnits: bucket.usdcInBaseUnits.toString(),
        swapTxVersion: version,
        note: "Resolved from indexer fungible-asset activities (Withdraw spot + Deposit USDC in the same vault swap tx).",
      };
    }
  }

  return {
    status: "not_found",
    note: "Found vault swap activities for this safe but no Withdraw(spot)+Deposit(USDC) pair after the close version.",
  };
}
