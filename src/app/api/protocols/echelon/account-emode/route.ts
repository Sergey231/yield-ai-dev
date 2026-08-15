import { NextRequest, NextResponse } from 'next/server';

const ECHELON_PACKAGE = '0xc6bc659f1649553c1a3fa05d9727433dc03843baac29473c817d06d39e7621ba';
const APTOS_API_KEY = process.env.APTOS_API_KEY;

/**
 * GET /api/protocols/echelon/account-emode?address=0x..
 * Resolves the account's active Echelon efficiency mode id (0 = normal, 2 = stable, ...).
 * Needed to pick the correct liquidation threshold for Health Factor: eMode boosts LT
 * (e.g. USD1/USDt: base LT 82% vs eMode-2 LT 95%) and the account only benefits from it
 * when actually opted in.
 */
export async function GET(request: NextRequest) {
  try {
    const address = request.nextUrl.searchParams.get('address');
    if (!address) {
      return NextResponse.json({ success: false, error: 'address is required' }, { status: 400 });
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (APTOS_API_KEY) headers.Authorization = `Bearer ${APTOS_API_KEY}`;

    const res = await fetch('https://fullnode.mainnet.aptoslabs.com/v1/view', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        function: `${ECHELON_PACKAGE}::lending::account_emode`,
        type_arguments: [],
        arguments: [address],
      }),
    });

    if (!res.ok) {
      return NextResponse.json(
        { success: false, error: `view failed: HTTP ${res.status}` },
        { status: 502 }
      );
    }

    const raw = (await res.json()) as unknown[];
    const emodeId = Number(raw[0] ?? 0);

    return NextResponse.json({ success: true, data: { emodeId } });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
