import { NextRequest, NextResponse } from 'next/server';
import {
  aggregateProtocolValues,
  computeProtocolValueUsd,
} from '@/lib/services/public/protocolValueUsd';
import {
  computeDecibelUsd,
  computeEchelonUsd,
  computeYieldAiSafesUsd,
} from '@/lib/services/public/aptosDefiUsd';
import { computeTramplinUsd } from '@/lib/services/public/solanaDefiUsd';
import { getWalletBalance } from '@/lib/services/wallet-api';
import { SolanaPortfolioService } from '@/lib/services/solana/portfolio';

type ProtocolConfig = {
  key: string;
  endpoint: string;
};

type ProtocolResult = {
  protocol: string;
  endpoint: string;
  success: boolean;
  positionsCount: number;
  positions: unknown[];
  /** Best-effort net USD for this protocol (positions only; rewards may be excluded per protocol). */
  valueUSD: number;
  /** False when USD could not be derived reliably (e.g. Echelon raw amounts without prices). */
  valueUSDComplete: boolean;
  /** Passthrough from upstream route (e.g. Jupiter scaffold explanation, Kamino market counts). */
  meta?: unknown;
  status?: number;
  error?: string;
};

const APTOS_PROTOCOLS: ProtocolConfig[] = [
  { key: 'hyperion', endpoint: '/api/protocols/hyperion/userPositions' },
  { key: 'echelon', endpoint: '/api/protocols/echelon/userPositions' },
  { key: 'aries', endpoint: '/api/protocols/aries/userPositions' },
  { key: 'joule', endpoint: '/api/protocols/joule/userPositions' },
  { key: 'tapp', endpoint: '/api/protocols/tapp/userPositions' },
  { key: 'meso', endpoint: '/api/protocols/meso/userPositions' },
  { key: 'auro', endpoint: '/api/protocols/auro/userPositions' },
  { key: 'amnis', endpoint: '/api/protocols/amnis/userPositions' },
  { key: 'earnium', endpoint: '/api/protocols/earnium/userPositions' },
  { key: 'aave', endpoint: '/api/protocols/aave/positions' },
  { key: 'moar', endpoint: '/api/protocols/moar/userPositions' },
  { key: 'thala', endpoint: '/api/protocols/thala/userPositions' },
  { key: 'echo', endpoint: '/api/protocols/echo/userPositions' },
  { key: 'decibel', endpoint: '/api/protocols/decibel/userPositions' },
  { key: 'aptree', endpoint: '/api/protocols/aptree/userPositions' },
];

const SOLANA_PROTOCOLS: ProtocolConfig[] = [
  { key: 'jupiter', endpoint: '/api/protocols/jupiter/userPositions' },
  { key: 'kamino', endpoint: '/api/protocols/kamino/userPositions' },
  { key: 'meteora', endpoint: '/api/protocols/meteora/userPositions' },
  { key: 'raydium', endpoint: '/api/protocols/raydium/userPositions' },
  { key: 'orca', endpoint: '/api/protocols/orca/userPositions' },
  { key: 'tramplin', endpoint: '/api/protocols/tramplin/userPositions' },
  { key: 'exponent', endpoint: '/api/protocols/exponent/userPositions' },
];

function isRequireKey(): boolean {
  const flag = process.env.PUBLIC_API_REQUIRE_KEY;
  return flag === 'true' || flag === '1';
}

function getAllowedKeys(): Set<string> {
  const raw = process.env.PUBLIC_API_KEYS || '';
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function extractApiKey(req: NextRequest): string | null {
  const headerKey = req.headers.get('x-api-key');
  if (headerKey) return headerKey;
  const keyFromQuery = req.nextUrl.searchParams.get('api_key');
  return keyFromQuery || null;
}

function normalizeAptosAddress(input: string): { ok: boolean; clean?: string; provided: string } {
  const provided = input;
  const no0x = input.startsWith('0x') ? input.slice(2) : input;
  const isHex64 = /^[0-9a-fA-F]{64}$/.test(no0x);
  if (!isHex64) return { ok: false, provided };
  return { ok: true, clean: '0x' + no0x.toLowerCase(), provided };
}

function normalizeSolanaAddress(input: string): { ok: boolean; clean?: string; provided: string } {
  const provided = input;
  const clean = input.trim();
  const isBase58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean);
  if (!isBase58) return { ok: false, provided };
  return { ok: true, clean, provided };
}

