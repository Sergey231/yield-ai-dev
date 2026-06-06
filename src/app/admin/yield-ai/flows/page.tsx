'use client';

import { useEffect, useMemo, useState } from 'react';

type StrategyId = 'stablecoin_compound' | 'decibel_delta_neutral' | 'unknown';
type Direction = 'deposit' | 'withdraw';

interface DayBucket {
  date: string;
  stablecoinDeposit: string;
  stablecoinWithdraw: string;
  deltaNeutralDeposit: string;
  deltaNeutralWithdraw: string;
  unknownDeposit: string;
  unknownWithdraw: string;
}

interface WalletSummary {
  owner: string;
  safeAddresses: string[];
  strategies: StrategyId[];
  totalDeposited: string;
  totalWithdrawn: string;
  netDeposits: string;
  lastActivity: string | null;
}

interface FlowEntry {
  timestamp: string;
  txVersion: string;
  safeAddress: string;
  owner: string | null;
  strategy: StrategyId;
  direction: Direction;
  amount: string;
}

interface FlowsResponse {
  generatedAt: string;
  rangeFrom: string | null;
  rangeTo: string | null;
  totals: {
    safes: number;
    activeOwners: number;
    totalDeposited: string;
    totalWithdrawn: string;
    netDeposits: string;
  };
  byDay: DayBucket[];
  byWallet: WalletSummary[];
  entries: FlowEntry[];
  truncated: boolean;
}

const COLORS = {
  stablecoinDeposit: '#10b981',
  stablecoinWithdraw: '#f87171',
  deltaNeutralDeposit: '#3b82f6',
  deltaNeutralWithdraw: '#a855f7',
  unknownDeposit: '#94a3b8',
  unknownWithdraw: '#64748b',
} as const;

const LEGEND: Array<{ key: keyof typeof COLORS; label: string }> = [
  { key: 'stablecoinDeposit', label: 'Stablecoin deposit' },
  { key: 'stablecoinWithdraw', label: 'Stablecoin withdraw' },
  { key: 'deltaNeutralDeposit', label: 'Delta-neutral deposit' },
  { key: 'deltaNeutralWithdraw', label: 'Delta-neutral withdraw' },
  { key: 'unknownDeposit', label: 'Unknown deposit' },
  { key: 'unknownWithdraw', label: 'Unknown withdraw' },
];

