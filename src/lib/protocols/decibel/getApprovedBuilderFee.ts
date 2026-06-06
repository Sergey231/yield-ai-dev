import type { Aptos } from "@aptos-labs/ts-sdk";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";
import { PACKAGE_MAINNET, PACKAGE_TESTNET } from "./closePosition";

/**
 * Read on-chain Move view `builder_code_registry::get_approved_max_fee(subaccount, builder)`
 * which returns `Option<u64>` (basis points). Returns null when no approval exists, or when
 * the view call fails (we treat lookup errors as "no approval" and let callers fall back).
 *
 * This is the server-side helper used by executor routes; the public API route at
 * `/api/protocols/decibel/approved-max-fee` performs the same view via a raw HTTP call.
 */
export async function getApprovedBuilderFeeBps(params: {
  aptos: Aptos;
  subaccount: string;
  builder: string;
  isTestnet?: boolean;
}): Promise<number | null> {
  const { aptos, subaccount, builder, isTestnet = false } = params;
  const pkg = isTestnet ? PACKAGE_TESTNET : PACKAGE_MAINNET;
  try {
    const raw = await aptos.view({
      payload: {
        function: `${pkg}::builder_code_registry::get_approved_max_fee`,
        typeArguments: [],
        functionArguments: [toCanonicalAddress(subaccount), toCanonicalAddress(builder)],
      },
    });
    // Returned shape: [Option<u64>] -> [{vec: [] | ["123"]}]
    const first = Array.isArray(raw) ? raw[0] : raw;
    if (
      first &&
      typeof first === "object" &&
      "vec" in (first as object) &&
      Array.isArray((first as { vec: unknown[] }).vec) &&
      (first as { vec: unknown[] }).vec.length > 0
    ) {
      const v = (first as { vec: unknown[] }).vec[0];
      const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  } catch (err) {
    console.warn("[Decibel] get_approved_max_fee view failed", err);
    return null;
  }
}
