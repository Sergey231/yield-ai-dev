import { NextRequest, NextResponse } from 'next/server';
import { toCanonicalAddress } from '@/lib/utils/addressNormalization';
import {
  YIELD_AI_VAULT_MODULE,
  USDC_FA_METADATA_MAINNET,
} from '@/lib/constants/yieldAiVault';
import { createErrorResponse, createSuccessResponse } from '@/lib/utils/http';

const APTOS_API_KEY = process.env.APTOS_API_KEY;
const INDEXER_URL = 'https://indexer.mainnet.aptoslabs.com/v1/graphql';
const USDC_DECIMALS = 6;

const VAULT_DEPOSIT_FN = `${YIELD_AI_VAULT_MODULE}::deposit`;
const VAULT_WITHDRAW_FN = `${YIELD_AI_VAULT_MODULE}::withdraw`;

type Direction = 'deposit' | 'withdraw';

interface DepositHistoryEntry {
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Human-readable USDC amount (e.g. "150.25") */
  amount: string;
  /** Raw amount in base units (6 decimals) */
  amountRaw: string;
  direction: Direction;
  txVersion: string;
}

interface PnlStats {
  /** PnL in USDC (currentValue − netDeposits). null when currentValue not provided. */
  pnl: string | null;
  /** Annualized return (Modified Dietz). null when currentValue not provided or history < 1 day. */
  apr: string | null;
  /** Days between first deposit and now. */
  holdingDays: number;
}

interface DepositHistorySummary {
  totalDeposited: string;
  totalWithdrawn: string;
  netDeposits: string;
  pnlStats: PnlStats;
  entries: DepositHistoryEntry[];
}

const QUERY = `
  query GetVaultUserFlows($safeAddress: String!, $usdcAsset: String!, $entryFunctions: [String!]!) {
    fungible_asset_activities(
      where: {
        owner_address: { _eq: $safeAddress }
        asset_type: { _eq: $usdcAsset }
        is_transaction_success: { _eq: true }
        entry_function_id_str: { _in: $entryFunctions }
      }
      order_by: { transaction_timestamp: desc }
      limit: 500
    ) {
      transaction_version
      transaction_timestamp
      type
      amount
      entry_function_id_str
    }
  }
`;

/**
 * GET /api/protocols/yield-ai/deposit-history?safeAddress=0x...&currentValue=495.12
 *
 * Returns chronological list of user deposit/withdraw operations for a Yield AI safe,
 * aggregated totals, and PnL / APR when currentValue is provided.
 *
 * currentValue — current total USD value of the safe (tokens + Moar positions + rewards).
 * The client already computes this; passing it here avoids duplicate fetches.
 */
