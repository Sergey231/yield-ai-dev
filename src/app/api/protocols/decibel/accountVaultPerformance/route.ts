import { NextRequest, NextResponse } from 'next/server';
import { toCanonicalAddress } from '@/lib/utils/addressNormalization';
import { deriveVaultApr } from '@/lib/protocols/decibel/vaultApr';

type AccountVaultPerfItem = { vault?: unknown } & Record<string, unknown>;

/** Group rows that refer to the same vault (Decibel uses `vault.address`; `id` is rare). */
function vaultPerformanceGroupKey(item: AccountVaultPerfItem, fallbackIndex: number): string {
  const vault = item.vault as { id?: string; address?: string } | undefined;
  if (vault?.id) return `id:${String(vault.id)}`;
  if (vault?.address) return `addr:${toCanonicalAddress(String(vault.address))}`;
  return `noid:${fallbackIndex}`;
}

/**
 * Decibel returns one row per (account_address, vault). The same owner may have deposits on
 * subaccounts; we can also get stale owner rows with zero `current_value_of_shares` while
 * the subaccount still holds shares. Merge rows that share the same vault and sum share value.
 */
function mergeAccountVaultPerformanceByVault(rows: AccountVaultPerfItem[]): AccountVaultPerfItem[] {
  const groups = new Map<string, AccountVaultPerfItem[]>();
  rows.forEach((row, idx) => {
    const key = vaultPerformanceGroupKey(row, idx);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  });
  const out: AccountVaultPerfItem[] = [];
  for (const items of groups.values()) {
    if (items.length === 1) {
      out.push(items[0]);
      continue;
    }
    const sumShares = items.reduce((s, r) => s + (Number(r.current_value_of_shares) || 0), 0);
    const base = items.reduce((best, r) =>
      (Number(r.current_value_of_shares) || 0) > (Number(best.current_value_of_shares) || 0)
        ? r
        : best
    );
    out.push({ ...base, current_value_of_shares: sumShares });
  }
  return out;
}

const DECIBEL_API_KEY = process.env.DECIBEL_API_KEY;
const DECIBEL_API_BASE_URL =
  process.env.DECIBEL_API_BASE_URL || 'https://api.testnet.aptoslabs.com/decibel';
const DECIBEL_MAINNET_URL = 'https://api.mainnet.aptoslabs.com/decibel';

/**
 * GET /api/protocols/decibel/accountVaultPerformance
 * Proxies to Decibel account_vault_performance API. Returns performance for all vaults where the account has deposits.
 * Query: address (required), offset (optional), limit (optional).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');
    const offset = searchParams.get('offset');
    const limit = searchParams.get('limit');

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
    const baseUrl = DECIBEL_API_BASE_URL.replace(/\/$/, '');
    const headers = {
      Authorization: `Bearer ${DECIBEL_API_KEY}`,
      'Content-Type': 'application/json',
    };

    const makeFetchVaultPerf =
      (apiRoot: string) =>
      async (account: string): Promise<AccountVaultPerfItem[]> => {
        const root = apiRoot.replace(/\/$/, '');
        const params = new URLSearchParams({ account });
        if (offset !== null && offset !== undefined) params.set('offset', offset);
        if (limit !== null && limit !== undefined) params.set('limit', limit);
        const url = `${root}/api/v1/account_vault_performance?${params.toString()}`;
        const res = await fetch(url, { method: 'GET', headers });
        const text = await res.text();
        if (!res.ok) return [];
        try {
          const parsed = text ? JSON.parse(text) : [];
          return Array.isArray(parsed) ? (parsed as AccountVaultPerfItem[]) : [];
        } catch {
          return [];
        }
      };

    const collectMergedVaultPerformance = async (apiRoot: string): Promise<AccountVaultPerfItem[]> => {
      const fetchVaultPerf = makeFetchVaultPerf(apiRoot);
      const root = apiRoot.replace(/\/$/, '');
      let rows: AccountVaultPerfItem[] = await fetchVaultPerf(decibelAddr);

      const subRes = await fetch(
        `${root}/api/v1/subaccounts?owner=${encodeURIComponent(decibelAddr)}`,
        { method: 'GET', headers }
      );
      if (subRes.ok) {
        const subText = await subRes.text();
        let subaccounts: { subaccount_address?: string }[] = [];
        try {
          const parsed = subText ? JSON.parse(subText) : [];
          subaccounts = Array.isArray(parsed) ? parsed : [];
        } catch {
          // ignore
        }
        for (const sub of subaccounts) {
          const subAddr = sub.subaccount_address;
          if (!subAddr) continue;
          const subList = await fetchVaultPerf(toCanonicalAddress(subAddr));
          rows.push(...subList);
        }
      }

      return mergeAccountVaultPerformanceByVault(rows);
    };

    let list: AccountVaultPerfItem[] = await collectMergedVaultPerformance(baseUrl);

    const usedTestnet = baseUrl.includes('testnet');
    if (list.length === 0 && usedTestnet && !process.env.DECIBEL_API_BASE_URL) {
      list = await collectMergedVaultPerformance(DECIBEL_MAINNET_URL);
    }

    // Enrich each item with derived APR when vault has return metrics but no apr field
    const enriched = list.map((item) => {
      const apr = deriveVaultApr(item.vault as Parameters<typeof deriveVaultApr>[0]);
      return { ...item, apr: apr ?? undefined };
    });

    return NextResponse.json({ success: true, data: enriched });
  } catch (error) {
    console.error('[Decibel] accountVaultPerformance error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
