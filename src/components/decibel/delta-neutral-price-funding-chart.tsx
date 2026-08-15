'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  ColorType,
  LineStyle,
  LineType,
  type UTCTimestamp,
} from 'lightweight-charts';
import { cn } from '@/lib/utils';

/** Decibel candlestick item: t (open time ms), o, h, l, c. */
interface DecibelCandle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

interface RawFundingRecord {
  market_name?: string;
  funding_rate_bps?: number;
  is_funding_positive?: number | boolean;
  transaction_unix_ms?: number;
}

interface FundingPoint {
  time: UTCTimestamp;
  value: number;
}

const DEFAULT_RANGE_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
/**
 * Decibel funding accrues hourly (8760 cycles/year). Annualization factor for
 * raw bps per period → APR percent: bps × 8760 / 100 = bps × 87.6.
 * If the funding cadence ever changes, recompute or detect from data interval.
 */
const APR_PCT_PER_BPS_PER_HOUR = (24 * 365) / 100;

/**
 * Normalize Decibel market display names ("BTC-USDC" / "BTC/USD") to the
 * canonical funding-API key ("BTC/USD").
 */
function normalizeMarketKey(name: string): string {
  if (!name) return '';
  const s = name.trim().replace(/-/g, '/');
  if (s.toUpperCase().includes('USDC')) return s.replace(/USDC/gi, 'USD');
  return s;
}

export interface DeltaNeutralPriceFundingChartProps {
  /** Decibel market address (canonical Aptos addr) — used by the candlesticks API. */
  marketAddr: string;
  /** Market display name ("BTC-USD" / "BTC/USD") — used by the funding API. */
  marketName: string;
  /** Candle interval, default '15m'. */
  interval?: string;
  /** Range start (Unix ms). Default: now − 7d. */
  startTime?: number;
  /** Range end (Unix ms). Default: now. */
  endTime?: number;
  /** Horizontal lines on the candle pane (e.g. position entry price). */
  entryPrices?: number[];
  /** LP range bounds (price) — drawn as dashed lines so out-of-range risk is visible. */
  rangeLowerPrice?: number;
  rangeUpperPrice?: number;
  /** Pane height for the funding sub-pane. Default 100px. */
  fundingPaneHeight?: number;
  className?: string;
}

/**
 * Two-pane chart for delta-neutral context: candlesticks on top, funding APR
 * step-line below. Single chart instance — time axis and crosshair are shared
 * between panes automatically by lightweight-charts v5.
 */
