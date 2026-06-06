"use client";

import { type ReactNode } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, ArrowUpDown, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReclaimCheckButton } from './ReclaimCheckButton';

interface Chain {
  id: string;
  name: string;
  icon?: string;
}

interface Token {
  id: string;
  symbol: string;
  name: string;
  icon?: string;
  chain: string;
}

interface BridgeViewProps {
  sourceChain: Chain | null;
  sourceToken: Token | null;
  destChain: Chain | null;
  destToken: Token | null;
  amount: string;
  destinationAddress: string;
  onSourceChainSelect: (chain: Chain) => void;
  onSourceTokenSelect: (token: Token) => void;
  onDestChainSelect: (chain: Chain) => void;
  onDestTokenSelect: (token: Token) => void;
  onAmountChange: (amount: string) => void;
  onDestinationAddressChange: (address: string) => void;
  onTransfer: () => void;
  onRefund?: () => void;
  hasFundedSigners?: boolean;
  isTransferring?: boolean;
  transferStatus?: string;
  chains: Chain[];
  tokens: Token[];
  showSwapButton?: boolean;
  disableAssetSelection?: boolean;
  availableBalance?: string | null;
  hideSourceWallet?: boolean;
  hideDestinationAddress?: boolean;
  walletSection?: ReactNode;
  bothWalletsConnected?: boolean;
  missingWalletAlert?: ReactNode;
  bridgeButtonDisabled?: boolean;
  bridgeButtonAlert?: ReactNode;
  sourceBalance?: number;
  isBalanceLoading?: boolean;
  /** Native SOL balance for the connected Solana wallet (human-readable). */
  solanaSolBalance?: number;
  /** Aptos address (short form) used for the chain-route header. */
  aptosAddress?: string | null;
  /** Solana address (short form) used for the chain-route header. */
  solanaAddress?: string | null;
  /** SOL price in USD — used to show approximate fiat values in the fee summary. */
  solPriceUsd?: number;
}

/** Truncate number to N decimal places WITHOUT rounding */
function truncateDecimals(value: number, decimals: number): string {
  const factor = Math.pow(10, decimals);
  const truncated = Math.floor(value * factor) / factor;
  return truncated.toFixed(decimals);
}

function shortAddr(a?: string | null) {
  if (!a) return null;
  if (a.length <= 12) return a;
  return `${a.slice(0, 5)}…${a.slice(-4)}`;
}

// eslint-disable-next-line @next/next/no-img-element
const SolanaIcon = ({ size = 20 }: { size?: number }) => (
  <img src="/chain_ico/solana2.png" alt="Solana" width={size} height={size} className="rounded-full shrink-0" />
);

// eslint-disable-next-line @next/next/no-img-element
const AptosIcon = ({ size = 20 }: { size?: number }) => (
  <img src="/chain_ico/aptos2.png" alt="Aptos" width={size} height={size} className="rounded-full shrink-0" />
);

function ChainRow({ label, chain }: { label: 'From' | 'To'; chain: Chain | null }) {
  const isSolana = chain?.id === 'Solana';
  const Icon = isSolana ? SolanaIcon : AptosIcon;
  return (
    <div className="flex items-center gap-2.5 rounded-lg border bg-muted/30 px-3 py-2">
      <Icon size={26} />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground leading-none">{label}</div>
        <div className="mt-0.5 text-sm font-semibold leading-tight">
          {chain?.name ?? '—'} USDC
        </div>
      </div>
    </div>
  );
}

function ChainPill({ chain, address }: { chain: string; address?: string | null }) {
  const isSolana = chain === 'Solana';
  return (
    <div className={cn(
      'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide',
      isSolana
        ? 'border-purple-200 bg-purple-50 text-purple-800 dark:border-purple-900 dark:bg-purple-950/30 dark:text-purple-300'
        : 'border-zinc-200 bg-zinc-50 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-200',
    )}>
      <span className={cn('h-1.5 w-1.5 rounded-full', isSolana ? 'bg-purple-500' : 'bg-zinc-700 dark:bg-zinc-300')} />
      <span>{chain}</span>
      {address && <span className="font-mono opacity-70">{address}</span>}
    </div>
  );
}

