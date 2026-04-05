import { PositionBadge, type ProtocolPosition } from "@/shared/ProtocolCard/types";
import { formatNumber } from "@/lib/utils/numberFormat";
import { getPreferredJupiterTokenIcon } from "@/lib/services/solana/jupiterTokenIcons";
import type {
  KaminoRewardRow,
} from "@/lib/query/hooks/protocols/kamino/useKaminoRewards";
import type {
  KaminoUserPositionsRow,
} from "@/lib/query/hooks/protocols/kamino/useKaminoPositions";

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function shortKey(value?: string): string {
  if (!value) return "Unknown";
  if (value.length <= 10) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function getDeep(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const p of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[p];
  }
  return current;
}

function pickFirstNumber(obj: unknown, paths: string[], fallback = 0): number {
  for (const path of paths) {
    const value = getDeep(obj, path);
    const n = toNumber(value, NaN);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

type KaminoBorrowRow = {
  borrowReserve: string;
  borrowedAmountSf?: string;
  marketValueSf?: string;
  marketValueUsd?: number;
  tokenMint?: string;
  tokenSymbol?: string;
  tokenLogoUrl?: string;
};

type KaminoDepositRow = {
  depositReserve: string;
  depositedAmountSf?: string;
  marketValueSf?: string;
  marketValueUsd?: number;
  tokenMint?: string;
  tokenSymbol?: string;
  tokenLogoUrl?: string;
};

function extractKaminoBorrows(obligation: unknown): KaminoBorrowRow[] {
  const raw = getDeep(obligation, "state.borrows");
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b) => (b && typeof b === "object" ? (b as KaminoBorrowRow) : null))
    .filter((b): b is KaminoBorrowRow => Boolean(b && typeof b.borrowReserve === "string" && b.borrowReserve.trim()));
}

function extractKaminoDeposits(obligation: unknown): KaminoDepositRow[] {
  const raw = getDeep(obligation, "state.deposits");
  if (!Array.isArray(raw)) return [];
  return raw
    .map((d) => (d && typeof d === "object" ? (d as KaminoDepositRow) : null))
    .filter((d): d is KaminoDepositRow => Boolean(d && typeof d.depositReserve === "string" && d.depositReserve.trim()));
}

export function computeKaminoRewardsUsd(rewards: KaminoRewardRow[]): number {
  return rewards.reduce((sum, rw) => {
    const v = typeof rw.usdValue === "number" && Number.isFinite(rw.usdValue) ? rw.usdValue : 0;
    return sum + v;
  }, 0);
}

export function computeKaminoPositionsUsd(rows: KaminoUserPositionsRow[]): number {
  let total = 0;
  const list = rows.filter((r) => r.source !== "kamino-farm");
  for (const r of list) {
    if (r.source === "kamino-lend") {
      // Match manage-positions footer: sum supply rows minus borrow rows (per-asset marketValueUsd).
      // Do not use refreshedStats.netAccountValue here — it can diverge from the line items we render.
      const depositRows = extractKaminoDeposits(r.obligation);
      const depositsUsd =
        depositRows.length > 0
          ? depositRows.reduce((sum, d) => {
              const v = typeof d.marketValueUsd === "number" && Number.isFinite(d.marketValueUsd) ? d.marketValueUsd : 0;
              return sum + v;
            }, 0)
          : pickFirstNumber(r.obligation, [
              "refreshedStats.userTotalDeposit",
              "obligationStats.userTotalDeposit",
              "userTotalDeposit",
              "depositedValueUsd",
              "totalDepositUsd",
            ]);
      const borrowsUsd = extractKaminoBorrows(r.obligation).reduce((sum, b) => {
        const v = typeof b.marketValueUsd === "number" && Number.isFinite(b.marketValueUsd) ? b.marketValueUsd : 0;
        return sum + v;
      }, 0);
      total += depositsUsd - borrowsUsd;
      continue;
    }
    if (r.source === "kamino-earn") {
      const usd = pickFirstNumber(r.position, [
        "totalUsdValue",
        "totalValueUsd",
        "positionUsdValue",
        "usdValue",
        "valueUsd",
      ]);
      if (Number.isFinite(usd) && usd > 0) total += usd;
    }
  }
  return total;
}

