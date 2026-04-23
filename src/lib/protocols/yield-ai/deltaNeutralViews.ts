import { YIELD_AI_PACKAGE_ADDRESS } from "@/lib/constants/yieldAiVault";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";

/** Aptos view: full position snapshot for a safe (mainnet package). */
export const DELTA_NEUTRAL_GET_POSITION_VIEW =
  `${YIELD_AI_PACKAGE_ADDRESS}::delta_neutral::get_delta_neutral_position` as const;

export const DELTA_NEUTRAL_IS_OPEN_VIEW =
  `${YIELD_AI_PACKAGE_ADDRESS}::delta_neutral::is_delta_neutral_open` as const;

export type DeltaNeutralPositionViewParsed = {
  recordExists: boolean;
  isOpen: boolean;
  decibelSubaccount: string;
  perpMarket: string;
  spotAssetMetadata: string;
  openedAt: string;
  filledShortSize: string;
  usdcSwappedIn: string;
  decibelTxVersion: string;
  closedAt: string;
  closeDecibelTxVersion: string;
};

/** Indexer-based hint after close; not proof of a specific swap transaction. */
export type DeltaNeutralSpotHedgeInference =
  | "open"
  | "no_record"
  | "closed_spot_still_on_safe"
  | "closed_no_spot_for_metadata"
  | "closed_spot_metadata_empty";

export type DeltaNeutralStateResponse = DeltaNeutralPositionViewParsed & {
  spotBalanceBaseUnits: string;
  /** Rough human amount (8 decimals) for display; indexer raw is authoritative. */
  spotBalanceHumanApprox: string | null;
  spotHedgeInference: DeltaNeutralSpotHedgeInference;
  spotHedgeInferenceNote: string;
};

function addrToString(v: unknown): string {
  if (typeof v === "string") return toCanonicalAddress(v);
  if (v && typeof v === "object" && "inner" in v && typeof (v as { inner?: string }).inner === "string") {
    return toCanonicalAddress((v as { inner: string }).inner);
  }
  return "";
}

function u64ToString(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number" && Number.isFinite(v)) return String(Math.trunc(v));
  if (typeof v === "string" && /^\d+$/.test(v)) return v;
  return "0";
}

function boolVal(v: unknown): boolean {
  return v === true || v === "true";
}

/** Move struct field order for `DeltaNeutralPositionView` (snake_case as in ABI). */
const VIEW_FIELD_ORDER_SNAKE = [
  "record_exists",
  "is_open",
  "decibel_subaccount",
  "perp_market",
  "spot_asset_metadata",
  "opened_at",
  "filled_short_size",
  "usdc_swapped_in",
  "decibel_tx_version",
  "closed_at",
  "close_decibel_tx_version",
] as const;

const VIEW_FIELD_ORDER_CAMEL = [
  "recordExists",
  "isOpen",
  "decibelSubaccount",
  "perpMarket",
  "spotAssetMetadata",
  "openedAt",
  "filledShortSize",
  "usdcSwappedIn",
  "decibelTxVersion",
  "closedAt",
  "closeDecibelTxVersion",
] as const;

function pickField(obj: Record<string, unknown>, snake: string, camel: string): unknown {
  if (obj[snake] !== undefined) return obj[snake];
  if (obj[camel] !== undefined) return obj[camel];
  return undefined;
}

function viewRowFromObject(obj: Record<string, unknown>): unknown[] | null {
  const hasAnyKey = [...VIEW_FIELD_ORDER_SNAKE, ...VIEW_FIELD_ORDER_CAMEL].some((k) => obj[k] !== undefined);
  if (!hasAnyKey) return null;

  const defaults: unknown[] = [
    false,
    false,
    "0x0",
    "0x0",
    "0x0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
  ];
  const row = VIEW_FIELD_ORDER_SNAKE.map((snake, i) => {
    const camel = VIEW_FIELD_ORDER_CAMEL[i];
    const v = pickField(obj, snake, camel);
    return v !== undefined ? v : defaults[i];
  });
  return row;
}

/**
 * Normalize `aptos.view()` / REST output: array of 11 values, nested array, or struct object.
 */
export function normalizeDeltaNeutralViewRaw(raw: unknown): unknown[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    if (raw.length >= 11) return raw;
    if (raw.length === 1) {
      const inner = raw[0];
      if (Array.isArray(inner) && inner.length >= 11) return inner;
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        return viewRowFromObject(inner as Record<string, unknown>);
      }
    }
    return null;
  }
  if (typeof raw === "object") {
    return viewRowFromObject(raw as Record<string, unknown>);
  }
  return null;
}

/**
 * Parse return value of `delta_neutral::get_delta_neutral_position(address)`.
 * Field order matches Move struct DeltaNeutralPositionView.
 */
export function parseDeltaNeutralPositionView(raw: unknown): DeltaNeutralPositionViewParsed | null {
  const row = normalizeDeltaNeutralViewRaw(raw);
  if (!row || row.length < 11) return null;
  const [
    recordExists,
    isOpen,
    decibelSubaccount,
    perpMarket,
    spotAssetMetadata,
    openedAt,
    filledShortSize,
    usdcSwappedIn,
    decibelTxVersion,
    closedAt,
    closeDecibelTxVersion,
  ] = row;
  return {
    recordExists: boolVal(recordExists),
    isOpen: boolVal(isOpen),
    decibelSubaccount: addrToString(decibelSubaccount),
    perpMarket: addrToString(perpMarket),
    spotAssetMetadata: addrToString(spotAssetMetadata),
    openedAt: u64ToString(openedAt),
    filledShortSize: u64ToString(filledShortSize),
    usdcSwappedIn: u64ToString(usdcSwappedIn),
    decibelTxVersion: u64ToString(decibelTxVersion),
    closedAt: u64ToString(closedAt),
    closeDecibelTxVersion: u64ToString(closeDecibelTxVersion),
  };
}
