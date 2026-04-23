"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SwapTokenChartProps {
  mint: string;
  symbol: string;
  chain?: "solana" | "aptos";
}

const PERIODS = [
  { label: "1D", type: "15m", days: 1 },
  { label: "7D", type: "1H", days: 7 },
  { label: "1M", type: "4H", days: 30 },
  { label: "3M", type: "1D", days: 90 },
] as const;

type HistoryKey = string;
type HistoryResponse = { success: boolean; data?: { items?: Array<{ unixTime?: number; value?: number }> }; message?: string; error?: string; details?: string };

const inflight = new Map<HistoryKey, { promise: Promise<HistoryResponse>; startedAt: number }>();
const INFLIGHT_TTL_MS = 5_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function SwapTokenChart({ mint, symbol, chain = "solana" }: SwapTokenChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [activePeriod, setActivePeriod] = useState<(typeof PERIODS)[number]>(PERIODS[2]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [priceData, setPriceData] = useState<{ time: UTCTimestamp; value: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const timeTo = Math.floor(Date.now() / 1000);
        const timeFrom = timeTo - activePeriod.days * 24 * 60 * 60;
        const params = new URLSearchParams({
          chain,
          address: mint,
          type: activePeriod.type,
          time_from: String(timeFrom),
          time_to: String(timeTo),
        });
        const key: HistoryKey = `${chain}|${mint}|${activePeriod.type}|${timeFrom}|${timeTo}`;

        // Coalesce duplicate requests (React Strict Mode double-invokes effects in dev).
        const now = Date.now();
        for (const [k, v] of inflight.entries()) {
          if (now - v.startedAt > INFLIGHT_TTL_MS) inflight.delete(k);
        }

        let entry = inflight.get(key);
        if (!entry) {
          const promise = (async (): Promise<HistoryResponse> => {
            const doFetch = async () => {
              const r = await fetch(`/api/birdeye/history?${params.toString()}`, { cache: "no-store" });
              const j = (await r.json().catch(() => null)) as any;
              return { status: r.status, json: j } as const;
            };

            const first = await doFetch();
            if (first.status !== 429) return first.json as HistoryResponse;

            // Simple backoff retry on 429.
            await sleep(900);
            const second = await doFetch();
            return second.json as HistoryResponse;
          })();

          entry = { promise, startedAt: now };
          inflight.set(key, entry);
        }

        const json = await entry.promise;
        if (cancelled) return;
        if (!json?.success || !Array.isArray(json?.data?.items)) {
          const base = String(json?.message || json?.error || "Failed to load chart");
          const details = typeof json?.details === "string" && json.details.trim() ? json.details.trim() : "";
          setError(details ? `${base}\n${details}` : base);
          setPriceData([]);
          return;
        }
        const items = json.data.items as Array<{ unixTime?: number; value?: number }>;
        const formatted = items
          .map((item) => ({
            time: Math.floor(Number(item.unixTime)) as UTCTimestamp,
            value: Number(item.value),
          }))
          .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
          .sort((a, b) => (a.time as number) - (b.time as number));
        setPriceData(formatted);
      } catch {
        if (!cancelled) setError("Network error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [mint, activePeriod, chain]);

  useEffect(() => {
    if (!containerRef.current || loading || error || priceData.length === 0) return;

    const el = containerRef.current;
    const height = 280;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94a3b8",
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.1)" },
        horzLines: { color: "rgba(148, 163, 184, 0.1)" },
      },
      width: el.clientWidth,
      height,
      timeScale: {
        borderColor: "rgba(148, 163, 184, 0.2)",
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: { borderColor: "rgba(148, 163, 184, 0.2)" },
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

    const onResize = () => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({
        width: containerRef.current.clientWidth,
        height: 280,
      });
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [priceData, loading, error]);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const el = wrapperRef.current;
    // Ensure the chart never overflows horizontally on mobile.
    el.style.maxWidth = "100%";
    el.style.overflowX = "hidden";
  }, []);

  const stats = useMemo(() => {
    if (priceData.length < 2) return null;
    const start = priceData[0].value;
    const end = priceData[priceData.length - 1].value;
    if (!Number.isFinite(start) || start === 0) return null;
    const diff = end - start;
    const percent = (diff / start) * 100;
    return { price: end, percent: percent.toFixed(2), isUp: percent >= 0 };
  }, [priceData]);

  return (
    <div ref={wrapperRef} className="flex w-full max-w-full flex-col gap-3 overflow-x-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">
            {symbol} <span className="text-muted-foreground font-normal">price</span>
          </div>
          {stats && (
            <div className="flex items-center gap-2 text-xs mt-0.5">
              <span>${stats.price.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
              <span className={stats.isUp ? "text-emerald-500" : "text-red-500"}>
                {stats.isUp ? <TrendingUp className="inline h-3 w-3" /> : <TrendingDown className="inline h-3 w-3" />}
                {stats.percent}%
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {PERIODS.map((p) => (
            <Button
              key={p.label}
              type="button"
              variant={activePeriod.label === p.label ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-[10px] font-semibold"
              onClick={() => setActivePeriod(p)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="relative w-full max-w-full rounded-md border border-border/60 bg-muted/20 overflow-hidden">
        {loading && (
          <div className="flex h-[280px] items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}
        {!loading && error && (
          <div className="flex h-[280px] items-center justify-center px-4 text-center text-sm text-red-500">
            {error}
          </div>
        )}
        {!loading && !error && priceData.length === 0 && (
          <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
            No price data for this period
          </div>
        )}
        <div ref={containerRef} className={loading || error || priceData.length === 0 ? "hidden" : "w-full max-w-full"} />
      </div>

      <p className="text-[10px] text-muted-foreground text-center">
        Chart data from Birdeye
      </p>
    </div>
  );
}
