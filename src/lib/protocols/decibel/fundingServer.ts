import { marketNameForFundingApi } from "@/lib/protocols/decibel/fundingApr";

const EXTERNAL_FUNDING_URL =
  process.env.DECIBEL_FUNDING_SERIES_URL?.trim() || "https://yieldai.aoserver.ru/funding.php";

export type ServerFundingApr = {
  avg_yearly_apr_pct: number;
  direction: string;
};

function upstreamQueryString(marketName: string, windowParam: "24h" | "7d", weightedAverage: boolean): string {
  const params = new URLSearchParams();
  params.set("market_name", marketName);
  if (weightedAverage) params.set("weighted_average", "true");
  params.set("period", windowParam === "7d" ? "week" : "day");
  return params.toString();
}

export async function fetchServerFundingApr(
  marketName: string,
  window: "24h" | "7d" = "24h"
): Promise<ServerFundingApr | null> {
  const key = marketNameForFundingApi(marketName);
  const url = `${EXTERNAL_FUNDING_URL}?${upstreamQueryString(key, window, true)}`;
  try {
    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json?.weighted_average?.success) return null;
    const avg = json.weighted_average.avg_yearly_apr_pct;
    const direction = typeof json.weighted_average.direction === "string" ? json.weighted_average.direction : "—";
    if (typeof avg !== "number" || !Number.isFinite(avg)) return null;
    return { avg_yearly_apr_pct: avg, direction };
  } catch {
    return null;
  }
}

export function shortEarnsFunding(apr: ServerFundingApr | null): boolean {
  if (!apr) return false;
  const dir = apr.direction.toLowerCase();
  return apr.avg_yearly_apr_pct > 0 && dir.includes("long") && dir.includes("short");
}
