export type OrcaPoolStatsWindow = {
  volume?: string | null;
  fees?: string | null;
  rewards?: string | null;
  yieldOverTvl?: string | null;
};

export type OrcaPoolAprSource = {
  yieldOverTvl?: string;
  stats?: Record<string, OrcaPoolStatsWindow>;
};

function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** Orca `yieldOverTvl` is fees/TVL for the stats window; annualize to APR %. */
export function annualizeYieldOverTvl(yieldOverTvl: unknown, windowDays: number): number {
  const ratio = toNumber(yieldOverTvl, 0);
  if (!(ratio > 0) || !(windowDays > 0)) return 0;
  return ratio * (365 / windowDays) * 100;
}

/** Prefer 7d stats (annualized), then 24h — same logic as Ideas /orca/pools. */
export function resolveOrcaPoolAprPct(pool: OrcaPoolAprSource): number {
  const stats7d = pool.stats?.["7d"]?.yieldOverTvl;
  const stats24h = pool.stats?.["24h"]?.yieldOverTvl;
  if (stats7d != null) return annualizeYieldOverTvl(stats7d, 7);
  if (stats24h != null) return annualizeYieldOverTvl(stats24h, 1);
  return annualizeYieldOverTvl(pool.yieldOverTvl, 1);
}

/** 24h fee yield annualized (for tooltips). */
export function resolveOrcaPoolApr24hPct(pool: OrcaPoolAprSource): number {
  const stats24h = pool.stats?.["24h"]?.yieldOverTvl;
  if (stats24h != null) return annualizeYieldOverTvl(stats24h, 1);
  return annualizeYieldOverTvl(pool.yieldOverTvl, 1);
}
