import { YIELD_AI_PACKAGE_ADDRESS } from "@/lib/constants/yieldAiVault";

/**
 * On-chain resource: `0x...::vault::VaultFaSwapConfig` stored on the safe address.
 * Tracks the AI agent's daily / per-tx swap-notional cap (in USDC base units),
 * the day-epoch (day = floor(now_seconds / 86400)) the counter applies to, and
 * how much has been spent so far in that day.
 *
 * When the contract executes a swap, if `day` < current day it resets
 * `spent_today_usdc` to 0 and rolls `day` forward. So when we read it client-
 * side and find `day` stale, the effective remaining budget is `max_daily_usdc`.
 */

export const VAULT_FA_SWAP_CONFIG_RESOURCE = `${YIELD_AI_PACKAGE_ADDRESS}::vault::VaultFaSwapConfig` as const;
export const USDC_DECIMALS = 6;

/** Move-side abort code raised when the swap would exceed the daily budget. */
export const VAULT_DAILY_LIMIT_ABORT_CODE = 0x8;

export interface VaultFaSwapConfigRaw {
  day: string;
  max_daily_usdc: string;
  max_per_tx_usdc: string;
  spent_today_usdc: string;
}

export interface VaultFaSwapLimits {
  exists: boolean;
  /** Current day-epoch as stored on chain (floor(now_secs / 86400)). */
  day: bigint;
  maxDailyUsdc: bigint;
  maxPerTxUsdc: bigint;
  /** Raw spent counter, may belong to a past day. */
  spentTodayUsdcRaw: bigint;
  /** Spent counter normalised against the current day (0 if day-epoch is stale). */
  spentTodayUsdc: bigint;
  /** maxDailyUsdc - effectiveSpentTodayUsdc, clamped at 0. */
  remainingUsdc: bigint;
  /** Current day-epoch as observed at fetch time. */
  currentDayEpoch: bigint;
  /** Seconds remaining until the next UTC midnight (i.e. day-counter rollover). */
  secondsUntilRollover: number;
}

function dayEpochFromSeconds(seconds: number | bigint): bigint {
  const s = typeof seconds === "bigint" ? seconds : BigInt(Math.floor(seconds));
  return s / 86_400n;
}

export function vaultFaSwapConfigResourceUrl(safeAddress: string, network: "mainnet" | "testnet" = "mainnet"): string {
  const base =
    network === "testnet"
      ? "https://fullnode.testnet.aptoslabs.com/v1"
      : "https://fullnode.mainnet.aptoslabs.com/v1";
  return `${base}/accounts/${safeAddress}/resource/${VAULT_FA_SWAP_CONFIG_RESOURCE}`;
}

export function deriveVaultFaSwapLimits(
  raw: VaultFaSwapConfigRaw | null,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): VaultFaSwapLimits {
  const currentDayEpoch = dayEpochFromSeconds(nowSeconds);
  const secondsUntilRollover = 86_400 - (Math.floor(nowSeconds) % 86_400);
  if (!raw) {
    return {
      exists: false,
      day: 0n,
      maxDailyUsdc: 0n,
      maxPerTxUsdc: 0n,
      spentTodayUsdcRaw: 0n,
      spentTodayUsdc: 0n,
      remainingUsdc: 0n,
      currentDayEpoch,
      secondsUntilRollover,
    };
  }
  const day = BigInt(raw.day);
  const maxDailyUsdc = BigInt(raw.max_daily_usdc);
  const maxPerTxUsdc = BigInt(raw.max_per_tx_usdc);
  const spentTodayUsdcRaw = BigInt(raw.spent_today_usdc);
  const isFresh = day === currentDayEpoch;
  const spentTodayUsdc = isFresh ? spentTodayUsdcRaw : 0n;
  const remainingUsdc =
    maxDailyUsdc > spentTodayUsdc ? maxDailyUsdc - spentTodayUsdc : 0n;
  return {
    exists: true,
    day,
    maxDailyUsdc,
    maxPerTxUsdc,
    spentTodayUsdcRaw,
    spentTodayUsdc,
    remainingUsdc,
    currentDayEpoch,
    secondsUntilRollover,
  };
}

/**
 * Server-side fetch (Aptos REST). Returns null when the resource isn't yet
 * created (older safes that have never made an executor swap may not have it).
 * Caller can treat null as "limits unknown / not configured" — the deriver
 * also returns a zero-filled object for that case.
 */
export async function fetchVaultFaSwapConfigRaw(params: {
  safeAddress: string;
  network?: "mainnet" | "testnet";
  aptosApiKey?: string;
}): Promise<VaultFaSwapConfigRaw | null> {
  const url = vaultFaSwapConfigResourceUrl(params.safeAddress, params.network ?? "mainnet");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (params.aptosApiKey) headers.Authorization = `Bearer ${params.aptosApiKey}`;
  const res = await fetch(url, { headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Failed to read VaultFaSwapConfig (${res.status})`);
  }
  const json = (await res.json()) as { data?: VaultFaSwapConfigRaw };
  return json.data ?? null;
}

export async function fetchVaultFaSwapLimits(params: {
  safeAddress: string;
  network?: "mainnet" | "testnet";
  aptosApiKey?: string;
  nowSeconds?: number;
}): Promise<VaultFaSwapLimits> {
  const raw = await fetchVaultFaSwapConfigRaw(params);
  return deriveVaultFaSwapLimits(raw, params.nowSeconds);
}

/** Detects the abort code `0x8` (daily limit exceeded) inside Move/SDK errors. */
export function isVaultDailyLimitAbort(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  // SDK surfaces it as: `Move abort in 0x...::vault: 0x8`
  return (
    /::vault: 0x8\b/.test(msg) ||
    /Move abort .*::vault.*: 0x8\b/i.test(msg) ||
    /abort.*::vault.*0x8/i.test(msg)
  );
}

export function formatUsdc(baseUnits: bigint): string {
  const sign = baseUnits < 0n ? "-" : "";
  const abs = baseUnits < 0n ? -baseUnits : baseUnits;
  const whole = abs / 1_000_000n;
  const frac = abs % 1_000_000n;
  const fracStr = frac.toString().padStart(6, "0").slice(0, 2);
  return `${sign}$${whole.toLocaleString("en-US")}.${fracStr}`;
}
