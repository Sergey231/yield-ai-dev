"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/utils/numberFormat";

interface BinChartProps {
  tokenXMint: string;
  tokenXSymbol: string;
  tokenYSymbol: string;
  lowerBinPrice?: number;
  upperBinPrice?: number;
  activeBinPrice?: number;
  lowerLabel?: string;
  upperLabel?: string;
  activeLabel?: string;
  /**
   * Additional existing position ranges to overlay as dashed line-pairs (the
   * primary lower/upper above stays the solid shaded band — typically the
   * prospective new range). Lets one chart show open positions + a new one.
   */
  extraRanges?: Array<{ lowerPrice: number; upperPrice: number; label?: string; inRange?: boolean }>;
  /** Mirrors `chain` param of /api/birdeye/history. */
  chain?: "solana" | "aptos";
  height?: number;
}

const PERIODS = [
  { label: "1H", type: "1m", days: 0.0417 },
  { label: "1D", type: "15m", days: 1 },
  { label: "7D", type: "1H", days: 7 },
  { label: "1M", type: "4H", days: 30 },
] as const;

type HistoryResponse = {
  success?: boolean;
  data?: { items?: Array<{ unixTime?: number; value?: number }> };
  message?: string;
  error?: string;
};

/**
 * DLMM price chart for a single position: candlestick-style area chart of the
 * pool's tokenX/USD history (via Birdeye, same source as the swap modal),
 * overlaid with horizontal Min Bin / Max Bin price lines that mark the range,
 * and a dashed Active Bin line for the current pool price.
 *
 * Visually mirrors Meteora's own "Price Chart" with Min Bin / Max Bin labels.
 */
