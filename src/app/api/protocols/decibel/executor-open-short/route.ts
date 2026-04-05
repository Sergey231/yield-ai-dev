import { NextRequest, NextResponse } from "next/server";
import { normalizeAddress, toCanonicalAddress } from "@/lib/utils/addressNormalization";
import { buildConfigureUserSettingsPayload } from "@/lib/protocols/decibel/configureUserSettings";
import { buildOpenMarketOrderPayload, type DecibelMarketConfig } from "@/lib/protocols/decibel/closePosition";
import { getDecibelExecutorAccount, submitExecutorEntryFunction } from "@/lib/protocols/decibel/executorSubmit";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { PACKAGE_MAINNET, PACKAGE_TESTNET } from "@/lib/protocols/decibel/closePosition";

type DelegationDto = {
  delegated_account?: string;
  permission_type?: string;
  expiration_time_s?: number | null;
};

const DECIBEL_API_KEY = process.env.DECIBEL_API_KEY;
const DECIBEL_API_BASE_URL =
  process.env.DECIBEL_API_BASE_URL || "https://api.testnet.aptoslabs.com/decibel";
const APTOS_API_KEY = process.env.APTOS_API_KEY;

const DEFAULT_MIN_SIZE_USD = 10;
const DEFAULT_MAX_SIZE_USD = 100;

function parseAllowlist(): string[] {
  const raw = process.env.DECIBEL_EXECUTOR_ALLOWLIST || "";
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => normalizeAddress(toCanonicalAddress(v)));
}

function getSizeLimits() {
  const minRaw = Number(process.env.DECIBEL_EXECUTOR_MIN_SIZE_USD ?? DEFAULT_MIN_SIZE_USD);
  const maxRaw = Number(process.env.DECIBEL_EXECUTOR_MAX_SIZE_USD ?? DEFAULT_MAX_SIZE_USD);
  const min = Number.isFinite(minRaw) && minRaw > 0 ? minRaw : DEFAULT_MIN_SIZE_USD;
  const max = Number.isFinite(maxRaw) && maxRaw >= min ? maxRaw : DEFAULT_MAX_SIZE_USD;
  return { min, max };
}

