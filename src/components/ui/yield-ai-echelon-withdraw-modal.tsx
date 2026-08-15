"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useAmountInput } from "@/hooks/useAmountInput";
import { TokenAmountInput } from "@/shared/DepositAmountInput";
import type { EchelonModalRow } from "@/lib/query/hooks/protocols/echelon/useEchelonProtocolCardModel";

/**
 * Inputs within this many base units of the supplied balance are treated as a
 * full exit (owner-signed withdraw_all) — same rounding tolerance the regular
 * Echelon withdraw flow uses. Interest accrues between fetch and tx, so an
 * "exact max" partial withdraw would otherwise leave dust behind.
 */
const FULL_WITHDRAW_TOLERANCE = 1000n;

function formatTokenAmount(value: bigint, decimals: number): string {
  if (decimals <= 0) return value.toString();
  const s = value.toString();
  const whole = s.length > decimals ? s.slice(0, -decimals) : "0";
  const fracRaw = s.length > decimals ? s.slice(-decimals) : s.padStart(decimals, "0");
  const frac = fracRaw.replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

interface YieldAiEchelonWithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Echelon supply row inside the AI agent safe. */
  row: EchelonModalRow;
  /** Executor partial withdraw is unavailable while the agent is paused. */
  isPaused: boolean;
  /** Owner-signed full exit needs the resolved Echelon adapter address. */
  adapterReady: boolean;
  adapterError: string | null;
  isLoading: boolean;
  onConfirm: (amountBaseUnits: bigint, isFull: boolean) => void;
}

/**
 * Withdraw-from-Echelon form for the AI agent safe, matching the standard
 * `WithdrawModal` layout. Full amount → owner signs withdraw_all; partial
 * amount → wallet-signed authorization, executor submits.
 */
export function YieldAiEchelonWithdrawModal({
  isOpen,
  onClose,
  row,
  isPaused,
  adapterReady,
  adapterError,
  isLoading,
  onConfirm,
}: YieldAiEchelonWithdrawModalProps) {
  const [error, setError] = useState("");
  const amountInputRef = useRef<HTMLInputElement>(null);

  const balance = (() => {
    try {
      const v = BigInt(row.amountBaseUnits);
      return v > 0n ? v : 0n;
    } catch {
      return 0n;
    }
  })();
  const decimals = row.decimals;
  const humanBalance = Number(balance) / 10 ** decimals;
  const priceUSD =
    humanBalance > 0 && Number.isFinite(row.valueUsd) ? row.valueUsd / humanBalance : 0;

  const { amount, amountString, setAmountFromString, setHalf, setMax, isValid } = useAmountInput({
    balance,
    decimals,
  });

  // Default to max when opening (withdraw all).
  useEffect(() => {
    if (isOpen) {
      setMax();
      setError("");
    }
  }, [isOpen, setMax]);

  const isFull = amount > 0n && amount + FULL_WITHDRAW_TOLERANCE >= balance;
  const withdrawValueUSD =
    priceUSD > 0 && amountString ? Number.parseFloat(amountString || "0") * priceUSD : 0;
  const partialBlockedByPause = !isFull && isPaused;
  const fullBlockedByAdapter = isFull && (!adapterReady || Boolean(adapterError));

  const handleConfirm = () => {
    if (!isValid || amount <= 0n) {
      setError("No amount to withdraw");
      return;
    }
    onConfirm(amount, isFull);
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (isLoading) return;
        if (!open) {
          setError("");
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader className="min-w-0 pr-11 sm:pr-12">
          <DialogTitle className="min-w-0 truncate text-base sm:text-lg">
            Withdraw {row.symbol} to AI agent wallet
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <TokenAmountInput
            tokenLogoUrl={row.tokenLogoUrl || "/file.svg"}
            tokenSymbol={row.symbol}
            amountString={amountString}
            onAmountChange={(value) => {
              setAmountFromString(value);
              setError("");
            }}
            priceUSD={Number.isFinite(priceUSD) ? priceUSD : 0}
            availableText={`${formatTokenAmount(balance, decimals)} ${row.symbol}`}
            inputRef={amountInputRef}
            onHalf={() => {
              setHalf();
              setError("");
            }}
            onMax={() => {
              setMax();
              setError("");
            }}
            isOverBalance={amount > balance}
          />

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Available Balance:</span>
              <span>
                {formatTokenAmount(balance, decimals)} {row.symbol}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Withdraw Amount:</span>
              <span>
                {formatTokenAmount(amount, decimals)} {row.symbol}
              </span>
            </div>
            {withdrawValueUSD > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Withdraw Value:</span>
                <span>${withdrawValueUSD.toFixed(2)}</span>
              </div>
            )}
          </div>

          <div className="space-y-2 text-xs text-muted-foreground">
            <p>
              Funds are withdrawn from Echelon into your AI agent safe. Use Withdraw in the AI
              agent wallet section to send them to your wallet.
            </p>
            {amount > 0n && isValid ? (
              isFull ? (
                <p>
                  Full exit — you sign the transaction with your wallet. Works even while the agent
                  is paused.
                </p>
              ) : (
                <p>
                  Partial withdraw — you authorize it with a wallet signature and the Yield AI
                  executor submits the transaction. While the agent is active, idle funds in the
                  safe may be re-deposited at the next hourly rebalance.
                </p>
              )
            ) : null}
            {partialBlockedByPause ? (
              <p className="text-destructive">
                Agent is paused — partial withdraw via the executor is unavailable. Resume the
                agent or withdraw the full position.
              </p>
            ) : null}
            {fullBlockedByAdapter && adapterError ? (
              <p className="text-destructive">
                Echelon adapter address could not be loaded: {adapterError}
              </p>
            ) : null}
            {error ? <p className="text-red-500 text-sm">{error}</p> : null}
          </div>
        </div>

        <DialogFooter className="gap-2 flex-col sm:flex-row">
          <Button
            variant="outline"
            onClick={() => {
              setError("");
              onClose();
            }}
            disabled={isLoading}
            className="w-full sm:w-auto h-10"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              isLoading || !isValid || amount <= 0n || partialBlockedByPause || fullBlockedByAdapter
            }
            className="w-full sm:w-auto h-10"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Withdrawing...
              </>
            ) : isFull ? (
              "Withdraw all"
            ) : (
              "Withdraw"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
