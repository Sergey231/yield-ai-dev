"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { ExternalLink, Info, Loader2 } from "lucide-react";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { formatCurrency, formatNumber } from "@/lib/utils/numberFormat";
import { queryKeys } from "@/lib/query/queryKeys";
import { useSolanaPortfolio } from "@/hooks/useSolanaPortfolio";
import {
  useMeteoraPositions,
  type MeteoraPool,
  type MeteoraPosition,
} from "@/lib/query/hooks/protocols/meteora/useMeteoraPositions";
import { BinChart } from "@/components/protocols/meteora/BinChart";

const METEORA_APP_URL = "https://app.meteora.ag";

function shortKey(value: string): string {
  if (!value) return "";
  if (value.length <= 10) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function PoolDetailsModal({
  pool,
  onClose,
}: {
  pool: MeteoraPool;
  onClose: () => void;
}) {
  const { tokenX, tokenY } = pool;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 max-w-2xl w-[90vw] max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Pool Details</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="font-semibold text-gray-700 dark:text-gray-300">Pair</h3>
              <p className="text-sm">{tokenX.symbol} / {tokenY.symbol}</p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-700 dark:text-gray-300">Bin step</h3>
              <p className="text-sm">{pool.binStep}</p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-700 dark:text-gray-300">Base fee</h3>
              <p className="text-sm">{formatNumber(pool.baseFeePct, pool.baseFeePct < 1 ? 3 : 2)}%</p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-700 dark:text-gray-300">Active bin</h3>
              <p className="text-sm">{pool.activeBinId}</p>
            </div>
            {pool.pricePerY != null && (
              <div>
                <h3 className="font-semibold text-gray-700 dark:text-gray-300">Pool price</h3>
                <p className="text-sm">
                  {formatNumber(pool.pricePerY, 4)} {tokenY.symbol}/{tokenX.symbol}
                </p>
              </div>
            )}
            <div>
              <h3 className="font-semibold text-gray-700 dark:text-gray-300">Pool address</h3>
              <a
                href={`${METEORA_APP_URL}/dlmm/${pool.poolAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono break-all underline-offset-2 hover:underline"
              >
                {pool.poolAddress}
              </a>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div>
              <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Token X</h3>
              <div className="bg-gray-50 dark:bg-zinc-800 p-3 rounded flex items-center gap-2">
                {tokenX.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tokenX.logoUrl} alt={tokenX.symbol} className="w-8 h-8 rounded-full object-contain" />
                ) : null}
                <div className="min-w-0">
                  <div className="font-bold">{tokenX.symbol}</div>
                  <div className="text-xs text-gray-500">Decimals: {tokenX.decimals}</div>
                  <div className="text-xs font-mono break-all">{tokenX.mint}</div>
                </div>
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">Token Y</h3>
              <div className="bg-gray-50 dark:bg-zinc-800 p-3 rounded flex items-center gap-2">
                {tokenY.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={tokenY.logoUrl} alt={tokenY.symbol} className="w-8 h-8 rounded-full object-contain" />
                ) : null}
                <div className="min-w-0">
                  <div className="font-bold">{tokenY.symbol}</div>
                  <div className="text-xs text-gray-500">Decimals: {tokenY.decimals}</div>
                  <div className="text-xs font-mono break-all">{tokenY.mint}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface MeteoraRowProps {
  pool: MeteoraPool;
  position: MeteoraPosition;
  canClaim: boolean;
  isClaiming: boolean;
  onClaim: () => void;
  canClose: boolean;
  isClosing: boolean;
  onClose: () => void;
}

const MeteoraPositionRow = memo(function MeteoraPositionRow({
  pool,
  position,
  canClaim,
  isClaiming,
  onClaim,
  canClose,
  isClosing,
  onClose,
}: MeteoraRowProps) {
  const [showPoolDetails, setShowPoolDetails] = useState(false);
  const { tokenX, tokenY } = pool;
  const positionUsd = position.valueUsd;
  const feesUsd = position.feesUsd;
  const positionHref = `${METEORA_APP_URL}/dlmm/${pool.poolAddress}`;
  const xUsd = position.amountX * (tokenX.priceUsd ?? 0);
  const yUsd = position.amountY * (tokenY.priceUsd ?? 0);
  const fxUsd = position.feeX * (tokenX.priceUsd ?? 0);
  const fyUsd = position.feeY * (tokenY.priceUsd ?? 0);

  return (
    <div className="p-4 border-b last:border-b-0">
      {/* Desktop layout */}
      <div className="hidden md:flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            {tokenX.logoUrl && tokenY.logoUrl && (
              <div className="flex -space-x-2 mr-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={tokenX.logoUrl}
                  alt={tokenX.symbol}
                  className="w-8 h-8 rounded-full border-2 border-white object-contain"
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={tokenY.logoUrl}
                  alt={tokenY.symbol}
                  className="w-8 h-8 rounded-full border-2 border-white object-contain"
                />
              </div>
            )}
            <span className="text-lg font-semibold">
              {tokenX.symbol} / {tokenY.symbol}
            </span>
            <TooltipProvider>
              {position.inRange ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="bg-green-500/10 text-green-600 border-green-500/20 text-xs font-normal px-2 py-0.5 h-5 ml-2 cursor-help"
                    >
                      Active
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Active bin is inside your range — position is accruing fees</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="bg-error-muted text-error border-error/20 text-xs font-normal px-2 py-0.5 h-5 ml-2 cursor-help"
                    >
                      Inactive
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Active bin is outside your range — no fees accruing</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-gray-200/60 focus:outline-none transition-colors"
                    onClick={() => setShowPoolDetails(true)}
                    aria-label="Pool details"
                    type="button"
                  >
                    <Info className="w-4 h-4 text-gray-400" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <span>Pool details</span>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="text-xs text-muted-foreground ml-1">
            Range: bin {position.lowerBinId} → {position.upperBinId} · active {pool.activeBinId}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {pool.meta && pool.meta.totalApyPct > 0 && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className={`text-xs font-normal px-2 py-0.5 h-5 cursor-help ${
                        position.inRange
                          ? "bg-green-500/10 text-green-600 border-green-500/20"
                          : "bg-muted text-muted-foreground border-border"
                      }`}
                    >
                      APR: {formatNumber(pool.meta.totalApyPct, 2)}%
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="space-y-1 text-xs">
                      <p className="font-medium">Pool APR</p>
                      <p>24h fee yield: {formatNumber(pool.meta.apr24hPct, 3)}%</p>
                      <p>Annualized (swap): {formatNumber(pool.meta.apyPct, 2)}%</p>
                      {pool.meta.farmApyPct > 0 && (
                        <p>Farm APY: {formatNumber(pool.meta.farmApyPct, 2)}%</p>
                      )}
                      <p className="pt-1 border-t border-border/40 font-semibold">
                        Total: {formatNumber(pool.meta.totalApyPct, 2)}%
                      </p>
                      <p className="text-muted-foreground">TVL: {formatCurrency(pool.meta.tvlUsd, 0)}</p>
                      <p className="text-muted-foreground">
                        24h vol: {formatCurrency(pool.meta.volume24hUsd, 0)}
                      </p>
                      <p className="text-muted-foreground">
                        24h fees: {formatCurrency(pool.meta.fees24hUsd, 0)}
                      </p>
                      {!position.inRange && (
                        <p className="text-orange-500 pt-1">
                          Position is out of range — not currently earning
                        </p>
                      )}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs font-normal px-2 py-0.5 h-5 cursor-help"
                  >
                    Bin {pool.binStep} · Fee {formatNumber(pool.baseFeePct, pool.baseFeePct < 1 ? 2 : 1)}%
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="space-y-1 text-xs">
                    <p className="font-medium">DLMM pool</p>
                    <p>Bin step: {pool.binStep}</p>
                    <p>Base fee: {formatNumber(pool.baseFeePct, 3)}%</p>
                    {pool.pricePerY != null && (
                      <p>
                        Pool price: {formatNumber(pool.pricePerY, 4)} {tokenY.symbol}/{tokenX.symbol}
                      </p>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <span className="text-lg font-bold text-right w-24">{formatCurrency(positionUsd, 2)}</span>
          </div>

          {feesUsd > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="text-sm text-gray-600 cursor-help">
                    💰 Fees: {formatCurrency(feesUsd, 2)}
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="space-y-1 text-xs">
                    <p className="font-medium">Claimable fees</p>
                    {position.feeX > 0 && (
                      <p>
                        {formatNumber(position.feeX, 6)} {tokenX.symbol} · {formatCurrency(fxUsd, 4)}
                      </p>
                    )}
                    {position.feeY > 0 && (
                      <p>
                        {formatNumber(position.feeY, 6)} {tokenY.symbol} · {formatCurrency(fyUsd, 4)}
                      </p>
                    )}
                    <p className="font-semibold pt-1 border-t border-border/40">
                      Total: {formatCurrency(feesUsd, 2)}
                    </p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Liquidity breakdown */}
          <div className="text-xs text-muted-foreground text-right space-y-0.5">
            {position.amountX > 0 && (
              <div>
                {formatNumber(position.amountX, 6)} {tokenX.symbol} · {formatCurrency(xUsd, 2)}
              </div>
            )}
            {position.amountY > 0 && (
              <div>
                {formatNumber(position.amountY, 6)} {tokenY.symbol} · {formatCurrency(yUsd, 2)}
              </div>
            )}
          </div>

          <div className="flex gap-2">
            {feesUsd > 0 && (
              <Button
                size="sm"
                className="h-8 bg-success text-success-foreground hover:bg-success/90"
                onClick={onClaim}
                disabled={!canClaim || isClaiming}
              >
                {isClaiming ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Claiming…
                  </>
                ) : (
                  "Claim"
                )}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-error/30 text-error hover:bg-error/10"
              onClick={onClose}
              disabled={!canClose || isClosing}
            >
              {isClosing ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Closing…
                </>
              ) : (
                "Close"
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => window.open(positionHref, "_blank")}
              aria-label="Open on Meteora"
              title="Open on Meteora"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile layout */}
      <div className="md:hidden space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {tokenX.logoUrl && tokenY.logoUrl && (
              <div className="flex -space-x-2 mr-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={tokenX.logoUrl}
                  alt={tokenX.symbol}
                  className="w-8 h-8 rounded-full border-2 border-white object-contain"
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={tokenY.logoUrl}
                  alt={tokenY.symbol}
                  className="w-8 h-8 rounded-full border-2 border-white object-contain"
                />
              </div>
            )}
            <div className="flex flex-col">
              <span className="text-lg font-semibold">
                {tokenX.symbol} / {tokenY.symbol}
              </span>
              <div className="flex items-center gap-2 mt-1">
                {position.inRange ? (
                  <Badge
                    variant="outline"
                    className="bg-success-muted text-success border-success/20 text-xs font-normal px-2 py-0.5 h-5"
                  >
                    Active
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="bg-error-muted text-error border-error/20 text-xs font-normal px-2 py-0.5 h-5"
                  >
                    Inactive
                  </Badge>
                )}
                <button
                  className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-gray-200/60 focus:outline-none transition-colors"
                  onClick={() => setShowPoolDetails(true)}
                  aria-label="Pool details"
                  type="button"
                >
                  <Info className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </div>
          </div>
          <div className="text-right">
            <span className="text-lg font-bold">{formatCurrency(positionUsd, 2)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs font-normal px-2 py-0.5 h-5"
            >
              Bin {pool.binStep} · Fee {formatNumber(pool.baseFeePct, pool.baseFeePct < 1 ? 2 : 1)}%
            </Badge>
            {pool.meta && pool.meta.totalApyPct > 0 && (
              <Badge
                variant="outline"
                className={`text-xs font-normal px-2 py-0.5 h-5 ${
                  position.inRange
                    ? "bg-green-500/10 text-green-600 border-green-500/20"
                    : "bg-muted text-muted-foreground border-border"
                }`}
              >
                APR: {formatNumber(pool.meta.totalApyPct, 2)}%
              </Badge>
            )}
          </div>
          {feesUsd > 0 && (
            <div className="text-sm text-gray-600">💰 {formatCurrency(feesUsd, 2)}</div>
          )}
        </div>

        <div className="text-xs text-muted-foreground">
          Range: bin {position.lowerBinId} → {position.upperBinId} · active {pool.activeBinId}
        </div>

        <div className="text-xs text-muted-foreground space-y-0.5">
          {position.amountX > 0 && (
            <div>
              {formatNumber(position.amountX, 6)} {tokenX.symbol} · {formatCurrency(xUsd, 2)}
            </div>
          )}
          {position.amountY > 0 && (
            <div>
              {formatNumber(position.amountY, 6)} {tokenY.symbol} · {formatCurrency(yUsd, 2)}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          {feesUsd > 0 && (
            <Button
              size="sm"
              className="flex-1 bg-success text-success-foreground hover:bg-success/90"
              onClick={onClaim}
              disabled={!canClaim || isClaiming}
            >
              {isClaiming ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Claiming…
                </>
              ) : (
                "Claim"
              )}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="flex-1 border-error/30 text-error hover:bg-error/10"
            onClick={onClose}
            disabled={!canClose || isClosing}
          >
            {isClosing ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Closing…
              </>
            ) : (
              "Close"
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => window.open(positionHref, "_blank")}
            aria-label="Open on Meteora"
            title="Open on Meteora"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Price chart with Min/Max bin lines (shared across layouts) */}
      <div className="mt-3">
        <BinChart
          tokenXMint={tokenX.mint}
          tokenXSymbol={tokenX.symbol}
          tokenYSymbol={tokenY.symbol}
          lowerBinPrice={position.lowerBinPrice}
          upperBinPrice={position.upperBinPrice}
          activeBinPrice={position.activeBinPrice}
        />
      </div>

      {showPoolDetails && (
        <PoolDetailsModal pool={pool} onClose={() => setShowPoolDetails(false)} />
      )}
    </div>
  );
});

export function MeteoraPositions() {
  const { protocolsAddress: solanaProtocolsAddress } = useSolanaPortfolio();
  const address = (solanaProtocolsAddress || "").trim();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { publicKey, signTransaction, wallet: solanaWallet } = useSolanaWallet();
  const [claimingKey, setClaimingKey] = useState<string | null>(null);
  const [closingKey, setClosingKey] = useState<string | null>(null);
  const [isClaimingAll, setIsClaimingAll] = useState(false);

  // Match Kamino's wallet-adapter resolution: prefer the adapter's own
  // signTransaction since some wallets leave the hook value stale.
  const adapterSignTransaction =
    typeof (solanaWallet?.adapter as { signTransaction?: unknown } | undefined)?.signTransaction === "function"
      ? ((solanaWallet?.adapter as {
          signTransaction: (t: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>;
        }).signTransaction.bind(solanaWallet?.adapter))
      : undefined;
  const activeSignTransaction = adapterSignTransaction ?? signTransaction;
  const adapterAddress = (solanaWallet?.adapter?.publicKey ?? publicKey)?.toBase58() ?? "";
  const signerAddress = adapterAddress || address;

  // Generic sign-and-send helper, shared by claim and close flows.
  const signAndSubmitArray = useCallback(
    async (transactions: string[]): Promise<string> => {
      if (!activeSignTransaction) throw new Error("Wallet cannot sign");
      let lastSig = "";
      for (const txBase64 of transactions) {
        const raw = Uint8Array.from(atob(txBase64), (c) => c.charCodeAt(0));
        const txForWallet = (() => {
          try {
            return VersionedTransaction.deserialize(raw);
          } catch {
            return Transaction.from(raw);
          }
        })();
        const signed = await activeSignTransaction(txForWallet);
        const sendResp = await fetch("/api/solana/sendRaw", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            txBase64: Buffer.from((signed as Transaction | VersionedTransaction).serialize()).toString("base64"),
          }),
        });
        const sendJson = (await sendResp.json().catch(() => null)) as
          | { success?: boolean; data?: { signature?: string }; error?: string }
          | null;
        if (!sendResp.ok || !sendJson?.success || !sendJson.data?.signature) {
          throw new Error(sendJson?.error || `Send failed: ${sendResp.status}`);
        }
        lastSig = sendJson.data.signature;
      }
      return lastSig;
    },
    [activeSignTransaction]
  );

  const closePositionFlow = useCallback(
    async (pool: MeteoraPool, position: MeteoraPosition) => {
      if (!signerAddress) {
        toast({
          variant: "destructive",
          title: "Wallet required",
          description: "Connect a Solana wallet that owns this position.",
        });
        return;
      }
      if (!activeSignTransaction) {
        toast({
          variant: "destructive",
          title: "Wallet cannot sign",
          description: "This wallet does not support transaction signing.",
        });
        return;
      }
      const confirmed = window.confirm(
        `Close ${pool.tokenX.symbol}/${pool.tokenY.symbol} position?\n\n` +
          `This withdraws 100% of liquidity, claims accrued fees, and closes the position account.`
      );
      if (!confirmed) return;

      const claimKey = `${pool.poolAddress}:${position.positionAddress}`;
      setClosingKey(claimKey);
      try {
        const buildResp = await fetch("/api/protocols/meteora/closePosition", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner: signerAddress,
            poolAddress: pool.poolAddress,
            positionAddress: position.positionAddress,
          }),
        });
        const buildJson = (await buildResp.json().catch(() => null)) as
          | { success?: boolean; data?: { transactions?: string[] }; error?: string }
          | null;
        if (!buildResp.ok || !buildJson?.success || !Array.isArray(buildJson.data?.transactions)) {
          throw new Error(buildJson?.error || `Close build failed: ${buildResp.status}`);
        }

        const lastSig = await signAndSubmitArray(buildJson.data.transactions);
        toast({
          title: "Position closed",
          description: `${pool.tokenX.symbol}/${pool.tokenY.symbol} withdrawn and closed.`,
          action: lastSig ? (
            <ToastAction
              altText="View on Solscan"
              onClick={() => window.open(`https://solscan.io/tx/${lastSig}`, "_blank")}
            >
              View on Solscan
            </ToastAction>
          ) : undefined,
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.protocols.meteora.userPositions(address),
        });
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Close failed",
          description: e instanceof Error ? e.message : "Unknown error",
        });
      } finally {
        setClosingKey(null);
      }
    },
    [activeSignTransaction, address, queryClient, signAndSubmitArray, signerAddress, toast]
  );

  const claimFees = useCallback(
    async (pool: MeteoraPool, position: MeteoraPosition) => {
      if (!signerAddress) {
        toast({
          variant: "destructive",
          title: "Wallet required",
          description: "Connect a Solana wallet that owns these positions.",
        });
        return;
      }
      if (!activeSignTransaction) {
        toast({
          variant: "destructive",
          title: "Wallet cannot sign",
          description: "This wallet does not support transaction signing.",
        });
        return;
      }
      const claimKey = `${pool.poolAddress}:${position.positionAddress}`;
      setClaimingKey(claimKey);
      try {
        const buildResp = await fetch("/api/protocols/meteora/claimFees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner: signerAddress,
            poolAddress: pool.poolAddress,
            positionAddresses: [position.positionAddress],
          }),
        });
        const buildJson = (await buildResp.json().catch(() => null)) as
          | { success?: boolean; data?: { transactions?: string[] }; error?: string }
          | null;
        if (!buildResp.ok || !buildJson?.success || !Array.isArray(buildJson.data?.transactions)) {
          throw new Error(buildJson?.error || `Claim build failed: ${buildResp.status}`);
        }

        // Sign + send each tx sequentially — Meteora's SDK occasionally returns
        // setup/cleanup pairs that must land in order.
        let lastSig = "";
        for (const txBase64 of buildJson.data.transactions) {
          const raw = Uint8Array.from(atob(txBase64), (c) => c.charCodeAt(0));
          const txForWallet = (() => {
            try {
              return VersionedTransaction.deserialize(raw);
            } catch {
              return Transaction.from(raw);
            }
          })();
          const signed = await activeSignTransaction(txForWallet);
          const sendResp = await fetch("/api/solana/sendRaw", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              txBase64: Buffer.from((signed as Transaction | VersionedTransaction).serialize()).toString(
                "base64"
              ),
            }),
          });
          const sendJson = (await sendResp.json().catch(() => null)) as
            | { success?: boolean; data?: { signature?: string }; error?: string }
            | null;
          if (!sendResp.ok || !sendJson?.success || !sendJson.data?.signature) {
            throw new Error(sendJson?.error || `Send failed: ${sendResp.status}`);
          }
          lastSig = sendJson.data.signature;
        }

        toast({
          title: "Fees claimed",
          description: `Claimed ${pool.tokenX.symbol}/${pool.tokenY.symbol} fees.`,
          action: lastSig ? (
            <ToastAction
              altText="View on Solscan"
              onClick={() => window.open(`https://solscan.io/tx/${lastSig}`, "_blank")}
            >
              View on Solscan
            </ToastAction>
          ) : undefined,
        });

        // Force a refetch so the row updates (fees go to wallet, position shows
        // $0 fees) without waiting for the 5-minute staleTime.
        queryClient.invalidateQueries({
          queryKey: queryKeys.protocols.meteora.userPositions(address),
        });
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Claim failed",
          description: e instanceof Error ? e.message : "Unknown error",
        });
      } finally {
        setClaimingKey(null);
      }
    },
    [activeSignTransaction, address, queryClient, signerAddress, toast]
  );

  const claimAllFlow = useCallback(
    async (poolsWithFees: Array<{ poolAddress: string; positionAddresses: string[] }>) => {
      if (!signerAddress) {
        toast({
          variant: "destructive",
          title: "Wallet required",
          description: "Connect a Solana wallet that owns these positions.",
        });
        return;
      }
      if (!activeSignTransaction) {
        toast({
          variant: "destructive",
          title: "Wallet cannot sign",
          description: "This wallet does not support transaction signing.",
        });
        return;
      }
      if (poolsWithFees.length === 0) return;

      setIsClaimingAll(true);
      try {
        const buildResp = await fetch("/api/protocols/meteora/claimAll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ owner: signerAddress, pools: poolsWithFees }),
        });
        const buildJson = (await buildResp.json().catch(() => null)) as
          | { success?: boolean; data?: { transactions?: string[]; txCount?: number; errors?: Array<{ poolAddress: string; error: string }> }; error?: string }
          | null;
        if (!buildResp.ok || !buildJson?.success || !Array.isArray(buildJson.data?.transactions)) {
          throw new Error(buildJson?.error || `Claim build failed: ${buildResp.status}`);
        }

        const lastSig = await signAndSubmitArray(buildJson.data.transactions);
        const partialErrors = buildJson.data.errors ?? [];
        toast({
          title: partialErrors.length > 0 ? "Claimed (partial)" : "Fees claimed",
          description:
            partialErrors.length > 0
              ? `${buildJson.data.txCount} tx submitted, ${partialErrors.length} pool(s) failed to build.`
              : `Claimed fees from ${poolsWithFees.length} pool${poolsWithFees.length === 1 ? "" : "s"}.`,
          action: lastSig ? (
            <ToastAction
              altText="View on Solscan"
              onClick={() => window.open(`https://solscan.io/tx/${lastSig}`, "_blank")}
            >
              View on Solscan
            </ToastAction>
          ) : undefined,
        });
        queryClient.invalidateQueries({
          queryKey: queryKeys.protocols.meteora.userPositions(address),
        });
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Claim All failed",
          description: e instanceof Error ? e.message : "Unknown error",
        });
      } finally {
        setIsClaimingAll(false);
      }
    },
    [activeSignTransaction, address, queryClient, signAndSubmitArray, signerAddress, toast]
  );

  const { data: pools = [], isLoading, isError } = useMeteoraPositions(address, {
    refetchOnMount: "always",
  });

  const flatRows = useMemo(() => {
    const out: Array<{ pool: MeteoraPool; position: MeteoraPosition; value: number }> = [];
    for (const pool of pools) {
      for (const p of pool.positions) {
        out.push({ pool, position: p, value: p.valueUsd });
      }
    }
    return out.sort((a, b) => b.value - a.value);
  }, [pools]);

  const totalDeposit = useMemo(
    () => flatRows.reduce((s, r) => s + r.position.valueUsd, 0),
    [flatRows]
  );

  // Pools with at least one claimable position. Drives the "Claim All Fees"
  // button visibility + which positions get sent to /claimAll.
  const claimablePools = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const { pool, position } of flatRows) {
      if (position.feesUsd <= 0) continue;
      const cur = map.get(pool.poolAddress) ?? [];
      cur.push(position.positionAddress);
      map.set(pool.poolAddress, cur);
    }
    return [...map.entries()].map(([poolAddress, positionAddresses]) => ({
      poolAddress,
      positionAddresses,
    }));
  }, [flatRows]);
  const totalClaimablePositions = useMemo(
    () => claimablePools.reduce((s, p) => s + p.positionAddresses.length, 0),
    [claimablePools]
  );
  const totalFees = useMemo(
    () => flatRows.reduce((s, r) => s + r.position.feesUsd, 0),
    [flatRows]
  );
  const totalValue = totalDeposit + totalFees;

  if (!address) {
    return <div className="py-4 text-muted-foreground">Connect a Solana wallet to view Meteora positions.</div>;
  }
  if (isLoading && flatRows.length === 0) {
    return <div className="py-4 text-muted-foreground">Loading positions…</div>;
  }
  if (isError) {
    return <div className="py-4 text-red-500">Failed to load Meteora positions.</div>;
  }
  if (flatRows.length === 0) {
    return <div className="py-4 text-muted-foreground">No DLMM positions on Meteora.</div>;
  }

  return (
    <div className="w-full mb-6 py-2">
      <div className="space-y-0 text-base">
        {flatRows.map(({ pool, position }) => {
          const rowKey = `${pool.poolAddress}:${position.positionAddress}`;
          const ready = Boolean(signerAddress && activeSignTransaction);
          return (
            <MeteoraPositionRow
              key={`${pool.poolAddress}-${position.positionAddress}`}
              pool={pool}
              position={position}
              canClaim={ready}
              isClaiming={claimingKey === rowKey}
              onClaim={() => void claimFees(pool, position)}
              canClose={ready}
              isClosing={closingKey === rowKey}
              onClose={() => void closePositionFlow(pool, position)}
            />
          );
        })}

        <div className="pt-6 pb-6">
          {/* Desktop */}
          <div className="hidden md:block">
            <div className="flex items-center justify-between">
              <span className="text-xl">Total assets in Meteora:</span>
              <span className="text-xl text-primary font-bold">{formatCurrency(totalValue, 2)}</span>
            </div>
            {totalFees > 0 && (
              <div className="flex justify-end mt-2">
                <div className="text-right space-y-1">
                  <div className="text-sm text-muted-foreground flex items-center gap-1 justify-end">
                    <span>💰</span>
                    <span>including fees {formatCurrency(totalFees, 2)}</span>
                  </div>
                  {totalClaimablePositions > 1 && (
                    <Button
                      size="sm"
                      className="h-8 bg-success text-success-foreground hover:bg-success/90"
                      onClick={() => void claimAllFlow(claimablePools)}
                      disabled={
                        !signerAddress || !activeSignTransaction || isClaimingAll
                      }
                    >
                      {isClaimingAll ? (
                        <>
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          Claiming…
                        </>
                      ) : (
                        <>Claim All Fees ({formatCurrency(totalFees, 2)})</>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Mobile */}
          <div className="md:hidden space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-lg">Total assets in Meteora:</span>
              <span className="text-lg text-primary font-bold">{formatCurrency(totalValue, 2)}</span>
            </div>
            {totalFees > 0 && (
              <div className="space-y-2">
                <div className="text-sm text-muted-foreground flex items-center gap-1">
                  <span>💰</span>
                  <span>including fees {formatCurrency(totalFees, 2)}</span>
                </div>
                {claimablePools.length > 1 && totalClaimablePositions > 1 && (
                  <Button
                    size="sm"
                    className="w-full bg-success text-success-foreground hover:bg-success/90"
                    onClick={() => void claimAllFlow(claimablePools)}
                    disabled={
                      !signerAddress || !activeSignTransaction || isClaimingAll
                    }
                  >
                    {isClaimingAll ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Claiming…
                      </>
                    ) : (
                      <>Claim All Fees ({formatCurrency(totalFees, 2)})</>
                    )}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
