import { isLikelySolanaAddress } from "@/lib/kamino/kvaultVaultAddress";
import { isMeaningfulKaminoRewardUsd } from "@/lib/kamino/kaminoRewardUsd";

/** Enables `?kaminoAddress=` / `?solanaAddress=` viewer override on test builds. */
export function isKaminoTestAddressOverrideEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_KAMINO_REWARDS_MOCK === "1" ||
    process.env.NEXT_PUBLIC_KAMINO_REWARDS_MOCK === "true"
  );
}

export function readKaminoViewerAddressFromSearchParams(
  searchParams: Pick<URLSearchParams, "get"> | null | undefined
): string {
  if (!isKaminoTestAddressOverrideEnabled() || !searchParams) return "";
  const raw = (
    searchParams.get("kaminoAddress") ||
    searchParams.get("address") ||
    searchParams.get("solanaAddress") ||
    ""
  ).trim();
  return raw && isLikelySolanaAddress(raw) ? raw : "";
}

export function resolveKaminoViewerAddress(
  searchParams: Pick<URLSearchParams, "get"> | null | undefined,
  fallbackAddress?: string | null
): string {
  const fromUrl = readKaminoViewerAddressFromSearchParams(searchParams);
  if (fromUrl) return fromUrl;
  return (fallbackAddress ?? "").trim();
}

export function canShowKaminoClaimUi(params: {
  rewardsCount: number;
  totalRewardsUsd: number;
  viewerAddress: string;
}): boolean {
  return (
    params.rewardsCount > 0 &&
    isMeaningfulKaminoRewardUsd(params.totalRewardsUsd) &&
    params.viewerAddress.length > 0 &&
    isLikelySolanaAddress(params.viewerAddress)
  );
}
