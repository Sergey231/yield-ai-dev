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
import { Input } from "@/components/ui/input";
import { ChevronDown, Loader2 } from "lucide-react";
import { calcYield } from "@/lib/utils/calcYield";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

function formatDepositAvailableAmount(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  return n
    .toFixed(8)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

interface KaminoVaultDepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (amountUi: number) => void;
  isLoading?: boolean;
  vaultLabel: string;
  token: {
    symbol: string;
    logoUrl?: string;
    availableAmount: number;
    apy?: number;
    priceUsd?: number;
  };
}

export function KaminoVaultDepositModal({
  isOpen,
  onClose,
  onConfirm,
  isLoading = false,
  vaultLabel: _vaultLabel,
  token,
}: KaminoVaultDepositModalProps) {
  const [amount, setAmount] = useState("");
  const [isYieldExpanded, setIsYieldExpanded] = useState(false);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const amountUi = Number(amount);
  const isValid = Number.isFinite(amountUi) && amountUi > 0;
  const exceeds = isValid && amountUi > token.availableAmount;

  useEffect(() => {
    if (!isOpen) {
      setAmount("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (token.availableAmount > 0) {
      setAmount(String(token.availableAmount));
    } else {
      setAmount("");
    }
  }, [isOpen, token.availableAmount]);

  const yieldResult = useMemo(() => {
    if (!token.apy || token.apy <= 0 || !isValid) {
      return { daily: 0, weekly: 0, monthly: 0, yearly: 0 };
    }
    const scaled = BigInt(Math.floor(amountUi * 1_000_000));
    return calcYield(token.apy, scaled, 6);
  }, [amountUi, isValid, token.apy]);

  const usdApproxDisplay = useMemo(() => {
    const parsed = Number(amount);
    if (!amount.trim() || !Number.isFinite(parsed) || !token.priceUsd || token.priceUsd <= 0) {
      return "0.00";
    }
    return (parsed * token.priceUsd).toFixed(2);
  }, [amount, token.priceUsd]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="w-full min-w-0 max-w-[min(100vw-2rem,425px)] overflow-x-hidden rounded-2xl p-6 sm:max-w-[425px] [&>button:last-child]:right-5 [&>button:last-child]:top-5 [&>button:last-child]:size-7 [&>button:last-child>svg]:size-3.5 [&>button:last-child]:transition-colors [&>button:last-child]:hover:bg-muted/40">
        <DialogHeader className="min-w-0 pr-11 sm:pr-12">
          <div className="flex min-w-0 items-center gap-2">
            <Image
              src="/protocol_ico/kamino.png"
              alt="Kamino"
              width={24}
              height={24}
              className="rounded-full"
              unoptimized
            />
            <DialogTitle className="min-w-0 truncate">Deposit to {token.symbol} Kamino</DialogTitle>
          </div>
        </DialogHeader>

        <div className="grid min-w-0 gap-4 py-4">
          <div>
            <div
              role="presentation"
              onClick={() => amountInputRef.current?.focus()}
              className={cn(
                "w-full min-w-0 max-w-full cursor-text rounded-2xl border px-4 py-3 outline-none transition-[color,box-shadow,border-color,background-color]",
                exceeds
                  ? "border-red-500 hover:border-red-400 hover:bg-red-500/[0.04] focus-within:border-red-500 focus-within:ring-1 focus-within:ring-red-500/12"
                  : "border-input hover:border-foreground/20 hover:bg-muted/25 focus-within:border-foreground/14 focus-within:ring-1 focus-within:ring-foreground/6",
              )}
              style={{ maxWidth: "380px" }}
            >
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border">
                  <Image
                    src={token.logoUrl || "/file.svg"}
                    alt={token.symbol}
                    width={34}
                    height={34}
                    className="object-contain"
                    unoptimized
                  />
                </div>

                <div className="flex min-w-0 flex-1 flex-col items-stretch gap-1">
                  <div className="flex w-full min-w-0 justify-start">
                    <Input
                      ref={amountInputRef}
                      placeholder="0"
                      id="kamino-vault-deposit-amount"
                      aria-label={`Deposit amount in ${token.symbol}`}
                      inputMode="decimal"
                      pattern="[0-9]*[.]?[0-9]*"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      disabled={isLoading}
                      className={cn(
                        "h-auto min-w-0 w-full max-w-full overflow-x-auto rounded-none border-0 bg-transparent px-0 py-0 text-left text-xl leading-none tabular-nums shadow-none dark:bg-transparent md:text-xl",
                        "focus-visible:border-transparent focus-visible:ring-0 focus-visible:ring-offset-0",
                        "aria-invalid:border-transparent aria-invalid:ring-0 dark:aria-invalid:ring-0",
                      )}
                    />
                  </div>

                  <div className="mt-1 flex w-full min-w-0 max-w-full items-center justify-start gap-2 overflow-hidden text-sm text-muted-foreground">
                    <span className="shrink-0">{token.symbol}</span>
                    <span className="min-w-0 truncate text-left">{`\u2248 $${usdApproxDisplay}`}</span>
                  </div>
                </div>

                <div className="flex min-w-0 shrink-0 flex-col items-end gap-2">
                  <div className="flex shrink-0 flex-row items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setAmount(String(token.availableAmount / 2))}
                      aria-label="Set half of available amount"
                      disabled={isLoading}
                      className="h-auto min-w-[3.25rem] shrink-0 px-2 py-1 text-center text-xs font-normal uppercase leading-none tracking-wide text-foreground border border-transparent shadow-none transition-colors hover:border-border hover:bg-muted/35 focus-visible:ring-1 focus-visible:ring-ring/40"
                    >
                      Half
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setAmount(String(token.availableAmount))}
                      aria-label="Set max amount"
                      disabled={isLoading}
                      className="h-auto min-w-[3.25rem] shrink-0 px-2 py-1 text-center text-xs font-normal uppercase leading-none tracking-wide text-foreground border border-transparent shadow-none transition-colors hover:border-border hover:bg-muted/35 focus-visible:ring-1 focus-visible:ring-ring/40"
                    >
                      Max
                    </Button>
                  </div>
                  <div className="max-w-full truncate text-right text-xs text-muted-foreground">
                    Available: {formatDepositAvailableAmount(token.availableAmount)} {token.symbol}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {exceeds ? (
            <p className="mt-1 flex min-w-0 items-center justify-between text-sm text-red-500">
              Amount exceeds available balance.
            </p>
          ) : null}

          <div
            className="flex min-w-0 cursor-pointer flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
            onClick={() => setIsYieldExpanded((v) => !v)}
          >
            <div className="min-w-0 shrink-0 text-sm text-muted-foreground">APR {(token.apy || 0).toFixed(2)}%</div>
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate text-sm font-semibold tabular-nums">≈ ${yieldResult.daily.toFixed(2)}</span>
              <span className="shrink-0 text-xs text-muted-foreground">/day</span>
              <ChevronDown className="ml-1 size-3 shrink-0 text-muted-foreground" />
            </div>
          </div>
          {isYieldExpanded ? (
            <div className="min-w-0 space-y-1 break-words text-sm text-muted-foreground">
              <div className="min-w-0 break-words">≈ ${yieldResult.weekly.toFixed(2)} /week</div>
              <div className="min-w-0 break-words">≈ ${yieldResult.monthly.toFixed(2)} /month</div>
              <div className="min-w-0 break-words">≈ ${yieldResult.yearly.toFixed(2)} /year</div>
            </div>
          ) : null}
        </div>

        <Separator />

        <DialogFooter className="gap-2 flex-col sm:flex-row">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(amountUi)} disabled={!isValid || exceeds || isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              "Deposit"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