async function fetchDecibel(path: string) {
  if (!DECIBEL_API_KEY) throw new Error("Decibel API key not configured");
  const baseUrl = DECIBEL_API_BASE_URL.replace(/\/$/, "");
  const res = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${DECIBEL_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("Invalid response from Decibel API");
  }
  if (!res.ok) {
    const msg =
      typeof data === "object" && data !== null && "message" in (data as object)
        ? String((data as { message?: string }).message)
        : `Decibel API error: ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function getAptosClientFromDecibelBaseUrl(): { aptos: Aptos; network: "mainnet" | "testnet"; isTestnet: boolean } {
  const isTestnet = DECIBEL_API_BASE_URL.includes("testnet");
  const network = isTestnet ? "testnet" : "mainnet";
  const aptosNetwork = isTestnet ? Network.TESTNET : Network.MAINNET;
  const config = new AptosConfig({
    network: aptosNetwork,
    ...(APTOS_API_KEY && { clientConfig: { HEADERS: { Authorization: `Bearer ${APTOS_API_KEY}` } } }),
  });
  return { aptos: new Aptos(config), network, isTestnet };
}

function hasPerpsDelegationOnChain(params: {
  subaccountResource: unknown;
  executorAddress: string;
}): boolean {
  const { subaccountResource, executorAddress } = params;
  const exec = normalizeAddress(executorAddress);
  if (!subaccountResource || typeof subaccountResource !== "object") return false;
  // Aptos TS SDK returns the resource "data" directly for getAccountResource, while other callers
  // may pass a { data } wrapper. Support both shapes.
  const root: any =
    (subaccountResource as any)?.delegated_permissions ? subaccountResource : (subaccountResource as any)?.data;
  if (!root || typeof root !== "object") return false;

  const delegatedPermissions = (root as any)?.delegated_permissions;
  const entries = delegatedPermissions?.root?.children?.entries;
  if (!Array.isArray(entries)) return false;

  const normalizeKey = (k: unknown) => (typeof k === "string" ? normalizeAddress(toCanonicalAddress(k)) : "");

  const leaf = entries.find((e: any) => normalizeKey(e?.key) === exec)?.value;
  const permsEntries = leaf?.value?.perms?.entries;
  if (!Array.isArray(permsEntries)) return false;

  return permsEntries.some((pe: any) => {
    const v = pe?.key?.__variant__;
    if (typeof v !== "string") return false;
    const s = v.toLowerCase();
    return s.includes("perp") && s.includes("trade");
  });
}

function resolveMarketForAsset(
  asset: "BTC" | "APT",
  markets: Array<DecibelMarketConfig & { market_addr?: string; market_name?: string }>
): (DecibelMarketConfig & { market_addr: string; market_name: string }) | null {
  const extractBaseSymbol = (name: string): string => {
    const upper = name.toUpperCase();
    return upper.split(/[-/_\s]/)[0] || upper;
  };
  const candidates = markets.filter((m) => {
    const name = (m.market_name || "").toUpperCase();
    if (!name) return false;
    if (name.startsWith(`${asset}-`) || name.startsWith(`${asset}/`) || name.startsWith(`${asset}_`)) {
      return true;
    }
    return extractBaseSymbol(name) === asset;
  });
  const selected = candidates[0];
  if (!selected?.market_addr || !selected?.market_name) return null;
  return {
    ...selected,
    market_addr: selected.market_addr,
    market_name: selected.market_name,
  };
}

function normalizeMarketsPayload(data: unknown): Array<DecibelMarketConfig & { market_addr?: string; market_name?: string }> {
  if (Array.isArray(data)) return data as Array<DecibelMarketConfig & { market_addr?: string; market_name?: string }>;
  if (!data || typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  const candidates: unknown[] = [];
  if (Array.isArray(obj.items)) candidates.push(...obj.items);
  if (Array.isArray(obj.markets)) candidates.push(...obj.markets);
  if (Array.isArray(obj.data)) candidates.push(...obj.data);
  return candidates as Array<DecibelMarketConfig & { market_addr?: string; market_name?: string }>;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const subaccountRaw = typeof body.subaccount === "string" ? body.subaccount.trim() : "";
    const ownerRaw = typeof body.owner === "string" ? body.owner.trim() : "";
    const assetRaw = typeof body.asset === "string" ? body.asset.trim().toUpperCase() : "";
    const sizeUsd = Number(body.sizeUsd);

    if (!subaccountRaw || !ownerRaw) {
      return NextResponse.json(
        { success: false, error: "subaccount and owner are required" },
        { status: 400 }
      );
    }

    const canonicalSubaccount = toCanonicalAddress(subaccountRaw);
    const canonicalOwner = toCanonicalAddress(ownerRaw);
    if (!canonicalSubaccount.startsWith("0x") || !canonicalOwner.startsWith("0x")) {
      return NextResponse.json({ success: false, error: "Invalid address" }, { status: 400 });
    }

    const allowlist = parseAllowlist();
    if (
      allowlist.length > 0 &&
      !allowlist.includes(normalizeAddress(canonicalOwner))
    ) {
      return NextResponse.json(
        { success: false, error: "Owner is not allowlisted for executor trading" },
        { status: 403 }
      );
    }

    if (assetRaw !== "BTC" && assetRaw !== "APT") {
      return NextResponse.json(
        { success: false, error: "asset must be BTC or APT" },
        { status: 400 }
      );
    }

    const { min, max } = getSizeLimits();
    if (!Number.isFinite(sizeUsd) || sizeUsd < min || sizeUsd > max) {
      return NextResponse.json(
        {
          success: false,
          error: `sizeUsd must be between ${min} and ${max}`,
        },
        { status: 400 }
      );
    }

    const executorAddress = toCanonicalAddress(
      getDecibelExecutorAccount().accountAddress.toString()
    );
    if (!executorAddress) {
      return NextResponse.json(
        { success: false, error: "Executor address is not configured" },
        { status: 503 }
      );
    }

    const delegations = (await fetchDecibel(
      `/api/v1/delegations?subaccount=${encodeURIComponent(canonicalSubaccount)}`
    )) as DelegationDto[];
    const apiHasPerpsDelegation = (Array.isArray(delegations) ? delegations : []).some((item) => {
      const delegated = item.delegated_account ? toCanonicalAddress(item.delegated_account) : "";
      const notExpired =
        typeof item.expiration_time_s === "number"
          ? item.expiration_time_s > Math.floor(Date.now() / 1000)
          : true;
      const permission = (item.permission_type || "").toLowerCase();
      const canTrade = permission.includes("trade");
      const canTradePerps = permission.includes("perp");
      return (
        delegated &&
        normalizeAddress(delegated) === normalizeAddress(executorAddress) &&
        notExpired &&
        canTrade &&
        canTradePerps
      );
    });
    let hasDelegation = apiHasPerpsDelegation;
    let chainHasPerpsDelegation: boolean | null = null;

    // Decibel API can lag indexing; fall back to on-chain state if API doesn't show perps delegation yet.
    if (!hasDelegation) {
      const { aptos, isTestnet } = getAptosClientFromDecibelBaseUrl();
      const pkg = isTestnet ? PACKAGE_TESTNET : PACKAGE_MAINNET;
      try {
        const subRes = await aptos.getAccountResource({
          accountAddress: canonicalSubaccount,
          resourceType: `${pkg}::dex_accounts::Subaccount`,
        });
        chainHasPerpsDelegation = hasPerpsDelegationOnChain({
          subaccountResource: subRes,
          executorAddress,
        });
        hasDelegation = chainHasPerpsDelegation;
      } catch {
        chainHasPerpsDelegation = null;
      }
    }
    if (!hasDelegation) {
      return NextResponse.json(
        {
          success: false,
          error: "No active delegation to executor for this subaccount",
          debug: {
            executorAddress,
            apiHasPerpsDelegation,
            chainHasPerpsDelegation,
            apiDelegations: (Array.isArray(delegations) ? delegations : []).map((d) => ({
              delegated_account: d.delegated_account ?? null,
              permission_type: d.permission_type ?? null,
              expiration_time_s: d.expiration_time_s ?? null,
            })),
          },
        },
        { status: 403 }
      );
    }

    const marketsRaw = await fetchDecibel("/api/v1/markets");
    const markets = normalizeMarketsPayload(marketsRaw);
    const selectedMarket = resolveMarketForAsset(assetRaw, markets);
    if (!selectedMarket) {
      return NextResponse.json(
        { success: false, error: `Market not found for asset ${assetRaw}` },
        { status: 404 }
      );
    }

    const prices = (await fetchDecibel(
      `/api/v1/prices?market=${encodeURIComponent(selectedMarket.market_addr)}`
    )) as Array<{ mark_px?: number; mid_px?: number }>;
    const firstPrice = Array.isArray(prices) ? prices[0] : null;
    const markPx = Number(firstPrice?.mark_px ?? firstPrice?.mid_px ?? NaN);
    if (!Number.isFinite(markPx) || markPx <= 0) {
      return NextResponse.json(
        { success: false, error: "Failed to resolve mark price for market order" },
        { status: 502 }
      );
    }

    const { network, isTestnet } = getAptosClientFromDecibelBaseUrl();

    const configurePayload = buildConfigureUserSettingsPayload({
      subaccountAddr: canonicalSubaccount,
      marketAddr: selectedMarket.market_addr,
      isCross: true,
      userLeverage: 1,
      isTestnet,
    });
    const configureTxHash = await submitExecutorEntryFunction({
      network,
      fn: configurePayload.function,
      functionArguments: configurePayload.functionArguments as (string | number | boolean | bigint | null)[],
      maxGasAmount: 20_000,
    });

    const openPayload = buildOpenMarketOrderPayload({
      subaccountAddr: canonicalSubaccount,
      marketAddr: selectedMarket.market_addr,
      orderSizeUsd: sizeUsd,
      markPx,
      marketConfig: selectedMarket,
      isLong: false,
      slippageBps: 50,
      isTestnet,
    });
    const openTxHash = await submitExecutorEntryFunction({
      network,
      fn: openPayload.function,
      functionArguments: openPayload.functionArguments as (string | number | boolean | bigint | null)[],
      maxGasAmount: 30_000,
    });

    return NextResponse.json({
      success: true,
      data: {
        subaccount: canonicalSubaccount,
        owner: canonicalOwner,
        asset: assetRaw,
        sizeUsd,
        marketAddr: selectedMarket.market_addr,
        marketName: selectedMarket.market_name,
        configureTxHash,
        openTxHash,
      },
    });
  } catch (error) {
    console.error("[Decibel] executor-open-short error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
