"use client";

import { useMemo, useState } from "react";
import { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle, Copy } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { formatNumber } from "@/lib/utils/numberFormat";
import { formatKaminoRewardUsd, isMeaningfulKaminoRewardUsd } from "@/lib/kamino/kaminoRewardUsd";
import { queryKeys } from "@/lib/query/queryKeys";
import type { KaminoClaimTarget, KaminoRewardRow } from "@/lib/kamino/kaminoClaimTypes";
import { getSolanaRpcEndpoint } from "@/lib/solana/kaminoKvVaultTx";
import {
  isYieldAiNativeAppNow,
  signAndSubmitSolanaTransaction,
} from "@/lib/mobile/nativeBridge";
import { useNativeWalletStore } from "@/lib/stores/nativeWalletStore";

type ClaimResult = {
  targetId: string;
  success: boolean;
  signature?: string;
  error?: string;
};

export type KaminoClaimRewardsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  rewards: KaminoRewardRow[];
  claimTargets: KaminoClaimTarget[];
  signerAddress: string;
  onClaimComplete?: () => void;
};

function decodeTxBase64(transactionBase64: string): Uint8Array {
  const decoded = atob(transactionBase64);
  return Uint8Array.from(decoded, (c) => c.charCodeAt(0));
}

function shortAddress(value: string, head = 6): string {
  const trimmed = value.trim();
  if (!trimmed) return "—";
  if (trimmed.length <= head) return trimmed;
  return `${trimmed.slice(0, head)}…`;
}

function formatClaimTargetLabel(targetId: string): { label: string; copyValue: string } {
  if (targetId.startsWith("vault:")) {
    const address = targetId.slice("vault:".length).trim();
    return {
      label: `Vault ${shortAddress(address)}`,
      copyValue: address,
    };
  }
  if (targetId.startsWith("farm:")) {
    const rest = targetId.slice("farm:".length);
    const colonIdx = rest.indexOf(":");
    const farm = (colonIdx >= 0 ? rest.slice(0, colonIdx) : rest).trim();
    return {
      label: `Farm ${shortAddress(farm)}`,
      copyValue: farm,
    };
  }
  return {
    label: shortAddress(targetId, 12),
    copyValue: targetId,
  };
}

