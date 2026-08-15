'use client';

import { useEffect, useMemo, useState } from 'react';

interface DecibelOrderAggregate {
  placeOrderTxs: number;
  successfulPlaceOrderTxs: number;
  openLikeTxs: number;
  closeLikeTxs: number;
  actualFillCount: number;
  actualFillVolumeUsd: number;
  intentNotionalUsd: number;
  estimatedBuilderFeeUsd: number;
  uniqueWallets: number;
  uniqueSubaccounts: number;
  missedFillOrderTxs: number;
}

interface DecibelMarketSummary {
  market: string;
  placeOrderTxs: number;
  actualFillCount: number;
  actualFillVolumeUsd: number;
  intentNotionalUsd: number;
  estimatedBuilderFeeUsd: number;
}

interface DecibelDaySummary {
  date: string;
  placeOrderTxs: number;
  actualFillCount: number;
  actualFillVolumeUsd: number;
  intentNotionalUsd: number;
  estimatedBuilderFeeUsd: number;
}

interface DecibelReportSection {
  label: 'direct' | 'agentDeltaNeutral' | 'unclassifiedExecutorDecibelOrders';
  allOrders: DecibelOrderAggregate;
  builderFee: DecibelOrderAggregate;
  byMarket: DecibelMarketSummary[];
  byDay: DecibelDaySummary[];
  extra: Record<string, number>;
}

interface DecibelOrderPreview {
  source: 'direct' | 'executor';
  txVersion: string;
  timestamp: string;
  wallet: string | null;
  subaccount: string;
  market: string;
  marketName: string;
  side: 'buy' | 'sell';
  reduceOnly: boolean;
  fillCount: number;
  actualFillVolumeUsd: number;
  intentNotionalUsd: number;
  estimatedBuilderFeeUsd: number;
  builderFeeBps: number | null;
  agentRecordType: 'open' | 'close' | null;
  recordTxVersion: string | null;
}

