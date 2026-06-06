import { NextRequest, NextResponse } from 'next/server';
import { toCanonicalAddress } from '@/lib/utils/addressNormalization';

const DECIBEL_API_KEY = process.env.DECIBEL_API_KEY;
const DECIBEL_API_BASE_URL =
  process.env.DECIBEL_API_BASE_URL || 'https://api.mainnet.aptoslabs.com/decibel';
const UPSTREAM_USERS_LIMIT = 1000;

type ReferrerStatsResponse = {
  referrer_account?: string;
  total_referrals?: number;
  total_codes_created?: number;
  is_affiliate?: boolean;
  codes?: string[];
  volume_threshold_met?: boolean;
};

type ReferralCode = {
  referral_code: string;
  owner_account?: string;
  max_usage?: number | string;
  usage_count?: number;
  is_active?: boolean;
  is_affiliate?: boolean;
  source?: string;
  created_at_ms?: number;
};

type AffiliateCodesResponse = {
  owner_account?: string;
  codes?: ReferralCode[];
  volume_threshold_met?: boolean;
};

type AffiliateEarnings = {
  l1_amps?: number;
  l2_amps?: number;
  total_amps?: number;
  l1_count?: number;
  l2_count?: number;
};

type AffiliateUser = {
  account: string;
  level: 'L1' | 'L2';
  referred_by?: string | null;
  total_amps?: number;
  affiliate_amps_earned?: number;
  total_volume?: number;
  active?: boolean;
};

type AffiliateEarningsResponse = {
  affiliate_account?: string;
  is_affiliate?: boolean;
  earnings?: AffiliateEarnings;
  users?: {
    items?: AffiliateUser[];
    total_count?: number;
  };
};

type PointsLeaderboardEntry = {
  owner?: string;
  rank?: number;
  total_amps?: number;
  referral_amps?: number;
};

type PointsLeaderboardResponse = {
  items?: PointsLeaderboardEntry[];
};

class DecibelApiError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function sum(items: AffiliateUser[], select: (item: AffiliateUser) => unknown): number {
  return items.reduce((total, item) => total + finiteNumber(select(item)), 0);
}

function maskAddress(address: string): string {
  return address.length > 16 ? `${address.slice(0, 8)}...${address.slice(-6)}` : address;
}

function summarizeLevel(items: AffiliateUser[], level: AffiliateUser['level']) {
  const users = items.filter((item) => item.level === level);
  return {
    count: users.length,
    active_count: users.filter((item) => item.active === true).length,
    total_volume: sum(users, (item) => item.total_volume),
    affiliate_amps_earned: sum(users, (item) => item.affiliate_amps_earned),
  };
}

function sanitizeReferralCode(code: ReferralCode): Omit<ReferralCode, 'owner_account'> {
  return {
    referral_code: code.referral_code,
    max_usage: code.max_usage,
    usage_count: code.usage_count,
    is_active: code.is_active,
    is_affiliate: code.is_affiliate,
    source: code.source,
    created_at_ms: code.created_at_ms,
  };
}

function extractMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === 'object' &&
    'message' in payload &&
    typeof payload.message === 'string'
  ) {
    return payload.message;
  }
  return fallback;
}

async function fetchDecibel<T>(endpoint: string): Promise<T> {
  const baseUrl = DECIBEL_API_BASE_URL.replace(/\/$/, '');
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${DECIBEL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new DecibelApiError(endpoint, response.status, 'Invalid response from Decibel API');
  }

  if (!response.ok) {
    throw new DecibelApiError(
      endpoint,
      response.status,
      extractMessage(payload, `Decibel API error: ${response.status}`)
    );
  }

  return payload as T;
}

function settledValue<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === 'fulfilled' ? result.value : undefined;
}

function settledWarning(result: PromiseSettledResult<unknown>): string | null {
  if (result.status === 'fulfilled') return null;
  return result.reason instanceof Error ? result.reason.message : 'Unknown Decibel API error';
}

