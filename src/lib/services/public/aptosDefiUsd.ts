import tokenList from '@/lib/data/tokenList.json';
import { PanoraPricesService } from '@/lib/services/panora/prices';

/**
 * Server-side USD valuation helpers for the public protocols API.
 *
 * These mirror the per-protocol logic the Sidebar uses on the client so that
 * `/api/public/v1/wallet/{address}/protocols` can report the same totals:
 *  - Echelon: Panora prices (fallback to bundled token list) over supply/borrow
 *    positions, plus claimable rewards — same as `useEchelonProtocolCardModel`.
 *  - Decibel: perp equity + vault share value + pre-deposit USDC, aggregated from
 *    the same endpoints the Decibel sidebar card reads.
 *  - Yield AI safes: per-safe wallet tokens + Echelon + Hyperion LP value.
 */

export type ProtocolUsdResult = {
  valueUSD: number;
  valueUSDComplete: boolean;
};

type PriceInfo = { usd: number; decimals: number };

/** Normalize an Aptos coin/FA address: strip `@`, ensure `0x`, drop leading zeros. */
function normalizeCoin(address: string): string {
  if (!address) return '';
  let a = address.startsWith('@') ? address.slice(1) : address;
  if (!a.startsWith('0x')) a = `0x${a}`;
  const body = a.slice(2).replace(/^0+/, '');
  return body ? `0x${body}` : '0x0';
}

type PanoraPriceRow = {
  usdPrice?: string | number;
  decimals?: number;
  faAddress?: string;
  tokenAddress?: string;
};

/** Fetch Panora prices for the given addresses and key them by normalized address. */
async function buildPriceMap(addresses: string[]): Promise<Map<string, PriceInfo>> {
  const map = new Map<string, PriceInfo>();
  const unique = Array.from(new Set(addresses.filter(Boolean)));
  if (unique.length === 0) return map;

  try {
    const resp = await PanoraPricesService.getInstance().getPrices(1, unique);
    const list: PanoraPriceRow[] = Array.isArray(resp)
      ? (resp as PanoraPriceRow[])
      : ((resp as { data?: PanoraPriceRow[] })?.data ?? []);
    for (const row of list) {
      const usd = parseFloat(String(row.usdPrice ?? '0')) || 0;
      const decimals = Number(row.decimals ?? 0) || 0;
      const info: PriceInfo = { usd, decimals };
      if (row.faAddress) map.set(normalizeCoin(row.faAddress), info);
      if (row.tokenAddress) map.set(normalizeCoin(row.tokenAddress), info);
    }
  } catch {
    // Prices unavailable → callers fall back to the bundled token list.
  }

  return map;
}

type TokenListRow = {
  symbol: string;
  name: string;
  decimals: number;
  faAddress?: string | null;
  tokenAddress?: string | null;
  usdPrice?: string | number | null;
};

const TOKEN_LIST_ROWS = (tokenList as { data: { data: TokenListRow[] } }).data.data;

/** Fallback price/decimals from the bundled token list (used when Panora misses). */
function tokenListLookup(coin: string): PriceInfo | null {
  const norm = normalizeCoin(coin);
  const row = TOKEN_LIST_ROWS.find(
    (t) =>
      normalizeCoin(t.faAddress || '') === norm ||
      normalizeCoin(t.tokenAddress || '') === norm
  );
  if (!row) return null;
  return {
    usd: row.usdPrice != null ? parseFloat(String(row.usdPrice)) || 0 : 0,
    decimals: typeof row.decimals === 'number' ? row.decimals : 8,
  };
}

function priceFor(
  coin: string,
  panora: Map<string, PriceInfo>
): PriceInfo | null {
  return panora.get(normalizeCoin(coin)) ?? tokenListLookup(coin);
}

type EchelonPosition = {
  coin?: string;
  supply?: number | string;
  borrow?: number | string;
  amount?: number | string;
  type?: string;
};

type EchelonRewardRow = {
  token?: string;
  tokenType?: string;
  amount?: number | string;
};

const ECHELON_MARKETS_URL = 'https://app.echelon.market/api/markets?network=aptos_mainnet';

/**
 * Authoritative price + decimals for every Echelon-listed asset (e.g. DLP, which
 * Panora does not price). Keyed by normalized asset/fa address.
 */
