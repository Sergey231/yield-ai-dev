"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { CACHE_TIME, STALE_TIME } from "@/lib/query/config";

export type DecibelAccountOverview = {
  perp_equity_balance?: number;
  usdc_cross_withdrawable_balance?: number;
  usdc_isolated_withdrawable_balance?: number;
  total_margin?: number;
  vault_equity?: number;
  unrealized_pnl?: number;
  realized_pnl?: number;
};

export type DecibelMarketRow = {
  market_addr?: string;
  market_name?: string;
  px_decimals?: number;
  sz_decimals?: number;
  tick_size?: number;
  lot_size?: number;
  min_size?: number;
};

export type DecibelMarketsResponse = {
  data: DecibelMarketRow[];
  network?: "testnet" | "mainnet";
};

export type DecibelPriceRow = {
  market?: string;
  mark_px?: number;
  mid_px?: number;
  funding_rate_bps?: number;
  is_funding_positive?: boolean;
};

export type DecibelVaultPerformanceItem = {
  vault?: {
    name?: string;
    address?: string;
    share_asset_metadata?: string;
    share_symbol?: string;
    wallet_share_balance?: number | string;
  };
  account_address?: string;
  current_num_shares?: number | string;
  current_value_of_shares?: number;
  total_deposited?: number;
  total_withdrawn?: number;
  unrealized_pnl?: number;
  share_price?: number;
  locked_amount?: number;
  share_asset_metadata?: string;
  share_symbol?: string;
  wallet_share_balance?: number | string;
  apr?: number;
};

export type DecibelAmpsData = {
  rank?: number | null;
  total_amps: number;
  trading_amps?: number;
  referral_amps?: number;
  vault_amps?: number;
  streak_amps?: number;
  bonus_amps?: number;
};

export type DecibelOpenOrder = {
  source_subaccount?: string;
  account?: string;
  user?: string;
  subaccount?: string;
  subaccount_address?: string;
  market?: string;
  market_address?: string;
  price: number;
  size?: number;
  orig_size?: number;
  remaining_size?: number;
  size_delta?: number;
  reduce_only?: boolean;
  is_reduce_only?: boolean;
  order_id?: string;
};

type ApiResponse<T> = {
  success?: boolean;
  data?: T;
  error?: string;
  network?: "testnet" | "mainnet";
};

function enabledAddress(address: string | undefined): boolean {
  return Boolean(address && address.length >= 10);
}

async function fetchJson<T>(url: string, fallback: T): Promise<T> {
  const res = await fetch(url);
  const json = (await res.json()) as ApiResponse<T>;
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `Request failed: ${res.status}`);
  }
  return json.data ?? fallback;
}

export async function fetchDecibelAccountOverview(address: string): Promise<DecibelAccountOverview> {
  return fetchJson<DecibelAccountOverview>(
    `/api/protocols/decibel/accountOverview?address=${encodeURIComponent(address)}`,
    {
      perp_equity_balance: 0,
      usdc_cross_withdrawable_balance: 0,
    },
  );
}

export async function fetchDecibelMarkets(): Promise<DecibelMarketsResponse> {
  const res = await fetch("/api/protocols/decibel/markets");
  const json = (await res.json()) as ApiResponse<DecibelMarketRow[]>;
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `Markets request failed: ${res.status}`);
  }
  return {
    data: Array.isArray(json.data) ? json.data : [],
    network: json.network,
  };
}

export async function fetchDecibelPrices(market?: string): Promise<DecibelPriceRow[]> {
  const query = market ? `?market=${encodeURIComponent(market)}` : "";
  return fetchJson<DecibelPriceRow[]>(`/api/protocols/decibel/prices${query}`, []);
}

export async function fetchDecibelPredepositorBalance(address: string): Promise<number> {
  const data = await fetchJson<{ sumUsdc?: number }>(
    `/api/protocols/decibel/predepositorBalance?address=${encodeURIComponent(address)}`,
    { sumUsdc: 0 },
  );
  return typeof data.sumUsdc === "number" ? data.sumUsdc : 0;
}

export async function fetchDecibelVaultPerformance(address: string): Promise<DecibelVaultPerformanceItem[]> {
  return fetchJson<DecibelVaultPerformanceItem[]>(
    `/api/protocols/decibel/accountVaultPerformance?address=${encodeURIComponent(address)}`,
    [],
  );
}

