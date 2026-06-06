import { NextRequest, NextResponse } from "next/server";
import { toCanonicalAddress, normalizeAddress } from "@/lib/utils/addressNormalization";
import {
  buildCloseAtMarketPayload,
  type DecibelMarketConfig,
  PACKAGE_MAINNET,
  PACKAGE_TESTNET,
} from "@/lib/protocols/decibel/closePosition";
import { getDecibelExecutorAccount, submitExecutorEntryFunction } from "@/lib/protocols/decibel/executorSubmit";
import { USDC_FA_METADATA_MAINNET, YIELD_AI_PACKAGE_ADDRESS } from "@/lib/constants/yieldAiVault";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import {
  DELTA_NEUTRAL_GET_POSITION_VIEW,
  parseDeltaNeutralPositionView,
} from "@/lib/protocols/yield-ai/deltaNeutralViews";
import { fetchFaBalanceIndexerOrOnChain } from "@/lib/protocols/yield-ai/indexerFaBalance";
import { submitSwapFaToFaWithFallbackLimits } from "@/lib/protocols/yield-ai/swapFaToFa";
import {
  fetchVaultFaSwapLimits,
  isVaultDailyLimitAbort,
  type VaultFaSwapLimits,
} from "@/lib/protocols/yield-ai/vaultFaSwapLimits";
import { getApprovedBuilderFeeBps } from "@/lib/protocols/decibel/getApprovedBuilderFee";
import { decibelSpotFeeTierForMetadata } from "@/lib/protocols/decibel/deltaNeutralSpotAssets";

type DelegationDto = {
  delegated_account?: string;
  permission_type?: string;
  expiration_time_s?: number | null;
};

const DECIBEL_API_KEY = process.env.DECIBEL_API_KEY;
const DECIBEL_API_BASE_URL =
  process.env.DECIBEL_API_BASE_URL || "https://api.testnet.aptoslabs.com/decibel";
const APTOS_API_KEY = process.env.APTOS_API_KEY;

const DEFAULT_SWAP_SLIPPAGE_BPS = 50;
const DEFAULT_SWAP_DEADLINE_SECS = 120;
function feeTierForSpotMetadata(spotMetadata: string): number {
  return decibelSpotFeeTierForMetadata(spotMetadata);
}

function parseAllowlist(): string[] {
  const raw = process.env.DECIBEL_EXECUTOR_ALLOWLIST || "";
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => normalizeAddress(toCanonicalAddress(v)));
}

function getAptosClients(): {
  aptosMainnet: Aptos;
  decibelAptos: Aptos;
  network: "mainnet" | "testnet";
  isTestnet: boolean;
} {
  const isTestnet = DECIBEL_API_BASE_URL.includes("testnet");
  const network = isTestnet ? "testnet" : "mainnet";
  const aptosNetwork = isTestnet ? Network.TESTNET : Network.MAINNET;
  const cfg = new AptosConfig({
    network: aptosNetwork,
    ...(APTOS_API_KEY && { clientConfig: { HEADERS: { Authorization: `Bearer ${APTOS_API_KEY}` } } }),
  });
  const decibelAptos = new Aptos(cfg);
  const mainnetCfg = new AptosConfig({
    network: Network.MAINNET,
    ...(APTOS_API_KEY && { clientConfig: { HEADERS: { Authorization: `Bearer ${APTOS_API_KEY}` } } }),
  });
  const aptosMainnet = new Aptos(mainnetCfg);
  return { aptosMainnet, decibelAptos, network, isTestnet };
}