export function DeltaNeutralPriceFundingChart({
  marketAddr,
  marketName,
  interval = '15m',
  startTime: startTimeProp,
  endTime: endTimeProp,
  entryPrices = [],
  rangeLowerPrice,
  rangeUpperPrice,
  fundingPaneHeight = 110,
  className,
}: DeltaNeutralPriceFundingChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable cache key for the entry-prices array so reference-unstable parents
  // don't force a chart rebuild on every render. (Same trick as DecibelChart.)
  const entryPricesKey = useMemo(
    () => JSON.stringify(entryPrices),
    [entryPrices]
  );

  useEffect(() => {
    if (!marketAddr || !marketName || !containerRef.current) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const endTime = endTimeProp ?? Date.now();
    const startTime = startTimeProp ?? endTime - DEFAULT_RANGE_MS;

    const candleParams = new URLSearchParams({
      market: marketAddr,
      interval,
      startTime: String(startTime),
      endTime: String(endTime),
    });
    const fundingKey = normalizeMarketKey(marketName);
    const fundingParams = new URLSearchParams({
      market_name: fundingKey,
      window: '7d',
      series_only: 'true',
    });

    Promise.all([
      fetch(`/api/protocols/decibel/candlesticks?${candleParams}`).then((r) => r.json()),
      fetch(`/api/protocols/decibel/funding?${fundingParams}`).then((r) => r.json()),
    ])
      .then(([candleJson, fundingJson]) => {
        if (cancelled) return;

        // ---- candles
        if (!candleJson?.success || !Array.isArray(candleJson.data)) {
          setError('Failed to load candle data');
          setLoading(false);
          return;
        }
        const rawCandles = candleJson.data as DecibelCandle[];
        const candles = rawCandles.map((c) => ({
          time: Math.floor(c.t / 1000) as UTCTimestamp,
          open: c.o,
          high: c.h,
          low: c.l,
          close: c.c,
        }));
        if (candles.length === 0) {
          setError('No candle data');
          setLoading(false);
          return;
        }

        // ---- funding (filter by market, dedupe by hour bucket, annualize)
        const fundingRaw: RawFundingRecord[] = Array.isArray(fundingJson?.data)
          ? (fundingJson.data as RawFundingRecord[])
          : Array.isArray(fundingJson)
            ? (fundingJson as RawFundingRecord[])
            : [];
        const HOUR_MS = 3600_000;
        const bucketed = new Map<number, number>();
        for (const row of fundingRaw) {
          if (!row.market_name) continue;
          if (normalizeMarketKey(row.market_name) !== fundingKey) continue;
          const bps =
            typeof row.funding_rate_bps === 'number' ? row.funding_rate_bps : 0;
          const positive =
            row.is_funding_positive === true || row.is_funding_positive === 1;
          const signedBps = positive ? bps : -bps;
          const ts =
            typeof row.transaction_unix_ms === 'number' ? row.transaction_unix_ms : 0;
          if (ts <= 0) continue;
          if (ts < startTime || ts > endTime) continue;
          const bucket = Math.floor(ts / HOUR_MS) * HOUR_MS;
          bucketed.set(bucket, signedBps);
        }
        const fundingPoints: FundingPoint[] = Array.from(bucketed.entries())
          .map(([ms, signedBps]) => ({
            time: Math.floor(ms / 1000) as UTCTimestamp,
            // Annualize: bps per hourly period × 87.6 = % APR.
            value: signedBps * APR_PCT_PER_BPS_PER_HOUR,
          }))
          .sort((a, b) => (a.time as number) - (b.time as number));

        // ---- chart
        const container = containerRef.current;
        if (!container) return;

        const chart = createChart(container, {
          autoSize: true,
          layout: {
            background: { type: ColorType.Solid, color: 'transparent' },
            textColor: '#888',
          },
          grid: {
            vertLines: { visible: false },
            horzLines: { color: 'rgba(255,255,255,0.05)' },
          },
          timeScale: { timeVisible: true, secondsVisible: false },
          rightPriceScale: { borderVisible: false },
          crosshair: { mode: 1 }, // Magnet
        });
        chartRef.current = chart;

        // Pane 0 (default): candle series.
        const candleSeries = chart.addSeries(CandlestickSeries, {
          upColor: '#22c55e',
          downColor: '#ef4444',
          borderVisible: true,
          borderUpColor: '#22c55e',
          borderDownColor: '#ef4444',
          wickUpColor: '#22c55e',
          wickDownColor: '#ef4444',
        });
        candleSeries.setData(candles);

        for (const entry of entryPrices) {
          if (!Number.isFinite(entry) || entry <= 0) continue;
          candleSeries.createPriceLine({
            price: entry,
            color: '#6b7280',
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            axisLabelVisible: true,
            title: 'Entry',
          });
        }

        // LP range bounds — amber dashed lines so the user sees how close price is to exiting range.
        for (const [bound, title] of [
          [rangeLowerPrice, 'Range ↓'],
          [rangeUpperPrice, 'Range ↑'],
        ] as const) {
          if (typeof bound !== 'number' || !Number.isFinite(bound) || bound <= 0) continue;
          candleSeries.createPriceLine({
            price: bound,
            color: '#f59e0b',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title,
          });
        }

        // Pane 1: funding APR step-line. Skip pane creation if we have no
        // funding data — the chart still works with just price.
        if (fundingPoints.length > 0) {
          const fundingPane = chart.addPane(true);
          fundingPane.setHeight(fundingPaneHeight);
          const fundingSeries = chart.addSeries(
            LineSeries,
            {
              color: '#3b82f6',
              lineWidth: 2,
              lineType: LineType.WithSteps,
              lastValueVisible: true,
              priceLineVisible: true,
              priceLineColor: '#3b82f6',
              priceLineStyle: LineStyle.Dotted,
              priceFormat: {
                type: 'custom',
                minMove: 0.01,
                formatter: (v: number) =>
                  `${v >= 0 ? '+' : ''}${v.toFixed(2)}% APR`,
              },
            },
            1 // pane index
          );
          fundingSeries.setData(fundingPoints);

          // Zero baseline.
          fundingSeries.createPriceLine({
            price: 0,
            color: '#94a3b8',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: false,
          });
        }

        chart.timeScale().fitContent();
        setLoading(false);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load chart');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
    // Deps are intentionally limited to inputs that change the data shape; the
    // entry-prices array is keyed via a stable string. See DecibelChart for the
    // same pattern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    marketAddr,
    marketName,
    interval,
    startTimeProp,
    endTimeProp,
    entryPricesKey,
    rangeLowerPrice,
    rangeUpperPrice,
    fundingPaneHeight,
  ]);

  return (
    <div className={cn('relative w-full', className ?? 'h-[400px]')}>
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/20 rounded-md z-10">
          <span className="text-sm text-muted-foreground">Loading chart…</span>
        </div>
      )}
      {error && !loading && (
        <div className="flex items-center justify-center h-full min-h-[200px] text-sm text-destructive">
          {error}
        </div>
      )}
      <div
        ref={containerRef}
        className={cn('w-full h-full min-h-[200px]', error ? 'hidden' : '')}
      />
    </div>
  );
}