function ClaimResultRow({
  result,
  onCopy,
}: {
  result: ClaimResult;
  onCopy: (value: string) => void;
}) {
  const { label, copyValue } = formatClaimTargetLabel(result.targetId);

  return (
    <div className="flex items-start gap-2 min-w-0">
      {result.success ? (
        <CheckCircle className="w-3.5 h-3.5 text-green-600 shrink-0 mt-0.5" />
      ) : (
        <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 min-w-0">
          <span className="font-medium truncate" title={copyValue}>
            {label}
          </span>
          {copyValue ? (
            <button
              type="button"
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Copy address"
              title="Copy full address"
              onClick={() => onCopy(copyValue)}
            >
              <Copy className="h-3 w-3" />
            </button>
          ) : null}
        </div>
        {result.success && result.signature ? (
          <button
            type="button"
            className="text-primary underline break-all text-left"
            onClick={() => window.open(`https://solscan.io/tx/${result.signature}`, "_blank")}
          >
            View on Solscan
          </button>
        ) : null}
        {!result.success && result.error ? (
          <div className="text-destructive break-words">{result.error}</div>
        ) : null}
      </div>
    </div>
  );
}

export function KaminoClaimRewardsModal({
  isOpen,
  onClose,
  rewards,
  claimTargets,
  signerAddress,
  onClaimComplete,
}: KaminoClaimRewardsModalProps) {
  const { signTransaction, wallet: solanaWallet, connecting: solanaConnecting } = useSolanaWallet();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const injectedSolanaAddress = useNativeWalletStore((s) => s.solanaAddress);

  const [isClaiming, setIsClaiming] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<ClaimResult[]>([]);

  const adapterSignTransaction =
    typeof (solanaWallet?.adapter as { signTransaction?: unknown } | undefined)?.signTransaction === "function"
      ? ((solanaWallet?.adapter as {
          signTransaction: (t: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>;
        }).signTransaction.bind(solanaWallet?.adapter) as (
          t: VersionedTransaction
        ) => Promise<VersionedTransaction>)
      : undefined;
  const activeSignTransaction = adapterSignTransaction ?? signTransaction;

  const trimmedInjected = (injectedSolanaAddress ?? "").trim();
  const nativeFlowActive = isYieldAiNativeAppNow() && !!trimmedInjected;
  const effectiveSigner = (signerAddress || "").trim();

  const actionableTargets = useMemo(
    () => claimTargets.filter((t) => t.source === "vault" || (t.rewards?.length ?? 0) > 0),
    [claimTargets]
  );

  const totalRewardsUsd = useMemo(
    () => rewards.reduce((sum, r) => sum + (typeof r.usdValue === "number" ? r.usdValue : 0), 0),
    [rewards]
  );

  const totalTransactions = actionableTargets.length;
  const progress = totalTransactions > 0 ? ((currentIndex + 1) / totalTransactions) * 100 : 0;

  const submitPreparedTransaction = async (transactionBase64: string): Promise<string> => {
    if (nativeFlowActive) {
      return signAndSubmitSolanaTransaction(transactionBase64);
    }
    if (!activeSignTransaction) {
      throw new Error(solanaConnecting ? "Connecting wallet…" : "Wallet cannot sign transactions");
    }

    const serialized = decodeTxBase64(transactionBase64);
    const txForWallet = (() => {
      try {
        return VersionedTransaction.deserialize(serialized);
      } catch {
        return Transaction.from(serialized);
      }
    })();

    const signed = await activeSignTransaction(txForWallet as VersionedTransaction);
    const sendResp = await fetch("/api/solana/sendRaw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        txBase64: Buffer.from((signed as VersionedTransaction).serialize()).toString("base64"),
      }),
    });
    const sendJson = await sendResp.json().catch(() => null);
    if (!sendResp.ok || !sendJson?.success || !sendJson?.data?.signature) {
      throw new Error(sendJson?.error || `Send failed: ${sendResp.status}`);
    }
    return String(sendJson.data.signature);
  };

  const handleClaimAll = async () => {
    if (!effectiveSigner) {
      toast({
        variant: "destructive",
        title: "Wallet required",
        description: "Connect a Solana wallet that matches your portfolio address.",
      });
      return;
    }
    if (!nativeFlowActive && !activeSignTransaction) {
      toast({
        variant: "destructive",
        title: "Wallet cannot sign",
        description: solanaConnecting ? "Connecting wallet…" : "This wallet cannot sign transactions.",
      });
      return;
    }
    if (actionableTargets.length === 0) {
      toast({
        variant: "destructive",
        title: "Nothing to claim",
        description: "No claimable Kamino rewards found.",
      });
      return;
    }

    setIsClaiming(true);
    setCurrentIndex(0);
    setResults([]);

    const nextResults: ClaimResult[] = [];

    for (let i = 0; i < actionableTargets.length; i++) {
      const target = actionableTargets[i];
      setCurrentIndex(i);

      try {
        const body =
          target.source === "vault"
            ? {
                signer: effectiveSigner,
                source: "vault",
                vaultAddress: target.vaultAddress,
              }
            : {
                signer: effectiveSigner,
                source: "farm",
                farmPubkey: target.farmPubkey,
                isDelegated: target.isDelegated === true,
                delegatees: target.delegatees,
              };

        const txResp = await fetch("/api/protocols/kamino/claimTx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const txData = await txResp.json().catch(() => null);
        if (!txResp.ok || !txData?.success || !txData?.data?.transaction) {
          throw new Error(txData?.error || `Transaction prepare failed: ${txResp.status}`);
        }

        const signature = await submitPreparedTransaction(String(txData.data.transaction));
        nextResults.push({ targetId: target.id, success: true, signature });
        setResults([...nextResults]);
      } catch (error) {
        nextResults.push({
          targetId: target.id,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
        setResults([...nextResults]);
      }

      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    setIsClaiming(false);
    setCurrentIndex(actionableTargets.length);

    const successful = nextResults.filter((r) => r.success).length;
    const failed = nextResults.filter((r) => !r.success).length;

    if (successful > 0) {
      toast({
        title: "Claim completed",
        description: `Successfully claimed ${successful} reward batch${successful === 1 ? "" : "es"}${
          failed > 0 ? `, ${failed} failed` : ""
        }.`,
      });
    } else if (failed > 0) {
      toast({
        variant: "destructive",
        title: "Claim failed",
        description: nextResults[0]?.error || "Could not claim Kamino rewards.",
      });
    }

    queryClient.invalidateQueries({
      queryKey: queryKeys.protocols.kamino.rewards(effectiveSigner),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.protocols.kamino.userPositions(effectiveSigner),
    });
    onClaimComplete?.();
    window.dispatchEvent(new CustomEvent("refreshPositions", { detail: { protocol: "kamino" } }));

    // Touch RPC connection so wallet adapter stays warm (matches earn flow).
    void new Connection(getSolanaRpcEndpoint(), "confirmed");
  };

  const handleClose = () => {
    if (!isClaiming) onClose();
  };

  const copyAddress = async (value: string) => {
    const text = value.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: "Address copied to clipboard." });
    } catch {
      toast({
        variant: "destructive",
        title: "Copy failed",
        description: "Could not copy address to clipboard.",
      });
    }
  };

  const currentTarget = isClaiming ? actionableTargets[currentIndex] : null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md overflow-hidden">
        <DialogHeader>
          <DialogTitle>Claim All Rewards</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 min-w-0 overflow-hidden">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">
              {formatKaminoRewardUsd(totalRewardsUsd > 0 ? totalRewardsUsd : 0)}
            </div>
            <div className="text-sm text-muted-foreground">
              {rewards.length} reward token{rewards.length === 1 ? "" : "s"}
              {totalTransactions > 0 ? ` · ${totalTransactions} transaction${totalTransactions === 1 ? "" : "s"}` : ""}
            </div>

            {rewards.length > 0 && (
              <div className="mt-3 text-left">
                <div className="text-xs font-medium text-muted-foreground mb-2">Rewards breakdown:</div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {rewards.map((reward) => {
                    const sym =
                      (reward.tokenSymbol || "").trim() ||
                      `${reward.tokenMint.slice(0, 4)}...${reward.tokenMint.slice(-4)}`;
                    const amountNum = Number(reward.amount);
                    return (
                      <div key={reward.tokenMint} className="flex items-center justify-between text-xs gap-2">
                        <span className="font-medium truncate">{sym}</span>
                        <span className="text-muted-foreground shrink-0">
                          {Number.isFinite(amountNum) ? formatNumber(amountNum, 6) : reward.amount}
                        </span>
                        {typeof reward.usdValue === "number" && isMeaningfulKaminoRewardUsd(reward.usdValue) ? (
                          <span className="text-green-600 font-medium shrink-0">
                            {formatKaminoRewardUsd(reward.usdValue)}
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {isClaiming && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Claiming rewards…</span>
                <span>
                  {Math.min(currentIndex + 1, totalTransactions)} / {totalTransactions}
                </span>
              </div>
              <Progress value={progress} className="w-full" />
              {currentTarget ? (
                <div className="text-xs text-muted-foreground">
                  {currentTarget.source === "vault"
                    ? `Vault ${(currentTarget.vaultAddress || "").slice(0, 6)}…`
                    : `Farm ${(currentTarget.farmPubkey || "").slice(0, 6)}…`}
                </div>
              ) : null}
            </div>
          )}

          {results.length > 0 && (
            <div className="space-y-2 max-h-28 overflow-y-auto overflow-x-hidden text-xs min-w-0">
              {results.map((result) => (
                <ClaimResultRow key={result.targetId} result={result} onCopy={(v) => void copyAddress(v)} />
              ))}
            </div>
          )}

          {actionableTargets.length === 0 && rewards.length > 0 ? (
            <p className="text-xs text-muted-foreground text-center">
              Rewards are visible, but no claim batches were returned yet. Try refreshing, or connect the
              wallet that owns this address to claim on-chain.
            </p>
          ) : null}

          <div className="flex gap-2 pt-4">
            {!isClaiming && results.length === 0 ? (
              <Button
                className="flex-1 bg-success text-success-foreground hover:bg-success/90"
                onClick={() => void handleClaimAll()}
                disabled={isClaiming || actionableTargets.length === 0 || !effectiveSigner}
              >
                {isClaiming ? "Claiming…" : "Claim All Rewards"}
              </Button>
            ) : null}
            <Button variant="outline" className="flex-1" onClick={handleClose} disabled={isClaiming}>
              {results.length > 0 && !isClaiming ? "Close" : "Cancel"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
