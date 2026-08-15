import { NextResponse } from 'next/server';
import { sdk } from "@/lib/hyperion";

/**
 * @swagger
 * /api/protocols/hyperion/userPositions:
 *   get:
 *     tags:
 *       - protocols
 *     summary: Get user positions in Hyperion protocol
 *     parameters:
 *       - in: query
 *         name: address
 *         required: true
 *         schema:
 *           type: string
 *         description: User wallet address
 *     responses:
 *       200:
 *         description: User positions retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       isActive:
 *                         type: boolean
 *                       value:
 *                         type: string
 *                       farm:
 *                         type: object
 *                       fees:
 *                         type: object
 *                       position:
 *                         type: object
 *       400:
 *         description: Invalid address
 *       500:
 *         description: Internal server error
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get("address");

    console.log("🔍 Hyperion userPositions API called with address:", address);
    console.log("🔑 APTOS_API_KEY exists:", !!process.env.APTOS_API_KEY);

    if (!address) {
      return NextResponse.json(
        { error: "Address is required" },
        { status: 400 }
      );
    }

    const positions = await sdk.Position.fetchAllPositionsByAddress({
      address: address
    });
    
    console.log("✅ Hyperion SDK response:", {
      positionsCount: Array.isArray(positions) ? positions.length : 'not array',
      positionsType: typeof positions
    });
    
    return NextResponse.json({
      success: true,
      data: Array.isArray(positions) ? positions : []
    }, {
      headers: {
        'Cache-Control': 'public, max-age=2, s-maxage=2, stale-while-revalidate=4',
        'Cdn-Cache-Control': 'max-age=2',
        'Surrogate-Control': 'max-age=2'
      }
    });
  } catch (error) {
    console.error("❌ Hyperion user positions error:", error);
    console.error("❌ Error details:", {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch Hyperion positions"
      },
      { status: 502 }
    );
  }
}
