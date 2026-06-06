'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CATEGORY_META,
  type ActivityCategory,
} from '@/lib/admin/gasActivity';

const CATEGORY_ORDER: ActivityCategory[] = [
  'vault',
  'strategy',
  'decibel',
  'swap',
  'lending',
  'bridge',
  'other',
];

interface DayBucket {
  date: string;
  counts: Record<ActivityCategory, number>;
}

interface FunctionStat {
  entryFunction: string;
  category: ActivityCategory;
  action: string;
  count: number;
  uniqueWallets: number;
}

interface WalletStat {
  wallet: string;
  actions: number;
  categories: ActivityCategory[];
  isNew: boolean;
  firstSeen: string;
  lastSeen: string;
}

interface ActivityEntry {
  txVersion: string;
  timestamp: string;
  sender: string;
  entryFunction: string;
  category: ActivityCategory;
  action: string;
}

interface GasActivityResponse {
  generatedAt: string;
  gasStation: string;
  rangeFrom: string | null;
  rangeTo: string | null;
  totals: {
    actions: number;
    uniqueWallets: number;
    newSafes: number;
    byCategory: Record<ActivityCategory, number>;
  };
  byDay: DayBucket[];
  byFunction: FunctionStat[];
  byWallet: WalletStat[];
  entries: ActivityEntry[];
  truncated: boolean;
}

