/**
 * Range-adjusted Hyperion LP APR (shared with HyperionLpStrategyView's inline math).
 *
 * A CLMM position concentrated in a tight band earns proportionally more fees per $ while the
 * price stays in range. The pool feed's reported APR already reflects the pool's *current*
 * concentration, so we cannot multiply by the full-range factor (double-counts). Instead we
 * anchor: a ±`referenceRangePct` band ≈ the reported APR, then scale the FEE side by the chosen
 * range's concentration relative to that reference (clamped), and keep farm flat (conservative).
 */

const RANGE_APR_RATIO_MIN = 0.3;
const RANGE_APR_RATIO_MAX = 4;

/**
 * Capital-efficiency multiplier `m` of a tick range vs a full-range position for the same
 * capital: m = 2√p / (2√p − √p_lower − p/√p_upper). Tighter range ⇒ higher m.
 */
export function concentrationOf(currentTick: number, lowerTick: number, upperTick: number): number | null {
  const sp = Math.pow(1.0001, currentTick / 2);
  const spa = Math.pow(1.0001, lowerTick / 2);
  const spb = Math.pow(1.0001, upperTick / 2);
  const denom = 2 * sp - spa - (sp * sp) / spb;
  if (!(denom > 0)) return null;
  const m = (2 * sp) / denom;
  return Number.isFinite(m) && m > 0 ? m : null;
}

/** Half-width in ticks for a ±pct band around the current tick (tick = 1.0001^i). */
function halfWidthTicks(pct: number): number {
  return Math.log(1 + Math.max(0.01, pct) / 100) / Math.log(1.0001);
}

export type RangeAprResult = { total: number; fee: number; farm: number; ratio: number };

/**
 * Range-adjusted APR (percent). `feeAprPct`/`farmAprPct` are the pool feed's reported APRs;
 * `referenceRangePct` is the per-pool concentration anchor (±10% volatile, ±0.05% stable).
 */
/**
 * Range-adjusted APR from EXPLICIT position ticks (open positions know their exact range). The
 * reference anchor is still a symmetric ±`referenceRangePct` band around the current tick.
 */
export function rangeAdjustedAprFromTicks(params: {
  feeAprPct: number;
  farmAprPct: number;
  currentTick: number;
  lowerTick: number;
  upperTick: number;
  referenceRangePct: number;
  tickSpacing?: number;
}): RangeAprResult | null {
  const { feeAprPct, farmAprPct, currentTick, lowerTick, upperTick, referenceRangePct, tickSpacing = 1 } = params;
  if (![currentTick, lowerTick, upperTick].every((t) => Number.isFinite(t)) || !(referenceRangePct > 0)) return null;
  const snap = (t: number) => Math.round(t / tickSpacing) * tickSpacing;
  const hr = halfWidthTicks(referenceRangePct);
  const conc = concentrationOf(currentTick, lowerTick, upperTick);
  const concRef = concentrationOf(currentTick, snap(currentTick - hr), snap(currentTick + hr));
  const ratio =
    conc && concRef && concRef > 0
      ? Math.min(RANGE_APR_RATIO_MAX, Math.max(RANGE_APR_RATIO_MIN, conc / concRef))
      : 1;
  const fee = Number.isFinite(feeAprPct) ? feeAprPct : 0;
  const farm = Number.isFinite(farmAprPct) ? farmAprPct : 0;
  return { total: fee * ratio + farm, fee, farm, ratio };
}

export function rangeAdjustedApr(params: {
  feeAprPct: number;
  farmAprPct: number;
  currentTick: number;
  rangePct: number;
  referenceRangePct: number;
  tickSpacing?: number;
}): RangeAprResult | null {
  const { currentTick, rangePct, tickSpacing = 1 } = params;
  if (!Number.isFinite(currentTick) || !(rangePct > 0)) return null;
  const snap = (t: number) => Math.round(t / tickSpacing) * tickSpacing;
  const ht = halfWidthTicks(rangePct);
  return rangeAdjustedAprFromTicks({
    ...params,
    lowerTick: snap(currentTick - ht),
    upperTick: snap(currentTick + ht),
  });
}
