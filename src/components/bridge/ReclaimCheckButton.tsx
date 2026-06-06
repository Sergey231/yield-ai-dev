"use client";

import { useState } from "react";
import Link from "next/link";
import { useConnection } from "@solana/wallet-adapter-react";
import { Loader2 } from "lucide-react";
import { useSolanaWalletResolved } from "@/hooks/useSolanaWalletResolved";
import { scanReclaimableAccounts, RECLAIMABLE_RENT_SOL } from "@/lib/bridgeReclaimQueue";

/**
 * Tiny "Check for reclaim" button for the bridge footer. On click it scans the
 * connected Solana wallet on-chain for reclaimable CCTP rent and shows the
 * result inline with a link to the reclaim page.
 */
export function ReclaimCheckButton() {
  const { publicKey } = useSolanaWalletResolved();
  const { connection } = useConnection();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<number | null>(null);

  const handleCheck = async () => {
    if (!publicKey) return;
    setChecking(true);
    setResult(null);
    try {
      const accounts = await scanReclaimableAccounts(connection, publicKey);
      setResult(accounts.length);
    } catch {
      setResult(-1);
    } finally {
      setChecking(false);
    }
  };

  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-1.5">
      <button
        type="button"
        onClick={handleCheck}
        disabled={checking || !publicKey}
        className="rounded border px-1.5 py-0.5 hover:text-foreground disabled:opacity-40"
      >
        {checking ? <Loader2 className="inline h-2.5 w-2.5 animate-spin" /> : "Check for reclaim"}
      </button>
      {result !== null && result > 0 && (
        <Link href="/minting?dest=reclaim" className="text-primary underline">
          {result} account{result === 1 ? "" : "s"} · ≈{(result * RECLAIMABLE_RENT_SOL).toFixed(4)} SOL — reclaim
        </Link>
      )}
      {result === 0 && <span>No reclaimable rent</span>}
      {result === -1 && <span>Check unavailable</span>}
    </span>
  );
}