function hasPerpsDelegationOnChain(params: { subaccountResource: unknown; executorAddress: string }): boolean {
  const { subaccountResource, executorAddress } = params;
  const exec = normalizeAddress(executorAddress);
  if (!subaccountResource || typeof subaccountResource !== "object") return false;
  const root =
    "delegated_permissions" in (subaccountResource as object)
      ? (subaccountResource as Record<string, unknown>)
      : (subaccountResource as { data?: unknown })?.data;
  if (!root || typeof root !== "object") return false;
  const delegatedPermissions = (root as { delegated_permissions?: unknown }).delegated_permissions as any;
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getTxVersionByHash(params: { aptos: Aptos; hash: string }): Promise<bigint | null> {
  try {
    const tx = (await params.aptos.getTransactionByHash({
      transactionHash: params.hash,
    })) as unknown;
    const v =
      tx && typeof tx === "object" && "version" in tx ? (tx as { version?: unknown }).version : undefined;
    if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
    if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
    return null;
  } catch {
    return null;
  }
}

type DecibelAccountPosition = {
  market?: string;
  size?: number;
  is_deleted?: boolean;
};

async function pollShortClosed(params: {
  subaccount: string;
  marketAddr: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<void> {
  const { subaccount, marketAddr, timeoutMs = 25_000, intervalMs = 2_000 } = params;
  const started = Date.now();
  const want = normalizeAddress(toCanonicalAddress(marketAddr));
  while (Date.now() - started <= timeoutMs) {
    const positionsRaw = (await fetchDecibel(
      `/api/v1/account_positions?account=${encodeURIComponent(subaccount)}`
    )) as unknown;
    const list = Array.isArray(positionsRaw) ? (positionsRaw as DecibelAccountPosition[]) : [];
    const row = list.find((p) => {
      if (!p || p.is_deleted) return false;
      const m = String(p.market || "");
      if (!m) return false;
      return normalizeAddress(toCanonicalAddress(m)) === want;
    });
    if (!row) return;
    const sz = Number(row.size);
    if (!Number.isFinite(sz) || sz >= 0) return;
    await sleep(intervalMs);
  }
  throw new Error("Decibel short still open after close (account_positions timeout). Check subaccount manually.");
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const subaccountRaw = typeof body.subaccount === "string" ? body.subaccount.trim() : "";
    const ownerRaw = typeof body.owner === "string" ? body.owner.trim() : "";
    const safeRaw = typeof body.safeAddress === "string" ? body.safeAddress.trim() : "";
    const assetRaw = typeof body.asset === "string" ? body.asset.trim().toUpperCase() : "BTC";
    // Recovery mode: skip Decibel close (no active short to close), still swap residual spot
    // and write record_close to clear the on-chain DN slot. Server re-validates that no real
    // short exists before honouring this — never trust the client flag alone.
    const force = body.force === true;

    if (!subaccountRaw || !ownerRaw || !safeRaw) {
      return NextResponse.json(
        { success: false, error: "subaccount, owner, and safeAddress are required" },
        { status: 400 }
      );
    }

    const canonicalSubaccount = toCanonicalAddress(subaccountRaw);
    const canonicalOwner = toCanonicalAddress(ownerRaw);
    const canonicalSafe = toCanonicalAddress(safeRaw);
    if (!canonicalSubaccount.startsWith("0x") || !canonicalOwner.startsWith("0x") || !canonicalSafe.startsWith("0x")) {
      return NextResponse.json({ success: false, error: "Invalid address" }, { status: 400 });
    }

    if (assetRaw !== "BTC" && assetRaw !== "APT") {
      return NextResponse.json({ success: false, error: "asset must be BTC or APT" }, { status: 400 });
    }

    const allowlist = parseAllowlist();
    if (allowlist.length > 0 && !allowlist.includes(normalizeAddress(canonicalOwner))) {
      return NextResponse.json(
        { success: false, error: "Owner is not allowlisted for executor trading" },
        { status: 403 }
      );
    }

    const { aptosMainnet, decibelAptos, network, isTestnet } = getAptosClients();

    const rawView = await aptosMainnet.view({
      payload: {
        function: DELTA_NEUTRAL_GET_POSITION_VIEW,
        typeArguments: [],
        functionArguments: [canonicalSafe],
      },
    });
    const dn = parseDeltaNeutralPositionView(rawView);
    if (!dn || !dn.recordExists) {
      return NextResponse.json({ success: false, error: "No delta-neutral record for this safe" }, { status: 404 });
    }
    if (!dn.isOpen) {
      return NextResponse.json({ success: false, error: "Delta-neutral position is already closed on-chain" }, { status: 400 });
    }
    if (normalizeAddress(dn.decibelSubaccount) !== normalizeAddress(canonicalSubaccount)) {
      return NextResponse.json(
        { success: false, error: "subaccount does not match on-chain delta-neutral record" },
        { status: 400 }
      );
    }

    const executorAddress = toCanonicalAddress(getDecibelExecutorAccount().accountAddress.toString());
    if (!executorAddress) {
      return NextResponse.json({ success: false, error: "Executor address is not configured" }, { status: 503 });
    }

    const delegations = (await fetchDecibel(
      `/api/v1/delegations?subaccount=${encodeURIComponent(canonicalSubaccount)}`
    )) as DelegationDto[];
    const apiHasPerpsDelegation = (Array.isArray(delegations) ? delegations : []).some((item) => {
      const delegated = item.delegated_account ? toCanonicalAddress(item.delegated_account) : "";
      const notExpired =
        typeof item.expiration_time_s === "number" ? item.expiration_time_s > Math.floor(Date.now() / 1000) : true;
      const permission = (item.permission_type || "").toLowerCase();
      return (
        delegated &&
        normalizeAddress(delegated) === normalizeAddress(executorAddress) &&
        notExpired &&
        permission.includes("trade") &&
        permission.includes("perp")
      );
    });

    let hasDelegation = apiHasPerpsDelegation;
    if (!hasDelegation) {
      const pkg = isTestnet ? PACKAGE_TESTNET : PACKAGE_MAINNET;
      try {
        const subRes = await decibelAptos.getAccountResource({
          accountAddress: canonicalSubaccount,
          resourceType: `${pkg}::dex_accounts::Subaccount`,
        });
        hasDelegation = hasPerpsDelegationOnChain({
          subaccountResource: subRes,
          executorAddress,
        });
      } catch {
        // ignore
      }
    }

    if (!hasDelegation) {
      return NextResponse.json(
        { success: false, error: "No active delegation to executor for this subaccount" },
        { status: 403 }
      );
    }

    const marketAddr = toCanonicalAddress(dn.perpMarket);
    const spotMetadata = toCanonicalAddress(dn.spotAssetMetadata);

    const marketsRaw = await fetchDecibel("/api/v1/markets");
    const markets = normalizeMarketsPayload(marketsRaw);
    const marketConfig = markets.find(
      (m) => m.market_addr && normalizeAddress(toCanonicalAddress(m.market_addr)) === normalizeAddress(marketAddr)
    ) as (DecibelMarketConfig & { market_addr: string; market_name: string }) | undefined;
    if (!marketConfig?.market_addr) {
      return NextResponse.json({ success: false, error: "Market config not found for on-chain perp market" }, { status: 404 });
    }

    const positionsRaw = (await fetchDecibel(
      `/api/v1/account_positions?account=${encodeURIComponent(canonicalSubaccount)}`
    )) as unknown;
    const list = Array.isArray(positionsRaw) ? (positionsRaw as DecibelAccountPosition[]) : [];
    const posRow = list.find((p) => {
      if (!p || p.is_deleted) return false;
      const m = String(p.market || "");
      if (!m) return false;
      return normalizeAddress(toCanonicalAddress(m)) === normalizeAddress(marketAddr);
    });
    const shortSize = Number(posRow?.size ?? 0);
    const noActiveShort = !Number.isFinite(shortSize) || shortSize >= 0;
    if (noActiveShort && !force) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No active Decibel short found for this market. On-chain delta-neutral is open — resolve manually or sync state.",
          code: "NO_ACTIVE_SHORT",
        },
        { status: 409 }
      );
    }
    if (!noActiveShort && force) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Active Decibel short still exists for this market. Use the regular Close (no force flag).",
        },
        { status: 409 }
      );
    }

    let closeTxHash: string | null = null;
    let closeTxVersion: bigint | null = null;

    if (!noActiveShort) {
      const prices = (await fetchDecibel(
        `/api/v1/prices?market=${encodeURIComponent(marketAddr)}`
      )) as Array<{ mark_px?: number; mid_px?: number }>;
      const firstPrice = Array.isArray(prices) ? prices[0] : null;
      const markPx = Number(firstPrice?.mark_px ?? firstPrice?.mid_px ?? NaN);
      if (!Number.isFinite(markPx) || markPx <= 0) {
        return NextResponse.json({ success: false, error: "Failed to resolve mark price" }, { status: 502 });
      }

      // Do not call configure_user_settings here: Decibel aborts ECANNOT_MODIFY_SETTINGS_WHILE_HOLDING_POSITION (0x4)
      // when changing market settings while a position is open. Settings were applied at open.

      // Builder fee on close: same gating as open. If user has approved, include the builder
      // pair so we earn the fee on the close trade too. If not, log and skip.
      const builderAddrEnv = process.env.DECIBEL_BUILDER_ADDRESS?.trim() || null;
      const builderFeeEnvRaw = process.env.DECIBEL_BUILDER_FEE_BPS?.trim();
      const builderFeeEnv =
        builderFeeEnvRaw != null && builderFeeEnvRaw !== "" ? Number(builderFeeEnvRaw) : 10;
      let closeBuilderAddr: string | null = null;
      let closeBuilderFeeBps: number | null = null;
      if (
        builderAddrEnv &&
        Number.isFinite(builderFeeEnv) &&
        builderFeeEnv > 0 &&
        builderFeeEnv <= 10_000
      ) {
        const approvedBps = await getApprovedBuilderFeeBps({
          aptos: decibelAptos,
          subaccount: canonicalSubaccount,
          builder: builderAddrEnv,
          isTestnet,
        });
        if (approvedBps != null && approvedBps >= builderFeeEnv) {
          closeBuilderAddr = toCanonicalAddress(builderAddrEnv);
          closeBuilderFeeBps = builderFeeEnv;
        } else {
          console.warn(
            "[Decibel] executor-close-delta-neutral: builder fee skipped — no approval",
            { subaccount: canonicalSubaccount, requestedBps: builderFeeEnv, approvedBps }
          );
        }
      }

      const closePayload = buildCloseAtMarketPayload({
        subaccountAddr: canonicalSubaccount,
        marketAddr,
        size: Math.abs(shortSize),
        isLong: false,
        markPx,
        marketConfig,
        slippageBps: DEFAULT_SWAP_SLIPPAGE_BPS,
        isTestnet,
        builderAddr: closeBuilderAddr,
        builderFeeBps: closeBuilderFeeBps,
      });
      closeTxHash = await submitExecutorEntryFunction({
        network,
        fn: closePayload.function,
        functionArguments: closePayload.functionArguments as (string | number | boolean | bigint | null | number[])[],
        maxGasAmount: 35_000,
      });

      closeTxVersion = await getTxVersionByHash({ aptos: decibelAptos, hash: closeTxHash });
      if (closeTxVersion == null || closeTxVersion <= BigInt(0)) {
        return NextResponse.json(
          { success: false, error: "Failed to read Decibel close transaction version" },
          { status: 502 }
        );
      }

      await pollShortClosed({ subaccount: canonicalSubaccount, marketAddr });
    } else {
      console.warn(
        "[Decibel] executor-close-delta-neutral: force-recovery mode — skipping Decibel close (no active short)",
        { safe: canonicalSafe, subaccount: canonicalSubaccount, marketAddr }
      );
    }

    const balanceLookup = await fetchFaBalanceIndexerOrOnChain({
      aptos: aptosMainnet,
      owner: canonicalSafe,
      metadata: spotMetadata,
      aptosApiKey: APTOS_API_KEY,
    });
    const spotBalanceBaseUnits = balanceLookup.amount;
    let swapTxHash: string | null = null;
    let swapSkippedReason: string | null = null;
    if (spotBalanceBaseUnits <= BigInt(0)) {
      swapSkippedReason =
        "Both indexer and on-chain primary store report 0 spot FA balance for this safe/metadata. Swap skipped — verify the canonical safe address.";
      console.warn("[Decibel] executor-close-delta-neutral:", swapSkippedReason, {
        safe: canonicalSafe,
        spotMetadata,
        indexer: balanceLookup.indexer.toString(),
        onchain: balanceLookup.onchain.toString(),
      });
    } else if (balanceLookup.source === "onchain") {
      console.info(
        "[Decibel] executor-close-delta-neutral: indexer lagged; using on-chain primary store balance",
        {
          indexer: balanceLookup.indexer.toString(),
          onchain: balanceLookup.onchain.toString(),
        }
      );
    }
    let usedSqrtPriceLimit: string | null = null;
    if (spotBalanceBaseUnits > BigInt(0)) {
      // Pre-check the AI agent's daily FA-swap budget on the safe so we can
      // surface a clear "daily limit exhausted" message instead of letting
      // the executor tx revert with `Move abort ::vault: 0x8`. We can't size
      // the swap in USDC at this point without a quote, so the cheap check
      // here is: "is the remaining budget non-zero?". The contract still
      // does the final notional check, and if it aborts with 0x8 we
      // re-fetch the limits and return a structured error below.
      let preCheckLimits: VaultFaSwapLimits | null = null;
      try {
        preCheckLimits = await fetchVaultFaSwapLimits({
          safeAddress: canonicalSafe,
          aptosApiKey: APTOS_API_KEY,
        });
      } catch (e) {
        console.warn("[Decibel] executor-close-delta-neutral: vault swap-limit pre-check failed", e);
      }
      if (preCheckLimits?.exists && preCheckLimits.remainingUsdc === BigInt(0)) {
        return NextResponse.json(
          {
            success: false,
            code: "DAILY_LIMIT_EXHAUSTED",
            error:
              "Daily swap limit for this AI agent safe is exhausted. The counter resets at UTC midnight.",
            data: {
              safeAddress: canonicalSafe,
              maxDailyUsdc: preCheckLimits.maxDailyUsdc.toString(),
              maxPerTxUsdc: preCheckLimits.maxPerTxUsdc.toString(),
              spentTodayUsdc: preCheckLimits.spentTodayUsdc.toString(),
              remainingUsdc: preCheckLimits.remainingUsdc.toString(),
              secondsUntilRollover: preCheckLimits.secondsUntilRollover,
            },
          },
          { status: 422 }
        );
      }

      const deadline = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_SWAP_DEADLINE_SECS);
      try {
        const swapRes = await submitSwapFaToFaWithFallbackLimits({
          network,
          safe: canonicalSafe,
          feeTier: feeTierForSpotMetadata(spotMetadata),
          amountIn: spotBalanceBaseUnits,
          fromMetadata: spotMetadata,
          toMetadata: USDC_FA_METADATA_MAINNET,
          deadline,
          direction: "zeroForOne",
        });
        swapTxHash = swapRes.swapTxHash;
        usedSqrtPriceLimit = swapRes.usedSqrtPriceLimit.toString();
      } catch (swapErr) {
        if (isVaultDailyLimitAbort(swapErr)) {
          // The swap notional exceeded what was left in the daily budget.
          // Re-read the post-state so the client can show how much is left.
          let postLimits: VaultFaSwapLimits | null = null;
          try {
            postLimits = await fetchVaultFaSwapLimits({
              safeAddress: canonicalSafe,
              aptosApiKey: APTOS_API_KEY,
            });
          } catch {
            // ignore — we'll still return a useful structured error
          }
          return NextResponse.json(
            {
              success: false,
              code: "DAILY_LIMIT_EXCEEDED",
              error:
                "The close swap would exceed the AI agent safe's remaining daily limit. Wait for the UTC reset or close once the limit is bigger.",
              data: {
                safeAddress: canonicalSafe,
                maxDailyUsdc: postLimits?.maxDailyUsdc.toString() ?? null,
                maxPerTxUsdc: postLimits?.maxPerTxUsdc.toString() ?? null,
                spentTodayUsdc: postLimits?.spentTodayUsdc.toString() ?? null,
                remainingUsdc: postLimits?.remainingUsdc.toString() ?? null,
                secondsUntilRollover: postLimits?.secondsUntilRollover ?? null,
                spotSwapAmountInBaseUnits: spotBalanceBaseUnits.toString(),
              },
            },
            { status: 422 }
          );
        }
        throw swapErr;
      }
    }

    // record_close anchor tx version: Decibel close tx version when present; otherwise (force
    // recovery) fall back to the safe-swap tx version, or 0 if the safe also had no spot to
    // swap. Move-side does not validate the value — it's stored as `closeDecibelTxVersion`.
    let recordCloseAnchor: bigint = closeTxVersion ?? BigInt(0);
    if (recordCloseAnchor === BigInt(0) && swapTxHash) {
      const v = await getTxVersionByHash({ aptos: aptosMainnet, hash: swapTxHash });
      if (v != null && v > BigInt(0)) recordCloseAnchor = v;
    }

    const recordCloseFn = `${YIELD_AI_PACKAGE_ADDRESS}::delta_neutral::record_close`;
    const recordCloseTxHash = await submitExecutorEntryFunction({
      network,
      fn: recordCloseFn,
      functionArguments: [canonicalSafe, recordCloseAnchor],
      maxGasAmount: 50_000,
    });

    const pkg = isTestnet ? PACKAGE_TESTNET : PACKAGE_MAINNET;

    return NextResponse.json({
      success: true,
      data: {
        owner: canonicalOwner,
        safeAddress: canonicalSafe,
        subaccount: canonicalSubaccount,
        marketAddr,
        closeTxHash,
        closeTxVersion: closeTxVersion?.toString() ?? null,
        spotSwapAmountInBaseUnits: spotBalanceBaseUnits.toString(),
        swapTxHash,
        swapSkippedReason,
        usedSqrtPriceLimit,
        recordCloseTxHash,
        recordCloseAnchorTxVersion: recordCloseAnchor.toString(),
        forceRecovery: noActiveShort,
        decibelPackage: pkg,
      },
    });
  } catch (error) {
    console.error("[Decibel] executor-close-delta-neutral error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
