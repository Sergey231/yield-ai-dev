import { NextRequest, NextResponse } from "next/server";
import {
  getSolanaLstYieldConfig,
  HYLO_STATS_URL,
  LINCE_PROTOCOLS_APY_URL,
  normalizeSolanaMint,
  ONRE_LIVE_APY_URL,
  ONYC_SOLANA_MINT,
  PST_SOLANA_MINT,
  SHYUSD_MINT,
  SOLANA_LST_YIELD_CONFIGS,
  type TokenYield,
  type TokenYieldMap,
  type SolanaLstYieldConfig,
} from "@/lib/yields/tokenYields";

const SANCTUM_EXTRA_API_BASE_URL = "https://extra-api.sanctum.so/v1/apy/indiv-epochs";
const SANCTUM_IRONFORGE_BASE_URL = "https://sanctum-api.ironforge.network/lsts";
const HYLO_EPOCHS_PER_YEAR = 186.5;

type SanctumEpochApy = {
  epoch?: number;
  end?: number;
  apy?: number;
};

type SanctumApyResult = {
  value: number;
  sourceUrl: string;
};

async function fetchJson(url: string) {
  const response = await fetch(url, {
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.json();
}

function isOnycRequestKey(value: string): boolean {
  return value.trim() === ONYC_SOLANA_MINT || ["one", "onyc", "ony"].includes(value.trim().toLowerCase());
}

function isShyusdRequestKey(value: string): boolean {
  return value.trim() === SHYUSD_MINT || ["shyusd", "staked hyusd"].includes(value.trim().toLowerCase());
}

function isPstRequestKey(value: string): boolean {
  return value.trim() === PST_SOLANA_MINT || ["pst", "huma pst", "huma-pst", "payfi strategy token"].includes(value.trim().toLowerCase());
}

function getRequestedYieldConfigs(request: NextRequest): {
  includeOnyc: boolean;
  includeShyusd: boolean;
  includePst: boolean;
  solanaLstConfigs: SolanaLstYieldConfig[];
} {
  const requestedKeys = request.nextUrl.searchParams
    .get("mints")
    ?.split(",")
    .map(normalizeSolanaMint)
    .filter(Boolean) ?? [];

  if (requestedKeys.length === 0) {
    return {
      includeOnyc: true,
      includeShyusd: true,
      includePst: true,
      solanaLstConfigs: SOLANA_LST_YIELD_CONFIGS,
    };
  }

  const solanaLstConfigs = requestedKeys
    .map((mint) => getSolanaLstYieldConfig(mint))
    .filter((config): config is SolanaLstYieldConfig => Boolean(config));

  return {
    includeOnyc: requestedKeys.some(isOnycRequestKey),
    includeShyusd: requestedKeys.some(isShyusdRequestKey),
    includePst: requestedKeys.some(isPstRequestKey),
    solanaLstConfigs: Array.from(new Map(solanaLstConfigs.map((config) => [config.mint, config])).values()),
  };
}

async function getOnreApy(updatedAt: string): Promise<TokenYieldMap> {
  const response = await fetch(ONRE_LIVE_APY_URL, {
    headers: { Accept: "text/plain" },
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    throw new Error(`OnRe APY request failed: ${response.status} ${response.statusText}`);
  }

  const raw = (await response.text()).trim();
  const apyDecimal = Number(raw);

  if (!Number.isFinite(apyDecimal) || apyDecimal < 0) {
    throw new Error(`Invalid OnRe APY value: ${raw}`);
  }

  const onycYield: TokenYield = {
    value: apyDecimal * 100,
    type: "APY",
    source: "OnRe API",
    sourceUrl: ONRE_LIVE_APY_URL,
    updatedAt,
  };

  return {
    [ONYC_SOLANA_MINT]: onycYield,
    ONe: onycYield,
    ONyc: onycYield,
    ONYC: onycYield,
  };
}

async function getSanctumLstApy(
  mint: string,
  { window = 30, minNonZero = 3 }: { window?: number; minNonZero?: number } = {},
): Promise<SanctumApyResult | null> {
  const apiKey = process.env.SANCTUM_API_KEY;

  if (apiKey) {
    const sourceUrl = `${SANCTUM_IRONFORGE_BASE_URL}/${mint}`;
    try {
      const data = await fetchJson(`${sourceUrl}?apiKey=${encodeURIComponent(apiKey)}`);
      const lst = Array.isArray(data?.data) ? data.data[0] : data?.data;
      const apy = lst?.avgApy;
      if (Number.isFinite(apy) && apy > 0.001) {
        return {
          value: apy * 100,
          sourceUrl,
        };
      }
    } catch (error) {
      console.warn("[api/yields] Sanctum Ironforge APY unavailable", { mint, error });
    }
  }

  const sourceUrl = `${SANCTUM_EXTRA_API_BASE_URL}?lst=${encodeURIComponent(mint)}&n=${window}`;
  const data = await fetchJson(sourceUrl);
  const epochs = data?.apys?.[mint] as SanctumEpochApy[] | undefined;
  if (!Array.isArray(epochs)) return null;

  const nonzero = epochs
    .map((epoch) => epoch.apy)
    .filter((apy): apy is number => typeof apy === "number" && Number.isFinite(apy) && apy > 0.001);

  if (nonzero.length < minNonZero) return null;

  return {
    value: (nonzero.reduce((sum, apy) => sum + apy, 0) / nonzero.length) * 100,
    sourceUrl,
  };
}

async function getShyusdApy(updatedAt: string): Promise<TokenYieldMap> {
  const data = await fetchJson(HYLO_STATS_URL);
  const cache = data?.exchangeStats?.yieldHarvestCache;
  const stablecoinYieldToPool = Number(cache?.stablecoinYieldToPool);
  const stabilityPoolCap = Number(cache?.stabilityPoolCap);

  if (
    !Number.isFinite(stablecoinYieldToPool) ||
    !Number.isFinite(stabilityPoolCap) ||
    stablecoinYieldToPool < 0 ||
    stabilityPoolCap <= 0
  ) {
    throw new Error("Invalid Hylo yieldHarvestCache values");
  }

  const epochReturn = stablecoinYieldToPool / stabilityPoolCap;
  const shyusdYield: TokenYield = {
    value: (Math.pow(1 + epochReturn, HYLO_EPOCHS_PER_YEAR) - 1) * 100,
    type: "APY",
    source: "Hylo API",
    sourceUrl: HYLO_STATS_URL,
    updatedAt,
  };

  return {
    [SHYUSD_MINT]: shyusdYield,
    sHYUSD: shyusdYield,
    SHYUSD: shyusdYield,
  };
}

async function getPstApy(updatedAt: string): Promise<TokenYieldMap> {
  const data = await fetchJson(LINCE_PROTOCOLS_APY_URL);
  const apy = Number(data?.["huma-pst"]?.apy);

  if (!Number.isFinite(apy) || apy < 0) {
    throw new Error(`Invalid Huma PST APY value: ${data?.["huma-pst"]?.apy}`);
  }

  const pstYield: TokenYield = {
    value: apy,
    type: "APY",
    source: "Lince API",
    sourceUrl: LINCE_PROTOCOLS_APY_URL,
    updatedAt,
  };

  return {
    [PST_SOLANA_MINT]: pstYield,
    PST: pstYield,
    "huma-pst": pstYield,
  };
}

async function getSolanaLstYields(configs: SolanaLstYieldConfig[], updatedAt: string): Promise<TokenYieldMap> {
  const yields: TokenYieldMap = {};

  await Promise.all(
    configs.map(async (config) => {
      if (config.source !== "sanctum") return;

      const apy = await getSanctumLstApy(config.mint);
      if (!apy) return;

      const tokenYield: TokenYield = {
        value: apy.value,
        type: "APY",
        source: "Sanctum LST APY",
        sourceUrl: apy.sourceUrl,
        updatedAt,
      };

      yields[config.mint] = tokenYield;
      yields[config.symbol] = tokenYield;
    }),
  );

  return yields;
}

export async function GET(request: NextRequest) {
  const updatedAt = new Date().toISOString();
  const { includeOnyc, includeShyusd, includePst, solanaLstConfigs } = getRequestedYieldConfigs(request);
  const yields: TokenYieldMap = {};

  const tasks: Array<Promise<void>> = [];

  if (includeOnyc) {
    tasks.push(
      getOnreApy(updatedAt)
        .then((onycYields) => {
          Object.assign(yields, onycYields);
        })
        .catch((error) => {
          console.error("[api/yields] Failed to fetch OnRe APY:", error);
        }),
    );
  }

  if (includeShyusd) {
    tasks.push(
      getShyusdApy(updatedAt)
        .then((shyusdYields) => {
          Object.assign(yields, shyusdYields);
        })
        .catch((error) => {
          console.error("[api/yields] Failed to fetch Hylo sHYUSD APY:", error);
        }),
    );
  }

  if (includePst) {
    tasks.push(
      getPstApy(updatedAt)
        .then((pstYields) => {
          Object.assign(yields, pstYields);
        })
        .catch((error) => {
          console.error("[api/yields] Failed to fetch Huma PST APY:", error);
        }),
    );
  }

  if (solanaLstConfigs.length > 0) {
    tasks.push(
      getSolanaLstYields(solanaLstConfigs, updatedAt)
        .then((solanaLstYields) => {
          Object.assign(yields, solanaLstYields);
        })
        .catch((error) => {
          console.error("[api/yields] Failed to fetch Solana LST APY:", error);
        }),
    );
  }

  await Promise.all(tasks);

  return NextResponse.json(yields, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=3600",
    },
  });
}
