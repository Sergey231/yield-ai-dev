import { NextRequest, NextResponse } from 'next/server';
import { toCanonicalAddress } from '@/lib/utils/addressNormalization';

const DECIBEL_API_KEY = process.env.DECIBEL_API_KEY;
const DECIBEL_API_BASE_URL =
  process.env.DECIBEL_API_BASE_URL || 'https://api.mainnet.aptoslabs.com/decibel';

type PointsLeaderboardEntry = {
  owner: string;
  rank?: number;
  realized_pnl?: number;
  referral_amps?: number;
  total_amps: number;
  vault_amps?: number;
  streak_amps?: number;
  bonus_amps?: number;
};

type PointsLeaderboardResponse = {
  items?: PointsLeaderboardEntry[];
  total_count?: number;
  message?: string;
};

/**
 * GET /api/protocols/decibel/amps
 * Returns AMPs (points) for a wallet using the same leaderboard data model as Decibel.
 * Query: owner (or address) - wallet address.
 * Doc: GET /api/v1/points_leaderboard?search_term={walletAddress}
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const owner = searchParams.get('owner') ?? searchParams.get('address');
    if (!owner) {
      return NextResponse.json(
        { success: false, error: 'Query parameter owner or address is required' },
        { status: 400 }
      );
    }
    if (!DECIBEL_API_KEY) {
      return NextResponse.json(
        { success: false, error: 'Decibel API key not configured' },
        { status: 503 }
      );
    }
    const decibelAddr = toCanonicalAddress(owner.trim());
    const baseUrl = DECIBEL_API_BASE_URL.replace(/\/$/, '');
    const params = new URLSearchParams({ search_term: decibelAddr });
    const url = `${baseUrl}/api/v1/points_leaderboard?${params.toString()}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${DECIBEL_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    const text = await response.text();
    let data: PointsLeaderboardResponse;
    try {
      data = text ? (JSON.parse(text) as PointsLeaderboardResponse) : {};
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid response from Decibel API' },
        { status: 502 }
      );
    }
    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error:
            typeof data === 'object' && data !== null && 'message' in data
              ? data.message
              : `Decibel API error: ${response.status}`,
        },
        { status: response.status >= 500 ? 502 : response.status }
      );
    }

    const entry = Array.isArray(data.items)
      ? data.items.find((item) => item.owner?.toLowerCase() === decibelAddr.toLowerCase())
      : undefined;

    if (!entry) {
      return NextResponse.json({
        success: true,
        data: {
          owner: decibelAddr,
          rank: null,
          total_amps: 0,
          realized_pnl: 0,
          referral_amps: 0,
          vault_amps: 0,
          streak_amps: 0,
          bonus_amps: 0,
          trading_amps: 0,
        },
      });
    }

    const totalAmps = typeof entry.total_amps === 'number' ? entry.total_amps : 0;
    const referralAmps = typeof entry.referral_amps === 'number' ? entry.referral_amps : 0;
    const vaultAmps = typeof entry.vault_amps === 'number' ? entry.vault_amps : 0;
    const streakAmps = typeof entry.streak_amps === 'number' ? entry.streak_amps : 0;
    const bonusAmps = typeof entry.bonus_amps === 'number' ? entry.bonus_amps : 0;
    const tradingAmps = Math.max(0, totalAmps - referralAmps - vaultAmps - streakAmps - bonusAmps);

    return NextResponse.json({
      success: true,
      data: {
        owner: entry.owner ?? decibelAddr,
        rank: typeof entry.rank === 'number' ? entry.rank : null,
        total_amps: totalAmps,
        realized_pnl: typeof entry.realized_pnl === 'number' ? entry.realized_pnl : 0,
        referral_amps: referralAmps,
        vault_amps: vaultAmps,
        streak_amps: streakAmps,
        bonus_amps: bonusAmps,
        trading_amps: tradingAmps,
      },
    });
  } catch (error) {
    console.error('[Decibel] amps error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
