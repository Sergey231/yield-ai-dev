"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Image from "next/image";
import { ChevronDown, ArrowLeftRight } from "lucide-react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { showTransactionSuccessToast } from "@/components/ui/transaction-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAmountInput } from "@/hooks/useAmountInput";
import { calcYield } from "@/lib/utils/calcYield";
import { useWalletData } from '@/contexts/WalletContext';
import { Token } from '@/lib/types/panora';
import tokenList from "@/lib/data/tokenList.json";
import { useDeposit } from "@/lib/hooks/useDeposit";
import { ProtocolKey } from "@/lib/transactions/types";
import type { ExecuteDepositOptions } from "@/lib/transactions/DepositTransaction";
import { Loader2 } from "lucide-react";
import { SwapAndDepositModal } from "./swap-and-deposit-modal";
import { cn } from "@/lib/utils";
import { TokenAmountInput } from "@/shared/DepositAmountInput";

interface DepositModalProps {
  isOpen: boolean;
  onClose(): void;
  protocol: {
    name: string;
    logo: string;
    apy: number;
    key: ProtocolKey;
  };
  tokenIn: {
    symbol: string;
    logo: string;
    decimals: number;
    address: string;
  };
  tokenOut: {
    symbol: string;
    logo: string;
    decimals: number;
    address?: string;
  };
  priceUSD: number;
  poolAddress?: string;
  /** When depositing into the Yield AI vault (`protocol.key === 'yield-ai'`). */
  yieldAiSafeAddress?: string;
}

const MIN_DEPOSIT_YIELD_AI_USDC = 0.1;