export function mapKaminoToProtocolPositions(
  rows: KaminoUserPositionsRow[]
): ProtocolPosition[] {
  const out: ProtocolPosition[] = [];
  let earnIdx = 0;

  for (const r of rows) {
    // Don't render kamino-farm in UI (treat it as internal / rewards history noise).
    if (r.source === "kamino-farm") continue;

    if (r.source === "kamino-lend") {
      const deposits = extractKaminoDeposits(r.obligation);
      if (deposits.length > 0) {
        for (const d of deposits) {
          const v = typeof d.marketValueUsd === "number" && Number.isFinite(d.marketValueUsd) ? d.marketValueUsd : 0;
          if (!(v > 0)) continue;
          const symbol = (d.tokenSymbol || "").trim();
          const icon =
            (symbol ? `/token_ico/${symbol.toLowerCase()}.png` : "") ||
            getPreferredJupiterTokenIcon(symbol, d.tokenLogoUrl) ||
            "";
          out.push({
            id: `kamino-deposit-${d.depositReserve}-${out.length}`,
            label: symbol || "Supply",
            value: v,
            logoUrl: icon || undefined,
            logoUrlFallback: d.tokenLogoUrl || undefined,
            badge: PositionBadge.Supply,
          });
        }
      } else {
        const value = pickFirstNumber(r.obligation, [
          "refreshedStats.userTotalDeposit",
          "obligationStats.userTotalDeposit",
          "userTotalDeposit",
          "depositedValueUsd",
          "totalDepositUsd",
        ]);
        out.push({
          id: `kamino-lend-${r.marketPubkey}-${out.length}`,
          label: r.marketName || `Lend ${shortKey(r.marketPubkey)}`,
          value,
          badge: PositionBadge.Supply,
        });
      }

      const borrows = extractKaminoBorrows(r.obligation);
      for (const b of borrows) {
        const v = typeof b.marketValueUsd === "number" && Number.isFinite(b.marketValueUsd) ? b.marketValueUsd : 0;
        if (!(v > 0)) continue;
        const symbol = (b.tokenSymbol || "").trim();
        const icon =
          (symbol ? `/token_ico/${symbol.toLowerCase()}.png` : "") ||
          getPreferredJupiterTokenIcon(symbol, b.tokenLogoUrl) ||
          "";
        out.push({
          id: `kamino-borrow-${b.borrowReserve}-${out.length}`,
          label: symbol || "Borrow",
          value: v,
          logoUrl: icon || undefined,
          logoUrlFallback: b.tokenLogoUrl || undefined,
          badge: PositionBadge.Borrow,
        });
      }
      continue;
    }

    const value = pickFirstNumber(r.position, [
      "totalUsdValue",
      "totalValueUsd",
      "positionUsdValue",
      "usdValue",
      "valueUsd",
    ]);
    // Avoid rendering confusing "$0" rows in the sidebar.
    if (!Number.isFinite(value) || value <= 0) continue;

    const vaultName = String(
      getDeep(r.position, "name") ??
        getDeep(r.position, "vaultName") ??
        getDeep(r.position, "symbol") ??
        `Earn ${earnIdx + 1}`
    );
    const tokenSymbol = String(getDeep(r.position, "tokenSymbol") ?? "").trim();
    const tokenLogoUrl = String(getDeep(r.position, "tokenLogoUrl") ?? "").trim();
    const localBySymbol = tokenSymbol ? `/token_ico/${tokenSymbol.toLowerCase()}.png` : "";
    const icon = localBySymbol || getPreferredJupiterTokenIcon(tokenSymbol, tokenLogoUrl);
    const label = tokenSymbol || vaultName;
    const price = pickFirstNumber(r.position, ["underlyingTokenPriceUsd", "tokenPriceUsd", "priceUsd"], NaN);
    const underlyingAmount = toNumber(getDeep(r.position, "underlyingTokenAmount"), NaN);

    out.push({
      id: `kamino-earn-${earnIdx}`,
      label,
      value,
      logoUrl: icon,
      logoUrlFallback: tokenLogoUrl || undefined,
      badge: PositionBadge.Supply,
      price: Number.isFinite(price) && price > 0 ? price : undefined,
      subLabel:
        Number.isFinite(underlyingAmount) && underlyingAmount > 0
          ? formatNumber(underlyingAmount, 6)
          : undefined,
    });
    earnIdx += 1;
  }

  return out;
}

