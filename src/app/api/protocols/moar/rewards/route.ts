import { NextRequest, NextResponse } from "next/server";
import { PanoraPricesService } from "@/lib/services/panora/prices";
import {
  getMoarFarmingRewardRows,
  getMoarTokenInfo,
  parseClaimableOctas,
} from "@/lib/protocols/moar/moarFarmingRewardsCore";

const DEBUG_MOAR_LOGS = process.env.DEBUG_MOAR_LOGS === "true";

interface RewardItem {
  side: "supply" | "borrow";
  poolInner: string;
  rewardPoolInner: string;
  tokenAddress: string;
  amountRaw: string;
  amount: number;
  decimals: number;
  symbol: string;
  name: string;
  logoUrl?: string | null;
  price?: string | null;
  usdValue: number;
  farming_identifier: string;
  reward_id: string;
  claimable_amount: string;
  token_info?: {
    symbol: string;
    decimals: number;
    price: string;
    amount: number;
    logoUrl?: string | null;
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get("address");

    if (!address) {
      return NextResponse.json({
        success: false,
        error: "Address parameter is required",
      });
    }

    if (DEBUG_MOAR_LOGS) console.log("[Moar] fetching rewards for address:", address);

    const rows = await getMoarFarmingRewardRows(address);

    const rewards: RewardItem[] = [];
    const tokenAddresses = new Set<string>();

    for (const row of rows) {
      const tokenInfo = getMoarTokenInfo(row.tokenAddress);
      const octas = parseClaimableOctas(row.claimableAmount);
      if (octas == null) continue;

      const amount = Number(octas) / Math.pow(10, tokenInfo.decimals);
      tokenAddresses.add(row.tokenAddress);

      rewards.push({
        side: "supply",
        poolInner: row.farming_identifier,
        rewardPoolInner: row.reward_id,
        tokenAddress: row.tokenAddress,
        amountRaw: row.claimableAmount as string,
        amount,
        decimals: tokenInfo.decimals,
        symbol: tokenInfo.symbol,
        name: tokenInfo.name,
        logoUrl: tokenInfo.logoUrl,
        price: null,
        usdValue: 0,
        farming_identifier: row.farming_identifier,
        reward_id: row.reward_id,
        claimable_amount: row.claimableAmount as string,
        token_info: {
          symbol: tokenInfo.symbol,
          decimals: tokenInfo.decimals,
          price: "0",
          amount,
          logoUrl: tokenInfo.logoUrl,
        },
      });
    }

    if (DEBUG_MOAR_LOGS) console.log("[Moar] found", rewards.length, "rewards");

    if (rewards.length > 0 && tokenAddresses.size > 0) {
      try {
        const pricesService = PanoraPricesService.getInstance();
        const pricesResponse = await pricesService.getPrices(1, Array.from(tokenAddresses));
        const raw = pricesResponse?.data ?? pricesResponse;
        const pricesArray = Array.isArray(raw) ? raw : (raw?.data ?? []);

        if (DEBUG_MOAR_LOGS) console.log("[Moar] got prices for", pricesArray.length, "tokens");

        let totalUsd = 0;
        rewards.forEach((reward) => {
          const priceData = pricesArray.find(
            (p: any) =>
              p.tokenAddress === reward.tokenAddress || p.faAddress === reward.tokenAddress
          );

          if (priceData) {
            reward.price = priceData.usdPrice;
            reward.usdValue = reward.amount * parseFloat(priceData.usdPrice);
            totalUsd += reward.usdValue;

            if (reward.token_info) {
              reward.token_info.price = priceData.usdPrice;
            }

            if (DEBUG_MOAR_LOGS) {
              console.log(
                `[Moar] ${reward.symbol}: ${reward.amount.toFixed(6)} * $${priceData.usdPrice} = $${reward.usdValue.toFixed(2)}`
              );
            }
          } else {
            console.warn(`[Moar] no price found for ${reward.symbol} (${reward.tokenAddress})`);
          }
        });

        if (DEBUG_MOAR_LOGS) console.log("[Moar] total rewards value: $", totalUsd.toFixed(2));

        return NextResponse.json({
          success: true,
          data: rewards,
          totalUsd,
        });
      } catch (err) {
        console.warn("[Moar] error fetching prices:", err);
        return NextResponse.json({
          success: true,
          data: rewards,
          totalUsd: 0,
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: rewards,
      totalUsd: 0,
    });
  } catch (error) {
    console.error("Error fetching Moar Market rewards:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch rewards",
        data: [],
        totalUsd: 0,
      },
      { status: 500 }
    );
  }
}
