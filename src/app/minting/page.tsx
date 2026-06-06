"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ArrowLeft, Coins } from "lucide-react";
import { MintAptosForm } from "@/components/minting/MintAptosForm";
import { MintSolanaForm } from "@/components/minting/MintSolanaForm";
import { ReclaimByTxForm } from "@/components/minting/ReclaimByTxForm";
import { SolanaReconnect } from "@/components/minting/SolanaReconnect";
import { ReclaimBanner } from "@/components/bridge/ReclaimBanner";

type MintDest = "aptos" | "solana";
type Mode = MintDest | "reclaim";

/** Guess the destination chain from a CCTP burn signature / params. */
function detectDest(searchParams: URLSearchParams): MintDest {
  const explicit = searchParams.get("dest");
  if (explicit === "aptos" || explicit === "solana") return explicit;

  // sourceDomain: 5 = Solana (→ mint on Aptos), 9 = Aptos (→ mint on Solana)
  const sourceDomain = searchParams.get("sourceDomain");
  if (sourceDomain === "5") return "aptos";
  if (sourceDomain === "9") return "solana";

  // Fallback: an Aptos tx hash is 0x + 64 hex chars → burned on Aptos → mint on Solana
  const sig = searchParams.get("signature")?.trim() ?? "";
  if (/^0x[0-9a-fA-F]{64}$/.test(sig)) return "solana";

  // Default: most bridges are Solana → Aptos
  return "aptos";
}

function MintingContent() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<Mode>("aptos");

  useEffect(() => {
    if (!searchParams) return;
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("dest") === "reclaim") {
      setMode("reclaim");
      return;
    }
    setMode(detectDest(params));
  }, [searchParams]);

  // `skip_auto_connect_solana` is a bridge-internal flag for the derived-wallet
  // juggling on /bridge. It must not leak here — on /minting we always want the
  // connected Solana wallet auto-restored. Clearing it on mount (a child effect,
  // so it runs before SolanaWalletRestore's restore effect) unblocks restore.
  useEffect(() => {
    try {
      window.sessionStorage.removeItem("skip_auto_connect_solana");
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      {/* Reconnect the previously-used Solana wallet on mount */}
      <SolanaReconnect />

      <Link
        href="/bridge"
        className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Bridge
      </Link>

      <div className="mb-4">
        <h1 className="text-xl font-bold">Recover a Bridge / CCTP Minting</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Finish an interrupted bridge by minting USDC on the destination chain from your burn transaction.
        </p>
      </div>

      {/* Reclaim stranded Solana rent from past burns */}
      <div className="mb-4 max-w-xl">
        <ReclaimBanner />
      </div>

      {/* Mode toggle */}
      <div className="mb-4 inline-flex flex-wrap rounded-lg border bg-muted/40 p-1">
        {(["aptos", "solana"] as MintDest[]).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setMode(d)}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
              mode === d
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/chain_ico/${d}2.png`}
              alt={d}
              width={18}
              height={18}
              className="rounded-full"
            />
            Mint on {d === "aptos" ? "Aptos" : "Solana"}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setMode("reclaim")}
          className={cn(
            "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
            mode === "reclaim"
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Coins className="h-[18px] w-[18px]" />
          Reclaim rent
        </button>
      </div>

      {mode === "aptos" && <MintAptosForm />}
      {mode === "solana" && <MintSolanaForm />}
      {mode === "reclaim" && <ReclaimByTxForm />}
    </div>
  );
}

export default function MintingPage() {
  return (
    <Suspense fallback={<div className="container mx-auto p-6 max-w-6xl">Loading…</div>}>
      <MintingContent />
    </Suspense>
  );
}