/**
 * GET /api/protocols/decibel/referralDashboard
 * Returns referral analytics for a wallet in one client request.
 * Query: address (required).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');

    if (!address) {
      return NextResponse.json(
        { success: false, error: 'Address parameter is required' },
        { status: 400 }
      );
    }

    if (!DECIBEL_API_KEY) {
      return NextResponse.json(
        { success: false, error: 'Decibel API key not configured' },
        { status: 503 }
      );
    }

    const decibelAddr = toCanonicalAddress(address.trim());
    const encodedAddress = encodeURIComponent(decibelAddr);
    const [statsResult, codesResult, earningsResult, leaderboardResult] = await Promise.allSettled([
      fetchDecibel<ReferrerStatsResponse>(`/api/v1/referrals/stats/${encodedAddress}`),
      fetchDecibel<AffiliateCodesResponse>(`/api/v1/affiliates/codes/${encodedAddress}`),
      fetchDecibel<AffiliateEarningsResponse>(
        `/api/v1/affiliates/earnings/${encodedAddress}?limit=${UPSTREAM_USERS_LIMIT}&offset=0`
      ),
      fetchDecibel<PointsLeaderboardResponse>(
        `/api/v1/points_leaderboard?search_term=${encodedAddress}`
      ),
    ]);

    const stats = settledValue(statsResult);
    const codes = settledValue(codesResult);
    const earnings = settledValue(earningsResult);
    const leaderboard = settledValue(leaderboardResult);
    const warnings = [statsResult, codesResult, earningsResult, leaderboardResult]
      .map(settledWarning)
      .filter((warning): warning is string => warning !== null);

    if (!stats && !codes && !earnings && !leaderboard) {
      return NextResponse.json(
        { success: false, error: warnings[0] ?? 'Failed to load Decibel referral dashboard' },
        { status: 502 }
      );
    }

    const users = (Array.isArray(earnings?.users?.items) ? earnings.users.items : [])
      .filter((item): item is AffiliateUser => {
        return (
          typeof item?.account === 'string' &&
          (item.level === 'L1' || item.level === 'L2')
        );
      })
      .sort((a, b) => finiteNumber(b.total_volume) - finiteNumber(a.total_volume));
    const totalUsers = finiteNumber(earnings?.users?.total_count);
    const l1 = summarizeLevel(users, 'L1');
    const l2 = summarizeLevel(users, 'L2');
    const totalReferrals =
      typeof stats?.total_referrals === 'number' ? stats.total_referrals : l1.count;
    const totalCodesCreated =
      typeof stats?.total_codes_created === 'number'
        ? stats.total_codes_created
        : Array.isArray(codes?.codes)
          ? codes.codes.length
          : 0;
    const leaderboardEntry = Array.isArray(leaderboard?.items)
      ? leaderboard.items.find((item) => item.owner?.toLowerCase() === decibelAddr.toLowerCase())
      : undefined;
    const l2ByReferrer = Array.from(
      users
        .filter((item) => item.level === 'L2' && typeof item.referred_by === 'string')
        .reduce((groups, item) => {
          const referrer = item.referred_by as string;
          const current = groups.get(referrer) ?? [];
          current.push(item);
          groups.set(referrer, current);
          return groups;
        }, new Map<string, AffiliateUser[]>())
    )
      .map(([referrer, referredUsers]) => ({
        referrer: maskAddress(referrer),
        count: referredUsers.length,
        active_count: referredUsers.filter((item) => item.active === true).length,
        total_volume: sum(referredUsers, (item) => item.total_volume),
        affiliate_amps_earned: sum(referredUsers, (item) => item.affiliate_amps_earned),
      }))
      .sort((a, b) => b.total_volume - a.total_volume);

    return NextResponse.json(
      {
        success: true,
        data: {
          account: decibelAddr,
          summary: {
            total_referrals: totalReferrals,
            total_codes_created: totalCodesCreated,
            stats_is_affiliate: stats?.is_affiliate === true,
            earnings_is_affiliate: earnings?.is_affiliate === true,
            has_affiliate_breakdown: Boolean(earnings),
            volume_threshold_met:
              stats?.volume_threshold_met === true || codes?.volume_threshold_met === true,
            l1,
            l2,
            total_volume: l1.total_volume + l2.total_volume,
            leaderboard: {
              rank: typeof leaderboardEntry?.rank === 'number' ? leaderboardEntry.rank : null,
              total_amps: finiteNumber(leaderboardEntry?.total_amps),
              referral_amps: finiteNumber(leaderboardEntry?.referral_amps),
            },
            affiliate_earnings: {
              l1_amps: finiteNumber(earnings?.earnings?.l1_amps),
              l2_amps: finiteNumber(earnings?.earnings?.l2_amps),
              total_amps: finiteNumber(earnings?.earnings?.total_amps),
            },
          },
          codes: Array.isArray(codes?.codes) ? codes.codes.map(sanitizeReferralCode) : [],
          users: {
            total_count: totalUsers,
            returned_count: users.length,
            truncated: totalUsers > users.length,
          },
          top_users: users.slice(0, 20).map((item) => ({
            account: maskAddress(item.account),
            level: item.level,
            referred_by:
              typeof item.referred_by === 'string' ? maskAddress(item.referred_by) : null,
            total_volume: finiteNumber(item.total_volume),
            affiliate_amps_earned: finiteNumber(item.affiliate_amps_earned),
            active: item.active === true,
          })),
          l2_by_referrer: l2ByReferrer,
          warnings,
        },
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=60',
        },
      }
    );
  } catch (error) {
    console.error('[Decibel] referralDashboard error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
