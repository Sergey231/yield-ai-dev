import { NextRequest, NextResponse } from 'next/server';
import { PanoraSwapService } from '@/lib/services/panora/swap';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      chainId,
      fromTokenAddress,
      toTokenAddress,
      fromTokenAmount,
      toTokenAmount,
      toWalletAddress,
      slippagePercentage,
    } = body;

    // Validate required fields
    if (!chainId || !fromTokenAddress || !toTokenAddress || !toWalletAddress) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (!fromTokenAmount && !toTokenAmount) {
      return NextResponse.json(
        { error: 'Either fromTokenAmount or toTokenAmount is required' },
        { status: 400 }
      );
    }

    if (fromTokenAmount && toTokenAmount) {
      return NextResponse.json(
        { error: 'Provide either fromTokenAmount or toTokenAmount, not both' },
        { status: 400 }
      );
    }

    const isExactOut = Boolean(toTokenAmount);
    const swapService = PanoraSwapService.getInstance();
    const response = await swapService.getSwapQuote({
      fromToken: fromTokenAddress,
      toToken: toTokenAddress,
      amount: fromTokenAmount,
      toTokenAmount,
      quoteMode: isExactOut ? 'exactOut' : 'exactIn',
      slippage: parseFloat(slippagePercentage || '0.5'),
      toWalletAddress,
    });

    if (!response.success) {
      return NextResponse.json(
        { error: response.error },
        { status: 400 }
      );
    }

    return NextResponse.json(response.data);
  } catch (error: any) {
    console.error('Error in swap-quote route:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
