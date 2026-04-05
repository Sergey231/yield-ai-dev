'use client';

import { useMemo, useState } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useWalletData } from '@/contexts/WalletContext';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { buildInitVaultPayload } from '@/lib/protocols/yield-ai/vaultDeposit';
import { GasStationService } from '@/lib/services/gasStation';
import { useToast } from '@/components/ui/use-toast';
import { showTransactionSuccessToast } from '@/components/ui/transaction-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const USDC_DECIMALS = 6;
const DEFAULT_SAFE_MAX_PER_TX_USDC = '10000';
const DEFAULT_SAFE_MAX_DAILY_USDC = '100000';

export interface YieldAiSafeSettingsFormProps {
  className?: string;
  onCreated?: (txHash?: string) => void;
}

export function YieldAiSafeSettingsForm({ className, onCreated }: YieldAiSafeSettingsFormProps) {
  const { address } = useWalletData();
  const { signAndSubmitTransaction } = useWallet();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [safeMaxPerTxUSDC, setSafeMaxPerTxUSDC] = useState(DEFAULT_SAFE_MAX_PER_TX_USDC);
  const [safeMaxDailyUSDC, setSafeMaxDailyUSDC] = useState(DEFAULT_SAFE_MAX_DAILY_USDC);
  const [isCreatingSafe, setIsCreatingSafe] = useState(false);

  const parsedLimits = useMemo(() => {
    const maxPerTx = parseFloat(safeMaxPerTxUSDC);
    const maxDaily = parseFloat(safeMaxDailyUSDC);
    return { maxPerTx, maxDaily };
  }, [safeMaxPerTxUSDC, safeMaxDailyUSDC]);

  const validate = () => {
    if (!address || !signAndSubmitTransaction) {
      toast({
        title: 'Wallet required',
        description: 'Connect your Aptos wallet to create an AI agent wallet.',
        variant: 'destructive',
      });
      return false;
    }

    const { maxPerTx, maxDaily } = parsedLimits;
    if (!Number.isFinite(maxPerTx) || maxPerTx <= 0) {
      toast({
        title: 'Invalid limit',
        description: 'Max per transaction must be a positive number (USDC).',
        variant: 'destructive',
      });
      return false;
    }
    if (!Number.isFinite(maxDaily) || maxDaily <= 0) {
      toast({
        title: 'Invalid limit',
        description: 'Max daily must be a positive number (USDC).',
        variant: 'destructive',
      });
      return false;
    }
    if (maxDaily < maxPerTx) {
      toast({
        title: 'Invalid limits',
        description: 'Max daily must be at least max per transaction.',
        variant: 'destructive',
      });
      return false;
    }
    return true;
  };

  const handleCreateSafe = async () => {
    if (isCreatingSafe) return;
    if (!validate()) return;

    const { maxPerTx, maxDaily } = parsedLimits;
    const maxPerTxBaseUnits = BigInt(Math.round(maxPerTx * 10 ** USDC_DECIMALS));
    const maxDailyBaseUnits = BigInt(Math.round(maxDaily * 10 ** USDC_DECIMALS));

    try {
      setIsCreatingSafe(true);
      const payload = buildInitVaultPayload({
        maxPerTxBaseUnits,
        maxDailyBaseUnits,
      });

      const gasStationSubmitter = GasStationService.getInstance().getTransactionSubmitter();
      if (!gasStationSubmitter) {
        throw new Error('Gas Station is not available. Configure NEXT_PUBLIC_APTOS_GAS_STATION_KEY.');
      }

      const result = await signAndSubmitTransaction({
        data: {
          function: payload.function as `${string}::${string}::${string}`,
          typeArguments: payload.typeArguments,
          functionArguments: payload.functionArguments,
        },
        options: { maxGasAmount: 70000 },
        transactionSubmitter: gasStationSubmitter as any,
      });

      const txHash = typeof result?.hash === 'string' ? result.hash : undefined;

      if (txHash) {
        showTransactionSuccessToast({
          hash: txHash,
          title: 'AI agent wallet created',
        });
      } else {
        toast({
          title: 'AI agent wallet created',
          description: 'Transaction submitted.',
        });
      }

      if (address) {
        queryClient.invalidateQueries({ queryKey: queryKeys.protocols.yieldAi.safes(address) });
      }

      onCreated?.(txHash);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transaction failed';
      toast({
        title: 'Failed to create wallet',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsCreatingSafe(false);
    }
  };

  return (
    <div className={cn('space-y-3', className)}>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Max per transaction (USDC)</Label>
          <Input
            type="text"
            inputMode="decimal"
            value={safeMaxPerTxUSDC}
            onChange={(e) => setSafeMaxPerTxUSDC(e.target.value.replace(/[^0-9.]/g, ''))}
            className="h-9 text-sm"
            disabled={isCreatingSafe}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Max daily (USDC)</Label>
          <Input
            type="text"
            inputMode="decimal"
            value={safeMaxDailyUSDC}
            onChange={(e) => setSafeMaxDailyUSDC(e.target.value.replace(/[^0-9.]/g, ''))}
            className="h-9 text-sm"
            disabled={isCreatingSafe}
          />
        </div>
      </div>

      <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
        <div>Creating the wallet is free — Yield AI sponsors the transaction.</div>
        <div>
          The AI agent can only deploy funds into protocols. Withdrawals to your wallet can only be made by you.
        </div>
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={handleCreateSafe} disabled={isCreatingSafe || !address || !signAndSubmitTransaction}>
          {isCreatingSafe ? 'Creating…' : 'Create AI agent wallet'}
        </Button>
      </div>
    </div>
  );
}

