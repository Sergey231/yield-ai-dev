import "server-only";

import Decimal from "decimal.js";
import { createSolanaRpc, address as toAddress } from "@solana/kit";
import { Farms, FarmState } from "@kamino-finance/farms-sdk";
import { JupiterTokenMetadataService } from "@/lib/services/solana/tokenMetadata";
import { getSafeSolanaRpcEndpoint } from "@/lib/solana/solanaRpcEndpoint";
import { isLikelySolanaAddress } from "@/lib/kamino/kvaultVaultAddress";
import type { KaminoClaimTarget, KaminoRewardRow, KaminoRewardsPayload } from "@/lib/kamino/kaminoClaimTypes";

const DEFAULT_PUBKEY = "11111111111111111111111111111111";

const STABLE_MINTS_USD_1 = new Set<string>([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH",
  "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA",
  "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD",
  "HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr",
]);

async function fetchJupiterUsdPriceMap(mints: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const uniq = Array.from(new Set(mints.map((m) => (m || "").trim()).filter(Boolean)));
  if (uniq.length === 0) return out;

  const CHUNK = 80;
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const chunk = uniq.slice(i, i + CHUNK);
    const url = `https://api.jup.ag/tokens/v2/search?query=${encodeURIComponent(chunk.join(","))}`;
    try {
      const res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
      if (!res.ok) continue;
      const rows = (await res.json().catch(() => [])) as Array<{ id?: string; usdPrice?: number }>;
      if (!Array.isArray(rows)) continue;
      for (const r of rows) {
        const id = typeof r?.id === "string" ? r.id.trim() : "";
        const p = typeof r?.usdPrice === "number" ? r.usdPrice : undefined;
        if (id && typeof p === "number" && Number.isFinite(p) && p > 0) out.set(id, p);
      }
    } catch {
      // ignore
    }
  }
  return out;
}

function addrToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && value !== null && "toString" in value) {
    return String((value as { toString: () => string }).toString()).trim();
  }
  return String(value).trim();
}

function rewardDecimalsFromFarmState(farmState: unknown, rewardIndex: number): number {
  const infos = Array.isArray((farmState as { rewardInfos?: unknown })?.rewardInfos)
    ? ((farmState as { rewardInfos: unknown[] }).rewardInfos as unknown[])
    : [];
  const info = infos[rewardIndex];
  const decimalsRaw = (info as { token?: { decimals?: { toNumber?: () => number } } })?.token?.decimals?.toNumber?.();
  return typeof decimalsRaw === "number" && Number.isFinite(decimalsRaw) ? decimalsRaw : 0;
}

function buildRewardRows(
  byMint: Map<string, Decimal>,
  metadataMap: Record<string, { symbol?: string; logoUrl?: string }>,
  priceMap: Map<string, number>
): KaminoRewardRow[] {
  const mints = Array.from(byMint.keys()).filter((m) => isLikelySolanaAddress(m));
  const rows: KaminoRewardRow[] = [];

  for (const mint of mints) {
    const amount = byMint.get(mint);
    if (!amount || !amount.isFinite() || amount.lte(0)) continue;
    const meta = metadataMap[mint] || {};
    const usdPrice = priceMap.get(mint);
    const usdValue =
      typeof usdPrice === "number" && Number.isFinite(usdPrice) ? amount.mul(usdPrice).toNumber() : undefined;
    rows.push({
      tokenMint: mint,
      tokenSymbol: meta.symbol,
      tokenLogoUrl: meta.logoUrl,
      amount: amount.toString(),
      usdValue,
    });
  }

  rows.sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));
  return rows;
}