export async function fetchDecibelAmps(address: string): Promise<DecibelAmpsData | null> {
  const data = await fetchJson<DecibelAmpsData | null>(
    `/api/protocols/decibel/amps?owner=${encodeURIComponent(address)}`,
    null,
  );
  return data && typeof data.total_amps === "number" ? data : null;
}

function normalizeOpenOrdersResponse(data: unknown): DecibelOpenOrder[] {
  if (Array.isArray(data)) return data as DecibelOpenOrder[];
  if (data && typeof data === "object" && "items" in data && Array.isArray((data as { items: unknown }).items)) {
    return (data as { items: DecibelOpenOrder[] }).items;
  }
  return [];
}

export async function fetchDecibelOpenOrders(subaccounts: string[]): Promise<DecibelOpenOrder[]> {
  const uniqueSubaccounts = Array.from(new Set(subaccounts.filter(Boolean)));
  const settled = await Promise.allSettled(
    uniqueSubaccounts.map(async (addr) => {
      const res = await fetch(`/api/protocols/decibel/openOrders?address=${encodeURIComponent(addr)}`);
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!res.ok || json.success === false) return [];
      return normalizeOpenOrdersResponse(json.data).map((order) => ({
        ...order,
        source_subaccount: addr,
      }));
    }),
  );

  return settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

export function useDecibelAccountOverview(address: string | undefined, opts?: { enabled?: boolean }) {
  const enabled = (opts?.enabled ?? true) && enabledAddress(address);
  return useQuery({
    queryKey: queryKeys.protocols.decibel.accountOverview(address ?? ""),
    queryFn: () => fetchDecibelAccountOverview(address!),
    enabled,
    staleTime: STALE_TIME.POSITIONS,
    gcTime: CACHE_TIME.LONG,
  });
}

export function useDecibelMarkets(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.protocols.decibel.markets(),
    queryFn: fetchDecibelMarkets,
    enabled: opts?.enabled ?? true,
    staleTime: STALE_TIME.POOLS,
    gcTime: CACHE_TIME.LONG,
  });
}

export function useDecibelPrices(market?: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.protocols.decibel.prices(market),
    queryFn: () => fetchDecibelPrices(market),
    enabled: opts?.enabled ?? true,
    staleTime: STALE_TIME.PRICES,
    gcTime: CACHE_TIME.MEDIUM,
  });
}

export function useDecibelPredepositorBalance(address: string | undefined, opts?: { enabled?: boolean }) {
  const enabled = (opts?.enabled ?? true) && enabledAddress(address);
  return useQuery({
    queryKey: queryKeys.protocols.decibel.predepositorBalance(address ?? ""),
    queryFn: () => fetchDecibelPredepositorBalance(address!),
    enabled,
    staleTime: STALE_TIME.POSITIONS,
    gcTime: CACHE_TIME.LONG,
  });
}

export function useDecibelVaultPerformance(address: string | undefined, opts?: { enabled?: boolean }) {
  const enabled = (opts?.enabled ?? true) && enabledAddress(address);
  return useQuery({
    queryKey: queryKeys.protocols.decibel.vaultPerformance(address ?? ""),
    queryFn: () => fetchDecibelVaultPerformance(address!),
    enabled,
    staleTime: STALE_TIME.POSITIONS,
    gcTime: CACHE_TIME.LONG,
    refetchOnWindowFocus: false,
  });
}

export function useDecibelAmps(address: string | undefined, opts?: { enabled?: boolean }) {
  const enabled = (opts?.enabled ?? true) && enabledAddress(address);
  return useQuery({
    queryKey: queryKeys.protocols.decibel.amps(address ?? ""),
    queryFn: () => fetchDecibelAmps(address!),
    enabled,
    staleTime: STALE_TIME.POSITIONS,
    gcTime: CACHE_TIME.LONG,
    refetchOnWindowFocus: false,
  });
}

export function useDecibelOpenOrders(subaccounts: string[], opts?: { enabled?: boolean }) {
  const uniqueSubaccounts = Array.from(new Set(subaccounts.filter(Boolean)));
  const enabled = (opts?.enabled ?? true) && uniqueSubaccounts.length > 0;
  return useQuery({
    queryKey: queryKeys.protocols.decibel.openOrders(uniqueSubaccounts),
    queryFn: () => fetchDecibelOpenOrders(uniqueSubaccounts),
    enabled,
    staleTime: STALE_TIME.PRICES,
    gcTime: CACHE_TIME.MEDIUM,
  });
}
