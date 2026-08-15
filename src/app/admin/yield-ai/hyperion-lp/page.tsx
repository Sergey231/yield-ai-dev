'use client';

import { useCallback, useEffect, useState } from 'react';
import { YIELD_AI_HYPERION_POOLS, type HyperionPoolKey } from '@/lib/constants/yieldAiVault';
import { toCanonicalAddress } from '@/lib/utils/addressNormalization';

const POOL_KEYS = Object.keys(YIELD_AI_HYPERION_POOLS) as HyperionPoolKey[];

/** Resolve the non-USDC leg's symbol + decimals for a position by its tokenA. */
function resolveLeg(tokenA: string): { symbol: string; decimals: number } {
  const t = toCanonicalAddress(tokenA);
  for (const k of POOL_KEYS) {
    const p = YIELD_AI_HYPERION_POOLS[k];
    if (toCanonicalAddress(p.tokenA) === t) return { symbol: p.symbolA, decimals: p.decimalsA };
    if (toCanonicalAddress(p.tokenB) === t) return { symbol: p.symbolB, decimals: p.decimalsB };
  }
  return { symbol: 'A', decimals: 8 };
}

type PositionView = {
  position: string;
  tokenA: string;
  tokenB: string;
  feeTier: number;
  tickLower: number;
  tickUpper: number;
  principalUsdc: string;
  openedAt: string;
  closed: boolean;
  liquidity: string;
  amountA: string;
  amountB: string;
  active: boolean;
};

const USDC_DECIMALS = 6;

function fmt(raw: string, decimals: number): string {
  try {
    const v = Number(BigInt(raw)) / 10 ** decimals;
    return v.toLocaleString(undefined, { maximumFractionDigits: 8 });
  } catch {
    return raw;
  }
}

