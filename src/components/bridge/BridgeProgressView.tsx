"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ActionLog, type ActionLogItem } from './ActionLog';
import { ReclaimBanner } from './ReclaimBanner';
import {
  deriveBridgeSteps,
  formatElapsed,
  type StepStatus,
} from './bridgeSteps';

export type BridgeDirection = 'solana-to-aptos' | 'aptos-to-solana';
export type BridgePhase = 'progress' | 'success' | 'error';

interface BridgeProgressViewProps {
  phase: BridgePhase;
  direction: BridgeDirection;
  amount: string;
  sourceAddress?: string | null;
  destAddress?: string | null;
  /** Raw action log from the bridge executors (kept for power-user details). */
  actionLog: ActionLogItem[];
  /** Optional callbacks for the success-state CTAs. */
  onDeployToYield?: () => void;
  onBridgeMore?: () => void;
  /** Optional callback for the error-state CTA. */
  onRetry?: () => void;
}

// eslint-disable-next-line @next/next/no-img-element
const SolanaIcon = ({ size = 24 }: { size?: number }) => (
  <img src="/chain_ico/solana2.png" alt="Solana" width={size} height={size} className="rounded-full shrink-0" />
);

// eslint-disable-next-line @next/next/no-img-element
const AptosIcon = ({ size = 24 }: { size?: number }) => (
  <img src="/chain_ico/aptos2.png" alt="Aptos" width={size} height={size} className="rounded-full shrink-0" />
);

function shortAddr(a?: string | null) {
  if (!a) return '—';
  if (a.length <= 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function ChainBadge({ chain, address, compact = false }: { chain: 'Solana' | 'Aptos'; address?: string | null; compact?: boolean }) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border',
        compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        chain === 'Solana' ? 'border-purple-200 bg-purple-50 text-purple-800 dark:border-purple-900 dark:bg-purple-950/30 dark:text-purple-300' : 'border-zinc-200 bg-zinc-50 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', chain === 'Solana' ? 'bg-purple-500' : 'bg-zinc-700 dark:bg-zinc-300')} />
      <span className="font-semibold tracking-wide">{chain}</span>
      {address && <span className="font-mono opacity-70">{shortAddr(address)}</span>}
    </div>
  );
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done') {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-success text-white">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </div>
    );
  }
  if (status === 'active') {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-white">
        <AlertCircle className="h-3.5 w-3.5" />
      </div>
    );
  }
  return (
    <div className="flex h-6 w-6 items-center justify-center rounded-full border-[1.5px] border-border bg-muted">
      <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
    </div>
  );
}

function StepLeftRail({ status, isLast }: { status: StepStatus; isLast: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <StepIcon status={status} />
      {!isLast && (
        <div
          className={cn(
            'mt-1 w-0.5 flex-1 min-h-4 rounded',
            status === 'done' ? 'bg-success/40' : 'bg-border',
          )}
        />
      )}
    </div>
  );
}

