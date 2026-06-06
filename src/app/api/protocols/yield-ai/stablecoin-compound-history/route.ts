import { NextRequest, NextResponse } from "next/server";
import { toCanonicalAddress, normalizeAddress } from "@/lib/utils/addressNormalization";
import {
  USDC_FA_METADATA_MAINNET,
  YIELD_AI_VAULT_ENTRYPOINTS,
  YIELD_AI_VAULT_MODULE,
} from "@/lib/constants/yieldAiVault";

const APTOS_API_KEY = process.env.APTOS_API_KEY;
const INDEXER_URL = "https://indexer.mainnet.aptoslabs.com/v1/graphql";

const VAULT_DEPOSIT_FN = `${YIELD_AI_VAULT_MODULE}::deposit`;
const VAULT_WITHDRAW_FN = `${YIELD_AI_VAULT_MODULE}::withdraw`;

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
  legs: Array<{ direction: "in" | "out"; assetLabel: string; amountHuman: string }>;
};

function assetLabel(assetType: string): string {
  const n = normalizeAddress(toCanonicalAddress(assetType));
  if (n === normalizeAddress(USDC_FA_METADATA_MAINNET)) return "USDC";
  if (n === normalizeAddress("0xa") || /::aptos_coin::AptosCoin$/i.test(assetType)) return "APT";
  if (!n || n === "0x0") return "—";
  return `${n.slice(0, 6)}…${n.slice(-4)}`;
}

function amountToHuman(amountRaw: bigint, asset: string): string {
  // Best-effort decimals. USDC = 6, APT = 8. Unknown assets: show raw.
  const n = normalizeAddress(toCanonicalAddress(asset));
  const decimals = n === normalizeAddress(USDC_FA_METADATA_MAINNET) ? 6 : n === normalizeAddress("0xa") ? 8 : null;
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
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeSwapFaToFa) return "Swap (executor)";
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeSwapAptToFa) return "Swap APT → FA (executor)";
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeClaimApt) return "Claim APT (executor)";
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeClaimEchelon) return "Claim Echelon (executor)";
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeDeposit) return "Deposit to adapter (executor)";
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeDepositEchelonFa) return "Deposit to Echelon (executor)";
  if (fn === YIELD_AI_VAULT_ENTRYPOINTS.executeWithdrawFull) return "Withdraw full (executor)";
  return "Vault operation";
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
      YIELD_AI_VAULT_ENTRYPOINTS.executeClaimApt,
      YIELD_AI_VAULT_ENTRYPOINTS.executeClaimEchelon,
      YIELD_AI_VAULT_ENTRYPOINTS.executeSwapAptToFa,
      YIELD_AI_VAULT_ENTRYPOINTS.executeSwapFaToFa,
      YIELD_AI_VAULT_ENTRYPOINTS.executeDeposit,
      YIELD_AI_VAULT_ENTRYPOINTS.executeDepositEchelonFa,
      YIELD_AI_VAULT_ENTRYPOINTS.executeWithdrawFull,
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

