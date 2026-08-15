import { NextRequest, NextResponse } from 'next/server';
import { toCanonicalAddress } from '@/lib/utils/addressNormalization';
import { deriveVaultApr } from '@/lib/protocols/decibel/vaultApr';
import { PACKAGE_MAINNET, PACKAGE_TESTNET } from '@/lib/protocols/decibel/closePosition';

type AccountVaultPerfItem = { vault?: unknown } & Record<string, unknown>;
type VaultShareInfo = {
  shareAssetMetadata?: string;
  shareSymbol?: string;
};

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
const APTOS_FULLNODE_MAINNET_URL = 'https://api.mainnet.aptoslabs.com/v1';
const APTOS_FULLNODE_TESTNET_URL = 'https://api.testnet.aptoslabs.com/v1';

function isTestnetApiRoot(apiRoot: string): boolean {
  return apiRoot.toLowerCase().includes('testnet');
}

function getDecibelPackage(apiRoot: string): string {
  return isTestnetApiRoot(apiRoot) ? PACKAGE_TESTNET : PACKAGE_MAINNET;
}

function getAptosFullnodeRoot(apiRoot: string): string {
  return isTestnetApiRoot(apiRoot) ? APTOS_FULLNODE_TESTNET_URL : APTOS_FULLNODE_MAINNET_URL;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

async function fetchResource(apiRoot: string, address: string, resourceType: string): Promise<unknown | null> {
  const fullnode = getAptosFullnodeRoot(apiRoot);
  const account = encodeURIComponent(toCanonicalAddress(address));
  const resource = encodeURIComponent(resourceType);
  const res = await fetch(`${fullnode}/accounts/${account}/resource/${resource}`, { method: 'GET' });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchVaultShareInfo(
  apiRoot: string,
  vaultAddress: string,
  cache: Map<string, Promise<VaultShareInfo>>
): Promise<VaultShareInfo> {
  const canonicalVault = toCanonicalAddress(vaultAddress);
  const cached = cache.get(canonicalVault);
  if (cached) return cached;

  const pkg = getDecibelPackage(apiRoot);
  const promise = (async (): Promise<VaultShareInfo> => {
    const [vaultResource, metadataResource] = await Promise.all([
      fetchResource(apiRoot, canonicalVault, `${pkg}::vault::Vault`),
      fetchResource(apiRoot, canonicalVault, `${pkg}::vault::VaultMetadata`),
    ]);

    const vaultData = (vaultResource as { data?: Record<string, unknown> } | null)?.data;
    const shareDef = vaultData?.share_def as { share_asset_type?: { inner?: unknown } } | undefined;
    const shareAssetMetadata = stringValue(shareDef?.share_asset_type?.inner);

    const metadataData = (metadataResource as { data?: Record<string, unknown> } | null)?.data;
    const shareSymbol = stringValue(metadataData?.vault_share_symbol);

    return { shareAssetMetadata, shareSymbol };
  })();

  cache.set(canonicalVault, promise);
  return promise;
}

async function fetchPrimaryFungibleBalance(
  apiRoot: string,
  ownerAddress: string,
  assetMetadataAddress: string,
  cache: Map<string, Promise<string | undefined>>
): Promise<string | undefined> {
  const owner = toCanonicalAddress(ownerAddress);
  const asset = toCanonicalAddress(assetMetadataAddress);
  const key = `${owner}:${asset}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const promise = (async (): Promise<string | undefined> => {
    try {
      const res = await fetch(`${getAptosFullnodeRoot(apiRoot)}/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          function: '0x1::primary_fungible_store::balance',
          type_arguments: ['0x1::fungible_asset::Metadata'],
          arguments: [owner, asset],
        }),
      });

      if (!res.ok) return '0';
      const parsed = await res.json();
      const raw = Array.isArray(parsed) ? parsed[0] : undefined;
      if (typeof raw === 'string') return raw;
      if (typeof raw === 'number' && Number.isFinite(raw)) return Math.floor(raw).toString();
      return undefined;
    } catch {
      return undefined;
    }
  })();

  cache.set(key, promise);
  return promise;
}

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
      const rows: AccountVaultPerfItem[] = await fetchVaultPerf(decibelAddr);

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
        const subResults = await Promise.allSettled(
          subaccounts
            .map((sub) => sub.subaccount_address)
            .filter((subAddr): subAddr is string => Boolean(subAddr))
            .map((subAddr) => fetchVaultPerf(toCanonicalAddress(subAddr)))
        );
        for (const result of subResults) {
          if (result.status === 'fulfilled') rows.push(...result.value);
        }
      }

      return mergeAccountVaultPerformanceByVault(rows);
    };

    let effectiveBaseUrl = baseUrl;
    let list: AccountVaultPerfItem[] = await collectMergedVaultPerformance(effectiveBaseUrl);

    const usedTestnet = baseUrl.includes('testnet');
    if (list.length === 0 && usedTestnet && !process.env.DECIBEL_API_BASE_URL) {
      effectiveBaseUrl = DECIBEL_MAINNET_URL;
      list = await collectMergedVaultPerformance(effectiveBaseUrl);
    }

    const shareInfoCache = new Map<string, Promise<VaultShareInfo>>();
    const walletShareBalanceCache = new Map<string, Promise<string | undefined>>();
    // Enrich each item with derived APR and vault share metadata for non-collateral withdrawals.
    const enriched = await Promise.all(list.map(async (item) => {
      const apr = deriveVaultApr(item.vault as Parameters<typeof deriveVaultApr>[0]);
      const vault = item.vault as (Record<string, unknown> | undefined);
      const vaultAddress = stringValue(vault?.address);
      const shareInfo = vaultAddress
        ? await fetchVaultShareInfo(effectiveBaseUrl, vaultAddress, shareInfoCache)
        : {};
      const walletShareBalance = shareInfo.shareAssetMetadata
        ? await fetchPrimaryFungibleBalance(
            effectiveBaseUrl,
            decibelAddr,
            shareInfo.shareAssetMetadata,
            walletShareBalanceCache
          )
        : undefined;

      const nextVault =
        vault && (shareInfo.shareAssetMetadata || shareInfo.shareSymbol || walletShareBalance !== undefined)
          ? {
              ...vault,
              share_asset_metadata: shareInfo.shareAssetMetadata,
              share_symbol: shareInfo.shareSymbol,
              wallet_share_balance: walletShareBalance,
            }
          : vault;

      return {
        ...item,
        vault: nextVault,
        share_asset_metadata: shareInfo.shareAssetMetadata,
        share_symbol: shareInfo.shareSymbol,
        wallet_share_balance: walletShareBalance,
        apr: apr ?? undefined,
      };
    }));

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
