import { NextRequest, NextResponse } from 'next/server';

// GET /api/cctp/attestation?domain=9&signature=0xfecdef37...
// Server-side proxy to Circle Iris API — avoids CORS issues for browser clients.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const domain = searchParams.get('domain');
  const signature = searchParams.get('signature');

  if (!domain || !signature) {
    return NextResponse.json(
      { error: 'domain and signature query params are required' },
      { status: 400 }
    );
  }

  const domainNum = parseInt(domain, 10);
  if (isNaN(domainNum) || (domainNum !== 5 && domainNum !== 9)) {
    return NextResponse.json(
      { error: 'domain must be 5 (Solana) or 9 (Aptos)' },
      { status: 400 }
    );
  }

  const irisBase = (process.env.CIRCLE_CCTP_ATTESTATION_URL || 'https://iris-api.circle.com/v1')
    .replace(/\/messages\/?$/, '')
    .replace(/\/$/, '');

  const url = `${irisBase}/messages/${domainNum}/${signature.trim()}`;

  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      next: { revalidate: 0 },
    });

    const body = await res.text();

    return new NextResponse(body, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Failed to reach Circle API: ${err?.message ?? 'unknown error'}` },
      { status: 502 }
    );
  }
}
