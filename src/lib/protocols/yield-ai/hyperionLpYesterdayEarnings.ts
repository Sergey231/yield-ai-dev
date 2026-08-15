import { normalizeAddress, toCanonicalAddress } from "@/lib/utils/addressNormalization";
import {
  APTOS_COIN_TYPE,
  USDC_FA_METADATA_MAINNET,
  USD1_FA_METADATA_MAINNET,
  WBTC_FA_METADATA_MAINNET,
  XBTC_FA_METADATA_MAINNET,
  YIELD_AI_HYPERION_POOLS,
  YIELD_AI_VAULT_ENTRYPOINTS,
} from "@/lib/constants/yieldAiVault";
import { PanoraPricesService } from "@/lib/services/panora/prices";

const APTOS_API_KEY = process.env.APTOS_API_KEY;
const INDEXER_URL = "https://indexer.mainnet.aptoslabs.com/v1/graphql";
const APT_FA_METADATA = "0x000000000000000000000000000000000000000000000000000000000000000a";

const CLAIM_ENTRY_FUNCTIONS = [
  YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionClaimFees,
  YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionClaimRewards,
] as const;

type FaActivityRow = {
  transaction_version: string;
  transaction_timestamp: string;
  entry_function_id_str: string;
  asset_type: string;
  type: string;
  amount: string | number;
};

type PriceInfo = { usd: number; decimals: number };

const KNOWN_ASSETS: Array<{ address: string; symbol: string; decimals: number }> = [
  { address: USDC_FA_METADATA_MAINNET, symbol: "USDC", decimals: 6 },
  { address: USD1_FA_METADATA_MAINNET, symbol: "USD1", decimals: 6 },
  { address: WBTC_FA_METADATA_MAINNET, symbol: "WBTC", decimals: 8 },
  { address: XBTC_FA_METADATA_MAINNET, symbol: "xBTC", decimals: 8 },
  { address: YIELD_AI_HYPERION_POOLS.usdt_usdc.tokenA, symbol: "USDt", decimals: 6 },
];

const YESTERDAY_CLAIMS_QUERY = `
  query HyperionLpYesterdayClaims(
    $safeAddress: String!
    $entryFunctions: [String!]!
    $from: timestamp!
    $to: timestamp!
    $limit: Int!
  ) {
    fungible_asset_activities(
      where: {
        owner_address: { _eq: $safeAddress }
        is_transaction_success: { _eq: true }
        entry_function_id_str: { _in: $entryFunctions }
        transaction_timestamp: { _gte: $from, _lt: $to }
      }
      order_by: { transaction_timestamp: desc }
      limit: $limit
    ) {
      transaction_version
      transaction_timestamp
      entry_function_id_str
      asset_type
      type
      amount
    }
  }
`;

function isDepositLike(type: string): boolean {
  return type.endsWith("Deposit") || type.endsWith("DepositEvent");
}

function isWithdrawLike(type: string): boolean {
  return type.endsWith("Withdraw") || type.endsWith("WithdrawEvent");
}

function knownAsset(assetType: string): { symbol: string; decimals: number } | null {
  const n = normalizeAddress(toCanonicalAddress(assetType));
  if (n === normalizeAddress(APT_FA_METADATA) || /::aptos_coin::AptosCoin$/i.test(assetType)) {
    return { symbol: "APT", decimals: 8 };
  }
  for (const a of KNOWN_ASSETS) {
    if (n === normalizeAddress(a.address)) return { symbol: a.symbol, decimals: a.decimals };
  }
  return null;
}

function amountToHuman(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

/** Previous UTC calendar day [start, end). */
export function getYesterdayUtcWindow(now = new Date()): {
  start: string;
  end: string;
} {
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const yesterdayStart = todayStart - dayMs;
  return {
    start: new Date(yesterdayStart).toISOString(),
    end: new Date(todayStart).toISOString(),
  };
}

async function fetchYesterdayClaimRows(safeAddress: string, from: string, to: string): Promise<FaActivityRow[]> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (APTOS_API_KEY) headers.Authorization = `Bearer ${APTOS_API_KEY}`;

  const res = await fetch(INDEXER_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: YESTERDAY_CLAIMS_QUERY,
      variables: {
        safeAddress: toCanonicalAddress(safeAddress),
        entryFunctions: CLAIM_ENTRY_FUNCTIONS,
        from,
        to,
        limit: 500,
      },
    }),
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Indexer request failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    data?: { fungible_asset_activities?: FaActivityRow[] };
    errors?: { message?: string }[];
  };
  if (json.errors?.length) {
    throw new Error(`Indexer error: ${json.errors[0]?.message ?? "unknown"}`);
  }
  return json.data?.fungible_asset_activities ?? [];
}

