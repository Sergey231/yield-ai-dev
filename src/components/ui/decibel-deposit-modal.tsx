'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useWalletData } from '@/contexts/WalletContext';
import { useAmountInput } from '@/hooks/useAmountInput';
import { buildDepositToSubaccountPayload, DECIBEL_MAINNET_USDC_METADATA } from '@/lib/protocols/decibel/depositToSubaccount';
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

function normalizeAddress(addr?: string | null): string {
  if (!addr || !addr.startsWith('0x')) return addr || '';
  const normalized = addr.slice(2).replace(/^0+/, '');
  return `0x${normalized || '0'}`;
}

function shortenHex(hex: string, head = 6, tail = 4): string {
  if (!hex || !hex.startsWith('0x') || hex.length <= head + tail + 2) return hex;
  return `${hex.slice(0, head + 2)}...${hex.slice(-tail)}`;
}

function formatTokenAmount(baseUnits: bigint, decimals: number): string {
  const divisor = 10 ** decimals;
  const value = Number(baseUnits) / divisor;
  return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

interface DecibelDepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  subaccountAddr: string;
}

export function DecibelDepositModal({
  isOpen,
  onClose,
  subaccountAddr,
}: DecibelDepositModalProps) {
  const { account, signAndSubmitTransaction } = useWallet();
  const { tokens, refreshPortfolio } = useWalletData();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const amountInputRef = useRef<HTMLInputElement>(null);

  const usdcToken = useMemo(
    () =>
      tokens.find(
        (token) => normalizeAddress(token.address) === normalizeAddress(DECIBEL_MAINNET_USDC_METADATA)
      ),
    [tokens]
  );

  const walletBalance = usdcToken ? BigInt(usdcToken.amount) : BigInt(0);
  const priceUSD = usdcToken?.price ? parseFloat(usdcToken.price) : 1;

  const { amount, amountString, setAmountFromString, setHalf, setMax, isValid } = useAmountInput({
    balance: walletBalance,
    decimals: USDC_DECIMALS,
    initialValue: BigInt(0),
  });

  useEffect(() => {
    if (!isOpen) return;
    void refreshPortfolio();
    setAmountFromString('');
  }, [isOpen, refreshPortfolio, setAmountFromString]);

  const handleDeposit = async () => {
    if (!account?.address || !signAndSubmitTransaction || isSubmitting || amount === BigInt(0)) return;

    setIsSubmitting(true);
    try {
      const payload = buildDepositToSubaccountPayload({
        subaccountAddr,
        amountBaseUnits: amount,
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

      void refreshPortfolio();
      window.dispatchEvent(new Event('refreshPositions'));
      onClose();

      toast({
        title: 'USDC deposited to Decibel',
        description: txHash ? `Transaction ${txHash.slice(0, 6)}...${txHash.slice(-4)}` : 'Transaction submitted',
        action: txHash ? (
          <ToastAction
            altText="View in Explorer"
            onClick={() => window.open(`https://explorer.aptoslabs.com/txn/${txHash}?network=mainnet`, '_blank')}
          >
            View in Explorer
          </ToastAction>
        ) : undefined,
      });
    } catch (error) {
      toast({
        title: 'Deposit failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

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
              Deposit to USDC Decibel
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
              priceUSD={priceUSD}
              availableText={`${formatTokenAmount(walletBalance, USDC_DECIMALS)} USDC`}
              inputRef={amountInputRef}
              onHalf={setHalf}
              onMax={setMax}
              isOverBalance={amount > walletBalance}
            />
          </div>

          {amount > walletBalance && (
            <p className="text-sm text-red-500">Amount exceeds your USDC wallet balance.</p>
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
            onClick={handleDeposit}
            disabled={!isValid || isSubmitting || !signAndSubmitTransaction || amount === BigInt(0)}
            className="h-10 w-full sm:w-auto"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Depositing...
              </>
            ) : (
              'Deposit'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
