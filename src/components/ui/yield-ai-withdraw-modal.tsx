"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Token } from "@/lib/types/token";
import { APTOS_COIN_TYPE } from "@/lib/constants/yieldAiVault";
import { buildVaultWithdrawPayload } from "@/lib/protocols/yield-ai/vaultDeposit";
import { showTransactionSuccessToast } from "@/components/ui/transaction-toast";
import { useAmountInput } from "@/hooks/useAmountInput";
import { TokenAmountInput } from "@/shared/DepositAmountInput";

/** FA metadata address from token (safe asset_type). APT is not supported for vault::withdraw. */
function getMetadataAddress(token: Token): string | null {
  if (token.address === APTOS_COIN_TYPE || token.address.startsWith("0x1::"))
    return null;
  return token.address.includes("::")
    ? token.address.split("::")[0]
    : token.address;
}

/** Format a raw bigint amount (smallest units) to a decimal string without precision loss. */
function formatTokenAmount(value: bigint, decimals: number): string {
  if (decimals <= 0) return value.toString();
  const negative = value < 0n;
  const v = negative ? -value : value;
  const s = v.toString();
  const whole = s.length > decimals ? s.slice(0, -decimals) : "0";
  const fracRaw =
    s.length > decimals ? s.slice(-decimals) : s.padStart(decimals, "0");
  const frac = fracRaw.replace(/0+$/, "");
  const out = frac ? `${whole}.${frac}` : whole;
  return negative ? `-${out}` : out;
}

interface YieldAIWithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** If provided, called instead of submitting tx (e.g. stub). Otherwise modal submits vault::withdraw. */
  onConfirm?: (amount: bigint) => void | Promise<void>;
  /** Token in the safe to withdraw */
  token: Token | null;
  /** Safe address. Required for real withdraw when onConfirm is not provided. */
  safeAddress?: string;
}

export function YieldAIWithdrawModal({
  isOpen,
  onClose,
  onConfirm,
  token,
  safeAddress,
}: YieldAIWithdrawModalProps) {
  const { signAndSubmitTransaction } = useWallet();
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const amountInputRef = useRef<HTMLInputElement>(null);

  const availableBalance = token ? BigInt(token.amount) : BigInt(0);
  const decimals = token?.decimals ?? 6;

  const {
    amount,
    amountString,
    setAmountFromString,
    setHalf,
    setMax,
    isValid,
  } = useAmountInput({ balance: availableBalance, decimals });

  const priceUSD = token?.price ? parseFloat(token.price) : 0;
  const withdrawValueUSD =
    priceUSD > 0 && amountString
      ? parseFloat(amountString || "0") * priceUSD
      : 0;

  const metadataAddress = token ? getMetadataAddress(token) : null;
  const isApt = token?.address === APTOS_COIN_TYPE;
  const canSubmitTx =
    !!safeAddress && !!metadataAddress && !!signAndSubmitTransaction;

  // Default to max when opening (withdraw all).
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

  const handleAmountChange = (value: string) => {
    setAmountFromString(value);
    setError("");
  };

  const handleHalfClick = () => {
    setHalf();
    setError("");
  };

  const handleMaxClick = () => {
    setMax();
    setError("");
  };

  const handleConfirm = async () => {
    if (!isValid || amount <= BigInt(0)) {
      setError("No amount to withdraw");
      return;
    }
    setError("");
    try {
      setIsLoading(true);
      if (onConfirm) {
        await onConfirm(amount);
        onClose();
        return;
      }
      if (!canSubmitTx || !metadataAddress) {
        setError("Withdraw not supported for this asset");
        return;
      }
      const payload = buildVaultWithdrawPayload({
        safeAddress: safeAddress!,
        metadata: metadataAddress,
        amountBaseUnits: amount,
      });
      const result = await signAndSubmitTransaction({
        data: {
          function: payload.function as `${string}::${string}::${string}`,
          typeArguments: payload.typeArguments,
          functionArguments: payload.functionArguments,
        },
        options: { maxGasAmount: 20000 },
      });
      if (result?.hash) {
        showTransactionSuccessToast({
          hash: result.hash,
          title: "Withdraw from safe successful!",
        });
        window.dispatchEvent(
          new CustomEvent("refreshPositions", { detail: { protocol: "yield-ai" } })
        );
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdraw failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setError("");
    setAmountFromString("");
    onClose();
  };

  if (!token) return null;

  const logoUrl = token.logoUrl;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md w-[95vw] max-h-[90vh] overflow-y-auto [&>button:last-child]:right-3 [&>button:last-child]:top-3 [&>button:last-child]:size-7 [&>button:last-child>svg]:size-3.5 sm:[&>button:last-child]:right-6 sm:[&>button:last-child]:top-6 sm:[&>button:last-child]:size-8 sm:[&>button:last-child>svg]:size-4">
        <DialogHeader className="min-w-0 pr-11 sm:pr-12">
          <div className="flex min-w-0 items-center gap-2">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt={token.symbol}
                width={24}
                height={24}
                className="rounded-full object-contain"
                unoptimized
              />
            ) : (
              <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-semibold">
                {token.symbol.slice(0, 1)}
              </span>
            )}
            <DialogTitle className="min-w-0 truncate text-base sm:text-lg">
              Withdraw {token.symbol}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <TokenAmountInput
            tokenLogoUrl={logoUrl || "/file.svg"}
            tokenSymbol={token.symbol}
            amountString={amountString}
            onAmountChange={handleAmountChange}
            priceUSD={Number.isFinite(priceUSD) ? priceUSD : 0}
            availableText={`${formatTokenAmount(availableBalance, decimals)} ${token.symbol}`}
            inputRef={amountInputRef}
            onHalf={handleHalfClick}
            onMax={handleMaxClick}
            isOverBalance={amount > availableBalance}
          />

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Available Balance:</span>
              <span>
                {formatTokenAmount(availableBalance, decimals)} {token.symbol}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Withdraw Amount:</span>
              <span>
                {formatTokenAmount(amount, decimals)} {token.symbol}
              </span>
            </div>
            {withdrawValueUSD > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Withdraw Value:</span>
                <span>${withdrawValueUSD.toFixed(2)}</span>
              </div>
            )}
          </div>

          {isApt && !onConfirm && (
            <p className="text-sm text-muted-foreground">
              APT withdraw via this flow is not supported. Use FA assets (e.g. USDC).
            </p>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <DialogFooter className="gap-2 flex-col sm:flex-row">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isLoading}
            className="w-full sm:w-auto h-10"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              isLoading ||
              !isValid ||
              amount <= BigInt(0) ||
              (isApt && !onConfirm) ||
              (!onConfirm && !canSubmitTx)
            }
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
