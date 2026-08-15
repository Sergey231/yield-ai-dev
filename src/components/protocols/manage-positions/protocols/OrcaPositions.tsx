"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  useOrcaPositions,
  type OrcaPosition,
  type OrcaTokenInfo,
} from "@/lib/query/hooks/protocols/orca/useOrcaPositions";
import {
  computeOrcaFeesUsd,
  computeOrcaPrincipalUsd,
} from "@/components/protocols/orca/mapOrcaToProtocolPositions";
import { BinChart } from "@/components/protocols/meteora/BinChart";
import { isLikelySolanaAddress } from "@/lib/kamino/kvaultVaultAddress";

const ORCA_APP_URL = "https://www.orca.so/pools";

function finite(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function shortKey(value?: string): string {
  if (!value) return "";
  if (value.length <= 10) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function TokenIconPair({ tokenA, tokenB }: { tokenA?: OrcaTokenInfo; tokenB?: OrcaTokenInfo }) {
  return (
    <div className="flex -space-x-2 mr-2 shrink-0">
      {tokenA?.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={tokenA.logoUrl}
          alt={tokenA.symbol}
          className="w-8 h-8 rounded-full border-2 border-white object-contain bg-white"
        />
      ) : (
        <div className="w-8 h-8 rounded-full border-2 border-white bg-muted" />
      )}
      {tokenB?.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={tokenB.logoUrl}
          alt={tokenB.symbol}
          className="w-8 h-8 rounded-full border-2 border-white object-contain bg-white"
        />
      ) : (
        <div className="w-8 h-8 rounded-full border-2 border-white bg-muted" />
      )}
    </div>
  );
}

