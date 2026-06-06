"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useSolanaWalletResolved } from "@/hooks/useSolanaWalletResolved";
import { Loader2, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import {
  listPendingReclaims,
  executeReclaim,
  RECLAIMABLE_RENT_SOL,
} from "@/lib/bridgeReclaimQueue";

/**
 * Discreet banner offering to reclaim rent stranded by past Solana burns.
 * Batched-mode reclaim handles all but the *last* burn of a session; this
 * button drains that tail in a single standalone transaction.
 */
export function ReclaimBanner() {
  const { publicKey, signTransaction } = useSolanaWalletResolved();
  const { connection } = useConnection();
  const { toast } = useToast();

  const [pendingCount, setPendingCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const walletAddr = publicKey?.toBase58() ?? null;

  const refresh = useCallback(() => {
    setPendingCount(walletAddr ? listPendingReclaims(walletAddr).length : 0);
  }, [walletAddr]);

  useEffect(() => {
    refresh();
    // Re-read the queue when the tab regains focus — the adapter / queue
    // can change while the user is away.
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  // Hide only when there is genuinely nothing queued. If the wallet's
  // signTransaction is momentarily unavailable we still show the banner
  // (button disabled) so the user knows rent is waiting.
  if (!walletAddr || pendingCount === 0) return null;

  const estSol = (pendingCount * RECLAIMABLE_RENT_SOL).toFixed(4);

  const handleReclaim = async () => {
    if (!publicKey || !signTransaction) return;
    setBusy(true);
    try {
      const { count } = await executeReclaim(
        connection,
        publicKey,
        signTransaction,
        () => {},
      );
      toast({
        title: "Rent reclaimed",
        description: `Closed ${count} account${count === 1 ? "" : "s"} · ~${(count * RECLAIMABLE_RENT_SOL).toFixed(4)} SOL returned.`,
      });
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Reclaim failed",
        description: e?.message ?? "Could not reclaim rent.",
      });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <Coins className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-xs text-muted-foreground truncate">
          ≈ <span className="font-medium text-foreground">{estSol} SOL</span> of rent from past bridges can be reclaimed
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 shrink-0 text-xs"
        disabled={busy || !signTransaction}
        title={!signTransaction ? "Connect your Solana wallet to reclaim" : undefined}
        onClick={handleReclaim}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Reclaim"}
      </Button>
    </div>
  );
}
