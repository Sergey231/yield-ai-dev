import { NextResponse } from 'next/server';

/**
 * @swagger
 * /api/protocols/kofi/pools:
 *   get:
 *     tags:
 *       - protocols
 *     summary: Get KoFi Finance staking pool data
 *     description: Returns no deposit ideas while kAPT and stkAPT are deprecated from Echelon core pools
 *     responses:
 *       200:
 *         description: KoFi deposit ideas are disabled
 */
export async function GET() {
  return NextResponse.json({
    success: true,
    data: [],
    message: 'KoFi Finance deposit ideas are disabled while kAPT and stkAPT are deprecated from Echelon core pools',
  }, {
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}