async function buildEchelonMarketPriceMap(): Promise<Map<string, PriceInfo>> {
  const map = new Map<string, PriceInfo>();
  try {
    const res = await fetch(ECHELON_MARKETS_URL, {
      headers: { Accept: 'application/json', 'User-Agent': 'YieldAI/1.0' },
      cache: 'no-store',
    });
    if (!res.ok) return map;
    const json = await res.json().catch(() => null);
    const assets: Array<{ address?: string; faAddress?: string; price?: number; decimals?: number }> =
      json?.data?.assets ?? [];
    for (const asset of assets) {
      const usd = toNumber(asset.price);
      const decimals = typeof asset.decimals === 'number' ? asset.decimals : 8;
      const info: PriceInfo = { usd, decimals };
      if (asset.address) map.set(normalizeCoin(asset.address), info);
      if (asset.faAddress) map.set(normalizeCoin(asset.faAddress), info);
    }
  } catch {
    // Fall back to Panora/token list.
  }
  return map;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Echelon net USD: sum(supply) - sum(borrow) priced via Panora/token list, plus
 * claimable rewards. Mirrors `useEchelonProtocolCardModel` used by the sidebar.
 */
export async function computeEchelonUsd(
  positions: EchelonPosition[],
  address: string,
  origin: string
): Promise<ProtocolUsdResult> {
  if (!Array.isArray(positions) || positions.length === 0) {
    return { valueUSD: 0, valueUSDComplete: true };
  }

  // Best-effort rewards fetch (claimable amounts already human-readable).
  let rewards: EchelonRewardRow[] = [];
  try {
    const res = await fetch(
      `${origin}/api/protocols/echelon/rewards?address=${encodeURIComponent(address)}`,
      { headers: { Accept: 'application/json' }, cache: 'no-store' }
    );
    if (res.ok) {
      const payload = await res.json().catch(() => null);
      const data = payload?.data;
      if (Array.isArray(data)) rewards = data as EchelonRewardRow[];
    }
  } catch {
    // Rewards optional.
  }

  const coins = positions.map((p) => p.coin || '').filter(Boolean);
  const rewardAddrs = rewards.map((r) => r.tokenType || '').filter(Boolean);
  // Echelon markets API is authoritative (price + decimals); Panora/token list
  // only cover the gaps it might miss.
  const [echelonMap, panoraMap] = await Promise.all([
    buildEchelonMarketPriceMap(),
    buildPriceMap([...coins, ...rewardAddrs]),
  ]);

  const lookup = (coin: string): PriceInfo | null =>
    echelonMap.get(normalizeCoin(coin)) ?? priceFor(coin, panoraMap);

  let net = 0;
  let complete = true;

  for (const position of positions) {
    const coin = position.coin || '';
    const isBorrow = position.type === 'borrow';
    const rawAmount = isBorrow
      ? toNumber(position.borrow ?? position.amount)
      : toNumber(position.supply ?? position.amount);
    if (rawAmount <= 0) continue;

    const info = lookup(coin);
    if (!info || info.usd <= 0) {
      complete = false;
      continue;
    }
    const value = (rawAmount / 10 ** info.decimals) * info.usd;
    net += isBorrow ? -value : value;
  }

  for (const reward of rewards) {
    const amount = toNumber(reward.amount);
    if (amount <= 0) continue;
    const info = reward.tokenType ? lookup(reward.tokenType) : null;
    if (!info || info.usd <= 0) continue;
    net += amount * info.usd;
  }

  return { valueUSD: net, valueUSDComplete: complete };
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

/**
 * Decibel total = perp equity + sum(vault share value) + pre-deposit USDC.
 * All inputs are already USD-denominated, so the result is always complete.
 */
export async function computeDecibelUsd(
  address: string,
  origin: string
): Promise<ProtocolUsdResult> {
  const enc = encodeURIComponent(address);
  const [overview, vaults, preDeposit] = await Promise.all([
    fetchJson(`${origin}/api/protocols/decibel/accountOverview?address=${enc}`),
    fetchJson(`${origin}/api/protocols/decibel/accountVaultPerformance?address=${enc}`),
    fetchJson(`${origin}/api/protocols/decibel/predepositorBalance?address=${enc}`),
  ]);

  const equity = toNumber(
    (overview as { data?: { perp_equity_balance?: unknown } } | null)?.data
      ?.perp_equity_balance
  );

  const vaultRows =
    (vaults as { data?: Array<{ current_value_of_shares?: unknown }> } | null)?.data ?? [];
  const vaultsSum = Array.isArray(vaultRows)
    ? vaultRows.reduce((sum, row) => {
        const v = toNumber(row?.current_value_of_shares);
        return v > 0 ? sum + v : sum;
      }, 0)
    : 0;

  const preDepositUsdc = toNumber(
    (preDeposit as { data?: { sumUsdc?: unknown } } | null)?.data?.sumUsdc
  );

  return {
    valueUSD: equity + vaultsSum + preDepositUsdc,
    valueUSDComplete: true,
  };
}

export type YieldAiSafesResult = {
  valueUSD: number;
  valueUSDComplete: boolean;
  safesCount: number;
  positions: Array<{ safeAddress: string; valueUSD: number }>;
};

const APT_COIN_TYPE = '0x1::aptos_coin::AptosCoin';

/**
 * Yield AI safes total: for each safe owned by the address, sum wallet token
 * value + Echelon net + Hyperion LP value (matches `SafePositionsCard`).
 */
export async function computeYieldAiSafesUsd(
  address: string,
  origin: string
): Promise<YieldAiSafesResult> {
  const safesPayload = await fetchJson(
    `${origin}/api/protocols/yield-ai/safes?owner=${encodeURIComponent(address)}`
  );
  const safeAddresses: string[] =
    (safesPayload as { data?: { safeAddresses?: unknown } } | null)?.data
      ?.safeAddresses && Array.isArray(
      (safesPayload as { data?: { safeAddresses?: unknown[] } }).data?.safeAddresses
    )
      ? ((safesPayload as { data: { safeAddresses: string[] } }).data.safeAddresses)
      : [];

  if (safeAddresses.length === 0) {
    return { valueUSD: 0, valueUSDComplete: true, safesCount: 0, positions: [] };
  }

  const positions: Array<{ safeAddress: string; valueUSD: number }> = [];
  let complete = true;

  const perSafe = await Promise.all(
    safeAddresses.map(async (safe) => {
      const enc = encodeURIComponent(safe);

      const [contents, echelonPayload, hyperionPayload] = await Promise.all([
        fetchJson(`${origin}/api/protocols/yield-ai/safe-contents?safeAddress=${enc}`),
        fetchJson(`${origin}/api/protocols/echelon/userPositions?address=${enc}`),
        fetchJson(`${origin}/api/protocols/yield-ai/hyperion-lp/positions?safe=${enc}`),
      ]);

      // Safe wallet tokens (FA balances from indexer + native APT).
      const fa =
        (contents as { data?: { tokens?: Array<{ asset_type?: string; amount?: string }> } } | null)
          ?.data?.tokens ?? [];
      const aptBalance = toNumber(
        (contents as { data?: { aptBalance?: unknown } } | null)?.data?.aptBalance
      );

      const tokenAddrs = fa.map((t) => t.asset_type || '').filter(Boolean);
      const priceMap = await buildPriceMap([...tokenAddrs, APT_COIN_TYPE]);

      let tokensValue = 0;
      for (const t of fa) {
        const info = priceFor(t.asset_type || '', priceMap);
        if (!info || info.usd <= 0) continue;
        tokensValue += (toNumber(t.amount) / 10 ** info.decimals) * info.usd;
      }
      const aptInfo = priceFor(APT_COIN_TYPE, priceMap);
      if (aptBalance > 0 && aptInfo && aptInfo.usd > 0) {
        tokensValue += (aptBalance / 10 ** (aptInfo.decimals || 8)) * aptInfo.usd;
      }

      // Echelon positions held by the safe.
      const echelonPositions =
        (echelonPayload as { data?: EchelonPosition[] } | null)?.data ?? [];
      const echelon = await computeEchelonUsd(echelonPositions, safe, origin);
      if (!echelon.valueUSDComplete) complete = false;

      // Hyperion LP positions held by the safe (open only).
      const hyperionPositions =
        (hyperionPayload as { data?: { positions?: Array<{ valueUsd?: unknown; closed?: unknown }> } } | null)
          ?.data?.positions ?? [];
      const hyperionValue = Array.isArray(hyperionPositions)
        ? hyperionPositions.reduce(
            (sum, p) => (p?.closed ? sum : sum + toNumber(p?.valueUsd)),
            0
          )
        : 0;

      const safeTotal = tokensValue + echelon.valueUSD + hyperionValue;
      return { safeAddress: safe, valueUSD: safeTotal };
    })
  );

  let total = 0;
  for (const entry of perSafe) {
    positions.push(entry);
    total += entry.valueUSD;
  }

  return { valueUSD: total, valueUSDComplete: complete, safesCount: safeAddresses.length, positions };
}
