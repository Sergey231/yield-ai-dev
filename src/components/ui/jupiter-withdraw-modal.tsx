"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAmountInput } from "@/hooks/useAmountInput";
import { Loader2 } from "lucide-react";
import { TokenAmountInput } from "@/shared/DepositAmountInput";

interface JupiterWithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (amountUi: number) => void;
  isLoading?: boolean;
  protocol?: {
    name: string;
    logoUrl: string;
  };
  token: {
    symbol: string;
    logoUrl?: string;
    /** Available balance in UI units (underlying token amount for vault withdraw). */
    suppliedAmount: number;
    /** Token decimals for amount input (default 6). */
    decimals?: number;
    /** When set, Withdraw Value row shows USD estimate. */
    priceUsd?: number;
  };
}

function uiAmountToBigInt(value: number, decimals: number): bigint {
  if (!Number.isFinite(value) || value <= 0) return 0n;
  const [intPart, fracPart = ""] = value.toFixed(decimals).split(".");
  const frac = fracPart.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(`${intPart}${frac}`);
}

function formatTokenAmount(value: bigint, valueDecimals: number) {
  if (valueDecimals <= 0) return value.toString();
  const negative = value < 0n;
  const v = negative ? -value : value;
  const s = v.toString();
  const whole = s.length > valueDecimals ? s.slice(0, -valueDecimals) : "0";
  const fracRaw =
    s.length > valueDecimals ? s.slice(-valueDecimals) : s.padStart(valueDecimals, "0");
  const frac = fracRaw.replace(/0+$/, "");
  const out = frac ? `${whole}.${frac}` : whole;
  return negative ? `-${out}` : out;
}

function bigIntToUiAmount(value: bigint, decimals: number): number {
  if (decimals <= 0) return Number(value);
  const s = value.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals) || "0";
  const frac = s.slice(-decimals);
  return Number.parseFloat(`${whole}.${frac}`);
}

/** Withdraw modal UI aligned with Aptos `WithdrawModal`. */
export function JupiterWithdrawModal({
  isOpen,
  onClose,
  onConfirm,
  isLoading = false,
  protocol,
  token,
}: JupiterWithdrawModalProps) {
  const [error, setError] = useState("");
  const amountInputRef = useRef<HTMLInputElement>(null);

  const decimals = token.decimals ?? 6;
  const tokenSymbol = token.symbol;
  const protocolName = protocol?.name ?? "";
  const protocolLogoUrl = protocol?.logoUrl ?? "";
  const priceUSD =
    typeof token.priceUsd === "number" && Number.isFinite(token.priceUsd) ? token.priceUsd : 0;

  const effectiveAvailableBalance = useMemo(
    () => uiAmountToBigInt(token.suppliedAmount, decimals),
    [token.suppliedAmount, decimals],
  );

  const {
    amount,
    amountString,
    setAmountFromString,
    setHalf,
    setMax,
    isValid,
  } = useAmountInput({
    balance: effectiveAvailableBalance,
    decimals,
  });

  useEffect(() => {
    if (isOpen) {
      setMax();
      setError("");
    }
  }, [isOpen, setMax]);

  useEffect(() => {
    if (!isOpen) {
      setError("");
      setAmountFromString("");
    }
  }, [isOpen, setAmountFromString]);

  const withdrawValueUSD =
    priceUSD > 0 && amountString
      ? Number.parseFloat(amountString || "0") * priceUSD
      : 0;

  const handleHalfClick = () => {
    setHalf();
    setError("");
  };

  const handleMaxClick = () => {
    setMax();
    setError("");
  };

  const handleAmountChange = (value: string) => {
    setAmountFromString(value);
    setError("");
  };

  const handleConfirm = () => {
    if (!isValid || amount <= 0n) {
      setError("No amount to withdraw");
      return;
    }
    onConfirm(bigIntToUiAmount(amount, decimals));
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md w-[95vw] max-h-[90vh] overflow-y-auto [&>button:last-child]:right-3 [&>button:last-child]:top-3 [&>button:last-child]:size-7 [&>button:last-child>svg]:size-3.5 sm:[&>button:last-child]:right-6 sm:[&>button:last-child]:top-6 sm:[&>button:last-child]:size-8 sm:[&>button:last-child>svg]:size-4">
        <DialogHeader className="min-w-0 pr-11 sm:pr-12">
          <div className="flex min-w-0 items-center gap-2">
            {protocolLogoUrl ? (
              <Image
                src={protocolLogoUrl}
                alt={protocolName || "Protocol"}
                width={24}
                height={24}
                className="rounded-full object-contain"
                unoptimized
              />
            ) : null}
            <DialogTitle className="min-w-0 truncate text-base sm:text-lg">
              Withdraw {tokenSymbol}
              {protocolName ? ` ${protocolName}` : ""}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <TokenAmountInput
            tokenLogoUrl={token.logoUrl || "/file.svg"}
            tokenSymbol={tokenSymbol}
            amountString={amountString}
            onAmountChange={handleAmountChange}
            priceUSD={Number.isFinite(priceUSD) ? priceUSD : 0}
            availableText={`${formatTokenAmount(effectiveAvailableBalance, decimals)} ${tokenSymbol}`}
            inputRef={amountInputRef}
            onHalf={handleHalfClick}
            onMax={handleMaxClick}
            isOverBalance={amount > effectiveAvailableBalance}
          />

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Available Balance:</span>
              <span>
                {formatTokenAmount(effectiveAvailableBalance, decimals)} {tokenSymbol}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Withdraw Amount:</span>
              <span>
                {formatTokenAmount(amount, decimals)} {tokenSymbol}
              </span>
            </div>
            {withdrawValueUSD > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Withdraw Value:</span>
                <span>${withdrawValueUSD.toFixed(2)}</span>
              </div>
            )}
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <DialogFooter className="gap-2 flex-col sm:flex-row">
          <Button variant="outline" onClick={onClose} disabled={isLoading} className="w-full sm:w-auto h-10">
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isLoading || !isValid || amount <= 0n}
            className="w-full sm:w-auto h-10"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Withdrawing...
              </>
            ) : (
              "Withdraw"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