function netInflowsByAsset(rows: FaActivityRow[]): Map<string, bigint> {
  const netByAsset = new Map<string, bigint>();
  for (const row of rows) {
    if (!CLAIM_ENTRY_FUNCTIONS.includes(row.entry_function_id_str as (typeof CLAIM_ENTRY_FUNCTIONS)[number])) {
      continue;
    }
    const amt = BigInt(String(row.amount ?? "0"));
    const dir = isDepositLike(row.type) ? "in" : isWithdrawLike(row.type) ? "out" : null;
    if (!dir) continue;
    const prev = netByAsset.get(row.asset_type) ?? 0n;
    netByAsset.set(row.asset_type, prev + (dir === "in" ? amt : -amt));
  }
  return netByAsset;
}

/**
 * Cash-basis USD earned yesterday: fees + rewards claimed to the safe during the
 * previous UTC calendar day. WBTC/APT legs use Panora spot (MVP).
 */
export async function computeHyperionYesterdayEarnedUsd(safeAddress: string): Promise<{
  profitYesterdayUsd: number;
  claimsCount: number;
  window: { start: string; end: string };
}> {
  const window = getYesterdayUtcWindow();
  const rows = await fetchYesterdayClaimRows(safeAddress, window.start, window.end);
  const claimsCount = new Set(rows.map((r) => r.transaction_version)).size;
  const netByAsset = netInflowsByAsset(rows);

  const assetAddrs = Array.from(netByAsset.keys());
  const priceAddrs = new Set<string>([APTOS_COIN_TYPE, ...assetAddrs]);

  const byAddr = new Map<string, PriceInfo>();
  try {
    const pr = await PanoraPricesService.getInstance().getPrices(1, Array.from(priceAddrs));
    const list: Array<Record<string, unknown>> = Array.isArray(pr)
      ? (pr as Array<Record<string, unknown>>)
      : ((pr as { data?: unknown })?.data as Array<Record<string, unknown>>) ?? [];
    for (const it of list) {
      const usd = parseFloat(String(it.usdPrice ?? "0")) || 0;
      const decimals = Number(it.decimals ?? 0) || 0;
      const info: PriceInfo = { usd, decimals };
      if (typeof it.faAddress === "string") byAddr.set(normalizeAddress(it.faAddress), info);
      if (typeof it.tokenAddress === "string") byAddr.set(normalizeAddress(it.tokenAddress), info);
    }
  } catch {
    // Fall through — unknown assets contribute 0 USD.
  }

  const priceOf = (assetType: string): PriceInfo | undefined => {
    const direct = byAddr.get(normalizeAddress(assetType));
    if (direct) return direct;
    if (normalizeAddress(assetType) === normalizeAddress(APT_FA_METADATA)) {
      return byAddr.get(normalizeAddress(APTOS_COIN_TYPE));
    }
    const known = knownAsset(assetType);
    if (known) {
      for (const a of KNOWN_ASSETS) {
        if (a.symbol === known.symbol) {
          const p = byAddr.get(normalizeAddress(a.address));
          if (p) return p;
        }
      }
    }
    return undefined;
  };

  let profitYesterdayUsd = 0;
  for (const [assetType, net] of netByAsset) {
    if (net <= 0n) continue;
    const meta = knownAsset(assetType);
    const price = priceOf(assetType);
    const decimals = price?.decimals ?? meta?.decimals;
    if (decimals == null) continue;
    const human = amountToHuman(net, decimals);
    const usd = price?.usd ?? 0;
    if (usd > 0) profitYesterdayUsd += human * usd;
  }

  return { profitYesterdayUsd, claimsCount, window };
}
