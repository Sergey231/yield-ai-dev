"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { CACHE_TIME, STALE_TIME } from "@/lib/query/config";

export type DecibelReferralLevelSummary = {
  count: number;
  active_count: number;
  total_volume: number;
  affiliate_amps_earned: number;
};

export type DecibelReferralCode = {
  referral_code: string;
  max_usage?: number | string;
  usage_count?: number;
  is_active?: boolean;
  is_affiliate?: boolean;
  source?: string;
  created_at_ms?: number;
};

export type DecibelReferralDashboardUser = {
  account: string;
  level: "L1" | "L2";
  referred_by?: string | null;
  total_volume: number;
  affiliate_amps_earned: number;
  active: boolean;
};

export type DecibelReferralDashboard = {
  account: string;
  summary: {
    total_referrals: number;
    total_codes_created: number;
    stats_is_affiliate: boolean;
    earnings_is_affiliate: boolean;
    has_affiliate_breakdown: boolean;
    volume_threshold_met: boolean;
    l1: DecibelReferralLevelSummary;
    l2: DecibelReferralLevelSummary;
    total_volume: number;
    leaderboard: {
      rank: number | null;
      total_amps: number;
      referral_amps: number;
    };
    affiliate_earnings: {
      l1_amps: number;
      l2_amps: number;
      total_amps: number;
    };
  };
  codes: DecibelReferralCode[];
  users: {
    total_count: number;
    returned_count: number;
    truncated: boolean;
  };
  top_users: DecibelReferralDashboardUser[];
  l2_by_referrer: Array<{
    referrer: string;
    count: number;
    active_count: number;
    total_volume: number;
    affiliate_amps_earned: number;
  }>;
  warnings: string[];
};

type DecibelReferralDashboardResponse = {
  success?: boolean;
  data?: DecibelReferralDashboard;
  error?: string;
};

async function fetchDecibelReferralDashboard(address: string): Promise<DecibelReferralDashboard> {
  const res = await fetch(
    `/api/protocols/decibel/referralDashboard?address=${encodeURIComponent(address)}`
  );
  const json = (await res.json()) as DecibelReferralDashboardResponse;
  if (!res.ok || !json.success || !json.data) {
    throw new Error(json.error || "Failed to load Decibel referral analytics");
  }
  return json.data;
}

export function useDecibelReferralDashboard(
  address: string | undefined,
  options?: { enabled?: boolean }
) {
  const enabled = (options?.enabled ?? true) && Boolean(address);

  return useQuery({
    queryKey: queryKeys.protocols.decibel.referralDashboard(address ?? ""),
    queryFn: () => fetchDecibelReferralDashboard(address!),
    enabled,
    staleTime: STALE_TIME.POSITIONS,
    gcTime: CACHE_TIME.LONG,
    refetchOnWindowFocus: false,
  });
}
