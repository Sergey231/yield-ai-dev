import { normalizeAddress, toCanonicalAddress } from "@/lib/utils/addressNormalization";

const INDEXER_GRAPHQL = "https://indexer.mainnet.aptoslabs.com/v1/graphql";

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
