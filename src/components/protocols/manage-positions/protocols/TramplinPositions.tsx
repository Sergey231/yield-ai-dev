"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { ExternalLink, Loader2 } from "lucide-react";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/components/ui/use-toast";
import { useSolanaPortfolio } from "@/hooks/useSolanaPortfolio";
import { useTramplinPositions } from "@/lib/query/hooks/protocols/tramplin/useTramplinPositions";
import { useTramplinRewards } from "@/lib/query/hooks/protocols/tramplin/useTramplinRewards";
import { formatCurrency, formatNumber } from "@/lib/utils/numberFormat";
import {
  isYieldAiNativeAppNow,
  signAndSubmitSolanaTransaction,
} from "@/lib/mobile/nativeBridge";
import { useNativeWalletStore } from "@/lib/stores/nativeWalletStore";
import { JupiterDepositModal } from "@/components/ui/jupiter-deposit-modal";

const TRAMPLIN_APP_URL = "https://tramplin.io";
const SOL_ICON = "/token_ico/sol.png";
const SOL_MINT = "So11111111111111111111111111111111111111112";
/** Tramplin enforces 0.1 SOL as the minimum for non-first deposits. */
const TRAMPLIN_MIN_SUBSEQUENT_STAKE_SOL = 0.1;
/** Leave a little headroom on top of the explicit stake amount for fees + rent overhead. */
const STAKE_HEADROOM_SOL = 0.01;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || "Unknown error";
  if (typeof error === "string") return error;
  return "Unknown error";
}