function PoolAprBadge({ position }: { position: OrcaPosition }) {
  const aprPct = finite(position.aprPct);
  const apr24hPct = finite(position.apr24hPct);
  const feeRatePct = finite(position.feeRate) * 100;
  if (!(aprPct > 0)) return null;

  return (
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
            APR: {formatNumber(aprPct, 2)}%
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-1 text-xs">
            <p className="font-medium">Pool APR</p>
            {apr24hPct > 0 ? <p>24h fee yield: {formatNumber(apr24hPct, 3)}%</p> : null}
            <p>Annualized (7d fees/TVL): {formatNumber(aprPct, 2)}%</p>
            {feeRatePct > 0 ? <p>Fee tier: {formatNumber(feeRatePct, 2)}%</p> : null}
            {!position.inRange ? (
              <p className="text-orange-500 pt-1">Position is out of range — not currently earning fees</p>
            ) : null}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function PositionMeta({ position }: { position: OrcaPosition }) {
  const feeRatePct = finite(position.feeRate) * 100;
  const aprPct = finite(position.aprPct);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-gray-200/60 focus:outline-none transition-colors"
            aria-label="Pool details"
            type="button"
          >
            <Info className="w-4 h-4 text-gray-400" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm">
          <div className="space-y-1 text-xs">
            <p className="font-medium">Orca Whirlpool</p>
            <p>Pool: {shortKey(position.poolId)}</p>
            <p>Position: {shortKey(position.positionPda)}</p>
            {position.tickSpacing != null ? <p>Tick spacing: {position.tickSpacing}</p> : null}
            {aprPct > 0 ? <p>Pool APR: {formatNumber(aprPct, 2)}%</p> : null}
            {feeRatePct > 0 ? <p>Fee tier: {formatNumber(feeRatePct, 2)}%</p> : null}
            <p>Claim fees and close are built through Orca Whirlpool SDK helpers.</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface OrcaRowProps {
  position: OrcaPosition;
  canClaim: boolean;
  isClaiming: boolean;
  onClaim: () => void;
  canClose: boolean;
  isClosing: boolean;
  onClose: () => void;
}

const OrcaPositionRow = memo(function OrcaPositionRow({
  position,
  canClaim,
  isClaiming,
  onClaim,
  canClose,
  isClosing,
  onClose,
}: OrcaRowProps) {
  const tokenA = position.tokenA;
  const tokenB = position.tokenB;
  const principalUsd = computeOrcaPrincipalUsd(position);
  const feesUsd = finite(position.unclaimedUsd ?? position.feesUsd);
  const rewardsUsd = finite(position.rewardsUsd);
  const totalUsd = finite(position.valueUsd);
  const amountA = finite(position.amountA ?? tokenA?.amount);
  const amountB = finite(position.amountB ?? tokenB?.amount);
  const feeA = finite(position.feeA);
  const feeB = finite(position.feeB);
  const aUsd = amountA * finite(tokenA?.priceUsd);
  const bUsd = amountB * finite(tokenB?.priceUsd);
  const feeRatePct = finite(position.feeRate) * 100;

  return (
    <div className="p-4 border-b last:border-b-0">
      <div className="hidden md:flex justify-between items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 min-w-0">
            <TokenIconPair tokenA={tokenA} tokenB={tokenB} />
            <span className="text-lg font-semibold truncate">{position.label}</span>
            <Badge
              variant="outline"
              className={
                position.inRange
                  ? "bg-green-500/10 text-green-600 border-green-500/20 text-xs font-normal px-2 py-0.5 h-5"
                  : "bg-error-muted text-error border-error/20 text-xs font-normal px-2 py-0.5 h-5"
              }
            >
              {position.inRange ? "Active" : "Out of range"}
            </Badge>
            <PositionMeta position={position} />
          </div>
          <div className="text-xs text-muted-foreground">
            Whirlpool - pool {shortKey(position.poolId)} - position {shortKey(position.positionPda)}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <PoolAprBadge position={position} />
            {feeRatePct > 0 ? (
              <Badge
                variant="outline"
                className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs font-normal px-2 py-0.5 h-5"
              >
                Fee {formatNumber(feeRatePct, 2)}%
              </Badge>
            ) : null}
            <span className="text-lg font-bold text-right w-24">{formatCurrency(totalUsd, 2)}</span>
          </div>

          {feesUsd > 0 ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="text-sm text-gray-600 cursor-help">
                    Fees: {formatCurrency(feesUsd, 2)}
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="space-y-1 text-xs">
                    {tokenA && feeA > 0 ? <p>{formatNumber(feeA, feeA < 1 ? 6 : 4)} {tokenA.symbol}</p> : null}
                    {tokenB && feeB > 0 ? <p>{formatNumber(feeB, feeB < 1 ? 6 : 4)} {tokenB.symbol}</p> : null}
                    {rewardsUsd > 0 ? <p>Rewards: {formatCurrency(rewardsUsd, 2)}</p> : null}
                    <p className="font-semibold pt-1 border-t border-border/40">
                      Total: {formatCurrency(feesUsd, 2)}
                    </p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}

          <div className="text-xs text-muted-foreground text-right space-y-0.5">
            {tokenA && amountA > 0 ? (
              <div>
                {formatNumber(amountA, amountA < 1 ? 6 : 4)} {tokenA.symbol}
                {aUsd > 0 ? ` - ${formatCurrency(aUsd, 2)}` : ""}
              </div>
            ) : null}
            {tokenB && amountB > 0 ? (
              <div>
                {formatNumber(amountB, amountB < 1 ? 6 : 4)} {tokenB.symbol}
                {bUsd > 0 ? ` - ${formatCurrency(bUsd, 2)}` : ""}
              </div>
            ) : null}
            {principalUsd > 0 ? <div>Liquidity: {formatCurrency(principalUsd, 2)}</div> : null}
          </div>

          <div className="flex gap-2">
            {feesUsd > 0 ? (
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
            ) : null}
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
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => window.open(ORCA_APP_URL, "_blank")}
              aria-label="Open on Orca"
              title="Open on Orca"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="md:hidden space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <TokenIconPair tokenA={tokenA} tokenB={tokenB} />
            <div className="min-w-0">
              <span className="text-lg font-semibold block truncate">{position.label}</span>
              <div className="flex items-center gap-2 mt-1">
                <Badge
                  variant="outline"
                  className={
                    position.inRange
                      ? "bg-success-muted text-success border-success/20 text-xs font-normal px-2 py-0.5 h-5"
                      : "bg-error-muted text-error border-error/20 text-xs font-normal px-2 py-0.5 h-5"
                  }
                >
                  {position.inRange ? "Active" : "Out of range"}
                </Badge>
                <PositionMeta position={position} />
              </div>
            </div>
          </div>
          <span className="text-lg font-bold text-right shrink-0">{formatCurrency(totalUsd, 2)}</span>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <PoolAprBadge position={position} />
            <Badge
              variant="outline"
              className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs font-normal px-2 py-0.5 h-5"
            >
              Whirlpool{feeRatePct > 0 ? ` · Fee ${formatNumber(feeRatePct, 2)}%` : ""}
            </Badge>
          </div>
          {feesUsd > 0 ? <div className="text-sm text-gray-600">{formatCurrency(feesUsd, 2)} yield</div> : null}
        </div>

        <div className="text-xs text-muted-foreground">
          Pool {shortKey(position.poolId)} - position {shortKey(position.positionPda)}
        </div>

        <div className="text-xs text-muted-foreground space-y-0.5">
          {tokenA && amountA > 0 ? (
            <div>
              {formatNumber(amountA, amountA < 1 ? 6 : 4)} {tokenA.symbol}
              {aUsd > 0 ? ` - ${formatCurrency(aUsd, 2)}` : ""}
            </div>
          ) : null}
          {tokenB && amountB > 0 ? (
            <div>
              {formatNumber(amountB, amountB < 1 ? 6 : 4)} {tokenB.symbol}
              {bUsd > 0 ? ` - ${formatCurrency(bUsd, 2)}` : ""}
            </div>
          ) : null}
          {principalUsd > 0 ? <div>Liquidity: {formatCurrency(principalUsd, 2)}</div> : null}
        </div>

        <div className="flex gap-2">
          {feesUsd > 0 ? (
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
          ) : null}
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
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => window.open(ORCA_APP_URL, "_blank")}
            aria-label="Open on Orca"
            title="Open on Orca"
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
            <span className="text-xs text-muted-foreground">Price chart unavailable for this Orca position.</span>
          </div>
        )}
      </div>
    </div>
  );
});