export default function HyperionLpAdminPage() {
  const [secret, setSecret] = useState('');
  const [safe, setSafe] = useState('');
  const [poolKey, setPoolKey] = useState<HyperionPoolKey>('usdt_usdc');
  const [usdcAmount, setUsdcAmount] = useState('10'); // human USDC
  const [halfWidthTicks, setHalfWidthTicks] = useState('250');
  const [slippageBps, setSlippageBps] = useState('100');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [positions, setPositions] = useState<PositionView[]>([]);

  const pushLog = useCallback((m: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()}  ${m}`, ...prev].slice(0, 50));
  }, []);

  const loadPositions = useCallback(async () => {
    if (!safe.trim()) return;
    try {
      const res = await fetch(`/api/protocols/yield-ai/hyperion-lp/positions?safe=${encodeURIComponent(safe.trim())}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
      setPositions(json?.data?.positions ?? []);
    } catch (e) {
      pushLog(`load positions error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [safe, pushLog]);

  useEffect(() => {
    void loadPositions();
  }, [loadPositions]);

  const usdcBaseUnits = useCallback((): string => {
    const n = Number(usdcAmount);
    if (!Number.isFinite(n) || n <= 0) return '0';
    return BigInt(Math.round(n * 10 ** USDC_DECIMALS)).toString();
  }, [usdcAmount]);

  const openPosition = useCallback(
    async (dryRun: boolean) => {
      if (!secret.trim()) return pushLog('set the cron secret first');
      if (!safe.trim()) return pushLog('set the safe address first');
      setBusy(true);
      try {
        const res = await fetch('/api/protocols/yield-ai/hyperion-lp/open', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret.trim() },
          body: JSON.stringify({
            safeAddress: safe.trim(),
            poolKey,
            usdcAmountInBaseUnits: usdcBaseUnits(),
            halfWidthTicks: Number(halfWidthTicks),
            slippageBps: Number(slippageBps),
            dryRun,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
        const d = json.data;
        pushLog(
          `${dryRun ? 'DRY ' : ''}open ok: tick=${d.currentTick} range=[${d.tickLower},${d.tickUpper}] swapIn=${d.swapAmountIn} ${d.hash ? `tx=${d.hash}` : ''}`
        );
        if (!dryRun) await loadPositions();
      } catch (e) {
        pushLog(`open error: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [secret, safe, poolKey, usdcBaseUnits, halfWidthTicks, slippageBps, pushLog, loadPositions]
  );

  const closePosition = useCallback(
    async (position: string) => {
      if (!secret.trim()) return pushLog('set the cron secret first');
      setBusy(true);
      try {
        const res = await fetch('/api/protocols/yield-ai/hyperion-lp/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret.trim() },
          body: JSON.stringify({ safeAddress: safe.trim(), position, claimFirst: true }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
        pushLog(`close ok: claim=${json.data.claimFeesHash ?? '-'} remove=${json.data.removeAllHash ?? '-'}`);
        await loadPositions();
      } catch (e) {
        pushLog(`close error: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [secret, safe, pushLog, loadPositions]
  );

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
      <h1 className="text-lg font-semibold mb-1">Hyperion LP — CLMM strategy (multi-pool)</h1>
      <p className="text-sm text-gray-500 mb-4">
        Executor-signed CLMM LP for an AI agent safe. Open zaps USDC into a centered range; close
        claims fees (perf cut) then removes all liquidity back to the safe. Gated by the cron secret.
      </p>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <label className="text-sm col-span-2">
          Cron secret
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="w-full border rounded px-2 py-1 mt-1 font-mono text-xs"
            placeholder="x-cron-secret"
          />
        </label>
        <label className="text-sm col-span-2">
          Safe address
          <input
            value={safe}
            onChange={(e) => setSafe(e.target.value)}
            onBlur={() => void loadPositions()}
            className="w-full border rounded px-2 py-1 mt-1 font-mono text-xs"
            placeholder="0x..."
          />
        </label>
        <label className="text-sm col-span-2">
          Pool
          <select
            value={poolKey}
            onChange={(e) => setPoolKey(e.target.value as HyperionPoolKey)}
            className="w-full border rounded px-2 py-1 mt-1"
          >
            {POOL_KEYS.map((k) => (
              <option key={k} value={k}>
                {YIELD_AI_HYPERION_POOLS[k].label} ({k}, tier {YIELD_AI_HYPERION_POOLS[k].feeTier})
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          USDC amount
          <input
            value={usdcAmount}
            onChange={(e) => setUsdcAmount(e.target.value)}
            className="w-full border rounded px-2 py-1 mt-1"
          />
        </label>
        <label className="text-sm">
          Half-width ticks (±)
          <input
            value={halfWidthTicks}
            onChange={(e) => setHalfWidthTicks(e.target.value)}
            className="w-full border rounded px-2 py-1 mt-1"
          />
        </label>
        <label className="text-sm">
          Swap slippage (bps)
          <input
            value={slippageBps}
            onChange={(e) => setSlippageBps(e.target.value)}
            className="w-full border rounded px-2 py-1 mt-1"
          />
        </label>
      </div>

      <div className="flex gap-2 mb-6">
        <button
          disabled={busy}
          onClick={() => void openPosition(true)}
          className="px-3 py-1.5 text-sm rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
        >
          Dry-run plan
        </button>
        <button
          disabled={busy}
          onClick={() => void openPosition(false)}
          className="px-3 py-1.5 text-sm rounded bg-black text-white hover:bg-gray-800 disabled:opacity-50"
        >
          Open LP position
        </button>
        <button
          disabled={busy}
          onClick={() => void loadPositions()}
          className="px-3 py-1.5 text-sm rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50 ml-auto"
        >
          Refresh
        </button>
      </div>

      <h2 className="text-sm font-semibold mb-2">Positions</h2>
      <div className="space-y-2 mb-6">
        {positions.length === 0 && <div className="text-sm text-gray-400">No tracked positions.</div>}
        {positions.map((p) => (
          <div key={p.position} className="border rounded p-3 text-xs">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`px-2 py-0.5 rounded text-white ${
                  p.closed ? 'bg-gray-400' : p.active ? 'bg-green-600' : 'bg-amber-500'
                }`}
              >
                {p.closed ? 'closed' : p.active ? 'active' : 'inactive'}
              </span>
              <span className="font-mono">{p.position.slice(0, 10)}…{p.position.slice(-6)}</span>
              <span className="text-gray-500">fee {p.feeTier} · range [{p.tickLower}, {p.tickUpper}]</span>
              {!p.closed && (
                <button
                  disabled={busy}
                  onClick={() => void closePosition(p.position)}
                  className="ml-auto px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Close
                </button>
              )}
            </div>
            <div className="text-gray-600">
              {(() => {
                const leg = resolveLeg(p.tokenA);
                return `${leg.symbol}: ${fmt(p.amountA, leg.decimals)}`;
              })()}{' '}
              · USDC: {fmt(p.amountB, USDC_DECIMALS)} · principal:{' '}
              {fmt(p.principalUsdc, USDC_DECIMALS)} USDC · liq: {p.liquidity}
            </div>
          </div>
        ))}
      </div>

      <h2 className="text-sm font-semibold mb-2">Log</h2>
      <div className="border rounded p-2 bg-gray-50 text-xs font-mono h-48 overflow-auto">
        {log.length === 0 && <div className="text-gray-400">—</div>}
        {log.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
}