export function DepositModal({
  isOpen,
  onClose,
  protocol,
  tokenIn,
  tokenOut,
  priceUSD,
  poolAddress,
  yieldAiSafeAddress,
}: DepositModalProps) {
  const { tokens, refreshPortfolio } = useWalletData();
  const [isLoading, setIsLoading] = useState(false);
  const { deposit, isLoading: isDepositLoading } = useDeposit();
  const [isYieldExpanded, setIsYieldExpanded] = useState(false);
  const [isSwapModalOpen, setIsSwapModalOpen] = useState(false);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const { account, signAndSubmitTransaction } = useWallet();

  const [resolvedTokenIn, setResolvedTokenIn] = useState(tokenIn);
  const [resolvedPriceUSD, setResolvedPriceUSD] = useState(priceUSD);

  // For Echelon deposits (e.g. DLP) tokenList.json may not contain the token.
  // Resolve metadata for UI (logo/symbol/decimals/price) from the universal token API.
  useEffect(() => {
    if (!isOpen) return;
    if (protocol.key !== 'echelon') return;
    if (!tokenIn?.address) return;

    // If logo is already resolved (not placeholder), don't fetch.
    if (tokenIn.logo && tokenIn.logo !== '/file.svg') {
      setResolvedTokenIn(tokenIn);
      setResolvedPriceUSD(priceUSD);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tokens/info?address=${encodeURIComponent(tokenIn.address)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data?.success || !data?.data) return;
        const d = data.data;
        if (cancelled) return;
        setResolvedTokenIn({
          symbol: d.symbol ?? tokenIn.symbol,
          logo: d.logoUrl ?? tokenIn.logo ?? '/file.svg',
          decimals: typeof d.decimals === 'number' ? d.decimals : tokenIn.decimals,
          address: tokenIn.address,
        });
        setResolvedPriceUSD(typeof d.price === 'number' ? d.price : (priceUSD || 0));
      } catch {
        // Ignore; modal will use fallback props.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, protocol.key, tokenIn?.address, tokenIn?.logo, tokenIn?.decimals, priceUSD]);

  // Получаем информацию о токене из списка токенов
  const getTokenInfo = (address: string): Token | undefined => {
    // Normalize addresses by removing leading zeros after 0x
    const normalizeAddress = (addr: string) => {
      if (!addr || !addr.startsWith('0x')) return addr;
      return '0x' + addr.slice(2).replace(/^0+/, '') || '0x0';
    };

    const normalizedAddress = normalizeAddress(address);

    return (tokenList.data.data as Token[]).find(token => {
      const normalizedTokenAddress = normalizeAddress(token.tokenAddress || '');
      const normalizedFaAddress = normalizeAddress(token.faAddress || '');

      return normalizedTokenAddress === normalizedAddress ||
             normalizedFaAddress === normalizedAddress;
    });
  };

  // Находим текущий токен в кошельке по адресу
  const currentToken = useMemo(() => {
    const normalizeAddress = (addr: string) => {
      if (!addr || !addr.startsWith('0x')) return addr;
      return '0x' + addr.slice(2).replace(/^0+/, '') || '0x0';
    };

    const normalizedTokenInAddress = normalizeAddress(tokenIn.address);

    // 1) Fast path: match by address directly (works even if tokenList doesn't contain the token)
    const directMatch = tokens?.find(t => normalizeAddress(t.address) === normalizedTokenInAddress);
    if (directMatch) return directMatch;

    // 2) Fallback: match via tokenList tokenAddress/faAddress mapping
    return tokens?.find(t => {
      const tokenInfo = getTokenInfo(t.address);
      if (!tokenInfo) return false;

      const normalizedTokenInfoAddress = normalizeAddress(tokenInfo.tokenAddress || '');
      const normalizedFaAddress = normalizeAddress(tokenInfo.faAddress || '');

      return normalizedTokenInfoAddress === normalizedTokenInAddress ||
        normalizedFaAddress === normalizedTokenInAddress;
    });
  }, [tokens, tokenIn.address]);

  // Используем реальный баланс из кошелька
  const walletBalance = currentToken ? BigInt(currentToken.amount) : BigInt(0);

  const {
    amount,
    amountString,
    setAmountFromString,
    setHalf,
    setMax,
    isValid,
  } = useAmountInput({
    balance: walletBalance,
    decimals: resolvedTokenIn.decimals,
  });

  const formatTokenAmount = (value: bigint, decimals: number) => {
    if (decimals <= 0) return value.toString();
    const negative = value < 0n;
    const v = negative ? -value : value;
    const s = v.toString();
    const whole = s.length > decimals ? s.slice(0, -decimals) : '0';
    const fracRaw = s.length > decimals ? s.slice(-decimals) : s.padStart(decimals, '0');
    const frac = fracRaw.replace(/0+$/, '');
    const out = frac ? `${whole}.${frac}` : whole;
    return negative ? `-${out}` : out;
  };

  // Символы для токенов
  const tokenInfo = useMemo(() =>
    tokenIn.address ? getTokenInfo(tokenIn.address) : undefined,
    [tokenIn.address]
  );

  const displaySymbol = useMemo(() =>
    tokenInfo?.symbol || resolvedTokenIn.symbol,
    [tokenInfo?.symbol, resolvedTokenIn.symbol]
  );

  // Доходность
  const yieldResult = useMemo(() =>
    calcYield(protocol.apy, amount, resolvedTokenIn.decimals),
    [protocol.apy, amount, resolvedTokenIn.decimals]
  );

  const minYieldAiDepositBaseUnits = useMemo(() => {
    if (protocol.key !== "yield-ai") return BigInt(0);
    return BigInt(
      Math.round(MIN_DEPOSIT_YIELD_AI_USDC * Math.pow(10, resolvedTokenIn.decimals))
    );
  }, [protocol.key, resolvedTokenIn.decimals]);

  const isYieldAiBelowMinimum =
    protocol.key === "yield-ai" &&
    amount > BigInt(0) &&
    amount < minYieldAiDepositBaseUnits;

  // Устанавливаем максимальное значение при открытии модального окна
  useEffect(() => {
    if (isOpen && currentToken) {
      setMax();
    }
  }, [isOpen, currentToken, setMax]);

  // Refresh portfolio data when modal opens
  useEffect(() => {
    if (isOpen) {
      console.log('[DepositModal] Refreshing portfolio data on modal open');
      refreshPortfolio();
    }
  }, [isOpen, refreshPortfolio]);

  const handleDeposit = async () => {
    if (isLoading || isDepositLoading) return; // Prevent double-clicking

    try {
      setIsLoading(true);
      console.log('Starting deposit with:', {
        protocolKey: protocol.key,
        tokenAddress: tokenIn.address,
        amount: amount.toString(),
        poolAddress
      });

      // Special handling for Auro Finance new position creation
      if (protocol.key === 'auro' && poolAddress) {
        console.log('DepositModal: Creating new Auro Finance position with poolAddress:', poolAddress);
        console.log('DepositModal: Full modal props:', { protocol, tokenIn, tokenOut, poolAddress });
        console.log('DepositModal: poolAddress validation:', {
          poolAddress,
          poolAddressType: typeof poolAddress,
          poolAddressLength: poolAddress?.length,
          isPoolAddressValid: poolAddress && poolAddress.length > 10
        });

        const { safeImport } = await import('@/lib/utils/safeImport');
        const { AuroProtocol } = await safeImport(() => import('@/lib/protocols/auro'));
        const auroProtocol = new AuroProtocol();

        // Build transaction payload
        const payload = await auroProtocol.buildCreatePosition(
          poolAddress,
          amount,
          tokenIn.address
        );

        console.log('Generated Auro create position payload:', payload);

        // Submit transaction
        if (!account || !signAndSubmitTransaction) {
          throw new Error('Wallet not connected');
        }

        const result = await signAndSubmitTransaction({
          data: {
            function: payload.function as `${string}::${string}::${string}`,
            typeArguments: payload.type_arguments,
            functionArguments: payload.arguments
          },
          options: {
            maxGasAmount: 20000,
          },
        });

        console.log('Auro create position transaction result:', result);

        // Check transaction status
        if (result.hash) {
          console.log('Checking transaction status for hash:', result.hash);
          const maxAttempts = 10;
          const delay = 2000;

          for (let i = 0; i < maxAttempts; i++) {
            console.log(`Checking transaction status attempt ${i + 1}/${maxAttempts}`);
            try {
              const txResponse = await fetch(
                `https://fullnode.mainnet.aptoslabs.com/v1/transactions/by_hash/${result.hash}`
              );
              const txData = await txResponse.json();

              console.log('Transaction success:', txData.success);
              console.log('Transaction vm_status:', txData.vm_status);

              if (txData.success && txData.vm_status === "Executed successfully") {
                console.log('Transaction confirmed successfully, showing toast...');
                showTransactionSuccessToast({
                  hash: result.hash,
                  title: "Auro Finance position created!"
                });
                console.log('Toast should be shown now');

                // Refresh positions
                setTimeout(() => {
                  window.dispatchEvent(new CustomEvent('refreshPositions', {
                    detail: { protocol: 'auro' }
                  }));
                }, 2000);

                onClose();
                return;
              } else if (txData.vm_status) {
                console.error('Transaction failed with status:', txData.vm_status);
                throw new Error(`Transaction failed: ${txData.vm_status}`);
              }
            } catch (error) {
              console.error(`Attempt ${i + 1} failed:`, error);
            }

            console.log(`Waiting ${delay}ms before next attempt...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }

          console.error('Transaction status check timeout');
          throw new Error('Transaction status check timeout');
        }
                } else if (protocol.key === 'auro' && !poolAddress) {
                  throw new Error('Auro Finance requires pool address for deposit');
      } else {
        // Existing deposit logic for other protocols (Echelon: pass marketAddress for managed positions)
        console.log('DepositModal: Using standard deposit logic for protocol:', protocol.key);
        if (protocol.key === "yield-ai") {
          if (!yieldAiSafeAddress) {
            throw new Error("Yield AI deposit requires a safe address");
          }
          if (isYieldAiBelowMinimum) {
            throw new Error(
              `Minimum deposit is ${MIN_DEPOSIT_YIELD_AI_USDC} ${displaySymbol}`
            );
          }
        }
        let depositOptions: ExecuteDepositOptions | undefined;
        if (protocol.key === "echelon" && poolAddress) {
          depositOptions = { marketAddress: poolAddress };
        } else if (protocol.key === "yield-ai" && yieldAiSafeAddress) {
          depositOptions = { yieldAiSafeAddress };
        }
        await deposit(protocol.key, tokenIn.address, amount, depositOptions);
      }

      onClose();
    } catch (error) {
      console.error('Deposit error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="w-full min-w-0 max-w-[min(100vw-2rem,425px)] overflow-x-hidden rounded-2xl p-6 sm:max-w-[425px] [&>button:last-child]:right-3 [&>button:last-child]:top-3 [&>button:last-child]:size-7 [&>button:last-child>svg]:size-3.5 sm:[&>button:last-child]:right-5 sm:[&>button:last-child]:top-5 sm:[&>button:last-child]:size-7 sm:[&>button:last-child>svg]:size-3.5 [&>button:last-child]:transition-colors [&>button:last-child]:hover:bg-muted/40">
          <DialogHeader className="min-w-0 pr-11 sm:pr-12">
            <div className="flex min-w-0 items-center gap-2">
              <Image
                src={protocol.logo}
                alt={protocol.name}
                width={24}
                height={24}
                className="rounded-full"
                unoptimized
              />
              <DialogTitle className="min-w-0 truncate text-base sm:text-lg">
                Deposit to {displaySymbol} {protocol.name}
              </DialogTitle>
            </div>
          </DialogHeader>

          <div className="grid min-w-0 gap-4 py-4">
            <div>
              <TokenAmountInput
                tokenLogoUrl={resolvedTokenIn.logo}
                tokenSymbol={displaySymbol}
                amountString={amountString}
                onAmountChange={setAmountFromString}
                priceUSD={resolvedPriceUSD}
                availableText={`${formatTokenAmount(walletBalance, resolvedTokenIn.decimals)} ${displaySymbol}`}
                inputRef={amountInputRef}
                onHalf={setHalf}
                onMax={setMax}
                isOverBalance={amount > walletBalance}
              />
            </div>

            {amount > walletBalance && (
              <div className="mt-1 flex min-w-0 items-center justify-between text-sm text-red-500">
                <span className="min-w-0 break-words">
                  Amount exceeds wallet balance of {displaySymbol}. Would you like to{" "}
                  <button
                    onClick={() => setIsSwapModalOpen(true)}
                    className="text-blue-500 hover:text-blue-600 inline-flex items-center gap-1"
                  >
                    swap and deposit
                    <ArrowLeftRight className="h-4 w-4" />
                  </button>
                  {" "}another token?
                </span>
              </div>
            )}

            {isYieldAiBelowMinimum && (
              <p className="text-sm text-red-500">
                Minimum deposit is {MIN_DEPOSIT_YIELD_AI_USDC} {displaySymbol}.
              </p>
            )}

            <div
              className="flex min-w-0 cursor-pointer items-start gap-3"
              onClick={() => setIsYieldExpanded(!isYieldExpanded)}
            >
              <div className="min-w-0 shrink-0 pt-[1px] text-sm text-muted-foreground">
                APR {protocol.apy.toFixed(2)}%
              </div>

              <div className="ml-auto flex min-w-0 flex-col items-start text-left">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate text-sm font-semibold tabular-nums">
                    ≈ ${yieldResult.daily.toFixed(2)}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">/day</span>
                  <ChevronDown className="ml-1 size-3 shrink-0 text-muted-foreground" />
                </div>

                {isYieldExpanded && (
                  <div className="mt-1 min-w-0 space-y-1 break-words text-sm text-muted-foreground">
                    <div className="min-w-0 break-words">≈ ${yieldResult.weekly.toFixed(2)} /week</div>
                    <div className="min-w-0 break-words">≈ ${yieldResult.monthly.toFixed(2)} /month</div>
                    <div className="min-w-0 break-words">≈ ${yieldResult.yearly.toFixed(2)} /year</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={onClose}
              className="h-10 w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeposit}
              className="h-10 w-full sm:w-auto"
              disabled={
                !isValid ||
                isLoading ||
                isDepositLoading ||
                !tokenIn.address ||
                !protocol.key ||
                amount === BigInt(0) ||
                (protocol.key === "yield-ai" &&
                  (!yieldAiSafeAddress || isYieldAiBelowMinimum))
              }
            >
              {(isLoading || isDepositLoading) ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                "Deposit"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <SwapAndDepositModal
        isOpen={isSwapModalOpen}
        onClose={() => setIsSwapModalOpen(false)}
        protocol={protocol}
        tokenIn={resolvedTokenIn}
        amount={amount}
        priceUSD={resolvedPriceUSD}
        poolAddress={poolAddress}
        yieldAiSafeAddress={yieldAiSafeAddress}
      />
    </>
  );
}
