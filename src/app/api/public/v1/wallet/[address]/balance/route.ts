import { NextRequest, NextResponse } from 'next/server';
import { getWalletBalance } from '@/lib/services/wallet-api';
import { SolanaPortfolioService } from '@/lib/services/solana/portfolio';
import type { Token } from '@/lib/types/token';

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

type PublicToken = {
  tokenAddress: string;
  symbol: string | null;
  name: string | null;
  logoUrl: string | null;
  decimals: number;
  amount: string;
  priceUSD: number;
  valueUSD: number;
};

function isValidAmount(amount: string): boolean {
  if (!amount || amount === 'NaN' || amount === 'undefined' || amount === 'null') {
    return false;
  }
  return !Number.isNaN(parseFloat(amount));
}

function mapAptosTokens(
  tokens: Awaited<ReturnType<typeof getWalletBalance>>['tokens']
): PublicToken[] {
  return (tokens || [])
    .slice()
    .sort((a, b) => (b.valueUSD || 0) - (a.valueUSD || 0))
    .filter((t) => isValidAmount(t.balance))
    .map((t) => ({
      tokenAddress: t.address,
      symbol: t.symbol,
      name: t.name,
      logoUrl: t.logoUrl || null,
      decimals: t.decimals,
      amount: t.balance,
      priceUSD: t.priceUSD,
      valueUSD: t.valueUSD,
    }));
}

function mapSolanaTokens(tokens: Token[]): PublicToken[] {
  return tokens
    .map((token) => {
      const rawAmount = String(token.amount ?? '').trim();
      if (!rawAmount) return null;

      const amountNum = parseFloat(rawAmount) / Math.pow(10, token.decimals);
      if (!Number.isFinite(amountNum)) return null;

      const priceUSD = token.price ? parseFloat(token.price) : 0;
      const valueUSD = token.value ? parseFloat(token.value) : 0;

      return {
        tokenAddress: token.address,
        symbol: token.symbol || null,
        name: token.name || null,
        logoUrl: token.logoUrl || null,
        decimals: token.decimals,
        amount: amountNum.toString(),
        priceUSD: Number.isFinite(priceUSD) ? priceUSD : 0,
        valueUSD: Number.isFinite(valueUSD) ? valueUSD : 0,
      };
    })
    .filter((token): token is PublicToken => Boolean(token))
    .sort((a, b) => b.valueUSD - a.valueUSD);
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

    if (resolved.kind === 'aptos') {
      const result = await getWalletBalance(resolved.clean);
      return NextResponse.json(
        {
          address: resolved.clean,
          chain: 'aptos',
          timestamp: new Date().toISOString(),
          tokens: mapAptosTokens(result.tokens),
        },
        { status: 200 }
      );
    }

    const portfolio = await SolanaPortfolioService.getInstance().getPortfolio(resolved.clean);
    return NextResponse.json(
      {
        address: resolved.clean,
        chain: 'solana',
        timestamp: new Date().toISOString(),
        tokens: mapSolanaTokens(portfolio.tokens),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[public wallet balance] error:', error);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