export default function GasActivityPage() {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<GasActivityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [walletFilter, setWalletFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<ActivityCategory | 'all'>('all');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const url = new URL('/api/admin/yield-ai/gas-activity', window.location.origin);
      if (from) url.searchParams.set('from', from);
      if (to) url.searchParams.set('to', to);
      const res = await fetch(url.toString());
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json.data as GasActivityResponse);
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

  const maxDayTotal = useMemo(() => {
    if (!data) return 1;
    let max = 0;
    for (const d of data.byDay) {
      const total = CATEGORY_ORDER.reduce((acc, c) => acc + d.counts[c], 0);
      if (total > max) max = total;
    }
    return max || 1;
  }, [data]);

  const filteredEntries = useMemo(() => {
    if (!data) return [];
    const wf = walletFilter.trim().toLowerCase();
    return data.entries.filter((e) => {
      if (categoryFilter !== 'all' && e.category !== categoryFilter) return false;
      if (wf && !e.sender.toLowerCase().includes(wf)) return false;
      return true;
    });
  }, [data, walletFilter, categoryFilter]);

  return (
    <div className="container mx-auto py-6 px-4">
      <h1 className="text-3xl font-bold mb-2">Yield AI · Gas Station Activity</h1>
      <p className="text-sm text-gray-500 mb-1">
        Every transaction sponsored by the Yield AI gas station wallet — what users do across
        the app (vault, Decibel, swaps, lending, bridge). Counts only, no amounts.
      </p>
      {data && (
        <p className="text-xs text-gray-400 mb-6 font-mono break-all">
          Gas station: {data.gasStation}
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
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Stat label="Total actions" value={data.totals.actions.toLocaleString()} />
            <Stat label="Unique wallets" value={data.totals.uniqueWallets.toLocaleString()} />
            <Stat label="New safes created" value={data.totals.newSafes.toLocaleString()} />
            <Stat
              label="Functions used"
              value={data.byFunction.length.toLocaleString()}
            />
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-2">Actions by day × category</h2>
            <Legend />
            <div className="border rounded p-3 overflow-x-auto">
              <div className="min-w-[600px]">
                {data.byDay.length === 0 && (
                  <div className="text-sm text-gray-500">No activity in selected range.</div>
                )}
                {data.byDay.map((d) => (
                  <DayRow key={d.date} day={d} maxTotal={maxDayTotal} />
                ))}
              </div>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-2">By function ({data.byFunction.length})</h2>
            <div className="overflow-x-auto border rounded">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                  <tr>
                    <th className="text-left px-3 py-2">Action</th>
                    <th className="text-left px-3 py-2">Category</th>
                    <th className="text-right px-3 py-2">Count</th>
                    <th className="text-right px-3 py-2">Wallets</th>
                    <th className="text-left px-3 py-2">Entry function</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byFunction.map((f) => (
                    <tr key={f.entryFunction} className="border-t hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium">{f.action}</td>
                      <td className="px-3 py-2">
                        <CategoryBadge category={f.category} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {f.count.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {f.uniqueWallets.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-500 break-all">
                        {f.entryFunction}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-2">
              Wallets to monitor ({data.byWallet.length})
            </h2>
            <div className="overflow-x-auto border rounded max-h-[500px] overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-600 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">Wallet</th>
                    <th className="text-right px-3 py-2">Actions</th>
                    <th className="text-left px-3 py-2">Categories</th>
                    <th className="text-left px-3 py-2">New?</th>
                    <th className="text-left px-3 py-2">First seen</th>
                    <th className="text-left px-3 py-2">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byWallet.map((w) => (
                    <tr key={w.wallet} className="border-t hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-xs">
                        <ExplorerLink addr={w.wallet} kind="account" />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {w.actions.toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        {w.categories.map((c) => (
                          <CategoryBadge key={c} category={c} />
                        ))}
                      </td>
                      <td className="px-3 py-2">
                        {w.isNew ? (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-600 text-white">
                            new
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {new Date(w.firstSeen).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {new Date(w.lastSeen).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <div className="flex flex-wrap items-center gap-3 mb-2">
              <h2 className="text-lg font-semibold">
                Recent actions ({filteredEntries.length})
              </h2>
              <input
                placeholder="Filter by wallet…"
                value={walletFilter}
                onChange={(e) => setWalletFilter(e.target.value)}
                className="border rounded px-2 py-1 text-sm"
              />
              <select
                value={categoryFilter}
                onChange={(e) =>
                  setCategoryFilter(e.target.value as ActivityCategory | 'all')
                }
                className="border rounded px-2 py-1 text-sm"
              >
                <option value="all">All categories</option>
                {CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_META[c].label}
                  </option>
                ))}
              </select>
            </div>
            <div className="overflow-x-auto border rounded max-h-[600px] overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-600 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-2">Time</th>
                    <th className="text-left px-3 py-2">Action</th>
                    <th className="text-left px-3 py-2">Category</th>
                    <th className="text-left px-3 py-2">Wallet</th>
                    <th className="text-left px-3 py-2">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.slice(0, 500).map((e) => (
                    <tr key={e.txVersion} className="border-t">
                      <td className="px-3 py-1.5 text-xs whitespace-nowrap">
                        {new Date(e.timestamp).toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5">{e.action}</td>
                      <td className="px-3 py-1.5">
                        <CategoryBadge category={e.category} />
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">
                        <ExplorerLink addr={e.sender} kind="account" />
                      </td>
                      <td className="px-3 py-1.5 text-xs">
                        <ExplorerLink addr={e.txVersion} kind="txn" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredEntries.length > 500 && (
              <p className="text-xs text-gray-400 mt-1">
                Showing first 500 of {filteredEntries.length}.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-3 mb-2 text-xs">
      {CATEGORY_ORDER.map((c) => (
        <div key={c} className="flex items-center gap-1">
          <span
            className="inline-block w-3 h-3 rounded-sm"
            style={{ background: CATEGORY_META[c].color }}
          />
          {CATEGORY_META[c].label}
        </div>
      ))}
    </div>
  );
}

function DayRow({ day, maxTotal }: { day: DayBucket; maxTotal: number }) {
  const segments = CATEGORY_ORDER.map((c) => ({
    category: c,
    value: day.counts[c],
    color: CATEGORY_META[c].color,
  })).filter((s) => s.value > 0);

  const total = segments.reduce((acc, s) => acc + s.value, 0);
  const widthPct = (total / maxTotal) * 100;

  return (
    <div className="flex items-center gap-3 py-1">
      <div className="w-24 text-xs text-gray-600 font-mono">{day.date}</div>
      <div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden">
        <div className="flex h-full" style={{ width: `${widthPct}%` }}>
          {segments.map((s) => (
            <div
              key={s.category}
              title={`${CATEGORY_META[s.category].label}: ${s.value}`}
              style={{ background: s.color, width: `${(s.value / total) * 100}%` }}
            />
          ))}
        </div>
      </div>
      <div className="w-16 text-xs text-right tabular-nums">{total}</div>
    </div>
  );
}

function CategoryBadge({ category }: { category: ActivityCategory }) {
  const meta = CATEGORY_META[category];
  return (
    <span
      className="inline-block text-xs px-1.5 py-0.5 mr-1 rounded"
      style={{ background: meta.color, color: '#fff' }}
    >
      {meta.label}
    </span>
  );
}

function ExplorerLink({ addr, kind }: { addr: string; kind: 'account' | 'txn' }) {
  const label =
    kind === 'account' ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
  return (
    <a
      href={`https://explorer.aptoslabs.com/${kind}/${addr}?network=mainnet`}
      target="_blank"
      rel="noreferrer"
      className="text-blue-600 hover:underline"
      title={addr}
    >
      {label}
    </a>
  );
}
