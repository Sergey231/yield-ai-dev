/**
 * Hedge intent helpers: USDC ↔ base (APT / WBTC) for perp delta hedge via in-app swap.
 */

import tokenList from "@/lib/data/tokenList.json";
import type { Token } from "@/lib/types/panora";

export const HEDGE_FA = {
  USDC: "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b",
  APT: "0xa",
  WBTC: "0x68844a0d7f2587e726ad0579f3d640865bb4162c08a4589eeda3f9689ec52a3d",
} as const;

/** Extra slack for fees / rounding (0.5%) plus small fixed USDC. */
const USDC_BUFFER_BPS = 50;
const USDC_BUFFER_FIXED = 0.01;

function normAddr(a: string): string {
  if (!a || !a.startsWith("0x")) return (a || "").toLowerCase();
  const stripped = "0x" + a.slice(2).replace(/^0+/, "") || "0x0";
  return stripped.toLowerCase();
}

export function hedgeUsdcThreshold(sizeUsd: number): number {
  if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) return 0;
  return sizeUsd * (1 + USDC_BUFFER_BPS / 10_000) + USDC_BUFFER_FIXED;
}

export function getTokenInfoByFa(faOrAddr: string): Token | undefined {
  const n = normAddr(faOrAddr);
  return (tokenList.data.data as Token[]).find((t) => {
    const fa = normAddr(t.faAddress || "");
    const ta = normAddr(t.tokenAddress || "");
    return fa === n || ta === n;
  });
}

/** Human balance for a fungible address from portfolio tokens. */
export function humanBalanceForFa(
  portfolioTokens: { address: string; amount: string; decimals: number }[],
  fa: string
): number {
  const n = normAddr(fa);
  const row = portfolioTokens.find((t) => normAddr(t.address) === n);
  if (!row) return 0;
  return Number(row.amount) / 10 ** row.decimals;
}

export function hasEnoughUsdcForHedge(
  portfolioTokens: { address: string; amount: string; decimals: number }[],
  sizeUsd: number
): boolean {
  const need = hedgeUsdcThreshold(sizeUsd);
  if (need <= 0) return false;
  const bal = humanBalanceForFa(portfolioTokens, HEDGE_FA.USDC);
  return bal >= need - 1e-9;
}

export function hasEnoughBaseForHedge(
  portfolioTokens: { address: string; amount: string; decimals: number }[],
  baseFa: string,
  requiredHuman: number
): boolean {
  if (!Number.isFinite(requiredHuman) || requiredHuman <= 0) return false;
  const bal = humanBalanceForFa(portfolioTokens, baseFa);
  return bal + 1e-12 >= requiredHuman;
}

/**
 * Base symbol from Decibel market name (e.g. "BTC/USD", "APT/USDC", "BTC-USDC").
 * Must match how the app splits elsewhere (`marketName.split('/')[0]`).
 */
export function parseMarketBaseSymbol(marketName: string): string {
  const s = (marketName || "").trim();
  if (!s || s.startsWith("0x")) return "";
  const first = s.split(/[/\-_]/)[0] ?? "";
  return first.trim().toUpperCase();
}

export function hedgeBaseFaFromSymbol(base: string): string | null {
  const u = base.toUpperCase();
  if (u === "APT") return HEDGE_FA.APT;
  if (u === "BTC" || u === "WBTC") return HEDGE_FA.WBTC;
  return null;
}

export function formatUsdcAmountForSwap(sizeUsd: number): string {
  if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) return "";
  const t = hedgeUsdcThreshold(sizeUsd);
  return t >= 1 ? t.toFixed(6).replace(/\.?0+$/, "") : t.toFixed(6);
}

export function formatBaseAmountForSwap(absSize: number, maxDecimals = 8): string {
  if (!Number.isFinite(absSize) || absSize <= 0) return "";
  const s = absSize.toFixed(maxDecimals).replace(/\.?0+$/, "");
  return s || "";
}

/**
 * Base symbol for hedge routing from a human market label (e.g. "BTC/USD", "APT-USDC").
 * Raw `0x` addresses return empty (caller should pass a resolved display name when possible).
 */
export function resolveBaseSymbolForHedge(marketDisplayName: string): string {
  const s = (marketDisplayName || "").trim();
  if (!s || s.startsWith("0x")) return "";
  let baseSym = parseMarketBaseSymbol(s);
  if (baseSym) return baseSym;
  const first = s.split(/[/\-_]/)[0]?.trim();
  return first ? first.toUpperCase() : "";
}

/** Prefill for base → USDC swap after closing a short (unwind spot hedge). */
export function buildUnwindHedgePrefillFromClosePosition(
  pos: { size: number },
  marketDisplayName: string
): {
  prefill: { fromFaAddress: string; toFaAddress: string; amount: string };
  baseLabel: string;
} | null {
  if (pos.size >= 0) return null;
  const baseSym = resolveBaseSymbolForHedge(marketDisplayName);
  if (!baseSym) return null;
  const baseFa = hedgeBaseFaFromSymbol(baseSym);
  if (!baseFa) return null;
  const absSz = Math.abs(pos.size);
  const amount = formatBaseAmountForSwap(absSz);
  if (!amount) return null;
  const baseLabel = baseSym === "BTC" || baseSym === "WBTC" ? "WBTC" : baseSym;
  return {
    prefill: {
      fromFaAddress: baseFa,
      toFaAddress: HEDGE_FA.USDC,
      amount,
    },
    baseLabel,
  };
}
