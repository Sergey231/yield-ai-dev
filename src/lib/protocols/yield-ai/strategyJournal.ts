import { YIELD_AI_PACKAGE_ADDRESS } from "@/lib/constants/yieldAiVault";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";
import type { Aptos } from "@aptos-labs/ts-sdk";

/**
 * `strategy_journal` module (mainnet package `0x333d…4700`).
 *
 * The journal is the per-safe, auto-incrementing `cycle_id` ledger that ties a DN trade's
 * legs together. It replaces `delta_neutral::record_open/close` for new positions while the
 * legacy V2 records are still read in parallel (dual-read) until they close.
 *
 * ABI verified against mainnet (`journal_initialized() == true`). See
 * `docs/dn-journal-migration.md` §10 for the full signature list.
 */
const SJ = `${YIELD_AI_PACKAGE_ADDRESS}::strategy_journal` as const;

export const STRATEGY_JOURNAL_VIEWS = {
  journalInitialized: `${SJ}::journal_initialized`,
  isAnyCycleOpen: `${SJ}::is_any_cycle_open`,
  getOpenCycles: `${SJ}::get_open_cycles`,
  getCycleCount: `${SJ}::get_cycle_count`,
  getCycle: `${SJ}::get_cycle`,
  getCycleString: `${SJ}::get_cycle_string`,
  getCycleExtraU64: `${SJ}::get_cycle_extra_u64`,
} as const;

export const STRATEGY_JOURNAL_ENTRIES = {
  openCycle: `${SJ}::open_cycle`,
  closeCycle: `${SJ}::close_cycle`,
  recordAction: `${SJ}::record_action`,
  recordExternalLeg: `${SJ}::record_external_leg`,
  setCycleString: `${SJ}::set_cycle_string`,
  setCycleExtraU64: `${SJ}::set_cycle_extra_u64`,
} as const;

/** String-KV key used to pin the Decibel subaccount to a cycle (for exact position matching). */
export const CYCLE_SUBACCOUNT_KEY = "decibel_subaccount";

/** Extra-u64 key: cumulative USDC spent on the spot leg (open + every add), base units (6dp). */
export const CYCLE_SPOT_USDC_KEY = "spot_usdc";

/** Extra-u64 key: perp margin committed at open (short notional @ 1x), base units (6dp). A stable
 * anchor for "deposited" — rehedge is cash-neutral (usdc_delta=0) so it never changes this. */
export const CYCLE_MARGIN_OPEN_KEY = "decibel_margin_open";

/** deposit_mode enum (matches on-chain getters). */
export const DEPOSIT_MODE = {
  usdcZap: 0,
  dual: 1,
  baseAsset: 2,
} as const;

/** action_kind enum for `record_action`. */
export const ACTION_KIND = {
  marginAdd: 1,
  marginRemove: 2,
  liquidityAdd: 3,
  liquidityRemove: 4,
  rebalanceRange: 5,
  rehedge: 6,
  claimFees: 7,
  claimRewards: 8,
} as const;

/** `strategy_id` is a `vector<u8>` — encode the convention string to UTF-8 bytes. */
export function strategyIdBytes(id: string): number[] {
  return Array.from(new TextEncoder().encode(id));
}

/** Convention strategy id for the spot (hold-spot) DN, e.g. "dn-decibel-btc". */
export function spotDnStrategyId(asset: "BTC" | "APT"): string {
  return `dn-decibel-${asset.toLowerCase()}`;
}

/** Parsed `CycleView` snapshot (field order per mainnet ABI). */
export type CycleViewParsed = {
  recordExists: boolean;
  cycleId: string;
  strategyId: string; // decoded UTF-8
  depositMode: number;
  lpPosition: string;
  perpMarket: string;
  spotMetadata: string;
  baseExposure: string;
  perpShortSize: string;
  usdcNotionalOpen: string;
  isOpen: boolean;
  openedAt: string;
  updatedAt: string;
  closedAt: string;
  usdcReceivedOnClose: string;
  perpFundingAbs: string;
  perpFundingPositive: boolean;
  perpRealizedAbs: string;
  perpRealizedPositive: boolean;
  actionCount: string;
  version: number;
};

function addrToString(v: unknown): string {
  if (typeof v === "string") return toCanonicalAddress(v);
  if (v && typeof v === "object" && "inner" in v && typeof (v as { inner?: string }).inner === "string") {
    return toCanonicalAddress((v as { inner: string }).inner);
  }
  return "0x0";
}

function u64ToString(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number" && Number.isFinite(v)) return String(Math.trunc(v));
  if (typeof v === "string" && /^\d+$/.test(v)) return v;
  return "0";
}

function numVal(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return 0;
}

function boolVal(v: unknown): boolean {
  return v === true || v === "true";
}

