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
  useRaydiumPositions,
  type RaydiumPosition,
  type RaydiumTokenInfo,
} from "@/lib/query/hooks/protocols/raydium/useRaydiumPositions";
import {
  computeRaydiumPrincipalUsd,
  computeRaydiumUnclaimedUsd,
  isRaydiumPositionActive,
} from "@/components/protocols/raydium/mapRaydiumToProtocolPositions";
import { BinChart } from "@/components/protocols/meteora/BinChart";

const RAYDIUM_APP_URL = "https://raydium.io/liquidity-pools/";

function finite(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function shortKey(value?: string): string {
  if (!value) return "";
  if (value.length <= 10) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function getTokens(position: RaydiumPosition): [RaydiumTokenInfo | undefined, RaydiumTokenInfo | undefined] {
  if (position.tokenA || position.tokenB) return [position.tokenA, position.tokenB];
  return [position.tokens?.[0], position.tokens?.[1]];
}

function TokenIconPair({ tokenA, tokenB }: { tokenA?: RaydiumTokenInfo; tokenB?: RaydiumTokenInfo }) {
  return (
    <div className="flex -space-x-2 mr-2">
      {tokenA?.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={tokenA.logoUrl}
          alt={tokenA.symbol}
          className="w-8 h-8 rounded-full border-2 border-white object-contain"
        />
      ) : (
        <div className="w-8 h-8 rounded-full border-2 border-white bg-muted" />
      )}
      {tokenB?.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={tokenB.logoUrl}
          alt={tokenB.symbol}
          className="w-8 h-8 rounded-full border-2 border-white object-contain"
        />
      ) : (
        <div className="w-8 h-8 rounded-full border-2 border-white bg-muted" />
      )}
    </div>
  );
}

