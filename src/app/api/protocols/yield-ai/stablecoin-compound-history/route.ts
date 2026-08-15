import { NextRequest, NextResponse } from "next/server";
import { toCanonicalAddress, normalizeAddress } from "@/lib/utils/addressNormalization";
import {
  USD1_FA_METADATA_MAINNET,
  USDC_FA_METADATA_MAINNET,
  WBTC_FA_METADATA_MAINNET,
  XBTC_FA_METADATA_MAINNET,
  YIELD_AI_HYPERION_POOLS,
  YIELD_AI_VAULT_ENTRYPOINTS,
  YIELD_AI_VAULT_MODULE,
} from "@/lib/constants/yieldAiVault";

const APTOS_API_KEY = process.env.APTOS_API_KEY;
const INDEXER_URL = "https://indexer.mainnet.aptoslabs.com/v1/graphql";

const VAULT_DEPOSIT_FN = `${YIELD_AI_VAULT_MODULE}::deposit`;
const VAULT_WITHDRAW_FN = `${YIELD_AI_VAULT_MODULE}::withdraw`;
/** Executor-signed Echelon exit not listed in YIELD_AI_VAULT_ENTRYPOINTS. */
const VAULT_WITHDRAW_ALL_ECHELON_FN = `${YIELD_AI_VAULT_MODULE}::execute_withdraw_all_echelon_fa_as_owner`;

type FaActivityRow = {
  transaction_version: string;
  transaction_timestamp: string;
  entry_function_id_str: string;
  asset_type: string;
  type: string;
  amount: string | number;
};

export type StablecoinCompoundOperation = {
  txVersion: string;
  timestamp: string;
  label: string;
  /** Who signed/triggered the operation: the safe owner or the AI agent (executor). */
  actor: "user" | "agent";
  legs: Array<{ direction: "in" | "out"; assetLabel: string; amountHuman: string }>;
};

/** Known FA metadata → symbol/decimals, for readable legs. */
const KNOWN_ASSETS: Array<{ address: string; symbol: string; decimals: number }> = [
  { address: USDC_FA_METADATA_MAINNET, symbol: "USDC", decimals: 6 },
  { address: USD1_FA_METADATA_MAINNET, symbol: "USD1", decimals: 6 },
  { address: WBTC_FA_METADATA_MAINNET, symbol: "WBTC", decimals: 8 },
  { address: XBTC_FA_METADATA_MAINNET, symbol: "xBTC", decimals: 8 },
  { address: YIELD_AI_HYPERION_POOLS.usdt_usdc.tokenA, symbol: "USDt", decimals: 6 },
];

function knownAsset(assetType: string): { symbol: string; decimals: number } | null {
  const n = normalizeAddress(toCanonicalAddress(assetType));
  if (n === normalizeAddress("0xa") || /::aptos_coin::AptosCoin$/i.test(assetType)) {
    return { symbol: "APT", decimals: 8 };
  }
  for (const a of KNOWN_ASSETS) {
    if (n === normalizeAddress(a.address)) return { symbol: a.symbol, decimals: a.decimals };
  }
  return null;
}

function assetLabel(assetType: string): string {
  const known = knownAsset(assetType);
  if (known) return known.symbol;
  const n = normalizeAddress(toCanonicalAddress(assetType));
  if (!n || n === "0x0") return "—";
  return `${n.slice(0, 6)}…${n.slice(-4)}`;
}