/** Decode a `vector<u8>` view value (0x-hex string or number[]) to a UTF-8 string. */
export function decodeVectorU8Utf8(v: unknown): string {
  try {
    let bytes: Uint8Array | null = null;
    if (typeof v === "string") {
      const hex = v.startsWith("0x") ? v.slice(2) : v;
      if (hex.length === 0) return "";
      if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) return v; // not hex → already a string
      bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    } else if (Array.isArray(v)) {
      bytes = Uint8Array.from(v.map((n) => Number(n) & 0xff));
    }
    if (!bytes) return "";
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

/**
 * Parse the return of `get_cycle(safe, cycle_id)`. `aptos.view()` returns a single-element
 * array wrapping the struct object; REST may return the object directly. Fields are read by
 * name (snake_case as in the on-chain CycleView ABI), so positional order does not matter.
 */
export function parseCycleView(raw: unknown): CycleViewParsed | null {
  let obj: Record<string, unknown> | null = null;
  if (Array.isArray(raw) && raw.length > 0 && raw[0] && typeof raw[0] === "object") {
    obj = raw[0] as Record<string, unknown>;
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    obj = raw as Record<string, unknown>;
  }
  if (!obj) return null;
  const get = (k: string) => obj![k];
  return {
    recordExists: boolVal(get("record_exists")),
    cycleId: u64ToString(get("cycle_id")),
    strategyId: decodeVectorU8Utf8(get("strategy_id_utf8")),
    depositMode: numVal(get("deposit_mode")),
    lpPosition: addrToString(get("lp_position")),
    perpMarket: addrToString(get("perp_market")),
    spotMetadata: addrToString(get("spot_metadata")),
    baseExposure: u64ToString(get("base_exposure")),
    perpShortSize: u64ToString(get("perp_short_size")),
    usdcNotionalOpen: u64ToString(get("usdc_notional_open")),
    isOpen: boolVal(get("is_open")),
    openedAt: u64ToString(get("opened_at")),
    updatedAt: u64ToString(get("updated_at")),
    closedAt: u64ToString(get("closed_at")),
    usdcReceivedOnClose: u64ToString(get("usdc_received_on_close")),
    perpFundingAbs: u64ToString(get("perp_funding_abs")),
    perpFundingPositive: boolVal(get("perp_funding_positive")),
    perpRealizedAbs: u64ToString(get("perp_realized_abs")),
    perpRealizedPositive: boolVal(get("perp_realized_positive")),
    actionCount: u64ToString(get("action_count")),
    version: numVal(get("version")),
  };
}

/** Parse `get_open_cycles(safe)` → list of cycle ids as strings. */
export function parseOpenCycles(raw: unknown): string[] {
  const arr = Array.isArray(raw) && raw.length === 1 && Array.isArray(raw[0]) ? raw[0] : raw;
  if (!Array.isArray(arr)) return [];
  return arr.map((v) => u64ToString(v)).filter((s) => s !== "0");
}

/** Read `journal_initialized()`. Defaults to false on any failure. */
export async function isJournalInitialized(aptos: Aptos): Promise<boolean> {
  try {
    const res = await aptos.view({
      payload: { function: STRATEGY_JOURNAL_VIEWS.journalInitialized, typeArguments: [], functionArguments: [] },
    });
    return Array.isArray(res) && (res[0] === true || res[0] === "true");
  } catch {
    return false;
  }
}

/**
 * Read a cycle's string annotation by key (e.g. the pinned Decibel subaccount). Returns the
 * decoded UTF-8 value, or null when not set / on any failure.
 */
export async function fetchCycleString(
  aptos: Aptos,
  safe: string,
  cycleId: string,
  key: string
): Promise<string | null> {
  try {
    const res = await aptos.view({
      payload: {
        function: STRATEGY_JOURNAL_VIEWS.getCycleString,
        typeArguments: [],
        functionArguments: [safe, cycleId, strategyIdBytes(key)],
      },
    });
    const obj = Array.isArray(res) && res.length > 0 ? res[0] : res;
    if (!obj || typeof obj !== "object") return null;
    const found = (obj as { found?: unknown }).found;
    if (found !== true && found !== "true") return null;
    const value = decodeVectorU8Utf8((obj as { value_utf8?: unknown }).value_utf8);
    return value || null;
  } catch {
    return null;
  }
}

/**
 * Read a cycle's numeric extra (e.g. cumulative spot USDC) by key. Returns the value as bigint,
 * or null when not set / on any failure.
 */
export async function fetchCycleExtraU64(
  aptos: Aptos,
  safe: string,
  cycleId: string,
  key: string
): Promise<bigint | null> {
  try {
    const res = await aptos.view({
      payload: {
        function: STRATEGY_JOURNAL_VIEWS.getCycleExtraU64,
        typeArguments: [],
        functionArguments: [safe, cycleId, strategyIdBytes(key)],
      },
    });
    const obj = Array.isArray(res) && res.length > 0 ? res[0] : res;
    if (!obj || typeof obj !== "object") return null;
    const found = (obj as { found?: unknown }).found;
    if (found !== true && found !== "true") return null;
    const value = (obj as { value?: unknown }).value;
    if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
    if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
    return null;
  } catch {
    return null;
  }
}

/** Read all open cycles for a safe with their parsed snapshots. */
export async function fetchOpenCycles(aptos: Aptos, safe: string): Promise<CycleViewParsed[]> {
  const openRaw = await aptos.view({
    payload: { function: STRATEGY_JOURNAL_VIEWS.getOpenCycles, typeArguments: [], functionArguments: [safe] },
  });
  const ids = parseOpenCycles(openRaw);
  const out: CycleViewParsed[] = [];
  for (const id of ids) {
    try {
      const cycleRaw = await aptos.view({
        payload: { function: STRATEGY_JOURNAL_VIEWS.getCycle, typeArguments: [], functionArguments: [safe, id] },
      });
      const parsed = parseCycleView(cycleRaw);
      if (parsed && parsed.recordExists) out.push(parsed);
    } catch {
      // skip a cycle that fails to read; the rest still render
    }
  }
  return out;
}