export function BridgeView({
  sourceChain,
  sourceToken,
  destChain,
  destToken,
  amount,
  destinationAddress,
  onSourceChainSelect,
  onSourceTokenSelect,
  onDestChainSelect,
  onDestTokenSelect,
  onAmountChange,
  onTransfer,
  onRefund,
  hasFundedSigners,
  isTransferring,
  transferStatus,
  chains,
  tokens,
  showSwapButton = true,
  disableAssetSelection = false,
  walletSection,
  bothWalletsConnected = false,
  missingWalletAlert,
  bridgeButtonDisabled = false,
  bridgeButtonAlert,
  sourceBalance = 0,
  isBalanceLoading = false,
  solanaSolBalance = 0,
  aptosAddress,
  solanaAddress,
  solPriceUsd,
}: BridgeViewProps) {
  const handleSwap = () => {
    if (sourceChain && destChain) {
      const tempChain = sourceChain;
      onSourceChainSelect(destChain);
      onDestChainSelect(tempChain);
    }
    if (sourceToken && destToken) {
      const tempToken = sourceToken;
      onSourceTokenSelect(destToken);
      onDestTokenSelect(tempToken);
    }
  };

  const numericAmount = parseFloat(amount || '0');
  const exceedsBalance = numericAmount > sourceBalance + 1e-9;
  const lowSol = sourceChain?.id === 'Solana' && destChain?.id === 'Aptos' && solanaSolBalance < 0.01;
  const ctaLabel = isTransferring
    ? 'Bridging…'
    : numericAmount > 0
      ? `Bridge ${amount} ${sourceToken?.symbol ?? ''}`
      : 'Enter amount';

  const sourcePillAddr = sourceChain?.id === 'Solana' ? shortAddr(solanaAddress) : shortAddr(aptosAddress);
  const destPillAddr = destChain?.id === 'Solana' ? shortAddr(solanaAddress) : shortAddr(aptosAddress);

  return (
    <Card className="border-2">
      <CardContent className="p-4 sm:p-5 space-y-3.5">
        {/* Header */}
        <div>
          <h1 className="text-lg sm:text-xl font-bold leading-tight">Bridge USDC</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Transfer USDC across chains</p>
        </div>

        {/* Wallet route row */}
        {(solanaAddress || aptosAddress) && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5">
            <ChainPill chain={sourceChain?.name ?? ''} address={sourcePillAddr} />
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <ChainPill chain={destChain?.name ?? ''} address={destPillAddr} />
          </div>
        )}

        {/* Wallet connection */}
        {walletSection && <div>{walletSection}</div>}

        {missingWalletAlert && <div>{missingWalletAlert}</div>}

        {/* From / To — USDC fixed, only chain direction is shown */}
        <div className="relative space-y-1.5">
          <ChainRow label="From" chain={sourceChain} />
          <ChainRow label="To" chain={destChain} />
          {showSwapButton && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full h-8 w-8 bg-card shadow-sm z-10"
              onClick={handleSwap}
              disabled={disableAssetSelection || !bothWalletsConnected}
              aria-label="Swap direction"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Amount */}
        {sourceToken && (
          <div className="space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Amount</div>
            <div className={cn(
              'rounded-lg border bg-muted/30 px-3 py-2.5 transition-colors',
              exceedsBalance ? 'border-destructive/50' : 'border-border',
            )}>
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#2775CA] text-white font-bold text-[11px]">$</div>
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => onAmountChange(e.target.value)}
                  placeholder="0"
                  disabled={!bothWalletsConnected}
                  className="flex-1 min-w-0 bg-transparent text-xl sm:text-2xl font-extrabold font-mono outline-none disabled:opacity-50 leading-none"
                />
                <span className="text-xs font-semibold text-muted-foreground shrink-0">{sourceToken.symbol}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  Balance:{' '}
                  {isBalanceLoading ? (
                    <Loader2 className="h-3 w-3 animate-spin inline" />
                  ) : (
                    <span className="text-primary font-medium">
                      {truncateDecimals(sourceBalance, 2)} {sourceToken.symbol}
                    </span>
                  )}
                  {sourceChain?.id === 'Solana' && destChain?.id === 'Aptos' && (
                    <span className={cn('ml-1', lowSol ? 'text-destructive' : 'text-muted-foreground')}>
                      · {truncateDecimals(solanaSolBalance, 3)} SOL
                    </span>
                  )}
                </div>
                {bothWalletsConnected && (
                  <div className="flex gap-1">
                    {[
                      ['25%', 0.25],
                      ['50%', 0.5],
                      ['Max', 1],
                    ].map(([label, pct]) => (
                      <button
                        key={label as string}
                        type="button"
                        onClick={() => onAmountChange(truncateDecimals(sourceBalance * (pct as number), 2))}
                        className="rounded-md border border-primary/20 bg-primary/5 px-2 py-0.5 text-[11px] font-semibold text-primary hover:bg-primary/10"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {exceedsBalance && (
                <p className="mt-1 text-[11px] text-destructive">Exceeds available balance</p>
              )}
              {lowSol && sourceChain?.id === 'Solana' && (
                <p className="mt-1 text-[11px] text-destructive">Need at least 0.01 SOL for gas on Solana</p>
              )}
            </div>
          </div>
        )}

        {/* Fee summary */}
        {sourceToken && numericAmount > 0 && (() => {
          const fromSolana = sourceChain?.id === 'Solana';
          // ~0.00008 SOL observed network fee on the Solana leg (burn or mint).
          const SOLANA_GAS_SOL = 0.00008;
          // Solana→Aptos burn locks this rent in a CCTP event account; reclaimable later.
          const EVENT_RENT_SOL = 0.0029;
          const usd = (sol: number): string | null => {
            if (!solPriceUsd) return null;
            const v = sol * solPriceUsd;
            return v < 0.01 ? '<$0.01' : `~$${v.toFixed(2)}`;
          };
          const withUsd = (sol: number, digits = 5) => {
            const u = usd(sol);
            return `~${sol.toFixed(digits)} SOL${u ? ` (${u})` : ''}`;
          };
          return (
            <div className="rounded-md bg-muted/40 px-3 py-2 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bridge fee</span>
                <span className="text-success font-medium">$0.00 (sponsored by Yield AI)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Network gas (Solana)</span>
                <span className="font-medium">{withUsd(SOLANA_GAS_SOL)}</span>
              </div>
              {fromSolana ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Refundable rent</span>
                    <span className="font-medium">{withUsd(EVENT_RENT_SOL, 4)} · reclaimable</span>
                  </div>
                  <div className="flex justify-between border-t border-border/60 pt-1 mt-0.5">
                    <span className="text-muted-foreground">Net cost</span>
                    <span className="font-semibold">{withUsd(SOLANA_GAS_SOL)}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Aptos gas</span>
                  <span className="text-success font-medium">Sponsored by Yield AI</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border/60 pt-1 mt-0.5">
                <span className="text-muted-foreground">You receive</span>
                <span className="text-success font-semibold">{amount} USDC on {destChain?.name}</span>
              </div>
            </div>
          );
        })()}

        {bridgeButtonAlert && (
          <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            {bridgeButtonAlert}
          </div>
        )}

        {transferStatus && (
          <div className="rounded-md bg-muted px-3 py-2 text-xs">{transferStatus}</div>
        )}

        {/* CTA */}
        <Button
          onClick={onTransfer}
          disabled={bridgeButtonDisabled || isTransferring || exceedsBalance || lowSol || numericAmount <= 0}
          className="w-full h-11 text-sm font-bold tracking-wide"
        >
          {isTransferring ? (
            <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{ctaLabel}</span>
          ) : (
            <span className="inline-flex items-center gap-2">{ctaLabel}<ArrowRight className="h-4 w-4" /></span>
          )}
        </Button>

        {onRefund && hasFundedSigners && (
          <Button onClick={onRefund} disabled={isTransferring} variant="outline" className="w-full">
            {isTransferring ? 'Processing…' : 'Refund SOL from Internal Signers'}
          </Button>
        )}

        <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
          Works with wallets that have no APT · Bridge fee $0 · Gas paid on Solana only
        </p>

        <div className="flex flex-col items-center gap-1.5 text-[10px] text-muted-foreground/70 leading-relaxed">
          <p>
            Bridge interrupted?{' '}
            <Link href="/minting" className="underline hover:text-foreground">Recover manually</Link>
            {' · '}
            <Link href="/minting?dest=reclaim" className="underline hover:text-foreground">Reclaim SOL rent</Link>
          </p>
          <ReclaimCheckButton />
        </div>
      </CardContent>
    </Card>
  );
}