export function OrcaPositions() {
  const { protocolsAddress: solanaProtocolsAddress } = useSolanaPortfolio();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const mockEnabled =
    process.env.NEXT_PUBLIC_KAMINO_REWARDS_MOCK === "1" ||
    process.env.NEXT_PUBLIC_KAMINO_REWARDS_MOCK === "true";

  const address = useMemo(() => {
    if (mockEnabled) {
      const raw = (
        searchParams?.get("orcaAddress") ||
        searchParams?.get("address") ||
        searchParams?.get("solanaAddress") ||
        ""
      ).trim();
      if (raw && isLikelySolanaAddress(raw)) return raw;
    }
    return (solanaProtocolsAddress || "").trim();
  }, [mockEnabled, searchParams, solanaProtocolsAddress]);
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
    async (position: OrcaPosition) => {
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
        const buildResp = await fetch("/api/protocols/orca/claimFees", {
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
          queryKey: queryKeys.protocols.orca.userPositions(address),
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
    async (position: OrcaPosition) => {
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
          "This withdraws 100% of liquidity, claims accrued fees/rewards, and closes the Orca Whirlpool position NFT."
      );
      if (!confirmed) return;

      const rowKey = `${position.poolId}:${position.positionPda || position.nftMint}`;
      setClosingKey(rowKey);
      try {
        const buildResp = await fetch("/api/protocols/orca/closePosition", {
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
          queryKey: queryKeys.protocols.orca.userPositions(address),
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

  const { data: positions = [], isLoading, isError } = useOrcaPositions(address, {
    refetchOnMount: "always",
  });

  const sorted = useMemo(
    () => positions.slice().sort((a, b) => finite(b.valueUsd) - finite(a.valueUsd)),
    [positions]
  );
  const totalDeposit = useMemo(
    () => sorted.reduce((sum, position) => sum + computeOrcaPrincipalUsd(position), 0),
    [sorted]
  );
  const totalFees = useMemo(() => computeOrcaFeesUsd(sorted), [sorted]);
  const totalValue = totalDeposit + totalFees;

  if (!address) {
    return <div className="py-4 text-muted-foreground">Connect a Solana wallet to view Orca positions.</div>;
  }
  if (isLoading && sorted.length === 0) {
    return <div className="py-4 text-muted-foreground">Loading Orca positions...</div>;
  }
  if (isError) {
    return <div className="py-4 text-red-500">Failed to load Orca positions.</div>;
  }
  if (sorted.length === 0) {
    return <div className="py-4 text-muted-foreground">No liquidity positions on Orca.</div>;
  }

  return (
    <div className="w-full mb-6 py-2">
      <div className="space-y-0 text-base">
        {sorted.map((position) => {
          const rowKey = `${position.poolId}:${position.positionPda || position.nftMint}`;
          const ready = Boolean(signerAddress && activeSignTransaction);
          return (
            <OrcaPositionRow
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
              <span className="text-xl">Total assets in Orca:</span>
              <span className="text-xl text-primary font-bold">{formatCurrency(totalValue, 2)}</span>
            </div>
            {totalFees > 0 ? (
              <div className="flex justify-end mt-2">
                <div className="text-right">
                  <div className="text-sm text-muted-foreground flex items-center gap-1 justify-end">
                    <span>including fees {formatCurrency(totalFees, 2)}</span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="md:hidden space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-lg">Total assets in Orca:</span>
              <span className="text-lg text-primary font-bold">{formatCurrency(totalValue, 2)}</span>
            </div>
            {totalFees > 0 ? (
              <div className="text-sm text-muted-foreground">including fees {formatCurrency(totalFees, 2)}</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
