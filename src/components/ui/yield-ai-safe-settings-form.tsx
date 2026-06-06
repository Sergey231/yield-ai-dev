'use client';

import { useMemo, useState } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useWalletData } from '@/contexts/WalletContext';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import { buildInitVaultPayload } from '@/lib/protocols/yield-ai/vaultDeposit';
import { GasStationService } from '@/lib/services/gasStation';
import { useToast } from '@/components/ui/use-toast';
import { showTransactionSuccessToast } from '@/components/ui/transaction-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AI_AGENT_STRATEGIES, STRATEGY_REGISTRY_ENTRYPOINTS, strategyIdArg, type AiAgentStrategyId } from '@/lib/protocols/yield-ai/strategyRegistry';
import { toCanonicalAddress } from '@/lib/utils/addressNormalization';

const USDC_DECIMALS = 6;
const DEFAULT_SAFE_MAX_PER_TX_USDC = '10000';
const DEFAULT_SAFE_MAX_DAILY_USDC = '100000';

/** Refetch until the new safe appears so the card can switch to Deposit without a manual refresh. */
const SAFE_CREATED_REFETCH_MAX_ATTEMPTS = 12;
const SAFE_CREATED_REFETCH_DELAY_MS = 400;

async function refetchYieldAiSafesUntilPresent(
  queryClient: QueryClient,
  owner: string,
  beforeSafes: string[] = []
): Promise<string[] | null> {
  const key = queryKeys.protocols.yieldAi.safes(owner);
  const before = new Set(beforeSafes.map((safe) => toCanonicalAddress(safe)));
  for (let attempt = 0; attempt < SAFE_CREATED_REFETCH_MAX_ATTEMPTS; attempt++) {
    await queryClient.refetchQueries({ queryKey: key });
    const safes = queryClient.getQueryData<string[]>(key);
    if (safes && safes.length > 0) {
      const normalizedSafes = safes.map((safe) => toCanonicalAddress(safe));
      if (before.size === 0 || normalizedSafes.some((safe) => !before.has(safe))) {
        return normalizedSafes;
      }
    }
    if (attempt < SAFE_CREATED_REFETCH_MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, SAFE_CREATED_REFETCH_DELAY_MS));
    }
  }
  const latestSafes = queryClient.getQueryData<string[]>(key);
  return latestSafes?.map((safe) => toCanonicalAddress(safe)) ?? null;
}

export interface YieldAiSafeSettingsFormProps {
  className?: string;
  onCreated?: (txHash?: string) => void;
  fixedStrategy?: AiAgentStrategyId;
  createButtonLabel?: string;
}