function resolveAddressKind(input: string): { kind: 'aptos' | 'solana' | 'unknown'; clean?: string } {
  const aptos = normalizeAptosAddress(input);
  if (aptos.ok && aptos.clean) {
    return { kind: 'aptos', clean: aptos.clean };
  }
  const sol = normalizeSolanaAddress(input);
  if (sol.ok && sol.clean) {
    return { kind: 'solana', clean: sol.clean };
  }
  return { kind: 'unknown' };
}

function extractPositions(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];

  const obj = payload as Record<string, unknown>;

  if (Array.isArray(obj.data)) return obj.data;
  if (Array.isArray(obj.userPositions)) return obj.userPositions;
  if (Array.isArray(obj.positions)) return obj.positions;

  return [];
}

function extractUpstreamMeta(payload: unknown): unknown | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const obj = payload as Record<string, unknown>;
  return obj.meta;
}

function getPositionsCount(protocolKey: string, positions: unknown[]): number {
  if (protocolKey !== 'joule') {
    return positions.length;
  }

  // Joule may return a scaffold object even when user has no real positions.
  const first = positions[0];
  if (!first || typeof first !== 'object') return 0;

  const obj = first as Record<string, unknown>;
  const positionsMap = obj.positions_map as Record<string, unknown> | undefined;
  const nested = positionsMap?.data;

  if (Array.isArray(nested)) {
    return nested.length;
  }

  return 0;
}