export async function fetchKaminoRewardsPayload(walletAddress: string): Promise<KaminoRewardsPayload> {
  const address = walletAddress.trim();
  if (!address || !isLikelySolanaAddress(address)) {
    return { rewards: [], claimTargets: [], totalUsdValue: 0 };
  }

  const rpc = createSolanaRpc(getSafeSolanaRpcEndpoint() as Parameters<typeof createSolanaRpc>[0]);
  const farms = new Farms(rpc as any);
  const user = toAddress(address);
  const currentTime = new Decimal(Math.floor(Date.now() / 1000));

  const userFarmsMulti = await farms.getAllFarmsForUserMultiState(user, currentTime);
  const farmAddresses = Array.from(userFarmsMulti.keys());
  if (farmAddresses.length === 0) {
    return { rewards: [], claimTargets: [], totalUsdValue: 0 };
  }

  const farmStates = await FarmState.fetchMultiple(rpc as any, farmAddresses);
  const farmStateByAddress = new Map<string, unknown>();
  for (let i = 0; i < farmAddresses.length; i++) {
    farmStateByAddress.set(addrToString(farmAddresses[i]), farmStates[i]);
  }

  const byMint = new Map<string, Decimal>();
  const claimTargets: KaminoClaimTarget[] = [];

  for (const [farmAddress, userFarmList] of userFarmsMulti) {
    const farmKey = addrToString(farmAddress);
    const farmState = farmStateByAddress.get(farmKey);
    const isDelegated = Boolean((farmState as { isFarmDelegated?: unknown })?.isFarmDelegated);

    for (const userFarm of userFarmList) {
      const pending = Array.isArray(userFarm?.pendingRewards) ? userFarm.pendingRewards : [];
      const targetRewards: KaminoClaimTarget["rewards"] = [];
      const targetByMint = new Map<string, Decimal>();

      for (let idx = 0; idx < pending.length; idx++) {
        const reward = pending[idx] as {
          rewardTokenMint?: unknown;
          cumulatedPendingRewards?: unknown;
        };
        const mint = addrToString(reward?.rewardTokenMint);
        if (!mint || mint === DEFAULT_PUBKEY) continue;

        const decimals = rewardDecimalsFromFarmState(farmState, idx);
        const cum = new Decimal(String(reward?.cumulatedPendingRewards ?? "0"));
        if (!cum.isFinite() || cum.lte(0)) continue;

        const amountUi = cum.div(new Decimal(10).pow(decimals));
        if (!amountUi.isFinite() || amountUi.lte(0)) continue;

        byMint.set(mint, (byMint.get(mint) ?? new Decimal(0)).add(amountUi));
        targetByMint.set(mint, (targetByMint.get(mint) ?? new Decimal(0)).add(amountUi));
      }

      if (targetByMint.size === 0) continue;

      for (const [mint, amountUi] of targetByMint) {
        targetRewards.push({ tokenMint: mint, amount: amountUi.toString() });
      }

      const delegatee = addrToString(userFarm?.userState?.delegatee);
      const delegatees =
        isDelegated && delegatee && delegatee !== DEFAULT_PUBKEY
          ? Array.from(new Set([address, delegatee]))
          : undefined;

      claimTargets.push({
        id: `farm:${farmKey}:${delegatee || "self"}`,
        source: "farm",
        farmPubkey: farmKey,
        isDelegated,
        ...(delegatees ? { delegatees } : {}),
        rewards: targetRewards,
      });
    }
  }

  const mints = Array.from(byMint.keys()).filter((m) => isLikelySolanaAddress(m));
  const metadataService = JupiterTokenMetadataService.getInstance();
  const metadataMap = (await metadataService.getMetadataMap(mints).catch(() => ({}))) as Record<
    string,
    { symbol?: string; logoUrl?: string }
  >;
  const priceMap = await fetchJupiterUsdPriceMap(mints);
  for (const mint of mints) {
    if (!priceMap.has(mint) && STABLE_MINTS_USD_1.has(mint)) {
      priceMap.set(mint, 1);
    }
  }

  const rewards = buildRewardRows(byMint, metadataMap, priceMap);

  for (const target of claimTargets) {
    let usdValue = 0;
    for (const r of target.rewards) {
      const amount = new Decimal(r.amount);
      const meta = metadataMap[r.tokenMint] || {};
      const usdPrice = priceMap.get(r.tokenMint);
      r.tokenSymbol = meta.symbol;
      if (typeof usdPrice === "number" && Number.isFinite(usdPrice) && amount.isFinite()) {
        usdValue += amount.mul(usdPrice).toNumber();
        r.usdValue = amount.mul(usdPrice).toNumber();
      }
    }
    if (usdValue > 0) target.usdValue = usdValue;
  }

  claimTargets.sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));

  const totalUsdValue = rewards.reduce((sum, row) => sum + (row.usdValue ?? 0), 0);

  return { rewards, claimTargets, totalUsdValue };
}

export function mergeVaultClaimTargets(
  payload: KaminoRewardsPayload,
  vaultAddresses: string[]
): KaminoRewardsPayload {
  const uniqVaults = Array.from(new Set(vaultAddresses.map((v) => v.trim()).filter((v) => v.length > 0)));
  if (uniqVaults.length === 0) return payload;

  const existingVaults = new Set(
    payload.claimTargets
      .filter((t) => t.source === "vault" && t.vaultAddress)
      .map((t) => String(t.vaultAddress))
  );

  const claimTargets = [...payload.claimTargets];
  for (const vaultAddress of uniqVaults) {
    if (existingVaults.has(vaultAddress)) continue;
    claimTargets.push({
      id: `vault:${vaultAddress}`,
      source: "vault",
      vaultAddress,
      rewards: [],
    });
  }

  return { ...payload, claimTargets };
}
