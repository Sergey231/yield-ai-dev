import type { Aptos } from "@aptos-labs/ts-sdk";
import { normalizeAddress, toCanonicalAddress } from "@/lib/utils/addressNormalization";

const INDEXER_GRAPHQL = "https://indexer.mainnet.aptoslabs.com/v1/graphql";

/**
 * On-chain primary fungible store balance for `owner` and `metadata`.
 * Authoritative: not subject to indexer lag. Returns 0 on view failure.
 */
export async function fetchOnChainPrimaryFaBalance(
  aptos: Aptos,
  owner: string,
  metadata: string
): Promise<bigint> {
  try {
    const res = await aptos.view({
      payload: {
        function: "0x1::primary_fungible_store::balance",
        typeArguments: ["0x1::fungible_asset::Metadata"],
        functionArguments: [toCanonicalAddress(owner), toCanonicalAddress(metadata)],
      },
    });
    const raw = Array.isArray(res) ? res[0] : (res as unknown);
    if (typeof raw === "string" && /^\d+$/.test(raw)) return BigInt(raw);
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return BigInt(Math.trunc(raw));
    if (typeof raw === "bigint") return raw;
    return BigInt(0);
  } catch {
    return BigInt(0);
  }
}

/**
 * Take MAX of indexer FA balance and on-chain primary store balance — both should agree
 * but the indexer can lag by minutes after a swap. The on-chain view is authoritative.
 */
export async function fetchFaBalanceIndexerOrOnChain(params: {
  aptos: Aptos;
  owner: string;
  metadata: string;
  aptosApiKey?: string | null;
}): Promise<{ amount: bigint; source: "indexer" | "onchain" | "both"; indexer: bigint; onchain: bigint }> {
  const [indexer, onchain] = await Promise.all([
    fetchIndexerFaBalanceForMetadataAtOwner(params.owner, params.metadata, params.aptosApiKey),
    fetchOnChainPrimaryFaBalance(params.aptos, params.owner, params.metadata),
  ]);
  if (indexer === BigInt(0) && onchain === BigInt(0)) {
    return { amount: BigInt(0), source: "both", indexer, onchain };
  }
  if (onchain >= indexer) {
    return { amount: onchain, source: indexer === onchain ? "both" : "onchain", indexer, onchain };
  }
  return { amount: indexer, source: "indexer", indexer, onchain };
}

/**
 * Sum FA balance on `owner` for `metadataAddress` via Aptos indexer (same listing strategy as safe-contents).
 * Uses normalized address match because strict GraphQL _eq on asset_type often misses padding/case variants.
 */
export async function fetchIndexerFaBalanceForMetadataAtOwner(
  owner: string,
  metadataAddress: string,
  aptosApiKey?: string | null
): Promise<bigint> {
  const address = toCanonicalAddress(owner);
  const want = normalizeAddress(toCanonicalAddress(metadataAddress));
  if (!want || want === normalizeAddress("0x0")) return BigInt(0);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (aptosApiKey) headers.Authorization = `Bearer ${aptosApiKey}`;

  const res = await fetch(INDEXER_GRAPHQL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: `
        query ($owner: String!) {
          current_fungible_asset_balances(
            where: { owner_address: { _eq: $owner }, amount: { _gt: "0" } }
          ) {
            asset_type
            amount
          }
        }
      `,
      variables: { owner: address },
    }),
  });
  if (!res.ok) return BigInt(0);
  const json = (await res.json()) as {
    data?: {
      current_fungible_asset_balances?: {
        asset_type?: string;
        amount?: string | number;
      }[];
    };
  };
  const rows = json.data?.current_fungible_asset_balances ?? [];
  for (const row of rows) {
    const at = row?.asset_type;
    if (!at || typeof at !== "string") continue;
    if (normalizeAddress(toCanonicalAddress(at)) !== want) continue;
    const amt = row.amount;
    if (typeof amt === "string" && /^\d+$/.test(amt)) return BigInt(amt);
    if (typeof amt === "number" && Number.isFinite(amt) && amt >= 0) return BigInt(Math.trunc(amt));
  }
  return BigInt(0);
}
