'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useWalletData } from '@/contexts/WalletContext';
import { useAmountInput } from '@/hooks/useAmountInput';
import { buildWithdrawFromNonCollateralPayload } from '@/lib/protocols/decibel/withdrawFromSubaccount';
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
const SHARE_DECIMALS = 6;

function shortenHex(hex: string, head = 6, tail = 4): string {
  if (!hex || !hex.startsWith('0x') || hex.length <= head + tail + 2) return hex;
  return `${hex.slice(0, head + 2)}...${hex.slice(-tail)}`;
}

function coerceBaseUnits(value: bigint | number | string | null | undefined): bigint {
  if (typeof value === 'bigint') return value > 0n ? value : 0n;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? BigInt(Math.floor(value)) : 0n;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return /^\d+$/.test(trimmed) ? BigInt(trimmed) : 0n;
  }
  return 0n;
}

function formatTokenAmount(baseUnits: bigint, decimals: number): string {
  const divisor = 10 ** decimals;
  const value = Number(baseUnits) / divisor;
  return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}

interface DecibelVaultShareWithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  vaultName: string;
  subaccountAddr: string;
  assetMetadataAddr: string;
  shareBalanceBaseUnits: bigint | number | string;
  shareSymbol?: string;
  sharePriceUsd?: number;
  isTestnet?: boolean;
}

export function DecibelVaultShareWithdrawModal({
  isOpen,
  onClose,
  vaultName,
  subaccountAddr,
  assetMetadataAddr,
  shareBalanceBaseUnits,
  shareSymbol = 'shares',
  sharePriceUsd = 0,
  isTestnet = false,
}: DecibelVaultShareWithdrawModalProps) {
  const { signAndSubmitTransaction } = useWallet();
  const { refreshPortfolio } = useWalletData();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const amountInputRef = useRef<HTMLInputElement>(null);

  const shareBalance = useMemo(
    () => coerceBaseUnits(shareBalanceBaseUnits),
    [shareBalanceBaseUnits]
  );

  const { amount, amountString, setAmountFromString, setHalf, setMax, isValid } = useAmountInput({
    balance: shareBalance,
    decimals: SHARE_DECIMALS,
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
      const payload = buildWithdrawFromNonCollateralPayload({
        subaccountAddr,
        assetMetadataAddr,
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
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('refreshPositions', { detail: { protocol: 'decibel' } }));
      }
      onClose();

      toast({
        title: `${shareSymbol} withdrawal submitted`,
        description: txHash
          ? `Transaction ${txHash.slice(0, 6)}...${txHash.slice(-4)}. Shares will move from Decibel to your Aptos wallet.`
          : 'Transaction submitted. Shares will move from Decibel to your Aptos wallet.',
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
        title: 'Share withdrawal failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasWithdrawableShares = shareBalance > BigInt(0);
  const estimatedUsd = amountString && sharePriceUsd > 0
    ? parseFloat(amountString) * sharePriceUsd
    : 0;

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
              Withdraw {shareSymbol}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="grid min-w-0 gap-4 py-4">
          <TokenAmountInput
            tokenLogoUrl={DECIBEL_LOGO}
            tokenSymbol={shareSymbol}
            amountString={amountString}
            onAmountChange={setAmountFromString}
            priceUSD={sharePriceUsd}
            availableText={`${formatTokenAmount(shareBalance, SHARE_DECIMALS)} ${shareSymbol}`}
            inputRef={amountInputRef}
            onHalf={setHalf}
            onMax={setMax}
            isOverBalance={amount > shareBalance}
          />

          {amount > shareBalance && (
            <p className="text-sm text-red-500">Amount exceeds your Decibel vault share balance.</p>
          )}

          {!hasWithdrawableShares && (
            <p className="text-sm text-muted-foreground">
              No withdrawable shares on this Decibel subaccount.
            </p>
          )}

          <div className="space-y-1 text-xs text-muted-foreground">
            <div className="min-w-0 truncate" title={vaultName}>
              Vault: {vaultName}
            </div>
            <div className="min-w-0 truncate font-mono" title={subaccountAddr}>
              Subaccount: {shortenHex(subaccountAddr)}
            </div>
            <div className="min-w-0 truncate font-mono" title={assetMetadataAddr}>
              Share asset: {shortenHex(assetMetadataAddr)}
            </div>
            {estimatedUsd > 0 && (
              <div>Estimated value: ${estimatedUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
            )}
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
              !hasWithdrawableShares ||
              !assetMetadataAddr
            }
            className="h-10 w-full sm:w-auto"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Withdrawing...
              </>
            ) : (
              'Withdraw shares'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
