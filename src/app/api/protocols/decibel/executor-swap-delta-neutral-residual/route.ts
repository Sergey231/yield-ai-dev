import { NextRequest, NextResponse } from "next/server";
import { toCanonicalAddress, normalizeAddress } from "@/lib/utils/addressNormalization";
import { USDC_FA_METADATA_MAINNET } from "@/lib/constants/yieldAiVault";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import {
  DELTA_NEUTRAL_GET_POSITION_VIEW,
  parseDeltaNeutralPositionView,
} from "@/lib/protocols/yield-ai/deltaNeutralViews";
import { fetchIndexerFaBalanceForMetadataAtOwner } from "@/lib/protocols/yield-ai/indexerFaBalance";
import { submitSwapFaToFaWithFallbackLimits } from "@/lib/protocols/yield-ai/swapFaToFa";

const DECIBEL_API_BASE_URL =
  process.env.DECIBEL_API_BASE_URL || "https://api.testnet.aptoslabs.com/decibel";
const APTOS_API_KEY = process.env.APTOS_API_KEY;

const DEFAULT_SWAP_DEADLINE_SECS = 120;
const XBTC_USDC_FEE_TIER = 1;

function parseAllowlist(): string[] {
  const raw = process.env.DECIBEL_EXECUTOR_ALLOWLIST || "";
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => normalizeAddress(toCanonicalAddress(v)));
}

function getAptosForView(): Aptos {
  const isTestnet = DECIBEL_API_BASE_URL.includes("testnet");
  const aptosNetwork = isTestnet ? Network.TESTNET : Network.MAINNET;
  const cfg = new AptosConfig({
    network: aptosNetwork,
    ...(APTOS_API_KEY && { clientConfig: { HEADERS: { Authorization: `Bearer ${APTOS_API_KEY}` } } }),
  });
  return new Aptos(cfg);
}

/**
 * POST /api/protocols/decibel/executor-swap-delta-neutral-residual
 * Swaps recorded spot FA on the safe to USDC via vault::execute_swap_fa_to_fa (executor).
 * For closed delta-neutral records where spot dust or residual remains.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const ownerRaw = typeof body.owner === "string" ? body.owner.trim() : "";
    const safeRaw = typeof body.safeAddress === "string" ? body.safeAddress.trim() : "";
    const subRaw = typeof body.subaccount === "string" ? body.subaccount.trim() : "";

    if (!ownerRaw || !safeRaw || !subRaw) {
      return NextResponse.json(
        { success: false, error: "owner, safeAddress, and subaccount are required" },
        { status: 400 }
      );
    }

    const canonicalOwner = toCanonicalAddress(ownerRaw);
    const canonicalSafe = toCanonicalAddress(safeRaw);
    const canonicalSubaccount = toCanonicalAddress(subRaw);
    if (!canonicalOwner.startsWith("0x") || !canonicalSafe.startsWith("0x") || !canonicalSubaccount.startsWith("0x")) {
      return NextResponse.json({ success: false, error: "Invalid address" }, { status: 400 });
    }

    const allowlist = parseAllowlist();
    if (allowlist.length > 0 && !allowlist.includes(normalizeAddress(canonicalOwner))) {
      return NextResponse.json(
        { success: false, error: "Owner is not allowlisted for executor trading" },
        { status: 403 }
      );
    }

    const isTestnet = DECIBEL_API_BASE_URL.includes("testnet");
    const network = isTestnet ? "testnet" : "mainnet";

    const aptos = getAptosForView();
    const rawView = await aptos.view({
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
    if (dn.isOpen) {
      return NextResponse.json(
        { success: false, error: "Position is still open on-chain; use Close delta-neutral instead" },
        { status: 400 }
      );
    }
    if (normalizeAddress(dn.decibelSubaccount) !== normalizeAddress(canonicalSubaccount)) {
      return NextResponse.json(
        { success: false, error: "subaccount does not match on-chain delta-neutral snapshot" },
        { status: 400 }
      );
    }

    const spotMetadata = toCanonicalAddress(dn.spotAssetMetadata);
    const metaNorm = normalizeAddress(spotMetadata);
    if (!metaNorm || metaNorm === normalizeAddress("0x0")) {
      return NextResponse.json(
        { success: false, error: "On-chain record has no spot metadata; cannot swap" },
        { status: 400 }
      );
    }

    const spotBalanceBaseUnits = await fetchIndexerFaBalanceForMetadataAtOwner(
      canonicalSafe,
      spotMetadata,
      APTOS_API_KEY
    );
    if (spotBalanceBaseUnits <= BigInt(0)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Indexer reports zero spot FA for this safe and recorded metadata. Wait for indexer sync or verify the canonical safe address.",
        },
        { status: 409 }
      );
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_SWAP_DEADLINE_SECS);
    const { swapTxHash, usedSqrtPriceLimit } = await submitSwapFaToFaWithFallbackLimits({
      network,
      safe: canonicalSafe,
      feeTier: XBTC_USDC_FEE_TIER,
      amountIn: spotBalanceBaseUnits,
      fromMetadata: spotMetadata,
      toMetadata: USDC_FA_METADATA_MAINNET,
      deadline,
      direction: "zeroForOne",
    });

    return NextResponse.json({
      success: true,
      data: {
        owner: canonicalOwner,
        safeAddress: canonicalSafe,
        subaccount: canonicalSubaccount,
        spotSwapAmountInBaseUnits: spotBalanceBaseUnits.toString(),
        swapTxHash,
        spotMetadata,
        usedSqrtPriceLimit: usedSqrtPriceLimit.toString(),
      },
    });
  } catch (error) {
    console.error("[Decibel] executor-swap-delta-neutral-residual error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