interface DecibelResponse {
  generatedAt: string;
  range: {
    from: string;
    toExclusive: string;
  };
  addresses: {
    gasStation: string;
    executor: string;
    builder: string;
    configuredBuilderFeeBps: number | null;
    observedBuilderFeeBps: number[];
  };
  combinedBuilderFee: DecibelOrderAggregate;
  combinedBuilderFeeByMarket: DecibelMarketSummary[];
  combinedBuilderFeeByDay: DecibelDaySummary[];
  direct: DecibelReportSection;
  agentDeltaNeutral: DecibelReportSection;
  unclassifiedExecutorDecibelOrders: DecibelReportSection;
  recentBuilderOrders: DecibelOrderPreview[];
  diagnostics: Record<string, number>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export default function YieldAiDecibelPage() {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10);

  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<DecibelResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const url = new URL('/api/admin/yield-ai/decibel', window.location.origin);
      if (from) url.searchParams.set('from', from);
      if (to) url.searchParams.set('to', to);
      const res = await fetch(url.toString());
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json.data as DecibelResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxDayVolume = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, ...data.combinedBuilderFeeByDay.map((d) => d.actualFillVolumeUsd));
  }, [data]);

  const unclassified = data?.unclassifiedExecutorDecibelOrders.builderFee;

  return (
    <div className="container mx-auto py-6 px-4">
      <h1 className="text-3xl font-bold mb-2">Yield AI / Decibel</h1>
      <p className="text-sm text-gray-500 mb-1">
        Builder-fee Decibel volume from direct positions and Yield AI agent delta-neutral orders.
        Volume is based on Decibel fills, not only order intent.
      </p>
      {data && (
        <p className="text-xs text-gray-400 mb-6 font-mono break-all">
          Gas station: {data.addresses.gasStation} | Executor: {data.addresses.executor}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3 mb-6">
        <label className="flex flex-col text-xs">
          <span className="mb-1 text-gray-600">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="mb-1 text-gray-600">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          />
        </label>
        <button
          onClick={load}
          disabled={loading}
          className="bg-black text-white text-sm px-4 py-1.5 rounded disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Reload'}
        </button>
        {data && (
          <span className="text-xs text-gray-500 ml-2">
            generated {new Date(data.generatedAt).toLocaleString()}
          </span>
        )}
      </div>

      {error && (
        <div className="border border-red-300 bg-red-50 text-red-700 text-sm rounded p-3 mb-4">
          {error}
        </div>
      )}

      {!data && !error && (
        <div className="border rounded p-4 text-sm text-gray-500">
          {loading ? 'Building Decibel report...' : 'No report loaded yet.'}
        </div>
      )}

      {data && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
            <Stat
              label="Builder-fee volume"
              value={fmtUsd(data.combinedBuilderFee.actualFillVolumeUsd)}
              highlight
            />
            <Stat
              label="Est. builder fee"
              value={fmtUsd(data.combinedBuilderFee.estimatedBuilderFeeUsd)}
            />
            <Stat
              label="Order txs"
              value={data.combinedBuilderFee.placeOrderTxs.toLocaleString()}
            />
            <Stat
              label="Unique wallets"
              value={data.combinedBuilderFee.uniqueWallets.toLocaleString()}
            />
            <Stat
              label="Fills"
              value={data.combinedBuilderFee.actualFillCount.toLocaleString()}
            />
            <Stat
              label="Missing fills"
              value={data.combinedBuilderFee.missedFillOrderTxs.toLocaleString()}
            />
          </section>

          <section className="border rounded p-3 mb-6 text-xs text-gray-600">
            <div className="grid gap-1 md:grid-cols-3">
              <div>
                Range: {new Date(data.range.from).toLocaleDateString()} to{' '}
                {new Date(new Date(data.range.toExclusive).getTime() - DAY_MS).toLocaleDateString()}
              </div>
              <div>
                Builder bps: observed {formatBps(data.addresses.observedBuilderFeeBps)}
                {data.addresses.configuredBuilderFeeBps != null
                  ? `, env ${data.addresses.configuredBuilderFeeBps}`
                  : ''}
              </div>
              <div className="font-mono break-all">Builder: {shortAddress(data.addresses.builder)}</div>
            </div>
          </section>

          {unclassified && unclassified.placeOrderTxs > 0 && (
            <div className="border border-amber-300 bg-amber-50 text-amber-800 text-sm rounded p-3 mb-6">
              {unclassified.placeOrderTxs.toLocaleString()} executor builder-fee order txs are
              not tied to agent record_open/record_close entries. They are included in combined
              builder-fee volume and shown separately below as unclassified executor orders.
            </div>
          )}

          <section className="grid md:grid-cols-2 gap-4 mb-8">
            <SectionSummary title="Direct Decibel positions" section={data.direct} />
            <SectionSummary title="Agent delta-neutral Decibel legs" section={data.agentDeltaNeutral} />
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-2">Builder-fee volume by day</h2>
            <div className="border rounded p-3 overflow-x-auto">
              <div className="min-w-[620px]">
                {data.combinedBuilderFeeByDay.length === 0 && (
                  <div className="text-sm text-gray-500">No builder-fee fills in selected range.</div>
                )}
                {data.combinedBuilderFeeByDay.map((day) => (
                  <DayRow key={day.date} day={day} maxVolume={maxDayVolume} />
                ))}
              </div>
            </div>
          </section>

          <section className="grid lg:grid-cols-2 gap-6 mb-8">
            <MarketTable title="Combined markets" rows={data.combinedBuilderFeeByMarket} />
            <Diagnostics diagnostics={data.diagnostics} />
          </section>

          <section className="mb-8">
            <MarketTable title="Direct markets" rows={data.direct.byMarket} />
          </section>

          <section className="mb-8">
            <MarketTable title="Agent markets" rows={data.agentDeltaNeutral.byMarket} />
          </section>

          {unclassified && unclassified.placeOrderTxs > 0 && (
            <section className="mb-8">
              <SectionSummary
                title="Unclassified executor Decibel orders"
                section={data.unclassifiedExecutorDecibelOrders}
              />
            </section>
          )}

          <section>
            <h2 className="text-lg font-semibold mb-2">
              Recent builder-fee orders ({data.recentBuilderOrders.length})
            </h2>
            <div className="overflow-x-auto border rounded max-h-[640px] overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-600 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">Time</th>
                    <th className="text-left px-3 py-2">Source</th>
                    <th className="text-left px-3 py-2">Market</th>
                    <th className="text-right px-3 py-2">Fill volume</th>
                    <th className="text-right px-3 py-2">Fee est.</th>
                    <th className="text-right px-3 py-2">Fills</th>
                    <th className="text-left px-3 py-2">Wallet</th>
                    <th className="text-left px-3 py-2">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentBuilderOrders.map((order) => (
                    <tr key={order.txVersion} className="border-t">
                      <td className="px-3 py-1.5 text-xs whitespace-nowrap">
                        {new Date(order.timestamp).toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5">
                        <SourceBadge order={order} />
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="font-medium">{order.marketName || shortAddress(order.market)}</div>
                        <div className="text-xs text-gray-400">
                          {order.side} {order.reduceOnly ? 'close' : 'open'}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {fmtUsd(order.actualFillVolumeUsd)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {fmtUsd(order.estimatedBuilderFeeUsd)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {order.fillCount.toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">
                        {order.wallet ? <ExplorerLink value={order.wallet} kind="account" /> : '-'}
                      </td>
                      <td className="px-3 py-1.5 text-xs">
                        <ExplorerLink value={order.txVersion} kind="txn" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`border rounded p-3 ${highlight ? 'bg-gray-900 text-white' : ''}`}>
      <div className={`text-xs ${highlight ? 'text-gray-300' : 'text-gray-500'}`}>{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function SectionSummary({ title, section }: { title: string; section: DecibelReportSection }) {
  return (
    <div className="border rounded p-4">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <MiniStat label="Builder volume" value={fmtUsd(section.builderFee.actualFillVolumeUsd)} />
        <MiniStat label="Est. fee" value={fmtUsd(section.builderFee.estimatedBuilderFeeUsd)} />
        <MiniStat label="Builder order txs" value={section.builderFee.placeOrderTxs.toLocaleString()} />
        <MiniStat label="All order txs" value={section.allOrders.placeOrderTxs.toLocaleString()} />
        <MiniStat label="Wallets" value={section.builderFee.uniqueWallets.toLocaleString()} />
        <MiniStat label="Subaccounts" value={section.builderFee.uniqueSubaccounts.toLocaleString()} />
      </div>
      {Object.keys(section.extra).length > 0 && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-500">
          {Object.entries(section.extra).map(([key, value]) => (
            <div key={key} className="flex justify-between gap-2">
              <span>{labelize(key)}</span>
              <span className="font-mono">{value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded p-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function DayRow({ day, maxVolume }: { day: DecibelDaySummary; maxVolume: number }) {
  const widthPct = Math.max(2, (day.actualFillVolumeUsd / maxVolume) * 100);
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="w-24 text-xs text-gray-600 font-mono">{day.date}</div>
      <div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden">
        <div className="h-full bg-blue-500" style={{ width: `${widthPct}%` }} />
      </div>
      <div className="w-36 text-xs text-right tabular-nums">{fmtUsd(day.actualFillVolumeUsd)}</div>
      <div className="w-20 text-xs text-right tabular-nums">{day.placeOrderTxs} txs</div>
    </div>
  );
}

function MarketTable({ title, rows }: { title: string; rows: DecibelMarketSummary[] }) {
  return (
    <section>
      <h2 className="text-lg font-semibold mb-2">{title}</h2>
      <div className="overflow-x-auto border rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-600">
            <tr>
              <th className="text-left px-3 py-2">Market</th>
              <th className="text-right px-3 py-2">Volume</th>
              <th className="text-right px-3 py-2">Fee est.</th>
              <th className="text-right px-3 py-2">Txs</th>
              <th className="text-right px-3 py-2">Fills</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-sm text-gray-500" colSpan={5}>
                  No rows.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.market} className="border-t">
                <td className="px-3 py-2 font-medium">{row.market}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtUsd(row.actualFillVolumeUsd)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtUsd(row.estimatedBuilderFeeUsd)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.placeOrderTxs.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.actualFillCount.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Diagnostics({ diagnostics }: { diagnostics: Record<string, number> }) {
  return (
    <section>
      <h2 className="text-lg font-semibold mb-2">Scan diagnostics</h2>
      <div className="border rounded p-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {Object.entries(diagnostics).map(([key, value]) => (
          <div key={key} className="flex justify-between gap-3">
            <span className="text-gray-500">{labelize(key)}</span>
            <span className="font-mono tabular-nums">{value.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SourceBadge({ order }: { order: DecibelOrderPreview }) {
  const label =
    order.source === 'direct'
      ? 'direct'
      : order.agentRecordType
        ? `agent ${order.agentRecordType}`
        : 'executor';
  const color = order.source === 'direct' ? '#2563eb' : '#7c3aed';
  return (
    <span className="inline-block text-xs px-1.5 py-0.5 rounded" style={{ background: color, color: '#fff' }}>
      {label}
    </span>
  );
}

function ExplorerLink({ value, kind }: { value: string; kind: 'account' | 'txn' }) {
  const label = kind === 'account' ? shortAddress(value) : value;
  return (
    <a
      href={`https://explorer.aptoslabs.com/${kind}/${value}?network=mainnet`}
      target="_blank"
      rel="noreferrer"
      className="text-blue-600 hover:underline"
      title={value}
    >
      {label}
    </a>
  );
}

function fmtUsd(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value >= 1000 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatBps(values: number[]): string {
  if (values.length === 0) return 'none';
  return values.map((value) => `${value}`).join(', ');
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function labelize(value: string): string {
  return value
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