export function TramplinPositions() {
  const { protocolsAddress: solanaProtocolsAddress, tokens: solanaTokens } = useSolanaPortfolio();
  const ownerAddress = (solanaProtocolsAddress || "").trim();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { publicKey, signTransaction, wallet: solanaWallet, connecting: solanaConnecting } = useSolanaWallet();
  const injectedSolanaAddress = useNativeWalletStore((s) => s.solanaAddress);
  const trimmedInjectedSolanaAddress = (injectedSolanaAddress ?? "").trim();
  const [isClaiming, setIsClaiming] = useState(false);
  const [isStakeModalOpen, setIsStakeModalOpen] = useState(false);
  const [isStaking, setIsStaking] = useState(false);

  const adapterPublicKey = solanaWallet?.adapter?.publicKey ?? null;
  const adapterAddress = adapterPublicKey ? adapterPublicKey.toBase58() : "";
  const hookAddress = publicKey ? publicKey.toBase58() : "";
  const effectiveSignerAddress = adapterAddress || hookAddress || trimmedInjectedSolanaAddress || "";

  const adapterSignTransaction =
    typeof (solanaWallet?.adapter as { signTransaction?: unknown } | undefined)?.signTransaction === "function"
      ? ((solanaWallet?.adapter as {
          signTransaction: (
            t: Transaction | VersionedTransaction,
          ) => Promise<Transaction | VersionedTransaction>;
        }).signTransaction.bind(solanaWallet?.adapter) as (
          t: VersionedTransaction,
        ) => Promise<VersionedTransaction>)
      : undefined;
  const activeSignTransaction = adapterSignTransaction ?? signTransaction;
  const nativeFlowActive = isYieldAiNativeAppNow() && !!trimmedInjectedSolanaAddress;
  const canSubmitTx = !!activeSignTransaction || nativeFlowActive;

  useEffect(() => {
    if (!ownerAddress) return;
    const handleRefresh: EventListener = (evt) => {
      const event = evt as CustomEvent<{ protocol?: string }>;
      if (event?.detail?.protocol !== "tramplin") return;
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.tramplin.userPositions(ownerAddress) });
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.tramplin.rewards(ownerAddress) });
    };
    window.addEventListener("refreshPositions", handleRefresh);
    return () => window.removeEventListener("refreshPositions", handleRefresh);
  }, [ownerAddress, queryClient]);

  const positionsQuery = useTramplinPositions(ownerAddress, { refetchOnMount: "always" });
  const rewardsQuery = useTramplinRewards(ownerAddress, { refetchOnMount: "always" });

  const data = positionsQuery.data ?? null;
  const rewards = useMemo(() => rewardsQuery.data ?? [], [rewardsQuery.data]);

  const totalRewardsUsd = useMemo(
    () =>
      rewards.reduce(
        (sum, r) => sum + (typeof r.usdValue === "number" && Number.isFinite(r.usdValue) ? r.usdValue : 0),
        0,
      ),
    [rewards],
  );

  const hasPosition = Boolean(data?.hasPosition && data.stakeSol > 0);
  const stakeUsd =
    typeof data?.stakeUsd === "number" && Number.isFinite(data.stakeUsd) ? data.stakeUsd : 0;

  const loading = positionsQuery.isLoading || rewardsQuery.isLoading;
  const error = positionsQuery.isError;

  const refreshAfterClaim = useCallback(() => {
    if (!ownerAddress) return;
    // Optimistically clear unclaimed rewards from the cache: the on-chain claim
    // already executed; the Tramplin API may lag a few seconds before its
    // /indexPublicWins?isClaimed=false reflects this. Without the optimistic
    // wipe the UI would re-render with the same "$22.95 unclaimed" after a
    // background refetch and look like the claim did nothing.
    queryClient.setQueryData(queryKeys.protocols.tramplin.rewards(ownerAddress), []);
    queryClient.invalidateQueries({ queryKey: queryKeys.protocols.tramplin.userPositions(ownerAddress) });
    window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "tramplin" } }));
    // Re-pull rewards from the API after a short delay so we eventually sync
    // with the upstream truth (and surface any wins that arrive in the meantime).
    window.setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: queryKeys.protocols.tramplin.rewards(ownerAddress) });
    }, 12_000);
  }, [ownerAddress, queryClient]);

  const runClaim = useCallback(async () => {
    if (!effectiveSignerAddress) {
      toast({
        variant: "destructive",
        title: "Wallet required",
        description: "Connect a Solana wallet that matches your portfolio address.",
      });
      return;
    }
    if (!activeSignTransaction && !nativeFlowActive) {
      toast({
        variant: "destructive",
        title: "Wallet cannot sign",
        description: solanaConnecting ? "Connecting wallet…" : "This wallet cannot sign transactions.",
      });
      return;
    }

    setIsClaiming(true);
    try {
      const txResp = await fetch("/api/protocols/tramplin/claimTx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signer: effectiveSignerAddress }),
      });
      const txJson = (await txResp.json().catch(() => null)) as
        | { success?: boolean; error?: string; data?: { transactions?: Array<{ transaction?: string; instructionCount?: number }>; claimableWins?: number } }
        | null;
      if (!txResp.ok || !txJson?.success) {
        throw new Error(txJson?.error || `Claim prepare failed: ${txResp.status}`);
      }
      const txs = Array.isArray(txJson.data?.transactions) ? txJson.data!.transactions : [];
      if (txs.length === 0) {
        toast({
          title: "Nothing to claim",
          description: "No unclaimed Tramplin winnings found.",
        });
        return;
      }

      const signatures: string[] = [];
      for (const t of txs) {
        const b64 = (t.transaction ?? "").trim();
        if (!b64) continue;

        let sig: string;
        if (nativeFlowActive) {
          sig = await signAndSubmitSolanaTransaction(b64);
        } else {
          const decoded = atob(b64);
          const serialized = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
          const txForWallet = (() => {
            try {
              return VersionedTransaction.deserialize(serialized);
            } catch {
              return Transaction.from(serialized);
            }
          })();

          const signed = await activeSignTransaction!(txForWallet as VersionedTransaction);
          const sendResp = await fetch("/api/solana/sendRaw", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              txBase64: Buffer.from((signed as VersionedTransaction).serialize()).toString("base64"),
            }),
          });
          const sendJson = (await sendResp.json().catch(() => null)) as
            | { success?: boolean; error?: string; data?: { signature?: string } }
            | null;
          if (!sendResp.ok || !sendJson?.success || !sendJson?.data?.signature) {
            throw new Error(sendJson?.error || `Send failed: ${sendResp.status}`);
          }
          sig = String(sendJson.data.signature);
        }
        signatures.push(sig);
      }

      const lastSig = signatures[signatures.length - 1];
      const claimedCount = txJson.data?.claimableWins ?? 0;
      toast({
        title: "Claim submitted",
        description:
          claimedCount > 0
            ? `Claimed ${claimedCount} win${claimedCount === 1 ? "" : "s"} in ${signatures.length} tx${signatures.length === 1 ? "" : "s"}.`
            : `Submitted ${signatures.length} tx${signatures.length === 1 ? "" : "s"}.`,
        action: lastSig ? (
          <ToastAction
            altText="View on Solscan"
            onClick={() => window.open(`https://solscan.io/tx/${lastSig}`, "_blank")}
          >
            View on Solscan
          </ToastAction>
        ) : undefined,
      });

      refreshAfterClaim();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Claim failed",
        description: getErrorMessage(e),
      });
    } finally {
      setIsClaiming(false);
    }
  }, [
    effectiveSignerAddress,
    activeSignTransaction,
    nativeFlowActive,
    solanaConnecting,
    toast,
    refreshAfterClaim,
  ]);

  /** Native-SOL UI balance from the connected wallet, in SOL units. */
  const walletSolAmount = useMemo(() => {
    if (!Array.isArray(solanaTokens)) return 0;
    const tok = solanaTokens.find(
      (t) =>
        (t.address ?? "").trim() === SOL_MINT ||
        (t.symbol ?? "").toUpperCase() === "SOL",
    );
    if (!tok) return 0;
    const raw = Number(tok.amount);
    const decimals = Number(tok.decimals);
    if (!Number.isFinite(raw) || !Number.isFinite(decimals) || decimals < 0) return 0;
    return raw / Math.pow(10, decimals);
  }, [solanaTokens]);

  /**
   * Amount the user is allowed to type into the deposit field. Leave a small
   * SOL buffer for rent of the new stake account (~0.00228 SOL) and a couple
   * of transaction fees so they don't end up overdrafting after click.
   */
  const stakeAvailableSol = useMemo(
    () => Math.max(0, walletSolAmount - STAKE_HEADROOM_SOL),
    [walletSolAmount],
  );

  const refreshAfterStake = useCallback(() => {
    if (!ownerAddress) return;
    // Invalidate but don't optimistically bump stakeSol: the new stake account
    // is in "activating" state and Tramplin's API only counts it after its
    // next snapshot picks it up (and `effectiveStake` only after the activation
    // epoch boundary). Showing the increase prematurely would be misleading.
    queryClient.invalidateQueries({ queryKey: queryKeys.protocols.tramplin.userPositions(ownerAddress) });
    window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "tramplin" } }));
    // Bump the SOL wallet balance shortly after — give the RPC time to settle.
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("solana-portfolio:refresh", { detail: { address: ownerAddress } }));
    }, 3_000);
  }, [ownerAddress, queryClient]);

  const runStake = useCallback(
    async (amountSol: number) => {
      if (!effectiveSignerAddress) {
        toast({
          variant: "destructive",
          title: "Wallet required",
          description: "Connect a Solana wallet that matches your portfolio address.",
        });
        return;
      }
      if (!activeSignTransaction && !nativeFlowActive) {
        toast({
          variant: "destructive",
          title: "Wallet cannot sign",
          description: solanaConnecting ? "Connecting wallet…" : "This wallet cannot sign transactions.",
        });
        return;
      }
      if (!Number.isFinite(amountSol) || amountSol <= 0) {
        toast({ variant: "destructive", title: "Invalid amount", description: "Enter a positive SOL amount." });
        return;
      }
      if (amountSol < TRAMPLIN_MIN_SUBSEQUENT_STAKE_SOL) {
        toast({
          variant: "destructive",
          title: "Below minimum",
          description: `Tramplin requires at least ${TRAMPLIN_MIN_SUBSEQUENT_STAKE_SOL} SOL per stake.`,
        });
        return;
      }
      if (amountSol > stakeAvailableSol) {
        toast({
          variant: "destructive",
          title: "Insufficient balance",
          description: "Not enough SOL after reserving headroom for rent + fees.",
        });
        return;
      }

      setIsStaking(true);
      try {
        const txResp = await fetch("/api/protocols/tramplin/stakeTx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signer: effectiveSignerAddress, amountSol }),
        });
        const txJson = (await txResp.json().catch(() => null)) as
          | { success?: boolean; error?: string; data?: { transaction?: string; stakeAccountAddress?: string } }
          | null;
        if (!txResp.ok || !txJson?.success || !txJson?.data?.transaction) {
          throw new Error(txJson?.error || `Stake prepare failed: ${txResp.status}`);
        }

        const b64 = String(txJson.data.transaction);
        let sig: string;
        if (nativeFlowActive) {
          sig = await signAndSubmitSolanaTransaction(b64);
        } else {
          const decoded = atob(b64);
          const serialized = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
          const txForWallet = VersionedTransaction.deserialize(serialized);
          const signed = await activeSignTransaction!(txForWallet);
          const sendResp = await fetch("/api/solana/sendRaw", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              txBase64: Buffer.from((signed as VersionedTransaction).serialize()).toString("base64"),
            }),
          });
          const sendJson = (await sendResp.json().catch(() => null)) as
            | { success?: boolean; error?: string; data?: { signature?: string } }
            | null;
          if (!sendResp.ok || !sendJson?.success || !sendJson?.data?.signature) {
            throw new Error(sendJson?.error || `Send failed: ${sendResp.status}`);
          }
          sig = String(sendJson.data.signature);
        }

        toast({
          title: "Stake submitted",
          description: `Staked ${amountSol} SOL. The stake activates next epoch and will be picked up by Tramplin after its next snapshot.`,
          action: (
            <ToastAction
              altText="View on Solscan"
              onClick={() => window.open(`https://solscan.io/tx/${sig}`, "_blank")}
            >
              View on Solscan
            </ToastAction>
          ),
        });
        setIsStakeModalOpen(false);
        refreshAfterStake();
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Stake failed",
          description: getErrorMessage(e),
        });
      } finally {
        setIsStaking(false);
      }
    },
    [
      effectiveSignerAddress,
      activeSignTransaction,
      nativeFlowActive,
      solanaConnecting,
      toast,
      stakeAvailableSol,
      refreshAfterStake,
    ],
  );

  if (!ownerAddress) {
    return <div className="py-4 text-muted-foreground">Connect a Solana wallet to view Tramplin staking.</div>;
  }
  if (loading && !data) {
    return <div className="py-4 text-muted-foreground">Loading positions...</div>;
  }
  if (error) {
    return <div className="py-4 text-red-500">Failed to load Tramplin positions</div>;
  }
  if (!hasPosition && rewards.length === 0) {
    return <div className="py-4 text-muted-foreground">No positions on Tramplin.</div>;
  }

  const drawBadges: string[] = [];
  if (data?.drawEligibility?.regular) drawBadges.push("Regular draw");
  if (data?.drawEligibility?.epoch) drawBadges.push("Epoch draw");
  if (data?.drawEligibility?.big) drawBadges.push("Big draw");

  return (
    <div className="w-full min-w-0 max-w-full space-y-4 text-base">
      <ScrollArea className="w-full min-w-0 max-w-full">
        {hasPosition ? (
          <div className="box-border w-full min-w-0 max-w-full overflow-hidden p-3 sm:p-4 border-b">
            {/* Header row: icon + symbol + badge | value + amount */}
            <div className="flex w-full min-w-0 max-w-full items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Image
                  src={SOL_ICON}
                  alt="SOL"
                  width={32}
                  height={32}
                  className="h-8 w-8 shrink-0 rounded-full object-contain"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-lg font-semibold">SOL</div>
                    <Badge
                      variant="outline"
                      className="bg-green-500/10 text-green-600 border-green-500/20 text-xs font-normal px-2 py-0.5 h-5"
                    >
                      Staked
                    </Badge>
                  </div>
                  {/* SOL price shown only on desktop to avoid duplicating value on mobile */}
                  {data?.solPriceUsd != null ? (
                    <div className="hidden sm:block text-sm text-muted-foreground mt-0.5">
                      {formatCurrency(data.solPriceUsd, 2)} / SOL
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="text-right shrink-0">
                {/* Desktop: APR + value on the same row, like Kamino */}
                <div className="hidden sm:flex items-center justify-end gap-2 mb-1">
                  <Badge
                    variant="outline"
                    className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs font-normal px-2 py-0.5 h-5"
                  >
                    APR: {formatNumber(data?.aprPct ?? 0, 2)}%
                  </Badge>
                  <div className="text-lg font-bold">{formatCurrency(stakeUsd, 2)}</div>
                </div>
                <div className="sm:hidden text-lg font-bold">{formatCurrency(stakeUsd, 2)}</div>
                <div className="text-sm text-muted-foreground">
                  {formatNumber(data?.stakeSol ?? 0, 4)} SOL
                </div>
                {/* Desktop: actions live in the right column under the amount,
                    mirroring Kamino/Jupiter layout. Mobile renders them full-width
                    below the stats grid instead. */}
                <div className="hidden sm:flex gap-2 mt-2 justify-end">
                  <Button
                    size="sm"
                    variant="default"
                    className="h-10"
                    onClick={() => setIsStakeModalOpen(true)}
                    disabled={!effectiveSignerAddress || !canSubmitTx || stakeAvailableSol < TRAMPLIN_MIN_SUBSEQUENT_STAKE_SOL}
                  >
                    Stake more SOL
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-10"
                    onClick={() => window.open(TRAMPLIN_APP_URL, "_blank")}
                  >
                    Manage on Tramplin
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Badges row: mobile shows APR + draws; desktop shows only draws */}
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge
                variant="outline"
                className="sm:hidden bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs font-normal px-2 py-0.5 h-5"
              >
                APR: {formatNumber(data?.aprPct ?? 0, 2)}%
              </Badge>
              {drawBadges.map((label) => (
                <Badge
                  key={label}
                  variant="outline"
                  className="bg-purple-500/10 text-purple-600 border-purple-500/20 text-xs font-normal px-2 py-0.5 h-5"
                >
                  {label}
                </Badge>
              ))}
            </div>

            {/* Stats grid */}
            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:max-w-md">
              <span className="text-muted-foreground">Effective stake</span>
              <span className="text-right">
                {formatNumber(data?.effectiveStakeSol ?? 0, 4)} SOL
              </span>
              <span className="text-muted-foreground">Multiplier</span>
              <span className="text-right">
                {formatNumber(data?.multiplier ?? 0, 2)}x
              </span>
              <span className="text-muted-foreground">Points</span>
              <span className="text-right">
                {formatNumber(data?.totalPoints ?? 0, 0)}
              </span>
              {(data?.totalWonSol ?? 0) > 0 ? (
                <>
                  <span className="text-muted-foreground">Total earned</span>
                  <span className="text-right">
                    {formatNumber(data?.totalWonSol ?? 0, 6)} SOL
                    {data?.totalWonUsd != null ? (
                      <span className="ml-1 text-muted-foreground">
                        ({formatCurrency(data.totalWonUsd, 2)})
                      </span>
                    ) : null}
                  </span>
                </>
              ) : null}
            </div>

            {/* Mobile-only action stack: full-width buttons below the stats grid */}
            <div className="sm:hidden mt-4 flex flex-col gap-2">
              <Button
                size="sm"
                variant="default"
                className="h-10 w-full"
                onClick={() => setIsStakeModalOpen(true)}
                disabled={!effectiveSignerAddress || !canSubmitTx || stakeAvailableSol < TRAMPLIN_MIN_SUBSEQUENT_STAKE_SOL}
              >
                Stake more SOL
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-10 w-full"
                onClick={() => window.open(TRAMPLIN_APP_URL, "_blank")}
              >
                Manage on Tramplin
                <ExternalLink className="h-3 w-3 ml-1" />
              </Button>
            </div>
          </div>
        ) : null}
      </ScrollArea>

      <div className="pt-2">
        {rewards.length > 0 ? (
          <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:justify-end">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex w-fit text-gray-500 cursor-help">
                    🎁 Unclaimed winnings: {totalRewardsUsd > 0 ? formatCurrency(totalRewardsUsd, 2) : "-"}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <div className="space-y-1 text-xs max-h-48 overflow-auto">
                    {rewards.map((r) => {
                      const amountNum = Number(r.amount);
                      return (
                        <div key={r.tokenMint} className="flex items-center justify-between gap-3">
                          <span>{r.tokenSymbol}</span>
                          <span className="font-semibold">
                            {Number.isFinite(amountNum) ? formatNumber(amountNum, 6) : r.amount}
                            {r.winCount > 0 ? ` · ${r.winCount} wins` : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button
              size="sm"
              variant="default"
              className="h-9 w-full sm:w-auto"
              onClick={() => void runClaim()}
              disabled={isClaiming || !effectiveSignerAddress || !canSubmitTx}
            >
              {isClaiming ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Claiming…
                </>
              ) : (
                "Claim"
              )}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between pt-4 pb-6">
        <span className="text-xl">Total assets in Tramplin:</span>
        <span className="text-xl text-primary font-bold">
          {formatCurrency(stakeUsd + totalRewardsUsd, 2)}
        </span>
      </div>

      <JupiterDepositModal
        isOpen={isStakeModalOpen}
        onClose={() => (isStaking ? undefined : setIsStakeModalOpen(false))}
        onConfirm={(amountUi) => void runStake(amountUi)}
        isLoading={isStaking}
        title="Stake SOL on Tramplin"
        description={`Min ${TRAMPLIN_MIN_SUBSEQUENT_STAKE_SOL} SOL. Activates next epoch; Tramplin picks it up after its next snapshot.`}
        protocol={{ name: "Tramplin", logoUrl: "/protocol_ico/tramplin.png" }}
        token={{
          symbol: "SOL",
          logoUrl: SOL_ICON,
          availableAmount: stakeAvailableSol,
          apy: data?.aprPct,
          priceUsd: data?.solPriceUsd ?? undefined,
        }}
      />
    </div>
  );
}
