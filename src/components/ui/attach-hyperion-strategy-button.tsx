'use client';

import { useState } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { showTransactionSuccessToast } from '@/components/ui/transaction-toast';
import { GasStationService } from '@/lib/services/gasStation';
import { queryKeys } from '@/lib/query/queryKeys';
import { toCanonicalAddress } from '@/lib/utils/addressNormalization';
import {
  STRATEGY_REGISTRY_ENTRYPOINTS,
  strategyIdArg,
} from '@/lib/protocols/yield-ai/strategyRegistry';

interface AttachHyperionStrategyButtonProps {
  safeAddress: string;
  className?: string;
}

/**
 * Wallet-signed retry for attaching the `hyperion_lp` strategy tag to an
 * EXISTING safe. Needed because the create flow's attach step can be skipped
 * when the freshly created safe is not yet indexed (the safe lands untagged and
 * resolves as the default stablecoin strategy). Surfaced via `?strategy=hyperion`
 * when the selected safe is not yet hyperion-tagged.
 */
export function AttachHyperionStrategyButton({
  safeAddress,
  className,
}: AttachHyperionStrategyButtonProps) {
  const { signAndSubmitTransaction } = useWallet();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleAttach = async () => {
    if (busy) return;
    const submitter = GasStationService.getInstance().getTransactionSubmitter();
    if (!submitter) {
      toast({
        title: 'Gas Station unavailable',
        description: 'Configure NEXT_PUBLIC_APTOS_GAS_STATION_KEY.',
        variant: 'destructive',
      });
      return;
    }
    setBusy(true);
    try {
      const result = await signAndSubmitTransaction({
        data: {
          function: STRATEGY_REGISTRY_ENTRYPOINTS.attachStrategy as `${string}::${string}::${string}`,
          typeArguments: [],
          functionArguments: [toCanonicalAddress(safeAddress), strategyIdArg('hyperion_lp')],
        },
        options: { maxGasAmount: 70_000 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transactionSubmitter: submitter as any,
      });
      const hash = typeof result?.hash === 'string' ? result.hash : undefined;
      if (hash) {
        showTransactionSuccessToast({ hash, title: 'Hyperion LP strategy attached' });
      } else {
        toast({ title: 'Hyperion LP strategy attached' });
      }
      await queryClient.refetchQueries({
        queryKey: queryKeys.protocols.yieldAi.safeActiveStrategy(toCanonicalAddress(safeAddress)),
      });
    } catch (err) {
      toast({
        title: 'Attach failed',
        description: err instanceof Error ? err.message : 'Transaction failed',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button size="sm" variant="outline" className={className} disabled={busy} onClick={handleAttach}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Attach Hyperion LP'}
    </Button>
  );
}
