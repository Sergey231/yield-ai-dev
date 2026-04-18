"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAmountInput } from "@/hooks/useAmountInput";
import { Loader2 } from "lucide-react";
import { useDragDrop } from "@/contexts/DragDropContext";
import { TokenAmountInput } from "@/shared/DepositAmountInput";

/** Parse raw token amount (integer string in smallest units) without Number precision loss. */
function parsePositionSupplyToBigInt(
  supply: string | number | bigint | undefined | null
): bigint {
  if (supply === undefined || supply === null) return BigInt(0);
  if (typeof supply === "bigint") return supply >= 0n ? supply : BigInt(0);
  const s = String(supply).trim();
  if (!s || s === "0") return BigInt(0);
  if (/^\d+$/.test(s)) {
    try {
      return BigInt(s);
    } catch {
      return BigInt(0);
    }
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return BigInt(0);
  return BigInt(Math.floor(n));
}

export type WithdrawModalConfirmOptions = {
  /** When true, Moar Market uses on-chain full withdraw (`Option::None`). */
  withdrawFullPosition?: boolean;
};

interface WithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (amount: bigint, options?: WithdrawModalConfirmOptions) => void;
  protocol?: {
    name: string;
    logo: string;
  };
  position: {
    coin: string;
    supply: string;
    market?: string;
  };
  tokenInfo?: {
    symbol: string;
    logoUrl?: string;
    decimals: number;
    usdPrice?: string;
  };
  isLoading?: boolean;
  userAddress?: string;
}

export function WithdrawModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  protocol,
  position, 
  tokenInfo,
  isLoading = false,
  userAddress
}: WithdrawModalProps) {
  const { closeAllModals } = useDragDrop();
  const [error, setError] = useState("");
  const [vaultBalance, setVaultBalance] = useState<bigint>(BigInt(0));
  const [isLoadingVault, setIsLoadingVault] = useState(false);
  const amountInputRef = useRef<HTMLInputElement>(null);

  // Load Echelon vault collateral when `market` is a Move object id (0x...). Skip for Moar (pool id "0"/"1") etc.
  useEffect(() => {
    if (isOpen && userAddress && position.market) {
      if (position.coin && position.coin.startsWith('0x')) {
        console.log('WithdrawModal - AAVE protocol detected, skipping vault data load');
        setIsLoadingVault(false);
        return;
      }
      if (!position.market.startsWith('0x')) {
        setIsLoadingVault(false);
        return;
      }

      loadVaultData();
    } else {
      setIsLoadingVault(false);
    }
  }, [isOpen, userAddress, position.market]);

  const loadVaultData = async () => {
    if (!userAddress || !position.market) return;
    
    setIsLoadingVault(true);
    try {
      const response = await fetch(`/api/protocols/echelon/vault?address=${userAddress}`);
      const data = await response.json();
      
      console.log('WithdrawModal - Vault API response:', data);
      console.log('WithdrawModal - Looking for market:', position.market);
      
      if (data.success && data.data?.data?.collaterals?.data) {
        console.log('WithdrawModal - Collaterals data:', data.data.data.collaterals.data);
        const collateral = data.data.data.collaterals.data.find(
          (item: any) => item.key.inner === position.market
        );
        
        if (collateral) {
          setVaultBalance(BigInt(collateral.value));
          console.log('WithdrawModal - Vault balance for market', position.market, ':', collateral.value);
        } else {
          console.log('WithdrawModal - No collateral found for market:', position.market);
          setVaultBalance(BigInt(0));
        }
      } else {
        console.log('WithdrawModal - Invalid vault data structure:', data);
        setVaultBalance(BigInt(0));
      }
    } catch (error) {
      console.error('WithdrawModal - Error loading vault data:', error);
      setVaultBalance(BigInt(0));
    } finally {
      setIsLoadingVault(false);
    }
  };

  // Available balance from position (raw smallest units). Avoid Number() — loses precision above 2^53-1.
  const availableBalance = parsePositionSupplyToBigInt(position.supply);
  const decimals = tokenInfo?.decimals ?? 8;
  const tokenSymbol = tokenInfo?.symbol ?? "Token";
  const priceUSD = tokenInfo?.usdPrice ? Number.parseFloat(tokenInfo.usdPrice) : 0;
  const protocolName = protocol?.name ?? "";
  const protocolLogoUrl = protocol?.logo ?? "";

  const effectiveAvailableBalance = useMemo(() => {
    if (vaultBalance > 0n) return availableBalance < vaultBalance ? availableBalance : vaultBalance;
    return availableBalance;
  }, [availableBalance, vaultBalance]);

  const formatTokenAmount = (value: bigint, valueDecimals: number) => {
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
  };

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

  console.log('WithdrawModal - Raw data:', {
    positionSupply: position.supply,
    tokenInfoDecimals: tokenInfo?.decimals,
    effectiveAvailableBalance: effectiveAvailableBalance.toString(),
    availableBalance: availableBalance.toString()
  });

  // Default to max when opening (withdraw all).
  useEffect(() => {
    if (isOpen) {
      setMax();
      setError("");
    }
  }, [isOpen, setMax]);

  console.log('WithdrawModal - Debug state:', {
    availableBalance: availableBalance.toString(),
    vaultBalance: vaultBalance.toString(),
    withdrawAmount: amount.toString(),
    isLoading,
    isLoadingVault,
    withdrawAmountValid: amount > 0n
  });

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

    onConfirm(
      amount,
      amount === effectiveAvailableBalance ? { withdrawFullPosition: true } : undefined
    );
  };

  const handleClose = () => {
    setError("");
    onClose();
    closeAllModals();
  };

  // Сбрасываем состояние при открытии/закрытии модального окна
  useEffect(() => {
    if (!isOpen) {
      setError("");
      setAmountFromString("");
    }
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
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
            tokenLogoUrl={tokenInfo?.logoUrl || "/file.svg"}
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
              <span>{formatTokenAmount(effectiveAvailableBalance, decimals)} {tokenSymbol}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Withdraw Amount:</span>
              <span>{formatTokenAmount(amount, decimals)} {tokenSymbol}</span>
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
          <Button variant="outline" onClick={handleClose} disabled={isLoading} className="w-full sm:w-auto h-10">
            Cancel
          </Button>
          <Button 
            onClick={handleConfirm} 
            disabled={isLoading || isLoadingVault || !isValid || amount <= 0n}
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