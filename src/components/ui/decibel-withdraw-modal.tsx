'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useWalletData } from '@/contexts/WalletContext';
import { useAmountInput } from '@/hooks/useAmountInput';
import { buildWithdrawFromCrossCollateralPayload } from '@/lib/protocols/decibel/withdrawFromSubaccount';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { TokenAmountInput } from '@/shared/DepositAmountInput';

const DECIBEL_LOGO = '/protocol_ico/decibel.png';
const USDC_LOGO = 'https://assets.panora.exchange/tokens/aptos/USDC.svg';
const USDC_DECIMALS = 6;

function shortenHex(hex: string, head = 6, tail = 4): string {
  if (!hex || !hex.startsWith('0x') || hex.length <= head + tail + 2) return hex;
  return `${hex.slice(0, head + 2)}...${hex.slice(-tail)}`;
}

function formatTokenAmount(baseUnits: bigint, decimals: number): string {
  const divisor = 10 ** decimals;
  const value = Number(baseUnits) / divisor;
  return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function usdToBaseUnits(amountUsd: number): bigint {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return BigInt(0);
  return BigInt(Math.floor(amountUsd * 10 ** USDC_DECIMALS));
}

interface DecibelWithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  subaccountAddr: string;
  /** Withdrawable USDC balance in human units (e.g. 11.5 = $11.50). */
  withdrawableBalanceUsd: number;
  isTestnet?: boolean;
}

export function DecibelWithdrawModal({
  isOpen,
  onClose,
  subaccountAddr,
  withdrawableBalanceUsd,
  isTestnet = false,
}: DecibelWithdrawModalProps) {
  const { signAndSubmitTransaction } = useWallet();
  const { refreshPortfolio } = useWalletData();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const amountInputRef = useRef<HTMLInputElement>(null);

  const withdrawableBaseUnits = useMemo(
    () => usdToBaseUnits(withdrawableBalanceUsd),
    [withdrawableBalanceUsd]
  );

  const { amount, amountString, setAmountFromString, setHalf, setMax, isValid } = useAmountInput({
    balance: withdrawableBaseUnits,
    decimals: USDC_DECIMALS,
    initialValue: BigInt(0),
  });

  useEffect(() => {
    if (!isOpen) return;
    setAmountFromString('');
  }, [isOpen, setAmountFromString]);

  const handleWithdraw = async () => {
    if (!signAndSubmitTransaction || isSubmitting || amount === BigInt(0)) return;

    setIsSubmitting(true);
    try {
      const payload = buildWithdrawFromCrossCollateralPayload({
        subaccountAddr,
        amountBaseUnits: amount,
        isTestnet,
      });

      const result = await signAndSubmitTransaction({
        data: {
          function: payload.function as `${string}::${string}::${string}`,
          typeArguments: payload.typeArguments,
          functionArguments: payload.functionArguments as string[],
        },
        options: { maxGasAmount: 20000 },
      });

      const txHash = typeof result?.hash === 'string' ? result.hash : (result as { hash?: string })?.hash ?? '';
      const network = isTestnet ? 'testnet' : 'mainnet';

      void refreshPortfolio();
      window.dispatchEvent(new CustomEvent('refreshPositions', { detail: { protocol: 'decibel' } }));
      onClose();

      toast({
        title: 'USDC withdrawal submitted',
        description: txHash
          ? `Transaction ${txHash.slice(0, 6)}...${txHash.slice(-4)}. Funds may arrive immediately or after the withdraw queue processes.`
          : 'Transaction submitted. Funds may arrive immediately or after the withdraw queue processes.',
        action: txHash ? (
          <ToastAction
            altText="View in Explorer"
            onClick={() => window.open(`https://explorer.aptoslabs.com/txn/${txHash}?network=${network}`, '_blank')}
          >
            View in Explorer
          </ToastAction>
        ) : undefined,
      });
    } catch (error) {
      toast({
        title: 'Withdrawal failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasWithdrawableBalance = withdrawableBaseUnits > BigInt(0);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-full min-w-0 max-w-[min(100vw-2rem,425px)] overflow-x-hidden rounded-2xl p-6 sm:max-w-[425px] [&>button:last-child]:right-3 [&>button:last-child]:top-3 [&>button:last-child]:size-7 [&>button:last-child>svg]:size-3.5 sm:[&>button:last-child]:right-5 sm:[&>button:last-child]:top-5 [&>button:last-child]:transition-colors [&>button:last-child]:hover:bg-muted/40">
        <DialogHeader className="min-w-0 pr-11 sm:pr-12">
          <div className="flex min-w-0 items-center gap-2">
            <Image
              src={DECIBEL_LOGO}
              alt="Decibel"
              width={24}
              height={24}
              className="rounded-full"
              unoptimized
            />
            <DialogTitle className="min-w-0 truncate text-base sm:text-lg">
              Withdraw from Decibel
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="grid min-w-0 gap-4 py-4">
          <div>
            <TokenAmountInput
              tokenLogoUrl={USDC_LOGO}
              tokenSymbol="USDC"
              amountString={amountString}
              onAmountChange={setAmountFromString}
              priceUSD={1}
              availableText={`${formatTokenAmount(withdrawableBaseUnits, USDC_DECIMALS)} USDC`}
              inputRef={amountInputRef}
              onHalf={setHalf}
              onMax={setMax}
              isOverBalance={amount > withdrawableBaseUnits}
            />
          </div>

          {amount > withdrawableBaseUnits && (
            <p className="text-sm text-red-500">Amount exceeds your withdrawable Decibel balance.</p>
          )}

          {!hasWithdrawableBalance && (
            <p className="text-sm text-muted-foreground">
              No withdrawable USDC on this subaccount. Close positions or reduce margin usage first.
            </p>
          )}

          <div className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={subaccountAddr}>
            Subaccount: {shortenHex(subaccountAddr)}
          </div>
        </div>

        <Separator />

        <div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
            className="h-10 w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            onClick={handleWithdraw}
            disabled={
              !isValid ||
              isSubmitting ||
              !signAndSubmitTransaction ||
              amount === BigInt(0) ||
              !hasWithdrawableBalance
            }
            className="h-10 w-full sm:w-auto"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Withdrawing...
              </>
            ) : (
              'Withdraw'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