export async function GET(request: NextRequest) {
  try {
    const safeAddress = request.nextUrl.searchParams.get('safeAddress');
    if (!safeAddress?.trim()) {
      return NextResponse.json(
        createErrorResponse(new Error('safeAddress parameter is required')),
        { status: 400 },
      );
    }
    const address = toCanonicalAddress(safeAddress.trim());

    const currentValueParam = request.nextUrl.searchParams.get('currentValue');
    const currentValue = currentValueParam != null ? parseFloat(currentValueParam) : null;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (APTOS_API_KEY) {
      headers['Authorization'] = `Bearer ${APTOS_API_KEY}`;
    }

    const res = await fetch(INDEXER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: QUERY,
        variables: {
          safeAddress: address,
          usdcAsset: USDC_FA_METADATA_MAINNET,
          entryFunctions: [VAULT_DEPOSIT_FN, VAULT_WITHDRAW_FN],
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Indexer request failed: ${res.status} ${text.slice(0, 200)}`);
    }

    const json = await res.json();
    const activities: {
      transaction_version: string;
      transaction_timestamp: string;
      type: string;
      amount: string | number;
      entry_function_id_str: string;
    }[] = json.data?.fungible_asset_activities ?? [];

    let totalDepositedRaw = 0n;
    let totalWithdrawnRaw = 0n;
    const entries: DepositHistoryEntry[] = [];

    for (const a of activities) {
      const raw = BigInt(a.amount);
      const fn = a.entry_function_id_str;

      let direction: Direction;
      if (fn.endsWith('::deposit')) {
        direction = 'deposit';
        totalDepositedRaw += raw;
      } else if (fn.endsWith('::withdraw')) {
        direction = 'withdraw';
        totalWithdrawnRaw += raw;
      } else {
        continue;
      }

      entries.push({
        timestamp: a.transaction_timestamp,
        amount: formatUsdc(raw),
        amountRaw: String(raw),
        direction,
        txVersion: String(a.transaction_version),
      });
    }

    const netDepositsRaw = totalDepositedRaw - totalWithdrawnRaw;
    const pnlStats = computePnlStats(entries, netDepositsRaw, currentValue);

    const result: DepositHistorySummary = {
      totalDeposited: formatUsdc(totalDepositedRaw),
      totalWithdrawn: formatUsdc(totalWithdrawnRaw),
      netDeposits: formatUsdc(netDepositsRaw),
      pnlStats,
      entries,
    };

    return NextResponse.json(createSuccessResponse(result));
  } catch (error) {
    console.error('[Yield AI] deposit-history error:', error);
    return NextResponse.json(
      createErrorResponse(error instanceof Error ? error : new Error('Unknown error')),
      { status: 500 },
    );
  }
}

/**
 * Modified Dietz method: time-weighted average capital → annualized return.
 *
 * For each interval between consecutive events we track the running USDC balance.
 * avgCapital = Σ(balance_i × days_i) / totalDays.
 * APR = (PnL / avgCapital) × (365 / totalDays).
 */
function computePnlStats(
  entries: DepositHistoryEntry[],
  netDepositsRaw: bigint,
  currentValue: number | null,
): PnlStats {
  if (entries.length === 0) {
    return { pnl: null, apr: null, holdingDays: 0 };
  }

  const chronological = [...entries].reverse();
  const firstTs = new Date(chronological[0].timestamp).getTime();
  const now = Date.now();
  const totalMs = now - firstTs;
  const totalDays = totalMs / (1000 * 60 * 60 * 24);
  const holdingDays = Math.max(0, Math.floor(totalDays));

  const netDeposits = bigintToNumber(netDepositsRaw);

  if (currentValue == null || !Number.isFinite(currentValue)) {
    return { pnl: null, apr: null, holdingDays };
  }

  const pnl = currentValue - netDeposits;

  if (totalDays < 1) {
    return { pnl: pnl.toFixed(6), apr: null, holdingDays };
  }

  let dollarDays = 0;
  let balance = 0;
  let prevTs = firstTs;

  for (const entry of chronological) {
    const ts = new Date(entry.timestamp).getTime();
    const daysDelta = (ts - prevTs) / (1000 * 60 * 60 * 24);
    dollarDays += balance * daysDelta;
    prevTs = ts;

    const amount = parseFloat(entry.amount);
    if (entry.direction === 'deposit') {
      balance += amount;
    } else {
      balance -= amount;
    }
  }

  const remainingDays = (now - prevTs) / (1000 * 60 * 60 * 24);
  dollarDays += balance * remainingDays;

  const avgCapital = dollarDays / totalDays;

  let apr: string | null = null;
  if (avgCapital > 0.01) {
    const annualizedReturn = (pnl / avgCapital) * (365 / totalDays) * 100;
    apr = annualizedReturn.toFixed(2);
  }

  return {
    pnl: pnl.toFixed(6),
    apr,
    holdingDays,
  };
}

function bigintToNumber(raw: bigint): number {
  const sign = raw < 0n ? -1 : 1;
  const abs = raw < 0n ? -raw : raw;
  const whole = Number(abs / 10n ** BigInt(USDC_DECIMALS));
  const frac = Number(abs % 10n ** BigInt(USDC_DECIMALS)) / 10 ** USDC_DECIMALS;
  return sign * (whole + frac);
}

function formatUsdc(baseUnits: bigint): string {
  const sign = baseUnits < 0n ? '-' : '';
  const abs = baseUnits < 0n ? -baseUnits : baseUnits;
  const whole = abs / 10n ** BigInt(USDC_DECIMALS);
  const frac = abs % 10n ** BigInt(USDC_DECIMALS);
  return `${sign}${whole}.${String(frac).padStart(USDC_DECIMALS, '0')}`;
}