export default function YieldAiFlowsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<FlowsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const url = new URL('/api/admin/yield-ai/flows', window.location.origin);
      if (from) url.searchParams.set('from', from);
      if (to) url.searchParams.set('to', to);
      const res = await fetch(url.toString());
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json.data as FlowsResponse);
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

  const maxDayValue = useMemo(() => {
    if (!data) return 0;
    let max = 0;
    for (const d of data.byDay) {
      const v = LEGEND.reduce((acc, l) => acc + parseFloat(d[l.key] || '0'), 0);
      if (v > max) max = v;
    }
    return max || 1;
  }, [data]);

  return (
    <div className="container mx-auto py-6 px-4">
      <h1 className="text-3xl font-bold mb-2">Yield AI · Flows</h1>
      <p className="text-sm text-gray-500 mb-6">
        All deposits and withdrawals across Yield AI vault safes, grouped by day and active strategy.
        Strategy reflects the current on-chain tag (as of request time), not historical.
      </p>

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
          {loading ? 'Loading…' : 'Reload'}
        </button>
        {data && (
          <span className="text-xs text-gray-500 ml-2">
            generated {new Date(data.generatedAt).toLocaleString()}
            {data.truncated && <span className="text-orange-500 ml-2">⚠ truncated</span>}
          </span>
        )}
      </div>

      {error && (
        <div className="border border-red-300 bg-red-50 text-red-700 text-sm rounded p-3 mb-4">
          {error}
        </div>
      )}

      {data && (
        <>
          <section className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <Stat label="Safes" value={String(data.totals.safes)} />
            <Stat label="Active owners" value={String(data.totals.activeOwners)} />
            <Stat label="Total deposited (USDC)" value={fmt(data.totals.totalDeposited)} />
            <Stat label="Total withdrawn (USDC)" value={fmt(data.totals.totalWithdrawn)} />
            <Stat label="Net (USDC)" value={fmt(data.totals.netDeposits)} highlight />
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-2">By day × strategy</h2>
            <Legend />
            <div className="border rounded p-3 overflow-x-auto">
              <div className="min-w-[600px]">
                {data.byDay.length === 0 && (
                  <div className="text-sm text-gray-500">No flows in selected range.</div>
                )}
                {data.byDay.map((d) => (
                  <DayRow key={d.date} day={d} maxValue={maxDayValue} />
                ))}
              </div>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-2">
              Wallets to monitor ({data.byWallet.length})
            </h2>
            <div className="overflow-x-auto border rounded">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                  <tr>
                    <th className="text-left px-3 py-2">Owner</th>
                    <th className="text-left px-3 py-2">Strategies</th>
                    <th className="text-right px-3 py-2">Safes</th>
                    <th className="text-right px-3 py-2">Deposited</th>
                    <th className="text-right px-3 py-2">Withdrawn</th>
                    <th className="text-right px-3 py-2">Net</th>
                    <th className="text-left px-3 py-2">Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byWallet.map((w) => (
                    <tr key={w.owner} className="border-t hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-xs">
                        <ExplorerLink addr={w.owner} />
                      </td>
                      <td className="px-3 py-2">
                        {w.strategies.length === 0
                          ? <span className="text-gray-400">—</span>
                          : w.strategies.map((s) => (
                              <span
                                key={s}
                                className="inline-block text-xs px-1.5 py-0.5 mr-1 rounded"
                                style={{ background: strategyColor(s), color: '#fff' }}
                              >
                                {strategyLabel(s)}
                              </span>
                            ))}
                      </td>
                      <td className="px-3 py-2 text-right">{w.safeAddresses.length}</td>
                      <td className="px-3 py-2 text-right">{fmt(w.totalDeposited)}</td>
                      <td className="px-3 py-2 text-right">{fmt(w.totalWithdrawn)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{fmt(w.netDeposits)}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {w.lastActivity ? new Date(w.lastActivity).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Recent transactions ({data.entries.length})</h2>
            <div className="overflow-x-auto border rounded max-h-[600px] overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-600 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">Time</th>
                    <th className="text-left px-3 py-2">Direction</th>
                    <th className="text-left px-3 py-2">Strategy</th>
                    <th className="text-right px-3 py-2">USDC</th>
                    <th className="text-left px-3 py-2">Owner</th>
                    <th className="text-left px-3 py-2">Safe</th>
                    <th className="text-left px-3 py-2">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.slice(0, 500).map((e) => (
                    <tr key={`${e.txVersion}-${e.safeAddress}`} className="border-t">
                      <td className="px-3 py-1.5 text-xs whitespace-nowrap">
                        {new Date(e.timestamp).toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5">
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{
                            background: e.direction === 'deposit' ? '#10b981' : '#f87171',
                            color: '#fff',
                          }}
                        >
                          {e.direction}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-xs">{strategyLabel(e.strategy)}</td>
                      <td className="px-3 py-1.5 text-right">{fmt(e.amount)}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">
                        {e.owner ? <ExplorerLink addr={e.owner} /> : '—'}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">
                        <ExplorerLink addr={e.safeAddress} />
                      </td>
                      <td className="px-3 py-1.5 text-xs">
                        <a
                          href={`https://explorer.aptoslabs.com/txn/${e.txVersion}?network=mainnet`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          {e.txVersion}
                        </a>
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

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`border rounded p-3 ${highlight ? 'bg-gray-900 text-white' : ''}`}>
      <div className={`text-xs ${highlight ? 'text-gray-300' : 'text-gray-500'}`}>{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-3 mb-2 text-xs">
      {LEGEND.map((l) => (
        <div key={l.key} className="flex items-center gap-1">
          <span
            className="inline-block w-3 h-3 rounded-sm"
            style={{ background: COLORS[l.key] }}
          />
          {l.label}
        </div>
      ))}
    </div>
  );
}

function DayRow({ day, maxValue }: { day: DayBucket; maxValue: number }) {
  const segments = LEGEND.map((l) => ({
    key: l.key,
    value: parseFloat(day[l.key] || '0'),
    color: COLORS[l.key],
  })).filter((s) => s.value > 0);

  const total = segments.reduce((acc, s) => acc + s.value, 0);
  const widthPct = (total / maxValue) * 100;

  return (
    <div className="flex items-center gap-3 py-1">
      <div className="w-24 text-xs text-gray-600 font-mono">{day.date}</div>
      <div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden">
        <div className="flex h-full" style={{ width: `${widthPct}%` }}>
          {segments.map((s) => (
            <div
              key={s.key}
              title={`${s.key}: ${s.value.toFixed(2)}`}
              style={{
                background: s.color,
                width: `${(s.value / total) * 100}%`,
              }}
            />
          ))}
        </div>
      </div>
      <div className="w-28 text-xs text-right tabular-nums">{total.toFixed(2)}</div>
    </div>
  );
}

function ExplorerLink({ addr }: { addr: string }) {
  const short = `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  return (
    <a
      href={`https://explorer.aptoslabs.com/account/${addr}?network=mainnet`}
      target="_blank"
      rel="noreferrer"
      className="text-blue-600 hover:underline"
      title={addr}
    >
      {short}
    </a>
  );
}

function strategyLabel(s: StrategyId): string {
  if (s === 'stablecoin_compound') return 'Stablecoin';
  if (s === 'decibel_delta_neutral') return 'Delta-neutral';
  return 'Unknown';
}

function strategyColor(s: StrategyId): string {
  if (s === 'stablecoin_compound') return '#10b981';
  if (s === 'decibel_delta_neutral') return '#3b82f6';
  return '#94a3b8';
}

function fmt(s: string): string {
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