function PoolDetailsModal({
  position,
  tokenA,
  tokenB,
  onClose,
}: {
  position: RaydiumPosition;
  tokenA?: RaydiumTokenInfo;
  tokenB?: RaydiumTokenInfo;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-zinc-900 rounded-lg p-6 max-w-2xl w-[90vw] max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Pool Details</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">x</button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="font-semibold text-gray-700 dark:text-gray-300">Pair</h3>
              <p className="text-sm">{position.label}</p>
            </div>
            <div>
              <h3 className="font-semibold text-gray-700 dark:text-gray-300">Type</h3>
              <p className="text-sm">{position.type === "clmm-nft" ? "CLMM position NFT" : "LP token"}</p>
            </div>
            {position.apr24h != null ? (
              <div>
                <h3 className="font-semibold text-gray-700 dark:text-gray-300">24h APR</h3>
                <p className="text-sm">{formatNumber(finite(position.apr24h), 2)}%</p>
              </div>
            ) : null}
            {position.tvl != null ? (
              <div>
                <h3 className="font-semibold text-gray-700 dark:text-gray-300">Pool TVL</h3>
                <p className="text-sm">{formatCurrency(finite(position.tvl), 0)}</p>
              </div>
            ) : null}
            <div>
              <h3 className="font-semibold text-gray-700 dark:text-gray-300">Pool address</h3>
              <a
                href={RAYDIUM_APP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono break-all underline-offset-2 hover:underline"
              >
                {position.poolId || "Raydium"}
              </a>
            </div>
            {position.positionPda ? (
              <div>
                <h3 className="font-semibold text-gray-700 dark:text-gray-300">Position account</h3>
                <p className="text-xs font-mono break-all">{position.positionPda}</p>
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-4 pt-2">
            {[tokenA, tokenB].map((token, idx) =>
              token ? (
                <div key={token.mint || idx}>
                  <h3 className="font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Token {idx === 0 ? "A" : "B"}
                  </h3>
                  <div className="bg-gray-50 dark:bg-zinc-800 p-3 rounded flex items-center gap-2">
                    {token.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={token.logoUrl} alt={token.symbol} className="w-8 h-8 rounded-full object-contain" />
                    ) : null}
                    <div className="min-w-0">
                      <div className="font-bold">{token.symbol}</div>
                      <div className="text-xs text-gray-500">Decimals: {token.decimals}</div>
                      <div className="text-xs font-mono break-all">{token.mint}</div>
                    </div>
                  </div>
                </div>
              ) : null
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface RaydiumRowProps {
  position: RaydiumPosition;
  canClaim: boolean;
  isClaiming: boolean;
  onClaim: () => void;
  canClose: boolean;
  isClosing: boolean;
  onClose: () => void;
}

const RaydiumPositionRow = memo(function RaydiumPositionRow({
  position,
  canClaim,
  isClaiming,
  onClaim,
  canClose,
  isClosing,
  onClose,
}: RaydiumRowProps) {
  const [showPoolDetails, setShowPoolDetails] = useState(false);
  const [tokenA, tokenB] = getTokens(position);
  const principalUsd = computeRaydiumPrincipalUsd(position);
  const feesUsd = finite(position.feesUsd);
  const rewardsUsd = finite(position.rewardsUsd);
  const unclaimedUsd = Number.isFinite(position.unclaimedUsd) ? finite(position.unclaimedUsd) : feesUsd + rewardsUsd;
  const totalUsd = finite(position.valueUsd);
  const isActive = isRaydiumPositionActive(position);
  const isClmm = position.type === "clmm-nft";
  const positionHref = RAYDIUM_APP_URL;
  const amountA = finite(position.amountA ?? tokenA?.amount);
  const amountB = finite(position.amountB ?? tokenB?.amount);
  const aUsd = amountA * finite(tokenA?.priceUsd);
  const bUsd = amountB * finite(tokenB?.priceUsd);

  return (
    <div className="p-4 border-b last:border-b-0">
      {/* Desktop layout */}
      <div className="hidden md:flex justify-between items-start">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <TokenIconPair tokenA={tokenA} tokenB={tokenB} />
            <span className="text-lg font-semibold">{position.label}</span>
            <TooltipProvider>
              {isActive ? (
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
                    <p>{isClmm ? "Position has both token sides in range" : "LP token is in the wallet"}</p>
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
                    <p>Position appears to be single-sided or out of range</p>
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
            {isClmm ? "CLMM position" : "LP token"} - pool {shortKey(position.poolId)}
            {position.positionPda ? ` - position ${shortKey(position.positionPda)}` : ""}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {position.apr24h != null && finite(position.apr24h) > 0 && (
              <Badge
                variant="outline"
                className={`text-xs font-normal px-2 py-0.5 h-5 ${
                  isActive
                    ? "bg-green-500/10 text-green-600 border-green-500/20"
                    : "bg-muted text-muted-foreground border-border"
                }`}
              >
                APR: {formatNumber(finite(position.apr24h), 2)}%
              </Badge>
            )}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs font-normal px-2 py-0.5 h-5 cursor-help"
                  >
                    {isClmm ? "CLMM" : "LP"}
                    {position.feeApr24h != null ? ` - Fee APR ${formatNumber(finite(position.feeApr24h), 2)}%` : ""}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="space-y-1 text-xs">
                    <p className="font-medium">Raydium pool</p>
                    <p>Type: {position.poolType || (isClmm ? "CLMM" : "LP")}</p>
                    {position.tvl != null ? <p>TVL: {formatCurrency(finite(position.tvl), 0)}</p> : null}
                    {position.poolPrice != null ? <p>Pool price: {formatNumber(finite(position.poolPrice), 6)}</p> : null}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <span className="text-lg font-bold text-right w-24">{formatCurrency(totalUsd, 2)}</span>
          </div>

          {unclaimedUsd > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="text-sm text-gray-600 cursor-help">
                    Fees: {formatCurrency(unclaimedUsd, 2)}
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="space-y-1 text-xs">
                    <p className="font-medium">Unclaimed value</p>
                    {feesUsd > 0 ? <p>Fees: {formatCurrency(feesUsd, 2)}</p> : null}
                    {rewardsUsd > 0 ? <p>Rewards: {formatCurrency(rewardsUsd, 2)}</p> : null}
                    <p className="font-semibold pt-1 border-t border-border/40">
                      Total: {formatCurrency(unclaimedUsd, 2)}
                    </p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <div className="text-xs text-muted-foreground text-right space-y-0.5">
            {tokenA && amountA > 0 && (
              <div>
                {formatNumber(amountA, amountA < 1 ? 6 : 4)} {tokenA.symbol}
                {aUsd > 0 ? ` - ${formatCurrency(aUsd, 2)}` : ""}
              </div>
            )}
            {tokenB && amountB > 0 && (
              <div>
                {formatNumber(amountB, amountB < 1 ? 6 : 4)} {tokenB.symbol}
                {bUsd > 0 ? ` - ${formatCurrency(bUsd, 2)}` : ""}
              </div>
            )}
            {principalUsd > 0 && <div>Liquidity: {formatCurrency(principalUsd, 2)}</div>}
          </div>

          <div className="flex gap-2">
            {isClmm && unclaimedUsd > 0 && (
              <Button
                size="sm"
                className="h-8 bg-success text-success-foreground hover:bg-success/90"
                onClick={onClaim}
                disabled={!canClaim || isClaiming}
              >
                {isClaiming ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Claiming...
                  </>
                ) : (
                  "Claim"
                )}
              </Button>
            )}
            {isClmm && (
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
                    Closing...
                  </>
                ) : (
                  "Close"
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => window.open(positionHref, "_blank")}
              aria-label="Open on Raydium"
              title="Open on Raydium"
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
            <TokenIconPair tokenA={tokenA} tokenB={tokenB} />
            <div className="flex flex-col">
              <span className="text-lg font-semibold">{position.label}</span>
              <div className="flex items-center gap-2 mt-1">
                <Badge
                  variant="outline"
                  className={
                    isActive
                      ? "bg-success-muted text-success border-success/20 text-xs font-normal px-2 py-0.5 h-5"
                      : "bg-error-muted text-error border-error/20 text-xs font-normal px-2 py-0.5 h-5"
                  }
                >
                  {isActive ? "Active" : "Inactive"}
                </Badge>
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
            <span className="text-lg font-bold">{formatCurrency(totalUsd, 2)}</span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs font-normal px-2 py-0.5 h-5"
            >
              {isClmm ? "CLMM" : "LP"}
            </Badge>
            {position.apr24h != null && finite(position.apr24h) > 0 && (
              <Badge
                variant="outline"
                className={
                  isActive
                    ? "bg-green-500/10 text-green-600 border-green-500/20 text-xs font-normal px-2 py-0.5 h-5"
                    : "bg-muted text-muted-foreground border-border text-xs font-normal px-2 py-0.5 h-5"
                }
              >
                APR: {formatNumber(finite(position.apr24h), 2)}%
              </Badge>
            )}
          </div>
          {unclaimedUsd > 0 && (
            <div className="text-sm text-gray-600">{formatCurrency(unclaimedUsd, 2)} fees</div>
          )}
        </div>

        <div className="text-xs text-muted-foreground">
          {isClmm ? "CLMM position" : "LP token"} - pool {shortKey(position.poolId)}
        </div>

        <div className="text-xs text-muted-foreground space-y-0.5">
          {tokenA && amountA > 0 && (
            <div>
              {formatNumber(amountA, amountA < 1 ? 6 : 4)} {tokenA.symbol}
              {aUsd > 0 ? ` - ${formatCurrency(aUsd, 2)}` : ""}
            </div>
          )}
          {tokenB && amountB > 0 && (
            <div>
              {formatNumber(amountB, amountB < 1 ? 6 : 4)} {tokenB.symbol}
              {bUsd > 0 ? ` - ${formatCurrency(bUsd, 2)}` : ""}
            </div>
          )}
          {principalUsd > 0 && <div>Liquidity: {formatCurrency(principalUsd, 2)}</div>}
        </div>

        <div className="flex gap-2">
          {isClmm && unclaimedUsd > 0 && (
            <Button
              size="sm"
              className="flex-1 bg-success text-success-foreground hover:bg-success/90"
              onClick={onClaim}
              disabled={!canClaim || isClaiming}
            >
              {isClaiming ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Claiming...
                </>
              ) : (
                "Claim"
              )}
            </Button>
          )}
          {isClmm && (
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
                  Closing...
                </>
              ) : (
                "Close"
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => window.open(positionHref, "_blank")}
            aria-label="Open on Raydium"
            title="Open on Raydium"
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-3">
        {tokenA?.mint && tokenA.symbol && tokenB?.symbol ? (
          <BinChart
            tokenXMint={tokenA.mint}
            tokenXSymbol={tokenA.symbol}
            tokenYSymbol={tokenB.symbol}
            lowerBinPrice={position.lowerPrice}
            upperBinPrice={position.upperPrice}
            activeBinPrice={position.poolPrice}
          />
        ) : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Price chart unavailable for this Raydium position.</span>
          </div>
        )}
      </div>

      {showPoolDetails && (
        <PoolDetailsModal
          position={position}
          tokenA={tokenA}
          tokenB={tokenB}
          onClose={() => setShowPoolDetails(false)}
        />
      )}
    </div>
  );
});

export function RaydiumPositions() {
  const { protocolsAddress: solanaProtocolsAddress } = useSolanaPortfolio();
  const address = (solanaProtocolsAddress || "").trim();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { publicKey, signTransaction, wallet: solanaWallet } = useSolanaWallet();
  const [claimingKey, setClaimingKey] = useState<string | null>(null);
  const [closingKey, setClosingKey] = useState<string | null>(null);

  const adapterSignTransaction =
    typeof (solanaWallet?.adapter as { signTransaction?: unknown } | undefined)?.signTransaction === "function"
      ? ((solanaWallet?.adapter as {
          signTransaction: (t: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>;
        }).signTransaction.bind(solanaWallet?.adapter))
      : undefined;
  const activeSignTransaction = adapterSignTransaction ?? signTransaction;
  const adapterAddress = (solanaWallet?.adapter?.publicKey ?? publicKey)?.toBase58() ?? "";
  const signerAddress = adapterAddress || address;

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

  const claimFees = useCallback(
    async (position: RaydiumPosition) => {
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

      const rowKey = `${position.poolId}:${position.positionPda || position.nftMint}`;
      setClaimingKey(rowKey);
      try {
        const buildResp = await fetch("/api/protocols/raydium/claimFees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner: signerAddress,
            poolId: position.poolId,
            positionPda: position.positionPda,
            nftMint: position.nftMint,
          }),
        });
        const buildJson = (await buildResp.json().catch(() => null)) as
          | { success?: boolean; data?: { transactions?: string[] }; error?: string }
          | null;
        if (!buildResp.ok || !buildJson?.success || !Array.isArray(buildJson.data?.transactions)) {
          throw new Error(buildJson?.error || `Claim build failed: ${buildResp.status}`);
        }

        const lastSig = await signAndSubmitArray(buildJson.data.transactions);
        toast({
          title: "Fees claimed",
          description: `Claimed ${position.label} fees and rewards.`,
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
          queryKey: queryKeys.protocols.raydium.userPositions(address),
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
    [activeSignTransaction, address, queryClient, signAndSubmitArray, signerAddress, toast]
  );

  const closePositionFlow = useCallback(
    async (position: RaydiumPosition) => {
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
        `Close ${position.label} position?\n\n` +
          "This withdraws 100% of liquidity, claims accrued fees/rewards, and closes the Raydium CLMM position NFT."
      );
      if (!confirmed) return;

      const rowKey = `${position.poolId}:${position.positionPda || position.nftMint}`;
      setClosingKey(rowKey);
      try {
        const buildResp = await fetch("/api/protocols/raydium/closePosition", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner: signerAddress,
            poolId: position.poolId,
            positionPda: position.positionPda,
            nftMint: position.nftMint,
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
          description: `${position.label} withdrawn and closed.`,
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
          queryKey: queryKeys.protocols.raydium.userPositions(address),
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

  const { data: positions = [], isLoading, isError } = useRaydiumPositions(address, {
    refetchOnMount: "always",
  });

  const sorted = useMemo(
    () => positions.slice().sort((a, b) => finite(b.valueUsd) - finite(a.valueUsd)),
    [positions]
  );
  const totalDeposit = useMemo(
    () => sorted.reduce((sum, position) => sum + computeRaydiumPrincipalUsd(position), 0),
    [sorted]
  );
  const totalUnclaimed = useMemo(() => computeRaydiumUnclaimedUsd(sorted), [sorted]);
  const totalValue = totalDeposit + totalUnclaimed;

  if (!address) {
    return <div className="py-4 text-muted-foreground">Connect a Solana wallet to view Raydium positions.</div>;
  }
  if (isLoading && sorted.length === 0) {
    return <div className="py-4 text-muted-foreground">Loading Raydium positions...</div>;
  }
  if (isError) {
    return <div className="py-4 text-red-500">Failed to load Raydium positions.</div>;
  }
  if (sorted.length === 0) {
    return <div className="py-4 text-muted-foreground">No liquidity positions on Raydium.</div>;
  }

  return (
    <div className="w-full mb-6 py-2">
      <div className="space-y-0 text-base">
        {sorted.map((position) => {
          const rowKey = `${position.poolId}:${position.positionPda || position.nftMint}`;
          const ready = Boolean(signerAddress && activeSignTransaction);
          return (
            <RaydiumPositionRow
              key={position.id}
              position={position}
              canClaim={ready}
              isClaiming={claimingKey === rowKey}
              onClaim={() => void claimFees(position)}
              canClose={ready}
              isClosing={closingKey === rowKey}
              onClose={() => void closePositionFlow(position)}
            />
          );
        })}

        <div className="pt-6 pb-6">
          <div className="hidden md:block">
            <div className="flex items-center justify-between">
              <span className="text-xl">Total assets in Raydium:</span>
              <span className="text-xl text-primary font-bold">{formatCurrency(totalValue, 2)}</span>
            </div>
            {totalUnclaimed > 0 && (
              <div className="flex justify-end mt-2">
                <div className="text-right">
                  <div className="text-sm text-muted-foreground flex items-center gap-1 justify-end">
                    <span>including fees and rewards {formatCurrency(totalUnclaimed, 2)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="md:hidden space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-lg">Total assets in Raydium:</span>
              <span className="text-lg text-primary font-bold">{formatCurrency(totalValue, 2)}</span>
            </div>
            {totalUnclaimed > 0 && (
              <div className="text-sm text-muted-foreground">
                including fees and rewards {formatCurrency(totalUnclaimed, 2)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