async function fetchProtocolPositions(
  request: NextRequest,
  address: string,
  config: ProtocolConfig
): Promise<ProtocolResult> {
  const origin = request.nextUrl.origin;
  const url = `${origin}${config.endpoint}?address=${encodeURIComponent(address)}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    const status = response.status;
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        payload && typeof payload === 'object' && 'error' in payload
          ? String((payload as { error: unknown }).error)
          : `upstream_status_${status}`;
      return {
        protocol: config.key,
        endpoint: config.endpoint,
        success: false,
        positionsCount: 0,
        positions: [],
        valueUSD: 0,
        valueUSDComplete: true,
        status,
        error: message,
      };
    }

    const positions = extractPositions(payload);
    const positionsCount = getPositionsCount(config.key, positions);
    const normalizedPositions =
      config.key === 'joule' && positionsCount === 0 ? [] : positions;
    const { valueUSD, valueUSDComplete } = computeProtocolValueUsd(
      config.key,
      normalizedPositions,
      payload
    );

    return {
      protocol: config.key,
      endpoint: config.endpoint,
      success: true,
      positionsCount,
      positions: normalizedPositions,
      valueUSD,
      valueUSDComplete,
      meta: extractUpstreamMeta(payload),
      status,
    };
  } catch (error) {
    return {
      protocol: config.key,
      endpoint: config.endpoint,
      success: false,
      positionsCount: 0,
      positions: [],
      valueUSD: 0,
      valueUSDComplete: true,
      error: error instanceof Error ? error.message : 'fetch_failed',
    };
  }
}

/** Recompute the Echelon entry's USD from its raw positions (Panora-priced). */
async function enrichEchelonUsd(
  settled: ProtocolResult[],
  address: string,
  origin: string
): Promise<void> {
  const echelon = settled.find((p) => p.protocol === 'echelon');
  if (!echelon || echelon.positionsCount === 0) return;
  try {
    const result = await computeEchelonUsd(
      echelon.positions as Parameters<typeof computeEchelonUsd>[0],
      address,
      origin
    );
    echelon.valueUSD = result.valueUSD;
    echelon.valueUSDComplete = result.valueUSDComplete;
  } catch {
    // Leave the conservative default (0 / incomplete) on failure.
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    if (isRequireKey()) {
      const key = extractApiKey(request);
      const allowed = getAllowedKeys();
      if (!key || !allowed.has(key)) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      }
    }

    const { address } = await params;
    const resolved = resolveAddressKind(address);
    if (resolved.kind === 'unknown' || !resolved.clean) {
      return NextResponse.json({ error: 'invalid_address', address }, { status: 400 });
    }

    const protocolsToFetch = resolved.kind === 'aptos' ? APTOS_PROTOCOLS : SOLANA_PROTOCOLS;
    const cleanAddress = resolved.clean as string;
    const origin = request.nextUrl.origin;

    const settled = await Promise.all(
      protocolsToFetch.map((protocol) => fetchProtocolPositions(request, cleanAddress, protocol))
    );

    // Aptos-only USD parity with the Sidebar: recompute protocols whose upstream
    // routes return raw amounts without prices, then add the Yield AI safes total.
    let walletValueUSD = 0;
    if (resolved.kind === 'aptos') {
      const [, decibelUsd, yieldAiUsd] = await Promise.all([
        enrichEchelonUsd(settled, cleanAddress, origin),
        computeDecibelUsd(cleanAddress, origin).catch(() => null),
        computeYieldAiSafesUsd(cleanAddress, origin).catch(() => null),
      ]);

      const decibel = settled.find((p) => p.protocol === 'decibel');
      if (decibel && decibelUsd) {
        decibel.valueUSD = decibelUsd.valueUSD;
        decibel.valueUSDComplete = decibelUsd.valueUSDComplete;
      }

      if (yieldAiUsd) {
        settled.push({
          protocol: 'yield-ai',
          endpoint: '/api/protocols/yield-ai/safes',
          success: true,
          positionsCount: yieldAiUsd.safesCount,
          positions: yieldAiUsd.positions,
          valueUSD: yieldAiUsd.valueUSD,
          valueUSDComplete: yieldAiUsd.valueUSDComplete,
          status: 200,
        });
      }

      try {
        const balance = await getWalletBalance(cleanAddress);
        walletValueUSD = (balance.tokens || []).reduce((sum, t) => sum + (t.valueUSD || 0), 0);
      } catch {
        walletValueUSD = 0;
      }
    } else {
      // Tramplin's USD lives across two endpoints (stake + winnings), so recompute it.
      const tramplinUsd = await computeTramplinUsd(cleanAddress, origin).catch(() => null);
      const tramplin = settled.find((p) => p.protocol === 'tramplin');
      if (tramplin && tramplinUsd) {
        tramplin.valueUSD = tramplinUsd.valueUSD;
        tramplin.valueUSDComplete = tramplinUsd.valueUSDComplete;
        tramplin.positionsCount = tramplinUsd.hasPosition ? 1 : 0;
        tramplin.positions = tramplinUsd.positions;
      }

      try {
        const portfolio = await SolanaPortfolioService.getInstance().getPortfolio(cleanAddress);
        const total = portfolio.totalValueUsd;
        walletValueUSD =
          typeof total === 'number' && Number.isFinite(total)
            ? total
            : (portfolio.tokens || []).reduce(
                (sum, t) => sum + (t.value ? parseFloat(t.value) || 0 : 0),
                0
              );
      } catch {
        walletValueUSD = 0;
      }
    }

    const protocolsWithPositions = settled.filter((p) => p.positionsCount > 0).length;
    const failedProtocols = settled.filter((p) => !p.success).length;
    const { totalDeFiValueUSD, totalDeFiValueUSDComplete } = aggregateProtocolValues(settled);

    return NextResponse.json(
      {
        address: cleanAddress,
        chain: resolved.kind,
        timestamp: new Date().toISOString(),
        protocolsTotal: settled.length,
        protocolsWithPositions,
        failedProtocols,
        walletValueUSD,
        totalDeFiValueUSD,
        totalDeFiValueUSDComplete,
        totalAssetsUSD: walletValueUSD + totalDeFiValueUSD,
        totalAssetsUSDComplete: totalDeFiValueUSDComplete,
        protocols: settled,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[public wallet protocols] error:', error);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