export function BinChart({
  tokenXMint,
  tokenXSymbol,
  tokenYSymbol,
  lowerBinPrice,
  upperBinPrice,
  activeBinPrice,
  lowerLabel = "Min Bin",
  upperLabel = "Max Bin",
  activeLabel = "Current Price",
  extraRanges,
  chain = "solana",
  height = 320,
}: BinChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  const [activePeriod, setActivePeriod] = useState<(typeof PERIODS)[number]>(PERIODS[2]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [priceData, setPriceData] = useState<Array<{ time: UTCTimestamp; value: number }>>([]);
  type Band = { key: string; top: string; height: string; backgroundColor: string };
  const [bandStyles, setBandStyles] = useState<Band[]>([]);
  /**
   * Bumped to force a refetch (initial mount, period change, or manual retry).
   * On rate-limit failure we keep `priceData` empty + `error` set, render a
   * compact "Show chart" button instead of the chart container, and let the
   * user retry without leaving the panel.
   */
  const [requestNonce, setRequestNonce] = useState(0);

  // Shade every range as a translucent band. Existing positions
  // (`extraRanges`) use green/orange by in-range; the primary lower/upper band
  // (typically the prospective NEW range) uses a distinct indigo so "current"
  // vs "future" areas read at a glance.
  const syncBands = useCallback(() => {
    const series = seriesRef.current;
    if (!series) {
      setBandStyles((prev) => (prev.length ? [] : prev));
      return;
    }

    const next: Band[] = [];
    const push = (key: string, lower?: number, upper?: number, bg?: string) => {
      if (lower == null || upper == null || bg == null) return;
      const ly = series.priceToCoordinate(lower);
      const uy = series.priceToCoordinate(upper);
      if (ly == null || uy == null) return;
      const top = Math.max(0, Math.min(ly, uy));
      const bottom = Math.min(height, Math.max(ly, uy));
      next.push({ key, top: `${top}px`, height: `${Math.max(1, bottom - top)}px`, backgroundColor: bg });
    };

    // Existing positions first (drawn under the new band).
    if (Array.isArray(extraRanges)) {
      extraRanges.forEach((r, i) => {
        if (!r) return;
        push(
          `pos-${i}`,
          r.lowerPrice,
          r.upperPrice,
          r.inRange ? "rgba(34, 197, 94, 0.16)" : "rgba(249, 115, 22, 0.14)"
        );
      });
    }
    // Primary (prospective new) range — distinct indigo "future" tint.
    push("primary", lowerBinPrice, upperBinPrice, "rgba(99, 102, 241, 0.18)");

    setBandStyles((prev) => {
      if (
        prev.length === next.length &&
        prev.every((b, i) => {
          const n = next[i];
          return (
            n &&
            b.key === n.key &&
            b.top === n.top &&
            b.height === n.height &&
            b.backgroundColor === n.backgroundColor
          );
        })
      ) {
        return prev;
      }
      return next;
    });
  }, [lowerBinPrice, upperBinPrice, extraRanges, height]);

  // Fetch price history
  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const load = async (attempt = 0) => {
      setLoading(true);
      if (attempt === 0) setError(null);
      let scheduledRetry = false;
      try {
        const timeTo = Math.floor(Date.now() / 1000);
        const timeFrom = timeTo - Math.ceil(activePeriod.days * 24 * 60 * 60);
        const params = new URLSearchParams({
          chain,
          address: tokenXMint,
          type: activePeriod.type,
          time_from: String(timeFrom),
          time_to: String(timeTo),
        });
        const resp = await fetch(`/api/birdeye/history?${params.toString()}`, { cache: "no-store" });
        const json = (await resp.json().catch(() => null)) as HistoryResponse | null;
        if (cancelled) return;
        if (!json?.success || !Array.isArray(json.data?.items)) {
          const rawMsg = String(json?.message || json?.error || "");
          const isRateLimit = resp.status === 429 || /\b429\b|rate limit/i.test(rawMsg);
          if (isRateLimit && attempt < 1) {
            scheduledRetry = true;
            retryTimer = setTimeout(() => {
              if (!cancelled) void load(attempt + 1);
            }, 900 + Math.floor(Math.random() * 400));
            return;
          }
          setError(isRateLimit ? "Birdeye rate-limited" : rawMsg || "Failed to load price history");
          setPriceData([]);
          return;
        }
        const items = json.data!.items as Array<{ unixTime?: number; value?: number }>;
        const formatted = items
          .map((it) => ({
            time: Math.floor(Number(it.unixTime)) as UTCTimestamp,
            value: Number(it.value),
          }))
          .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
          .sort((a, b) => (a.time as number) - (b.time as number));
        setPriceData(formatted);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Network error");
      } finally {
        if (!cancelled && !scheduledRetry) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [tokenXMint, activePeriod, chain, requestNonce]);

  // Create / update chart
  useEffect(() => {
    if (!containerRef.current || loading || error || priceData.length === 0) return;
    const el = containerRef.current;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94a3b8",
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.08)" },
        horzLines: { color: "rgba(148, 163, 184, 0.08)" },
      },
      width: el.clientWidth,
      height,
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.2)",
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: { borderColor: "rgba(148, 163, 184, 0.2)" },
      crosshair: { mode: 1 },
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: "#3b82f6",
      topColor: "rgba(59, 130, 246, 0.35)",
      bottomColor: "rgba(59, 130, 246, 0.0)",
      lineWidth: 2,
    });
    series.setData(priceData as { time: Time; value: number }[]);
    chart.timeScale().fitContent();

    chartRef.current = chart;
    seriesRef.current = series;
    requestAnimationFrame(syncBands);

    const handleVisibleRangeChange = () => {
      requestAnimationFrame(syncBands);
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);

    const onResize = () => {
      if (!chartRef.current || !containerRef.current) return;
      chartRef.current.applyOptions({ width: containerRef.current.clientWidth, height });
      requestAnimationFrame(syncBands);
    };
    window.addEventListener("resize", onResize);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      window.removeEventListener("resize", onResize);
      priceLinesRef.current = [];
      setBandStyles([]);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [priceData, loading, error, height, syncBands]);

  // lightweight-charts does not expose a dedicated subscription for every price-scale
  // zoom/pan change, so keep the shaded range aligned with a lightweight sync loop.
  useEffect(() => {
    const hasBands =
      (lowerBinPrice != null && upperBinPrice != null) ||
      (Array.isArray(extraRanges) && extraRanges.length > 0);
    if (loading || error || priceData.length === 0 || !hasBands) {
      return;
    }

    const intervalId = window.setInterval(() => {
      requestAnimationFrame(syncBands);
    }, 120);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [priceData.length, loading, error, lowerBinPrice, upperBinPrice, extraRanges, syncBands]);

  // Sync price lines (min/max/active bin) onto the series whenever they change.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    // Remove existing
    for (const pl of priceLinesRef.current) {
      try {
        series.removePriceLine(pl);
      } catch {
        // ignore
      }
    }
    priceLinesRef.current = [];

    const inRange =
      activeBinPrice != null &&
      lowerBinPrice != null &&
      upperBinPrice != null &&
      activeBinPrice >= lowerBinPrice &&
      activeBinPrice <= upperBinPrice;
    const rangeColor = inRange ? "#22c55e" : "#f97316";

    if (lowerBinPrice != null) {
      priceLinesRef.current.push(
        series.createPriceLine({
          price: lowerBinPrice,
          color: rangeColor,
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `${lowerLabel} ${formatNumber(lowerBinPrice, 2)}`,
        })
      );
    }
    if (upperBinPrice != null) {
      priceLinesRef.current.push(
        series.createPriceLine({
          price: upperBinPrice,
          color: rangeColor,
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `${upperLabel} ${formatNumber(upperBinPrice, 2)}`,
        })
      );
    }
    // Existing positions: dashed line-pairs in a muted green/orange, labeled.
    if (Array.isArray(extraRanges)) {
      for (const r of extraRanges) {
        if (r == null) continue;
        const c = r.inRange ? "rgba(34,197,94,0.75)" : "rgba(249,115,22,0.75)";
        const tag = r.label ? `${r.label} ` : "";
        if (Number.isFinite(r.lowerPrice)) {
          priceLinesRef.current.push(
            series.createPriceLine({
              price: r.lowerPrice,
              color: c,
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: false,
              title: `${tag}min ${formatNumber(r.lowerPrice, 2)}`,
            })
          );
        }
        if (Number.isFinite(r.upperPrice)) {
          priceLinesRef.current.push(
            series.createPriceLine({
              price: r.upperPrice,
              color: c,
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              // Show the position tag (e.g. "#1") on the axis so it can be
              // matched to the position card; price stays in the title text.
              axisLabelVisible: Boolean(r.label),
              title: r.label ? `${r.label} ${formatNumber(r.upperPrice, 2)}` : `max ${formatNumber(r.upperPrice, 2)}`,
            })
          );
        }
      }
    }

    if (activeBinPrice != null) {
      priceLinesRef.current.push(
        series.createPriceLine({
          price: activeBinPrice,
          // Bright purple — pops against the blue area + green/orange range lines.
          color: "#a855f7",
          lineWidth: 2,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: `${activeLabel} ${formatNumber(activeBinPrice, 2)}`,
        })
      );
    }
    requestAnimationFrame(syncBands);
  }, [lowerBinPrice, upperBinPrice, activeBinPrice, lowerLabel, upperLabel, activeLabel, extraRanges, priceData, syncBands]);

  const stats = useMemo(() => {
    if (priceData.length === 0) return null;
    const last = priceData[priceData.length - 1].value;
    const first = priceData[0].value;
    if (!Number.isFinite(first) || first === 0) return { last, percent: 0 };
    const percent = ((last - first) / first) * 100;
    return { last, percent };
  }, [priceData]);

  // Compact failure state: collapse the whole chart row to a single button
  // (Birdeye 429s are common — better than reserving 320px of empty space).
  const hasData = priceData.length > 0;
  if (error && !hasData && !loading) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Price chart unavailable ({error}).
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setRequestNonce((n) => n + 1)}
        >
          <RefreshCw className="h-3 w-3 mr-1" />
          Retry
        </Button>
      </div>
    );
  }

  // First-load skeleton: don't reserve the whole 320px until we know there's
  // data to render. Loading is brief; if it stretches into a 429 we collapse.
  if (loading && !hasData) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading price chart…
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-full flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">Price Chart</span>
          <span className="text-muted-foreground">
            {tokenXSymbol}/{tokenYSymbol}
          </span>
          {stats && (
            <>
              <span className="font-medium tabular-nums">
                ${formatNumber(stats.last, 2)}
              </span>
              <span
                className={`text-xs tabular-nums ${stats.percent >= 0 ? "text-green-600" : "text-red-500"}`}
              >
                {stats.percent >= 0 ? "+" : ""}
                {formatNumber(stats.percent, 2)}%
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setActivePeriod(p)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                activePeriod.label === p.label
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setRequestNonce((n) => n + 1)}
            disabled={loading}
            aria-label="Refresh"
            title="Refresh"
            className="ml-1 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="relative w-full overflow-hidden rounded-md border border-border/40 bg-muted/10">
        {loading && hasData && (
          <div className="absolute right-2 top-2 z-10">
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          </div>
        )}
        {bandStyles.map((b) => (
          <div
            key={b.key}
            className="pointer-events-none absolute inset-x-0 z-[1]"
            style={{ top: b.top, height: b.height, backgroundColor: b.backgroundColor }}
            aria-hidden="true"
          />
        ))}
        <div ref={containerRef} className="w-full" style={{ height }} />
      </div>
    </div>
  );
}
