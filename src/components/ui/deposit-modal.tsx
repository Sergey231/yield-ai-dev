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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

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
  /**
   * Optional list of interchangeable input tokens. When provided (with >1
   * entry) the modal renders a token switcher; the first entry is the
   * default and should match `tokenIn`. Used by the Yield AI agent to let
   * users fund the safe with either USDC or USD1.
   */
  tokenInOptions?: Array<{
    symbol: string;
    logo: string;
    decimals: number;
    address: string;
  }>;
  priceUSD: number;
  poolAddress?: string;
  /** When depositing into the Yield AI vault (`protocol.key === 'yield-ai'`). */
  yieldAiSafeAddress?: string;
  /**
   * Yield AI safes the user owns, with their resolved strategy label. When
   * length > 1 the modal renders a dropdown so users can pick which safe to
   * fund without leaving the deposit flow.
   */
  yieldAiSafeOptions?: Array<{ address: string; strategyLabel?: string }>;
  /** Fired when the user picks a different safe from `yieldAiSafeOptions`. */
  onYieldAiSafeChange?: (address: string) => void;
  /**
   * Optional second logo stacked next to the protocol logo in the header.
   * Used to brand the Decibel delta-neutral safe deposit as "Yield AI x
   * Decibel" so it is visually distinct from the stablecoin compound flow.
   * When set, the APR row is replaced by a subtle safe-address line.
   */
  secondaryLogoUrl?: string;
  secondaryLogoAlt?: string;
}

const MIN_DEPOSIT_YIELD_AI_USDC = 0.1;

export function DepositModal({
  isOpen,
  onClose,
  protocol,
  tokenIn,
  tokenOut,
  tokenInOptions,
  priceUSD,
  poolAddress,
  yieldAiSafeAddress,
  yieldAiSafeOptions,
  onYieldAiSafeChange,
  secondaryLogoUrl,
  secondaryLogoAlt,
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

  // Reset the resolved input token to the default whenever the modal opens
  // (non-Echelon). Echelon resolves its own metadata in the effect above.
  useEffect(() => {
    if (!isOpen || protocol.key === 'echelon') return;
    setResolvedTokenIn(tokenIn);
    setResolvedPriceUSD(priceUSD);
  }, [isOpen, protocol.key, tokenIn.address, tokenIn.symbol, tokenIn.decimals, tokenIn.logo, priceUSD]);

  // Token switcher (e.g. USDC / USD1 for the Yield AI agent safe).
  const handleSelectTokenIn = (opt: NonNullable<DepositModalProps['tokenInOptions']>[number]) => {
    setResolvedTokenIn(opt);
    const norm = (a: string) =>
      a && a.startsWith('0x') ? '0x' + (a.slice(2).replace(/^0+/, '') || '0') : a;
    const walletTok = tokens?.find((t) => norm(t.address) === norm(opt.address));
    setResolvedPriceUSD(walletTok?.price ? parseFloat(walletTok.price) : priceUSD);
  };

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

    const normalizedTokenInAddress = normalizeAddress(resolvedTokenIn.address);

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
  }, [tokens, resolvedTokenIn.address]);

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
    resolvedTokenIn.address ? getTokenInfo(resolvedTokenIn.address) : undefined,
    [resolvedTokenIn.address]
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
        await deposit(protocol.key, resolvedTokenIn.address, amount, depositOptions);
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
              {secondaryLogoUrl ? (
                // Stacked logos: primary (e.g. Yield AI) with the secondary
                // protocol (e.g. Decibel) tucked into the bottom-right corner,
                // so the combined brand is recognisable in one glance.
                <div className="relative h-7 w-7 shrink-0">
                  <Image
                    src={protocol.logo}
                    alt={protocol.name}
                    width={28}
                    height={28}
                    className="h-7 w-7 rounded-full"
                    unoptimized
                  />
                  <Image
                    src={secondaryLogoUrl}
                    alt={secondaryLogoAlt ?? `${protocol.name} secondary`}
                    width={16}
                    height={16}
                    className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full ring-2 ring-background"
                    unoptimized
                  />
                </div>
              ) : (
                <Image
                  src={protocol.logo}
                  alt={protocol.name}
                  width={24}
                  height={24}
                  className="rounded-full"
                  unoptimized
                />
              )}
              <DialogTitle className="min-w-0 truncate text-base sm:text-lg">
                Deposit to {displaySymbol} {protocol.name}
              </DialogTitle>
            </div>
          </DialogHeader>

          {/* Safe switcher + strategy tag — visible only when the caller
              passes safe options (i.e. the Yield AI deposit flows). The
              full address is intentionally surfaced here (not on the main
              page card) because this is where users actually choose the
              destination. */}
          {yieldAiSafeAddress && yieldAiSafeOptions && yieldAiSafeOptions.length > 0 ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2 pb-1">
              {yieldAiSafeOptions.length > 1 ? (
                <Select
                  value={yieldAiSafeAddress}
                  onValueChange={(v) => onYieldAiSafeChange?.(v)}
                >
                  <SelectTrigger className="h-8 w-full max-w-full sm:w-[200px]">
                    <SelectValue placeholder="Select safe" />
                  </SelectTrigger>
                  <SelectContent>
                    {yieldAiSafeOptions.map((opt) => (
                      <SelectItem key={opt.address} value={opt.address}>
                        {opt.address.slice(0, 6)}…{opt.address.slice(-4)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-xs font-mono text-muted-foreground">
                  Safe {yieldAiSafeAddress.slice(0, 6)}…{yieldAiSafeAddress.slice(-4)}
                </span>
              )}
              {(() => {
                const active = yieldAiSafeOptions.find((o) => o.address === yieldAiSafeAddress);
                return active?.strategyLabel ? (
                  <Badge variant="secondary" className="whitespace-nowrap">
                    {active.strategyLabel}
                  </Badge>
                ) : null;
              })()}
            </div>
          ) : null}

          <div className="grid min-w-0 gap-4 py-4">
            {tokenInOptions && tokenInOptions.length > 1 && (
              <div className="inline-flex w-full rounded-lg border p-0.5">
                {tokenInOptions.map((opt) => {
                  const active =
                    resolvedTokenIn.address.toLowerCase() === opt.address.toLowerCase();
                  return (
                    <button
                      key={opt.address}
                      type="button"
                      onClick={() => handleSelectTokenIn(opt)}
                      className={cn(
                        'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:bg-muted/50'
                      )}
                    >
                      <Image
                        src={opt.logo}
                        alt={opt.symbol}
                        width={16}
                        height={16}
                        className="rounded-full"
                        unoptimized
                      />
                      {opt.symbol}
                    </button>
                  );
                })}
              </div>
            )}
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

            {yieldAiSafeAddress ? (
              // AI agent safes (both stablecoin compound and delta-neutral):
              // the protocol.apy figure here is a historical PnL/funding mix
              // and is misleading to surface in a "yield per day" row, so we
              // replace it with a subtle truncated safe address.
              <div className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                Safe {yieldAiSafeAddress.slice(0, 8)}…{yieldAiSafeAddress.slice(-6)}
              </div>
            ) : (
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
            )}
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
                !resolvedTokenIn.address ||
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
