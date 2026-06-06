"use client";

import { useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { useSolanaWalletResolved } from "@/hooks/useSolanaWalletResolved";
import { useSolPrice } from "@/hooks/useSolPrice";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ChevronDown, ChevronUp, Coins } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { SolanaWalletSelector } from "@/components/SolanaWalletSelector";
import {
  reclaimByTransaction,
  scanReclaimableAccounts,
  executeReclaimForAccounts,
  RECLAIMABLE_RENT_SOL,
} from "@/lib/bridgeReclaimQueue";

/**
 * Reclaim the ~0.0029 SOL of rent locked by past Solana CCTP burns.
 * Primary flow: scan the connected wallet on-chain for every open MessageSent
 * event account and reclaim them. Fallback: reclaim by a pasted burn signature.
 */
export function ReclaimByTxForm() {
  const { publicKey, signTransaction } = useSolanaWalletResolved();
  const { connection } = useConnection();
  const { toast } = useToast();
  const solPrice = useSolPrice();

  /** "≈ $1.23" suffix for a SOL amount, empty until the price loads. */
  const usd = (sol: number) => (solPrice ? ` (≈ $${(sol * solPrice).toFixed(2)})` : "");

  const [scanned, setScanned] = useState<string[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [resultSig, setResultSig] = useState<string | null>(null);

  const [manualOpen, setManualOpen] = useState(false);
  const [signature, setSignature] = useState("");

  const reset = () => {
    setStatus("");
    setResultSig(null);
  };

  const handleScan = async () => {
    if (!publicKey) {
      toast({ title: "Error", description: "Connect your Solana wallet first", variant: "destructive" });
      return;
    }
    setScanning(true);
    reset();
    try {
      const accounts = await scanReclaimableAccounts(connection, publicKey);
      setScanned(accounts);
      if (accounts.length === 0) setStatus("No reclaimable rent found on this wallet.");
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Scan failed",
        description: e?.message ?? "Could not scan the wallet.",
      });
    } finally {
      setScanning(false);
    }
  };

  const handleReclaimAll = async () => {
    if (!publicKey || !signTransaction || !scanned?.length) return;
    setBusy(true);
    reset();
    try {
      const { signature: sig, count, skipped } = await executeReclaimForAccounts(
        connection,
        publicKey,
        signTransaction,
        scanned,
        setStatus,
      );
      const solAmt = count * RECLAIMABLE_RENT_SOL;
      const sol = solAmt.toFixed(4);
      toast({
        title: "Rent reclaimed",
        description: `Closed ${count} account${count === 1 ? "" : "s"} · ~${sol} SOL${usd(solAmt)} returned.`,
      });
      setStatus(
        `✅ Reclaimed ${count} account${count === 1 ? "" : "s"} · ~${sol} SOL${usd(solAmt)}.` +
          (skipped > 0 ? ` ${skipped} not attested yet — try again in a minute.` : ""),
      );
      setResultSig(sig);
      const remaining = await scanReclaimableAccounts(connection, publicKey).catch(() => null);
      if (remaining) setScanned(remaining);
    } catch (e: any) {
      setStatus(`Error: ${e?.message ?? "Reclaim failed"}`);
      toast({
        variant: "destructive",
        title: "Reclaim failed",
        description: e?.message ?? "Could not reclaim rent.",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleReclaimByTx = async () => {
    if (!signature.trim()) {
      toast({ title: "Error", description: "Enter the Solana burn transaction signature", variant: "destructive" });
      return;
    }
    if (!publicKey || !signTransaction) {
      toast({ title: "Error", description: "Connect the Solana wallet that paid for the burn", variant: "destructive" });
      return;
    }
    setBusy(true);
    reset();
    try {
      const { signature: sig, count } = await reclaimByTransaction(
        connection,
        signature.trim(),
        publicKey,
        signTransaction,
        setStatus,
      );
      const solAmt = count * RECLAIMABLE_RENT_SOL;
      const sol = solAmt.toFixed(4);
      toast({
        title: "Rent reclaimed",
        description: `Closed ${count} account${count === 1 ? "" : "s"} · ~${sol} SOL${usd(solAmt)} returned.`,
      });
      setStatus(`✅ Reclaimed ${count} account${count === 1 ? "" : "s"} · ~${sol} SOL${usd(solAmt)}.`);
      setResultSig(sig);
      setSignature("");
    } catch (e: any) {
      setStatus(`Error: ${e?.message ?? "Reclaim failed"}`);
      toast({ variant: "destructive", title: "Reclaim failed", description: e?.message ?? "Could not reclaim rent." });
    } finally {
      setBusy(false);
    }
  };

  const foundCount = scanned?.length ?? 0;
  const estSol = (foundCount * RECLAIMABLE_RENT_SOL).toFixed(4);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reclaim Solana rent</CardTitle>
        <CardDescription>
          Every Solana CCTP burn locks ~0.0029 SOL of rent in an event account. Scan your
          wallet to find every open account — from any past bridge, to any destination — and
          get the rent back.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-end">
          <SolanaWalletSelector />
        </div>

        {/* Scan flow */}
        <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
          <Button onClick={handleScan} disabled={scanning || busy || !publicKey} variant="outline" className="w-full">
            {scanning ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Scanning wallet…</>
            ) : (
              "Scan my wallet"
            )}
          </Button>

          {scanned !== null && foundCount > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Coins className="h-4 w-4 text-muted-foreground" />
                <span>
                  Found <span className="font-semibold">{foundCount}</span> reclaimable account
                  {foundCount === 1 ? "" : "s"} · ≈{" "}
                  <span className="font-semibold">{estSol} SOL</span>
                  {solPrice ? (
                    <span className="text-success font-semibold">
                      {" "}
                      (≈ ${(foundCount * RECLAIMABLE_RENT_SOL * solPrice).toFixed(2)})
                    </span>
                  ) : null}
                </span>
              </div>
              <Button onClick={handleReclaimAll} disabled={busy || !signTransaction} className="w-full">
                {busy ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{status || "Processing…"}</>
                ) : (
                  `Reclaim ${foundCount > 4 ? "(4 at a time)" : "all"}`
                )}
              </Button>
              {foundCount > 4 && (
                <p className="text-xs text-muted-foreground">
                  Up to 4 accounts are reclaimed per transaction — repeat to drain the rest.
                </p>
              )}
            </div>
          )}
        </div>

        {status && !busy && !scanning && (
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground break-words">{status}</p>
            {resultSig && (
              <a
                href={`https://solscan.io/tx/${resultSig}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline break-all"
              >
                View reclaim transaction on Solscan →
              </a>
            )}
          </div>
        )}

        {/* Manual fallback */}
        <div>
          <button
            type="button"
            onClick={() => setManualOpen((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {manualOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Reclaim by transaction signature
          </button>
          {manualOpen && (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Use this if the scan is unavailable. Paste the Solana burn transaction; connect
                the same wallet that paid for it.
              </p>
              <div className="space-y-2">
                <Label htmlFor="reclaim-sig">Solana burn transaction signature</Label>
                <Input
                  id="reclaim-sig"
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder="5xK7…mN3q"
                  className="font-mono text-sm"
                />
              </div>
              <Button
                onClick={handleReclaimByTx}
                disabled={busy || !signature.trim()}
                variant="outline"
                className="w-full"
              >
                {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing…</> : "Reclaim by signature"}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