export function BridgeProgressView({
  phase,
  direction,
  amount,
  sourceAddress,
  destAddress,
  actionLog,
  onDeployToYield,
  onBridgeMore,
  onRetry,
}: BridgeProgressViewProps) {
  const sourceChain = direction === 'solana-to-aptos' ? 'Solana' : 'Aptos';
  const destChain = direction === 'solana-to-aptos' ? 'Aptos' : 'Solana';
  const SourceIcon = sourceChain === 'Solana' ? SolanaIcon : AptosIcon;
  const DestIcon = destChain === 'Solana' ? SolanaIcon : AptosIcon;

  const { steps, activeIndex, errorMessage } = useMemo(
    () => deriveBridgeSteps(actionLog, direction),
    [actionLog, direction],
  );

  // elapsed time clock (ticks while in progress; freezes on success/error)
  const startTime = useMemo(() => {
    const first = actionLog.find((it) => it.startTime);
    return first?.startTime ?? actionLog[0]?.timestamp.getTime() ?? Date.now();
  }, [actionLog]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (phase !== 'progress') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);
  const elapsedMs = (phase === 'progress' ? now : (actionLog[actionLog.length - 1]?.timestamp.getTime() ?? now)) - startTime;

  const [logOpen, setLogOpen] = useState(false);

  const doneCount = steps.filter((s) => s.status === 'done').length;
  const progressPct = Math.max(8, Math.round((doneCount / steps.length) * 100));

  // Latest tx link from the source chain (initiate or lock step)
  const latestTxItem = [...actionLog]
    .reverse()
    .find((it) => it.link && /explorer|solscan/i.test(it.link ?? ''));

  // ── SUCCESS ──────────────────────────────────────────────────────────────
  if (phase === 'success') {
    return (
      <Card className="border-2">
        <CardContent className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold">Bridge Complete</h2>
              <p className="text-sm text-success mt-0.5 font-medium">USDC arrived on {destChain}</p>
            </div>
            <div className="relative h-10 w-10 shrink-0">
              <span className="absolute inset-0 rounded-full bg-success/20 animate-ping" />
              <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-success">
                <Check className="h-5 w-5 text-white" strokeWidth={3} />
              </span>
            </div>
          </div>

          {/* Amount callout */}
          <div className="rounded-xl border border-success/30 bg-success/5 p-5 text-center">
            <div className="font-mono text-4xl font-extrabold tracking-tight">
              {amount} USDC
            </div>
            <div className="mt-1 text-sm text-muted-foreground">received on {destChain}</div>
            <div className="mt-3 flex items-center justify-center gap-2">
              <SourceIcon size={20} />
              <ArrowRight className="h-4 w-4 text-success" />
              <DestIcon size={20} />
            </div>
          </div>

          {/* Details */}
          <div className="divide-y divide-border">
            {[
              ['Sent from', `${sourceChain} · ${shortAddr(sourceAddress)}`],
              ['Received at', `${destChain} · ${shortAddr(destAddress)}`],
              ['Bridge fee', '$0.00 (Yield AI sponsored)'],
              ['Time taken', formatElapsed(elapsedMs)],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-muted-foreground">{k}</span>
                <span className={cn('font-medium', k === 'Bridge fee' && 'text-success')}>
                  {v}
                </span>
              </div>
            ))}
          </div>

          {/* Tx links */}
          <div className="flex flex-wrap gap-2">
            {actionLog
              .filter((it) => it.link && /explorer|solscan/i.test(it.link ?? ''))
              .slice(-2)
              .map((it) => (
                <Link
                  key={it.id}
                  href={it.link!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex flex-1 min-w-[140px] items-center justify-center gap-1.5 rounded-md border bg-muted px-3 py-2 text-xs font-semibold text-foreground hover:bg-accent"
                >
                  {it.linkText ?? 'View transaction'} <ExternalLink className="h-3 w-3" />
                </Link>
              ))}
          </div>

          {/* Reclaim stranded Solana rent from past burns */}
          <ReclaimBanner />

          {/* Actions */}
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            <Button className="flex-1 h-11 text-sm font-semibold" onClick={onDeployToYield}>
              Deploy to Yield
            </Button>
            <Button variant="outline" className="flex-1 h-11 text-sm font-semibold" onClick={onBridgeMore}>
              Bridge More
            </Button>
          </div>

          {/* Details (raw log) */}
          <DetailsDisclosure open={logOpen} onToggle={() => setLogOpen((v) => !v)} actionLog={actionLog} />
        </CardContent>
      </Card>
    );
  }

  // ── PROGRESS / ERROR ─────────────────────────────────────────────────────
  const isError = phase === 'error';
  return (
    <Card className="border-2">
      <CardContent className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">
              {isError ? 'Bridge Failed' : 'Bridge in Progress'}
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {isError ? errorMessage ?? 'Something went wrong' : 'Do not close this window'}
            </p>
          </div>
          {!isError && (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              {formatElapsed(elapsedMs)} elapsed
            </div>
          )}
        </div>

        {/* Chain flow visual */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="rounded-lg border bg-muted/40 p-3 flex items-center gap-2.5 min-w-0">
            <SourceIcon size={28} />
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{sourceChain}</div>
              <div className="font-mono text-sm font-bold truncate">−{amount} USDC</div>
            </div>
          </div>
          <div className="flex flex-col items-center gap-1">
            {isError ? <AlertCircle className="h-4 w-4 text-destructive" /> : <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            <div className="h-0.5 w-6 bg-gradient-to-r from-primary/40 to-primary rounded" />
          </div>
          <div className={cn('rounded-lg border bg-muted/40 p-3 flex items-center gap-2.5 min-w-0', !steps[3].status.startsWith('done') && 'opacity-60')}>
            <DestIcon size={28} />
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{destChain}</div>
              <div className="font-mono text-sm font-bold truncate">+{amount} USDC</div>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Step {Math.min(doneCount + (activeIndex >= 0 ? 1 : 0), steps.length)} of {steps.length}
            </span>
            {activeIndex >= 0 && (
              <span className="font-semibold text-primary">{steps[activeIndex].label}…</span>
            )}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                isError ? 'bg-destructive' : 'bg-gradient-to-r from-primary to-primary/70',
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <ul className="space-y-0">
          {steps.map((s, i) => {
            const isLast = i === steps.length - 1;
            return (
              <li key={s.key} className="flex items-stretch gap-3 pb-3 last:pb-0">
                <StepLeftRail status={s.status} isLast={isLast} />
                <div className="flex-1 pt-0.5">
                  <div className={cn(
                    'text-sm',
                    s.status === 'pending' && 'text-muted-foreground',
                    s.status === 'active' && 'font-semibold text-foreground',
                    s.status === 'done' && 'text-foreground',
                    s.status === 'error' && 'text-destructive font-semibold',
                  )}>
                    {s.label}
                  </div>
                  {s.status === 'done' && (
                    <div className="text-[11px] text-success mt-0.5">Confirmed</div>
                  )}
                  {s.status === 'active' && (
                    <div className="text-[11px] text-primary mt-0.5">{s.source?.message ?? 'Waiting for confirmation…'}</div>
                  )}
                  {s.status === 'error' && s.source?.message && (
                    <div className="text-[11px] text-destructive mt-0.5 break-words">{s.source.message}</div>
                  )}
                  {s.source?.link && (s.status === 'active' || s.status === 'error') && (
                    <Link
                      href={s.source.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                    >
                      {s.source.linkText ?? 'View'} <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {/* Latest tx link */}
        {latestTxItem?.link && (
          <Link
            href={latestTxItem.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-xs hover:bg-accent"
          >
            <span className="text-muted-foreground">{sourceChain} tx</span>
            <span className="font-mono text-primary inline-flex items-center gap-1">
              {latestTxItem.linkText ?? 'View'} <ExternalLink className="h-3 w-3" />
            </span>
          </Link>
        )}

        {isError && (
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            {onRetry && (
              <Button variant="default" className="flex-1 h-11" onClick={onRetry}>
                Try again
              </Button>
            )}
            {onBridgeMore && (
              <Button variant="outline" className="flex-1 h-11" onClick={onBridgeMore}>
                Start over
              </Button>
            )}
          </div>
        )}

        <DetailsDisclosure open={logOpen} onToggle={() => setLogOpen((v) => !v)} actionLog={actionLog} />
      </CardContent>
    </Card>
  );
}

function DetailsDisclosure({
  open,
  onToggle,
  actionLog,
}: {
  open: boolean;
  onToggle: () => void;
  actionLog: ActionLogItem[];
}) {
  if (actionLog.length === 0) return null;
  return (
    <div className="-mx-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between rounded-md px-2 py-2 text-xs font-medium text-muted-foreground hover:bg-accent/50"
      >
        <span>Details ({actionLog.length} events)</span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && (
        <div className="mt-2">
          <ActionLog items={actionLog} title="Event log" />
        </div>
      )}
    </div>
  );
}
