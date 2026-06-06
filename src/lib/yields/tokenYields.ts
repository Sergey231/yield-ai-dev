export const ONYC_SOLANA_MINT = "5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5";
export const ONRE_LIVE_APY_URL = "https://core.api.onre.finance/data/live-apy";

export const SHYUSD_MINT = "HnnGv3HrSqjRpgdFmx7vQGjntNEoex1SU4e9Lxcxuihz";
export const HYLO_STATS_URL = "https://api.hylo.so/stats";

export const PST_SOLANA_MINT = "59obFNBzyTBGowrkif5uK7ojS58vsuWz3ZCvg6tfZAGw";
export const LINCE_PROTOCOLS_APY_URL = "https://apy.lince.zone/api/protocols";

export const HYLOSOL_MINT = "hy1oXYgrBW6PVcJ4s6s2FKavRdwgWTXdfE69AxT7kPT";
export const JITOSOL_MINT = "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn";
export const MSOL_MINT = "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So";
export const JUPSOL_MINT = "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v";
export const BSOL_MINT = "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1";
export const BNSOL_MINT = "BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85";
export const BBSOL_MINT = "Bybit2vBJGhPF52GBdNaQfUJ6ZpThSgHBobjWZpLPb4B";

export type TokenYieldType = "APY";

export interface TokenYield {
  value: number;
  type: TokenYieldType;
  source: string;
  sourceUrl?: string;
  updatedAt?: string;
}

export type TokenYieldMap = Record<string, TokenYield>;

export type SolanaLstYieldConfig = {
  mint: string;
  symbol: string;
  name: string;
  source: "sanctum";
};

export const SOLANA_LST_YIELD_CONFIGS: SolanaLstYieldConfig[] = [
  {
    mint: JITOSOL_MINT,
    symbol: "JitoSOL",
    name: "Jito Staked SOL",
    source: "sanctum",
  },
  {
    mint: MSOL_MINT,
    symbol: "mSOL",
    name: "Marinade Staked SOL",
    source: "sanctum",
  },
  {
    mint: JUPSOL_MINT,
    symbol: "JupSOL",
    name: "Jupiter Staked SOL",
    source: "sanctum",
  },
  {
    mint: BSOL_MINT,
    symbol: "bSOL",
    name: "BlazeStake Staked SOL",
    source: "sanctum",
  },
  {
    mint: BNSOL_MINT,
    symbol: "BNSOL",
    name: "Binance Staked SOL",
    source: "sanctum",
  },
  {
    mint: BBSOL_MINT,
    symbol: "bbSOL",
    name: "Bybit Staked SOL",
    source: "sanctum",
  },
  {
    mint: HYLOSOL_MINT,
    symbol: "hyloSOL",
    name: "Hylo SOL",
    source: "sanctum",
  },
];

const SOLANA_LST_YIELD_CONFIG_BY_MINT = new Map(
  SOLANA_LST_YIELD_CONFIGS.map((config) => [normalizeSolanaMint(config.mint), config]),
);

const SOLANA_LST_YIELD_CONFIG_BY_SYMBOL = new Map(
  SOLANA_LST_YIELD_CONFIGS.map((config) => [config.symbol.toLowerCase(), config]),
);

type YieldTokenCandidate = {
  address?: string | null;
  symbol?: string | null;
  name?: string | null;
};

const ONYC_ALIASES = new Set(["one", "onyc", "ony"]);
const SHYUSD_ALIASES = new Set(["shyusd", "staked hyusd"]);
const PST_ALIASES = new Set(["pst", "huma pst", "huma-pst", "payfi strategy token"]);

export function normalizeSolanaMint(mint: string): string {
  return mint.trim();
}

function normalizeYieldLookupKey(value?: string | null): string {
  return value?.trim().toLowerCase() ?? "";
}

export function getSolanaLstYieldConfig(value?: string | null): SolanaLstYieldConfig | null {
  if (!value) return null;
  return (
    SOLANA_LST_YIELD_CONFIG_BY_MINT.get(normalizeSolanaMint(value)) ??
    SOLANA_LST_YIELD_CONFIG_BY_SYMBOL.get(value.trim().toLowerCase()) ??
    null
  );
}

export function getSolanaLstYieldConfigForToken(token: YieldTokenCandidate): SolanaLstYieldConfig | null {
  return getSolanaLstYieldConfig(token.address) ?? getSolanaLstYieldConfig(token.symbol) ?? getSolanaLstYieldConfig(token.name);
}

export function isOnycToken(token: YieldTokenCandidate): boolean {
  return (
    normalizeSolanaMint(token.address ?? "") === ONYC_SOLANA_MINT ||
    ONYC_ALIASES.has(normalizeYieldLookupKey(token.symbol)) ||
    ONYC_ALIASES.has(normalizeYieldLookupKey(token.name))
  );
}

export function isShyusdToken(token: YieldTokenCandidate): boolean {
  return (
    normalizeSolanaMint(token.address ?? "") === SHYUSD_MINT ||
    SHYUSD_ALIASES.has(normalizeYieldLookupKey(token.symbol)) ||
    SHYUSD_ALIASES.has(normalizeYieldLookupKey(token.name))
  );
}

export function isPstToken(token: YieldTokenCandidate): boolean {
  return (
    normalizeSolanaMint(token.address ?? "") === PST_SOLANA_MINT ||
    PST_ALIASES.has(normalizeYieldLookupKey(token.symbol)) ||
    PST_ALIASES.has(normalizeYieldLookupKey(token.name))
  );
}

export function isYieldSupportedToken(token: YieldTokenCandidate): boolean {
  return isOnycToken(token) || isShyusdToken(token) || isPstToken(token) || Boolean(getSolanaLstYieldConfigForToken(token));
}

export function getYieldRequestKeys(tokens: YieldTokenCandidate[]): string[] {
  return Array.from(
    new Set(
      tokens
        .map((token) => {
          if (isOnycToken(token)) return ONYC_SOLANA_MINT;
          if (isShyusdToken(token)) return SHYUSD_MINT;
          if (isPstToken(token)) return PST_SOLANA_MINT;
          return getSolanaLstYieldConfigForToken(token)?.mint ?? null;
        })
        .filter((mint): mint is string => Boolean(mint)),
    ),
  );
}

export function getTokenYield(
  yields: TokenYieldMap,
  token: YieldTokenCandidate
): TokenYield | undefined {
  const solanaLstYieldConfig = getSolanaLstYieldConfigForToken(token);

  if (solanaLstYieldConfig) {
    return yields[solanaLstYieldConfig.mint] ?? yields[solanaLstYieldConfig.symbol];
  }

  if (isOnycToken(token)) {
    return yields[ONYC_SOLANA_MINT] ?? yields.ONe ?? yields.ONyc ?? yields.ONYC;
  }

  if (isShyusdToken(token)) {
    return yields[SHYUSD_MINT] ?? yields.sHYUSD ?? yields.SHYUSD;
  }

  if (isPstToken(token)) {
    return yields[PST_SOLANA_MINT] ?? yields.PST ?? yields["huma-pst"];
  }

  if (token.address && yields[token.address]) return yields[token.address];
  if (token.symbol && yields[token.symbol]) return yields[token.symbol];
  if (token.name && yields[token.name]) return yields[token.name];
  return undefined;
}
