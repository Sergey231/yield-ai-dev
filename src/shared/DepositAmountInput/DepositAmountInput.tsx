"use client";

import * as React from "react";
import type { ComponentPropsWithoutRef } from "react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface DepositAmountInputProps
  extends Omit<ComponentPropsWithoutRef<"div">, "onChange"> {
  tokenLogoUrl: string;
  tokenSymbol: string;
  amountString: string;
  onAmountChange(value: string): void;
  priceUSD: number;
  availableText: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onHalf(): void;
  onMax(): void;
  isOverBalance?: boolean;
}

export interface TokenAmountInputProps extends DepositAmountInputProps {}

export function TokenAmountInput({
  tokenLogoUrl,
  tokenSymbol,
  amountString,
  onAmountChange,
  priceUSD,
  availableText,
  inputRef,
  onHalf,
  onMax,
  isOverBalance = false,
  className,
  ...props
}: TokenAmountInputProps) {
  return (
    <div
      role="presentation"
      onClick={() => inputRef.current?.focus()}
      className={cn(
        "w-full min-w-0 max-w-full cursor-text rounded-2xl border px-2.5 py-2 sm:px-4 sm:py-3 outline-none transition-[color,box-shadow,border-color,background-color]",
        isOverBalance
          ? "border-red-500 hover:border-red-400 hover:bg-red-500/[0.04] focus-within:border-red-500 focus-within:ring-1 focus-within:ring-red-500/12"
          : "border-input hover:border-foreground/20 hover:bg-muted/25 focus-within:border-foreground/14 focus-within:ring-1 focus-within:ring-foreground/6",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <div className="flex h-9 w-9 sm:h-12 sm:w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border">
          <Image
            src={tokenLogoUrl}
            alt={tokenSymbol}
            width={28}
            height={28}
            className="object-contain"
            unoptimized
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col items-stretch gap-1">
          <div className="flex w-full min-w-0 justify-start">
            <Input
              ref={inputRef}
              placeholder="0.00"
              id="amount"
              aria-label={`Deposit amount in ${tokenSymbol}`}
              inputMode="decimal"
              pattern="[0-9]*[.]?[0-9]*"
              value={amountString}
              onChange={(e) => onAmountChange(e.target.value)}
              className={cn(
                "h-auto min-w-0 w-full max-w-full overflow-x-auto rounded-none border-0 bg-transparent px-0 py-0 text-left text-base sm:text-xl leading-none tabular-nums shadow-none dark:bg-transparent",
                "focus-visible:border-transparent focus-visible:ring-0 focus-visible:ring-offset-0",
                "aria-invalid:border-transparent aria-invalid:ring-0 dark:aria-invalid:ring-0"
              )}
            />
          </div>

          <div className="mt-1 flex w-full min-w-0 max-w-full items-center justify-start gap-2 overflow-hidden text-xs sm:text-sm text-muted-foreground">
            <span className="shrink-0">{tokenSymbol}</span>
            <span className="min-w-0 truncate text-left">
              {amountString
                ? `≈ $${(parseFloat(amountString) * priceUSD).toFixed(2)}`
                : "$0"}
            </span>
          </div>
        </div>

        <div className="flex min-w-0 shrink-0 flex-col items-end gap-1.5 sm:gap-2">
          <div className="flex shrink-0 flex-row items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onHalf}
              aria-label="Set half of available amount"
              className="h-auto min-w-[2.5rem] sm:min-w-[3.25rem] shrink-0 px-1 sm:px-2 py-1 text-center text-[10px] sm:text-xs font-normal uppercase leading-none tracking-wide text-foreground border border-transparent shadow-none transition-colors hover:border-border hover:bg-muted/35 focus-visible:ring-1 focus-visible:ring-ring/40"
            >
              Half
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onMax}
              aria-label="Set max amount"
              className="h-auto min-w-[2.5rem] sm:min-w-[3.25rem] shrink-0 px-1 sm:px-2 py-1 text-center text-[10px] sm:text-xs font-normal uppercase leading-none tracking-wide text-foreground border border-transparent shadow-none transition-colors hover:border-border hover:bg-muted/35 focus-visible:ring-1 focus-visible:ring-ring/40"
            >
              Max
            </Button>
          </div>
          <div className="max-w-full truncate text-right text-[10px] sm:text-xs text-muted-foreground">
            Available: {availableText}
          </div>
        </div>
      </div>
    </div>
  );
}

// Backward-compatible export (can be removed after migrating all imports/usages).
export const DepositAmountInput = TokenAmountInput;