export function YieldAiSafeSettingsForm({
  className,
  onCreated,
  fixedStrategy,
  createButtonLabel = 'Create AI agent wallet',
}: YieldAiSafeSettingsFormProps) {
  const { address } = useWalletData();
  const { signAndSubmitTransaction } = useWallet();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [safeMaxPerTxUSDC, setSafeMaxPerTxUSDC] = useState(DEFAULT_SAFE_MAX_PER_TX_USDC);
  const [safeMaxDailyUSDC, setSafeMaxDailyUSDC] = useState(DEFAULT_SAFE_MAX_DAILY_USDC);
  const [swapMaxPerTxUSDC, setSwapMaxPerTxUSDC] = useState(DEFAULT_SAFE_MAX_PER_TX_USDC);
  const [swapMaxDailyUSDC, setSwapMaxDailyUSDC] = useState(DEFAULT_SAFE_MAX_DAILY_USDC);
  const [isCreatingSafe, setIsCreatingSafe] = useState(false);
  const [creationStep, setCreationStep] = useState<'idle' | 'init' | 'attach' | 'done'>('idle');
  const [strategyOnCreate, setStrategyOnCreate] = useState<AiAgentStrategyId>('stablecoin_compound');
  const selectedStrategyOnCreate = fixedStrategy ?? strategyOnCreate;
  // `stablecoin_compound` is the implicit default (no tag attached); any other
  // strategy is explicitly attached on-chain after the safe is created.
  const willAttachStrategy = selectedStrategyOnCreate !== 'stablecoin_compound';
  const attachLabel = AI_AGENT_STRATEGIES[selectedStrategyOnCreate]?.label ?? selectedStrategyOnCreate;

  // Hidden entry point: the Hyperion LP strategy option only appears when the
  // page is opened with `?strategy=hyperion` (kept out of the default UI for now).
  const [showHyperionOption] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('strategy') === 'hyperion';
  });

  const parsedLimits = useMemo(() => {
    const maxPerTx = parseFloat(safeMaxPerTxUSDC);
    const maxDaily = parseFloat(safeMaxDailyUSDC);
    const swapPerTx = parseFloat(swapMaxPerTxUSDC);
    const swapDaily = parseFloat(swapMaxDailyUSDC);
    return { maxPerTx, maxDaily, swapPerTx, swapDaily };
  }, [safeMaxPerTxUSDC, safeMaxDailyUSDC, swapMaxPerTxUSDC, swapMaxDailyUSDC]);

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

    const { swapPerTx, swapDaily } = parsedLimits;
    if (!Number.isFinite(swapPerTx) || swapPerTx < 0 || !Number.isFinite(swapDaily) || swapDaily < 0) {
      toast({
        title: 'Invalid swap limits',
        description: 'Swap limits must be non-negative numbers (USDC notional).',
        variant: 'destructive',
      });
      return false;
    }
    const swapsOff = swapPerTx === 0 && swapDaily === 0;
    const swapsOn = swapPerTx > 0 && swapDaily > 0;
    if (!swapsOff && !swapsOn) {
      toast({
        title: 'Invalid swap limits',
        description: 'Set both swap limits to 0 to disable swaps, or both to positive values.',
        variant: 'destructive',
      });
      return false;
    }
    if (swapsOn && swapDaily < swapPerTx) {
      toast({
        title: 'Invalid swap limits',
        description: 'Swap max daily must be at least swap max per transaction.',
        variant: 'destructive',
      });
      return false;
    }
    return true;
  };

  const handleCreateSafe = async () => {
    if (isCreatingSafe) return;
    if (!validate()) return;

    const { maxPerTx, maxDaily, swapPerTx, swapDaily } = parsedLimits;
    const maxPerTxBaseUnits = BigInt(Math.round(maxPerTx * 10 ** USDC_DECIMALS));
    const maxDailyBaseUnits = BigInt(Math.round(maxDaily * 10 ** USDC_DECIMALS));
    const swapMaxPerTxUsdcBaseUnits = BigInt(Math.round(swapPerTx * 10 ** USDC_DECIMALS));
    const swapMaxDailyUsdcBaseUnits = BigInt(Math.round(swapDaily * 10 ** USDC_DECIMALS));

    try {
      setIsCreatingSafe(true);
      setCreationStep('init');
      const safesKey = address ? queryKeys.protocols.yieldAi.safes(address) : null;
      const beforeSafes = safesKey ? (queryClient.getQueryData<string[]>(safesKey) ?? []) : [];

      const payload = buildInitVaultPayload({
        maxPerTxBaseUnits,
        maxDailyBaseUnits,
        swapMaxPerTxUsdcBaseUnits,
        swapMaxDailyUsdcBaseUnits,
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
        const normalizedBeforeSafes = beforeSafes.map((safe) => toCanonicalAddress(safe));
        const afterSafes = await refetchYieldAiSafesUntilPresent(queryClient, address, normalizedBeforeSafes);
        const createdSafe =
          afterSafes?.find((safe) => !normalizedBeforeSafes.includes(safe)) ??
          (normalizedBeforeSafes.length === 0 ? afterSafes?.[0] : null) ??
          null;

        if (!createdSafe && willAttachStrategy) {
          toast({
            title: 'Safe created',
            description: `The new safe is not indexed yet, so the ${attachLabel} strategy tag was not attached. Refresh and try again shortly.`,
            variant: 'destructive',
          });
          return;
        }

        // Make the newly created safe the selected one (best-effort).
        if (createdSafe) {
          try {
            window.localStorage.setItem(`yield-ai:selectedSafe:${address.toLowerCase()}`, createdSafe);
          } catch {
            // ignore
          }
        }

        // Optional: attach on-chain AI agent strategy tag right after creating the safe.
        // Default stablecoin_compound is treated as implicit, so we only attach when a
        // non-default strategy was selected. No prior tag exists on a fresh safe, so no
        // detach is needed.
        if (createdSafe && willAttachStrategy) {
          try {
            setCreationStep('attach');
            await signAndSubmitTransaction({
              data: {
                function: STRATEGY_REGISTRY_ENTRYPOINTS.attachStrategy as `${string}::${string}::${string}`,
                typeArguments: [],
                functionArguments: [toCanonicalAddress(createdSafe), strategyIdArg(selectedStrategyOnCreate)],
              },
              options: { maxGasAmount: 70_000 },
              transactionSubmitter: gasStationSubmitter as any,
            });
            // Force refetch (not just invalidate) so the batch strategies hook
            // immediately reflects the new tag and the parent card can switch
            // to "Deposit" without a manual page refresh.
            await queryClient.refetchQueries({
              queryKey: queryKeys.protocols.yieldAi.safeActiveStrategy(createdSafe),
            });
            setCreationStep('done');
          } catch (e) {
            console.warn('[Yield AI] attach strategy after safe create failed', e);
            toast({
              title: 'Strategy tag failed',
              description: `Safe was created, but the ${attachLabel} strategy tag was not attached.`,
              variant: 'destructive',
            });
            return;
          }
        }
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
      setCreationStep('idle');
    }
  };

  const buttonLabel = (() => {
    if (!isCreatingSafe) return createButtonLabel;
    if (willAttachStrategy) {
      if (creationStep === 'init') return 'Step 1/2: creating safe…';
      if (creationStep === 'attach') return 'Step 2/2: attaching strategy…';
      if (creationStep === 'done') return 'Done';
    }
    return 'Creating...';
  })();

  return (
    <div className={cn('space-y-3', className)}>
      {!fixedStrategy ? (
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">AI agent type</Label>
          <Select value={strategyOnCreate} onValueChange={(v) => setStrategyOnCreate(v as AiAgentStrategyId)}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Select strategy" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stablecoin_compound">Stablecoin compound (USD1 + Echelon)</SelectItem>
              <SelectItem value="decibel_delta_neutral">Decibel delta-neutral</SelectItem>
              {showHyperionOption ? (
                <SelectItem value="hyperion_lp">Hyperion CLMM LP</SelectItem>
              ) : null}
            </SelectContent>
          </Select>
        </div>
      ) : null}

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

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">
            Swap max per transaction (USDC notional)
          </Label>
          <Input
            type="text"
            inputMode="decimal"
            value={swapMaxPerTxUSDC}
            onChange={(e) => setSwapMaxPerTxUSDC(e.target.value.replace(/[^0-9.]/g, ''))}
            className="h-9 text-sm"
            disabled={isCreatingSafe}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Swap max daily (USDC notional)</Label>
          <Input
            type="text"
            inputMode="decimal"
            value={swapMaxDailyUSDC}
            onChange={(e) => setSwapMaxDailyUSDC(e.target.value.replace(/[^0-9.]/g, ''))}
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
        {willAttachStrategy ? (
          <div className="pt-1 text-foreground/80">
            You will sign <span className="font-medium">2 transactions</span>: create safe, then attach the
            {' '}{attachLabel} strategy. Both are gas-free.
          </div>
        ) : null}
      </div>

      <div className="flex justify-end">
        <Button size="sm" onClick={handleCreateSafe} disabled={isCreatingSafe || !address || !signAndSubmitTransaction}>
          {buttonLabel}
        </Button>
      </div>
    </div>
  );
}