function amountToHuman(amountRaw: bigint, asset: string): string {
  const decimals = knownAsset(asset)?.decimals ?? null;
  if (decimals == null) return amountRaw.toString();
  const sign = amountRaw < 0n ? "-" : "";
  const abs = amountRaw < 0n ? -amountRaw : amountRaw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = String(frac).padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${sign}${whole}.${fracStr}` : `${sign}${whole}`;
}

function isDepositLike(t: string) {
  return t.endsWith("Deposit") || t.endsWith("DepositEvent");
}
function isWithdrawLike(t: string) {
  return t.endsWith("Withdraw") || t.endsWith("WithdrawEvent");
}

function labelForEntryFn(fn: string): string {
  if (fn === VAULT_DEPOSIT_FN) return "Direct deposit";
  if (fn === VAULT_WITHDRAW_FN) return "Direct withdraw";
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeSwapFaToFa) return "Swap";
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeSwapAptToFa) return "Swap APT → FA";
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeClaimApt) return "Claim APT";
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeClaimEchelon) return "Claim Echelon";
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeDeposit) return "Deposit to adapter";
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeDepositEchelonFa) return "Deposit to Echelon";
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeWithdrawFull) return "Withdraw full";
  if (fn === VAULT_WITHDRAW_ALL_ECHELON_FN) return "Withdraw from Echelon";
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionClaimFees) return "Claim LP fees";
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionClaimRewards) return "Claim LP rewards";
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionOpenZapUsdc) return "Open LP position (zap)";
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionAddZapUsdc) return "Add LP liquidity (zap)";
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionOpenDual) return "Open LP position";
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionAddDual) return "Add LP liquidity";
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionRemoveLiquidity) return "Remove LP liquidity";
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionRemoveAll) return "Close LP position";
  return "Vault operation";
}

/** Direct deposit/withdraw are signed by the safe owner; everything else by the executor. */
function actorForEntryFn(fn: string): "user" | "agent" {
  return fn === VAULT_DEPOSIT_FN || fn === VAULT_WITHDRAW_FN ? "user" : "agent";
}

const QUERY = `
  query StablecoinCompoundHistory($safeAddress: String!, $entryFunctions: [String!]!, $limit: Int!) {
    fungible_asset_activities(
      where: {
        owner_address: { _eq: $safeAddress }
        is_transaction_success: { _eq: true }
        entry_function_id_str: { _in: $entryFunctions }
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

/**
 * GET /api/protocols/yield-ai/stablecoin-compound-history?safeAddress=0x...&limit=200
 *
 * Returns a compact list of *operations* for stablecoin strategy:
 * - direct deposit/withdraw (user-signed `vault::deposit/withdraw`)
 * - executor swaps / claims / adapter deposits (vault entrypoints)
 *
 * Uses indexer `fungible_asset_activities` grouped by `transaction_version`.
 */
export async function GET(request: NextRequest) {
  try {
    const safeRaw = request.nextUrl.searchParams.get("safeAddress")?.trim();
    if (!safeRaw) {
      return NextResponse.json({ success: false, error: "safeAddress is required" }, { status: 400 });
    }
    const limitRaw = request.nextUrl.searchParams.get("limit");
    const limit = (() => {
      if (!limitRaw) return 200;
      const n = parseInt(limitRaw, 10);
      if (!Number.isFinite(n) || n <= 0) return 200;
      return Math.min(n, 500);
    })();

    const safeAddress = toCanonicalAddress(safeRaw);
    if (!safeAddress.startsWith("0x")) {
      return NextResponse.json({ success: false, error: "Invalid safeAddress" }, { status: 400 });
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (APTOS_API_KEY) headers.Authorization = `Bearer ${APTOS_API_KEY}`;

    const entryFunctions = [
      VAULT_DEPOSIT_FN,
      VAULT_WITHDRAW_FN,
      VAULT_WITHDRAW_ALL_ECHELON_FN,
      YIELD_AI_VAULT_ENTRYPOINTS.executeClaimApt,
      YIELD_AI_VAULT_ENTRYPOINTS.executeClaimEchelon,
      YIELD_AI_VAULT_ENTRYPOINTS.executeSwapAptToFa,
      YIELD_AI_VAULT_ENTRYPOINTS.executeSwapFaToFa,
      YIELD_AI_VAULT_ENTRYPOINTS.executeDeposit,
      YIELD_AI_VAULT_ENTRYPOINTS.executeDepositEchelonFa,
      YIELD_AI_VAULT_ENTRYPOINTS.executeWithdrawFull,
      YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionOpenZapUsdc,
      YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionAddZapUsdc,
      YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionOpenDual,
      YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionAddDual,
      YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionRemoveLiquidity,
      YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionRemoveAll,
      YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionClaimFees,
      YIELD_AI_VAULT_ENTRYPOINTS.executeHyperionClaimRewards,
    ];

    const res = await fetch(INDEXER_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: QUERY,
        variables: { safeAddress, entryFunctions, limit },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Indexer request failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { data?: { fungible_asset_activities?: FaActivityRow[] } };
    const rows = json.data?.fungible_asset_activities ?? [];

    // Group by txVersion and derive compact legs.
    const byVersion = new Map<
      string,
      { timestamp: string; entryFn: string; netByAsset: Map<string, bigint> }
    >();

    for (const r of rows) {
      const txVersion = String(r.transaction_version);
      const bucket =
        byVersion.get(txVersion) ?? {
          timestamp: r.transaction_timestamp,
          entryFn: r.entry_function_id_str,
          netByAsset: new Map<string, bigint>(),
        };
      bucket.timestamp = bucket.timestamp || r.transaction_timestamp;
      bucket.entryFn = bucket.entryFn || r.entry_function_id_str;

      const amt = BigInt(String(r.amount ?? "0"));
      const dir: "in" | "out" | null = isDepositLike(r.type) ? "in" : isWithdrawLike(r.type) ? "out" : null;
      if (dir) {
        const key = r.asset_type;
        const prev = bucket.netByAsset.get(key) ?? 0n;
        bucket.netByAsset.set(key, prev + (dir === "in" ? amt : -amt));
      }
      byVersion.set(txVersion, bucket);
    }

    const operations: StablecoinCompoundOperation[] = Array.from(byVersion.entries())
      .map(([txVersion, b]) => ({
        txVersion,
        timestamp: b.timestamp,
        label: labelForEntryFn(b.entryFn),
        actor: actorForEntryFn(b.entryFn),
        legs: Array.from(b.netByAsset.entries())
          .map(([asset, net]) => {
            const direction: "in" | "out" = net >= 0n ? "in" : "out";
            const human = amountToHuman(net >= 0n ? net : -net, asset);
            return {
              direction,
              assetLabel: assetLabel(asset),
              amountHuman: human,
            };
          })
          .filter((l) => l.amountHuman !== "0"),
      }))
      .sort((a, b) => Number(BigInt(b.txVersion) - BigInt(a.txVersion))); // newest first

    return NextResponse.json({ success: true, data: { operations } });
  } catch (error) {
    console.error("[Yield AI] stablecoin-compound-history error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

