'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  AlertCircle,
  RefreshCw,
  ArrowRight,
  X,
} from 'lucide-react';

import { useWalletData } from '@/contexts/WalletContext';
import { useProtocol } from '@/lib/contexts/ProtocolContext';
import { useMobileManagement } from '@/contexts/MobileManagementContext';
import { useToast } from '@/components/ui/use-toast';
import { showTransactionSuccessToast } from '@/components/ui/transaction-toast';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

import { DepositModal } from '@/components/ui/deposit-modal';
import { DecibelDepositModal } from '@/components/ui/decibel-deposit-modal';

import { queryKeys } from '@/lib/query/queryKeys';
import { toCanonicalAddress, normalizeAddress } from '@/lib/utils/addressNormalization';

import { buildInitVaultPayload } from '@/lib/protocols/yield-ai/vaultDeposit';
import {
  STRATEGY_REGISTRY_ENTRYPOINTS,
  strategyIdArg,
} from '@/lib/protocols/yield-ai/strategyRegistry';
import { GasStationService } from '@/lib/services/gasStation';
import { buildDelegateTradingPayload } from '@/lib/protocols/decibel/delegateTrading';
import { buildApproveBuilderFeePayload } from '@/lib/protocols/decibel/approveBuilderFee';

import { useDecibelSubaccounts } from '@/lib/query/hooks/protocols/decibel/useDecibelSubaccounts';
import { useDecibelDelegation } from '@/lib/query/hooks/protocols/decibel/useDecibelDelegation';
import {
  useDecibelBuilderFeeApproval,
} from '@/lib/query/hooks/protocols/decibel/useDecibelBuilderFeeApproval';
import { useDecibelAccountBalance } from '@/lib/query/hooks/protocols/decibel/useDecibelAccountBalance';
import { useYieldAiSafeTokens } from '@/lib/query/hooks/protocols/yield-ai/useYieldAiSafeTokens';
import { dispatchSelectYieldAiSafe } from '@/lib/query/hooks/protocols/yield-ai/useSelectedYieldAiSafe';

import { USDC_FA_METADATA_MAINNET } from '@/lib/constants/yieldAiVault';
import { getProtocolByName } from '@/lib/protocols/getProtocolsList';

const USDC_DECIMALS = 6;
const USDC_LOGO_APTOS = 'https://assets.panora.exchange/tokens/aptos/USDC.svg';
const MIN_BALANCE_USD = 20;
const SAFE_CREATED_REFETCH_MAX_ATTEMPTS = 12;
const SAFE_CREATED_REFETCH_DELAY_MS = 400;
const DECIBEL_ACCOUNTS_URL = 'https://app.decibel.trade/accounts';

const DEFAULT_LIMIT_PER_TX = '10000';
const DEFAULT_LIMIT_DAILY = '100000';

type SubStatus = 'idle' | 'pending' | 'done' | 'error';
type WizardStep = 1 | 2 | 3 | 4;

interface DecibelAgentWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing DN safe address (when user re-opens wizard mid-flow). */
  existingDecibelSafe?: string | null;
}

async function refetchYieldAiSafesUntilPresent(
  queryClient: QueryClient,
  owner: string,
  before: string[]
): Promise<string[] | null> {
  const key = queryKeys.protocols.yieldAi.safes(owner);
  const beforeSet = new Set(before.map((s) => toCanonicalAddress(s)));
  for (let attempt = 0; attempt < SAFE_CREATED_REFETCH_MAX_ATTEMPTS; attempt++) {
    await queryClient.refetchQueries({ queryKey: key });
    const safes = queryClient.getQueryData<string[]>(key);
    if (safes && safes.length > 0) {
      const normalized = safes.map((s) => toCanonicalAddress(s));
      if (beforeSet.size === 0 || normalized.some((s) => !beforeSet.has(s))) {
        return normalized;
      }
    }
    if (attempt < SAFE_CREATED_REFETCH_MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, SAFE_CREATED_REFETCH_DELAY_MS));
    }
  }
  const latest = queryClient.getQueryData<string[]>(key);
  return latest?.map((s) => toCanonicalAddress(s)) ?? null;
}

function SubStepRow({
  status,
  label,
}: {
  status: SubStatus;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {status === 'pending' ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : status === 'done' ? (
        <Check className="h-4 w-4 text-green-600" />
      ) : status === 'error' ? (
        <AlertCircle className="h-4 w-4 text-destructive" />
      ) : (
        <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/40" />
      )}
      <span
        className={cn(
          status === 'done' && 'text-muted-foreground',
          status === 'pending' && 'text-foreground',
          status === 'idle' && 'text-muted-foreground'
        )}
      >
        {label}
      </span>
    </div>
  );
}

function StepHeader({
  current,
  total,
}: {
  current: WizardStep;
  total: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wide">
          Step {Math.min(current, total)} of {total}
        </span>
        <span>{Math.round((Math.min(current, total) / total) * 100)}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${(Math.min(current, total) / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

export function DecibelAgentWizard({
  open,
  onOpenChange,
  existingDecibelSafe = null,
}: DecibelAgentWizardProps) {
  const { address } = useWalletData();
  const { signAndSubmitTransaction } = useWallet();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { setSelectedProtocol } = useProtocol();
  const { setActiveTab, scrollToTop } = useMobileManagement();
  const decibelProtocol = getProtocolByName('Decibel');

  // --- Step / progression state ---
  const [step, setStep] = useState<WizardStep>(1);
  const [createdSafe, setCreatedSafe] = useState<string | null>(existingDecibelSafe);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // --- Step 1 (create safe) state ---
  const [maxPerTxUSDC, setMaxPerTxUSDC] = useState(DEFAULT_LIMIT_PER_TX);
  const [maxDailyUSDC, setMaxDailyUSDC] = useState(DEFAULT_LIMIT_DAILY);
  const [swapMaxPerTxUSDC, setSwapMaxPerTxUSDC] = useState(DEFAULT_LIMIT_PER_TX);
  const [swapMaxDailyUSDC, setSwapMaxDailyUSDC] = useState(DEFAULT_LIMIT_DAILY);
  const [createInitStatus, setCreateInitStatus] = useState<SubStatus>('idle');
  const [createAttachStatus, setCreateAttachStatus] = useState<SubStatus>('idle');

  // --- Step 2 (authorize) state ---
  const [selectedSubaccount, setSelectedSubaccount] = useState<string>('');
  const [authAccountStatus, setAuthAccountStatus] = useState<SubStatus>('idle');
  const [authDelegateStatus, setAuthDelegateStatus] = useState<SubStatus>('idle');
  const [authFeeStatus, setAuthFeeStatus] = useState<SubStatus>('idle');

  // --- Step 3 (fund) modals ---
  const [safeDepositOpen, setSafeDepositOpen] = useState(false);
  const [decibelDepositOpen, setDecibelDepositOpen] = useState(false);

  // --- Data hooks ---
  const { data: subaccounts = [], refetch: refetchSubaccounts } = useDecibelSubaccounts(
    address,
    { enabled: Boolean(address) && open }
  );
  const primarySubaccount = useMemo(
    () =>
      subaccounts.find((s) => s.is_primary && s.is_active)?.subaccount_address ??
      subaccounts.find((s) => s.is_active)?.subaccount_address ??
      '',
    [subaccounts]
  );
  const effectiveSubaccount = selectedSubaccount || primarySubaccount;

  const { data: delegationStatus } = useDecibelDelegation(
    effectiveSubaccount,
    { enabled: Boolean(effectiveSubaccount) && open }
  );
  const builderApproval = useDecibelBuilderFeeApproval({
    subaccount: effectiveSubaccount || undefined,
    enabled: Boolean(effectiveSubaccount) && open,
  });
  const { data: decibelBalance, refetch: refetchDecibelBalance } = useDecibelAccountBalance(
    effectiveSubaccount,
    { enabled: Boolean(effectiveSubaccount) && open }
  );

  const { data: safeTokens = [], refetch: refetchSafeTokens } = useYieldAiSafeTokens(
    createdSafe ?? undefined,
    { enabled: Boolean(createdSafe) && open, refetchOnMount: 'always' }
  );
  const safeUsdcBalance = useMemo(() => {
    const usdc = safeTokens.find(
      (t) =>
        normalizeAddress(t.address) === normalizeAddress(USDC_FA_METADATA_MAINNET) ||
        t.symbol === 'USDC'
    );
    return usdc ? parseFloat(usdc.value || '0') : 0;
  }, [safeTokens]);

  const decibelUsdcBalance = decibelBalance?.usdc_cross_withdrawable_balance ?? 0;

  // --- Reset / resume on open ---
  useEffect(() => {
    if (!open) return;
    // pick subaccount if missing
    if (!selectedSubaccount && primarySubaccount) {
      setSelectedSubaccount(primarySubaccount);
    }
  }, [open, primarySubaccount, selectedSubaccount]);

  // Auto-resume: if a DN safe already exists, jump past step 1
  useEffect(() => {
    if (!open) return;
    if (createdSafe && step === 1) {
      setStep(2);
    }
  }, [open, createdSafe, step]);

  // --- Auto-detect completed sub-steps from on-chain state (for resume) ---
  const accountAlreadyExists = Boolean(primarySubaccount);
  const delegationAlreadyDone = Boolean(delegationStatus?.isDelegatedToExecutor);
  const builderFeeAlreadyDone = Boolean(builderApproval.meetsRequiredFee);
  const step2AllDone = accountAlreadyExists && delegationAlreadyDone && builderFeeAlreadyDone;

  const safeFunded = safeUsdcBalance >= MIN_BALANCE_USD;
  const decibelFunded = decibelUsdcBalance >= MIN_BALANCE_USD;

  // --- Validators ---
  const parsedLimits = useMemo(() => {
    return {
      maxPerTx: parseFloat(maxPerTxUSDC),
      maxDaily: parseFloat(maxDailyUSDC),
      swapPerTx: parseFloat(swapMaxPerTxUSDC),
      swapDaily: parseFloat(swapMaxDailyUSDC),
    };
  }, [maxPerTxUSDC, maxDailyUSDC, swapMaxPerTxUSDC, swapMaxDailyUSDC]);

  const validateLimits = (): boolean => {
    const { maxPerTx, maxDaily, swapPerTx, swapDaily } = parsedLimits;
    if (!Number.isFinite(maxPerTx) || maxPerTx <= 0) {
      toast({ title: 'Invalid limit', description: 'Max per transaction must be positive.', variant: 'destructive' });
      return false;
    }
    if (!Number.isFinite(maxDaily) || maxDaily <= 0 || maxDaily < maxPerTx) {
      toast({ title: 'Invalid limit', description: 'Max daily must be ≥ max per transaction.', variant: 'destructive' });
      return false;
    }
    if (!Number.isFinite(swapPerTx) || swapPerTx < 0 || !Number.isFinite(swapDaily) || swapDaily < 0) {
      toast({ title: 'Invalid swap limit', description: 'Swap limits must be non-negative.', variant: 'destructive' });
      return false;
    }
    const swapsOff = swapPerTx === 0 && swapDaily === 0;
    const swapsOn = swapPerTx > 0 && swapDaily > 0;
    if (!swapsOff && !swapsOn) {
      toast({ title: 'Invalid swap limit', description: 'Set both swap limits to 0 to disable, or both positive.', variant: 'destructive' });
      return false;
    }
    if (swapsOn && swapDaily < swapPerTx) {
      toast({ title: 'Invalid swap limit', description: 'Swap max daily must be ≥ swap max per tx.', variant: 'destructive' });
      return false;
    }
    return true;
  };

  // --- Step 1 actions ---
  const isCreating = createInitStatus === 'pending' || createAttachStatus === 'pending';

  const handleCreateAgent = useCallback(async () => {
    if (isCreating) return;
    if (!address || !signAndSubmitTransaction) {
      toast({ title: 'Wallet required', description: 'Connect your Aptos wallet.', variant: 'destructive' });
      return;
    }
    if (!validateLimits()) return;

    const gasSubmitter = GasStationService.getInstance().getTransactionSubmitter();
    if (!gasSubmitter) {
      toast({
        title: 'Gas Station unavailable',
        description: 'Configure NEXT_PUBLIC_APTOS_GAS_STATION_KEY.',
        variant: 'destructive',
      });
      return;
    }

    const { maxPerTx, maxDaily, swapPerTx, swapDaily } = parsedLimits;
    const safesKey = queryKeys.protocols.yieldAi.safes(address);
    const beforeSafes = queryClient.getQueryData<string[]>(safesKey) ?? [];

    // --- Sub-step 1: init vault ---
    let txInitHash: string | undefined;
    let newSafe: string | null = createdSafe;
    if (!createdSafe) {
      try {
        setCreateInitStatus('pending');
        const payload = buildInitVaultPayload({
          maxPerTxBaseUnits: BigInt(Math.round(maxPerTx * 10 ** USDC_DECIMALS)),
          maxDailyBaseUnits: BigInt(Math.round(maxDaily * 10 ** USDC_DECIMALS)),
          swapMaxPerTxUsdcBaseUnits: BigInt(Math.round(swapPerTx * 10 ** USDC_DECIMALS)),
          swapMaxDailyUsdcBaseUnits: BigInt(Math.round(swapDaily * 10 ** USDC_DECIMALS)),
        });
        const result = await signAndSubmitTransaction({
          data: {
            function: payload.function as `${string}::${string}::${string}`,
            typeArguments: payload.typeArguments,
            functionArguments: payload.functionArguments,
          },
          options: { maxGasAmount: 70000 },
          transactionSubmitter: gasSubmitter as any,
        });
        txInitHash = typeof result?.hash === 'string' ? result.hash : undefined;
        if (txInitHash) {
          showTransactionSuccessToast({ hash: txInitHash, title: 'AI agent safe created' });
        }

        const normalizedBefore = beforeSafes.map((s) => toCanonicalAddress(s));
        const after = await refetchYieldAiSafesUntilPresent(queryClient, address, normalizedBefore);
        newSafe =
          after?.find((s) => !normalizedBefore.includes(s)) ??
          (normalizedBefore.length === 0 ? after?.[0] : null) ??
          null;
        if (!newSafe) {
          setCreateInitStatus('error');
          toast({
            title: 'Safe not indexed yet',
            description: 'Wait a few seconds and retry the strategy attach step.',
            variant: 'destructive',
          });
          return;
        }
        try {
          window.localStorage.setItem(
            `yield-ai:selectedSafe:${address.toLowerCase()}`,
            newSafe
          );
        } catch {
          // ignore
        }
        setCreatedSafe(newSafe);
        setCreateInitStatus('done');
      } catch (err) {
        setCreateInitStatus('error');
        toast({
          title: 'Create safe failed',
          description: err instanceof Error ? err.message : 'Transaction failed',
          variant: 'destructive',
        });
        return;
      }
    } else {
      setCreateInitStatus('done');
    }

    // --- Sub-step 2: attach Decibel DN strategy ---
    try {
      setCreateAttachStatus('pending');
      await signAndSubmitTransaction({
        data: {
          function: STRATEGY_REGISTRY_ENTRYPOINTS.attachStrategy as `${string}::${string}::${string}`,
          typeArguments: [],
          functionArguments: [toCanonicalAddress(newSafe!), strategyIdArg('decibel_delta_neutral')],
        },
        options: { maxGasAmount: 70000 },
        transactionSubmitter: gasSubmitter as any,
      });
      await queryClient.refetchQueries({
        queryKey: queryKeys.protocols.yieldAi.safeActiveStrategy(newSafe!),
      });
      setCreateAttachStatus('done');
      setStep(2);
    } catch (err) {
      setCreateAttachStatus('error');
      toast({
        title: 'Attach strategy failed',
        description:
          err instanceof Error
            ? err.message
            : 'Safe was created but the DN strategy tag was not attached. Retry.',
        variant: 'destructive',
      });
    }
    // validateLimits intentionally read fresh each call via parsedLimits closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    address,
    createdSafe,
    isCreating,
    parsedLimits,
    queryClient,
    signAndSubmitTransaction,
    toast,
  ]);

  // --- Step 2 action ---
  const isAuthorizing =
    authAccountStatus === 'pending' ||
    authDelegateStatus === 'pending' ||
    authFeeStatus === 'pending';

  const handleAuthorize = useCallback(async () => {
    if (isAuthorizing) return;
    if (!address || !signAndSubmitTransaction) return;

    // 1) Register Decibel account if missing
    let workingSubaccount = effectiveSubaccount;
    if (!accountAlreadyExists) {
      try {
        setAuthAccountStatus('pending');
        const res = await fetch('/api/protocols/decibel/onboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account: address }),
        });
        const json = await res.json();
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || 'Failed to register Decibel account');
        }
        const refreshed = await refetchSubaccounts();
        const primary =
          refreshed.data?.find((s) => s.is_primary && s.is_active)?.subaccount_address ??
          refreshed.data?.find((s) => s.is_active)?.subaccount_address ??
          '';
        if (!primary) {
          throw new Error('Decibel subaccount not visible yet, retry in a moment');
        }
        workingSubaccount = primary;
        setSelectedSubaccount(primary);
        setAuthAccountStatus('done');
      } catch (err) {
        setAuthAccountStatus('error');
        toast({
          title: 'Account registration failed',
          description: err instanceof Error ? err.message : 'Unknown error',
          variant: 'destructive',
        });
        return;
      }
    } else {
      setAuthAccountStatus('done');
    }

    // 2) Delegate trading. Always fetch fresh delegation status for the working
    // subaccount: React Query state may be stale (e.g. when the subaccount was
    // just created in step 1 and its query was disabled at handleAuthorize call
    // time).
    try {
      setAuthDelegateStatus('pending');
      const delegationRes = await fetch(
        `/api/protocols/decibel/delegations?subaccount=${encodeURIComponent(workingSubaccount)}`
      );
      const delegationJson = (await delegationRes.json()) as {
        success?: boolean;
        executorAddress?: string;
        isDelegatedToExecutor?: boolean;
        error?: string;
      };
      if (!delegationRes.ok || delegationJson.error) {
        throw new Error(delegationJson.error || `Delegation status HTTP ${delegationRes.status}`);
      }
      if (!delegationJson.isDelegatedToExecutor) {
        const executor = delegationJson.executorAddress;
        if (!executor) {
          throw new Error('Executor address unavailable. Try again in a moment.');
        }
        const payload = buildDelegateTradingPayload({
          subaccountAddr: workingSubaccount,
          accountToDelegateTo: executor,
          expirationTimestampSecs: null,
        });
        await signAndSubmitTransaction({
          data: {
            function: payload.function as `${string}::${string}::${string}`,
            typeArguments: payload.typeArguments,
            functionArguments: payload.functionArguments as (string | number | null)[],
          },
          options: { maxGasAmount: 70000 },
        });
      }
      // Invalidate the React Query cache so any consumer (manage positions,
      // onboarding card) sees the new delegation state without a hard refresh.
      await queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.decibel.delegation(workingSubaccount),
      });
      setAuthDelegateStatus('done');
    } catch (err) {
      setAuthDelegateStatus('error');
      toast({
        title: 'Delegation failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
      return;
    }

    // 3) Approve builder fee. Same approach: fetch fresh config + approval
    // status directly, do not rely on the (possibly stale) builderApproval hook.
    try {
      setAuthFeeStatus('pending');
      const cfgRes = await fetch('/api/protocols/decibel/builder-config');
      const cfgJson = (await cfgRes.json()) as {
        success?: boolean;
        builderAddress?: string;
        builderFeeBps?: number;
      };
      if (!cfgRes.ok || !cfgJson.success || !cfgJson.builderAddress || typeof cfgJson.builderFeeBps !== 'number') {
        throw new Error('Builder configuration unavailable. Try again in a moment.');
      }
      const builderAddr = cfgJson.builderAddress;
      const requiredBps = cfgJson.builderFeeBps;

      const approvalRes = await fetch(
        `/api/protocols/decibel/approved-max-fee?subaccount=${encodeURIComponent(workingSubaccount)}` +
          `&builder=${encodeURIComponent(builderAddr)}`
      );
      const approvalJson = (await approvalRes.json()) as {
        success?: boolean;
        approvedMaxFeeBps?: number | null;
      };
      const approvedBps = approvalJson.approvedMaxFeeBps ?? null;
      const meetsFee = approvedBps != null && approvedBps >= requiredBps;

      if (!meetsFee) {
        const payload = buildApproveBuilderFeePayload({
          subaccountAddr: toCanonicalAddress(workingSubaccount),
          builderAddr,
          maxFeeBps: requiredBps,
          isTestnet: false,
        });
        await signAndSubmitTransaction({
          data: {
            function: payload.function as `${string}::${string}::${string}`,
            typeArguments: payload.typeArguments,
            functionArguments: payload.functionArguments as (string | number)[],
          },
          options: { maxGasAmount: 20000 },
        });
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.protocols.decibel.approvedBuilderFee(workingSubaccount, builderAddr),
      });
      setAuthFeeStatus('done');
      setStep(3);
    } catch (err) {
      setAuthFeeStatus('error');
      toast({
        title: 'Builder fee approval failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  }, [
    accountAlreadyExists,
    address,
    effectiveSubaccount,
    isAuthorizing,
    queryClient,
    refetchSubaccounts,
    signAndSubmitTransaction,
    toast,
  ]);

  // --- Final CTA: go to manage positions ---
  const handleOpenManagePositions = useCallback(() => {
    if (!address || !createdSafe) return;
    dispatchSelectYieldAiSafe(address, createdSafe);
    const aiAgentProtocol = getProtocolByName('AI agent');
    if (aiAgentProtocol) {
      setSelectedProtocol(aiAgentProtocol);
    }
    if (setActiveTab) {
      setActiveTab('ideas');
      setTimeout(() => scrollToTop?.(), 300);
    }
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    onOpenChange(false);
  }, [address, createdSafe, onOpenChange, scrollToTop, setActiveTab, setSelectedProtocol]);

  // ====================== RENDER ======================

  const decibelLogoUrl = decibelProtocol?.logoUrl;

  const renderStep1 = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Create your AI agent safe</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          A non-custodial safe holds the funds the agent can deploy. Only you can withdraw to your wallet.
        </p>
      </div>

      <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
        <div className="font-medium text-foreground">You will sign 2 gas-free transactions</div>
        <ol className="mt-1 ml-4 list-decimal space-y-0.5">
          <li>Initialize the safe</li>
          <li>Attach the Decibel delta-neutral strategy</li>
        </ol>
      </div>

      <div className="rounded-md border">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-muted/50"
        >
          <span className="font-medium">Advanced — spending limits</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            Defaults are safe
            {advancedOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </span>
        </button>
        {advancedOpen && (
          <div className="space-y-3 border-t p-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Max per transaction (USDC)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={maxPerTxUSDC}
                  onChange={(e) => setMaxPerTxUSDC(e.target.value.replace(/[^0-9.]/g, ''))}
                  className="h-9 text-sm"
                  disabled={isCreating}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Max daily (USDC)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={maxDailyUSDC}
                  onChange={(e) => setMaxDailyUSDC(e.target.value.replace(/[^0-9.]/g, ''))}
                  className="h-9 text-sm"
                  disabled={isCreating}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Swap max per tx (USDC)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={swapMaxPerTxUSDC}
                  onChange={(e) => setSwapMaxPerTxUSDC(e.target.value.replace(/[^0-9.]/g, ''))}
                  className="h-9 text-sm"
                  disabled={isCreating}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Swap max daily (USDC)</Label>
                <Input
                  type="text"
                  inputMode="decimal"
                  value={swapMaxDailyUSDC}
                  onChange={(e) => setSwapMaxDailyUSDC(e.target.value.replace(/[^0-9.]/g, ''))}
                  className="h-9 text-sm"
                  disabled={isCreating}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {(createInitStatus !== 'idle' || createAttachStatus !== 'idle') && (
        <div className="rounded-md border bg-background p-3 space-y-2">
          <SubStepRow status={createInitStatus} label="Initialize safe" />
          <SubStepRow status={createAttachStatus} label="Attach Decibel delta-neutral strategy" />
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          onClick={handleCreateAgent}
          disabled={isCreating || !address || !signAndSubmitTransaction}
          className="w-full sm:w-auto"
        >
          {createInitStatus === 'pending'
            ? 'Signing 1/2…'
            : createAttachStatus === 'pending'
              ? 'Signing 2/2…'
              : createAttachStatus === 'error' || createInitStatus === 'error'
                ? 'Retry'
                : 'Create agent — sign 2 transactions'}
        </Button>
      </div>
    </div>
  );

  const renderStep2 = () => {
    const hasMultiple = subaccounts.length > 1;
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Authorize the trading bot</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            The bot manages positions in your Decibel subaccount within your spending limits.
            You can revoke this at any time.
          </p>
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs text-muted-foreground">Decibel subaccount</Label>
            {accountAlreadyExists && (
              <Badge variant="secondary" className="text-[10px]">Registered</Badge>
            )}
          </div>
          {!accountAlreadyExists ? (
            <p className="text-sm text-muted-foreground">
              No Decibel account yet — we&apos;ll register your primary subaccount automatically.
            </p>
          ) : hasMultiple ? (
            <div className="space-y-1">
              {subaccounts.filter((s) => s.is_active).map((sub) => (
                <label
                  key={sub.subaccount_address}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded border p-2 text-sm cursor-pointer',
                    effectiveSubaccount === sub.subaccount_address
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/40'
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="radio"
                      name="decibel-subaccount"
                      checked={effectiveSubaccount === sub.subaccount_address}
                      onChange={() => setSelectedSubaccount(sub.subaccount_address)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="font-mono text-xs truncate">
                      {sub.subaccount_address.slice(0, 8)}…{sub.subaccount_address.slice(-6)}
                    </span>
                  </div>
                  {sub.is_primary && <Badge variant="secondary" className="text-[10px]">Primary</Badge>}
                </label>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 rounded border bg-muted/30 p-2 text-sm">
              <span className="font-mono text-xs truncate">
                {primarySubaccount
                  ? `${primarySubaccount.slice(0, 8)}…${primarySubaccount.slice(-6)}`
                  : '—'}
              </span>
              <Badge variant="secondary" className="text-[10px]">Primary</Badge>
            </div>
          )}
          <a
            href={DECIBEL_ACCOUNTS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Need a separate subaccount? Create one on Decibel
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">You will sign up to 2 transactions</div>
          <ol className="mt-1 ml-4 list-decimal space-y-0.5">
            <li>Delegate trading to the executor bot</li>
            <li>Approve the builder fee cap</li>
          </ol>
        </div>

        {(authAccountStatus !== 'idle' ||
          authDelegateStatus !== 'idle' ||
          authFeeStatus !== 'idle') && (
          <div className="rounded-md border bg-background p-3 space-y-2">
            {!accountAlreadyExists && (
              <SubStepRow status={authAccountStatus} label="Register Decibel account" />
            )}
            <SubStepRow status={authDelegateStatus} label="Delegate trading to bot" />
            <SubStepRow status={authFeeStatus} label="Approve builder fee" />
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="w-full sm:w-auto"
          >
            Skip — finish later
          </Button>
          <Button
            onClick={handleAuthorize}
            disabled={isAuthorizing || !effectiveSubaccount && accountAlreadyExists}
            className="w-full sm:w-auto"
          >
            {isAuthorizing
              ? 'Authorizing…'
              : step2AllDone
                ? 'Continue'
                : 'Authorize bot'}
          </Button>
        </div>
      </div>
    );
  };

  const renderStep3 = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Fund your agent</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Move USDC into your safe and your Decibel margin account so the bot can open positions.
          Minimum ${MIN_BALANCE_USD} in each.
        </p>
      </div>

      {/* Safe balance */}
      <div className="rounded-md border p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium">AI agent safe (USDC)</div>
            <div className="text-xs text-muted-foreground">
              Current: ${safeUsdcBalance.toFixed(2)} · min ${MIN_BALANCE_USD}
            </div>
          </div>
          {safeFunded ? (
            <Badge className="bg-green-500/10 text-green-700 border-green-500/30 border">
              <Check className="h-3 w-3 mr-1" />
              Funded
            </Badge>
          ) : (
            <Badge variant="outline">Required</Badge>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            size="sm"
            variant={safeFunded ? 'outline' : 'default'}
            onClick={() => setSafeDepositOpen(true)}
            disabled={!createdSafe}
            className="w-full sm:w-auto"
          >
            Deposit USDC to AI agent
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refetchSafeTokens()}
            className="w-full sm:w-auto"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Decibel balance */}
      <div className="rounded-md border p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-medium">Decibel margin (USDC)</div>
            <div className="text-xs text-muted-foreground">
              Current: ${decibelUsdcBalance.toFixed(2)} · min ${MIN_BALANCE_USD}
            </div>
          </div>
          {decibelFunded ? (
            <Badge className="bg-green-500/10 text-green-700 border-green-500/30 border">
              <Check className="h-3 w-3 mr-1" />
              Funded
            </Badge>
          ) : (
            <Badge variant="outline">Required</Badge>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            size="sm"
            variant={decibelFunded ? 'outline' : 'default'}
            onClick={() => setDecibelDepositOpen(true)}
            disabled={!effectiveSubaccount}
            className="w-full sm:w-auto"
          >
            Deposit USDC to Decibel
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refetchDecibelBalance()}
            className="w-full sm:w-auto"
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOpenChange(false)}
          className="w-full sm:w-auto"
        >
          Skip — finish later
        </Button>
        <Button
          onClick={() => setStep(4)}
          disabled={!safeFunded || !decibelFunded}
          className="w-full sm:w-auto"
        >
          Continue
          <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div className="space-y-4 text-center py-4">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
        <Check className="h-6 w-6 text-green-600" />
      </div>
      <div>
        <h3 className="text-lg font-semibold">Agent is ready</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Your Decibel delta-neutral AI agent is set up. Open your first position to start earning.
        </p>
      </div>
      <Button
        size="lg"
        onClick={handleOpenManagePositions}
        className="w-full"
      >
        Open delta-neutral position
        <ArrowRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto p-5 sm:p-6 rounded-2xl w-[calc(100vw-1rem)] sm:w-auto [&>button:last-child]:hidden"
        >
          <DialogHeader>
            <div className="flex items-start justify-between gap-2">
              <DialogTitle className="text-base sm:text-lg">
                Create Decibel AI agent
              </DialogTitle>
              <Button
                onClick={() => onOpenChange(false)}
                variant="ghost"
                size="icon"
                className="h-8 w-8 p-0 -mr-1"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <DialogDescription className="text-xs sm:text-sm">
              Set up a delta-neutral agent. All transactions are gas-free — sponsored by Yield AI.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2">
            <StepHeader current={step} total={3} />
          </div>

          <Separator className="my-3" />

          <div>
            {step === 1 && renderStep1()}
            {step === 2 && renderStep2()}
            {step === 3 && renderStep3()}
            {step === 4 && renderStep4()}
          </div>
        </DialogContent>
      </Dialog>

      {/* Nested Safe deposit modal */}
      <DepositModal
        isOpen={safeDepositOpen}
        onClose={() => {
          setSafeDepositOpen(false);
          void refetchSafeTokens();
        }}
        protocol={{
          name: 'Decibel AI agent',
          logo: decibelLogoUrl ?? '/logo.png',
          apy: 0,
          key: 'yield-ai',
        }}
        tokenIn={{
          symbol: 'USDC',
          logo: USDC_LOGO_APTOS,
          decimals: 6,
          address: USDC_FA_METADATA_MAINNET,
        }}
        tokenOut={{
          symbol: 'USDC',
          logo: USDC_LOGO_APTOS,
          decimals: 6,
          address: USDC_FA_METADATA_MAINNET,
        }}
        priceUSD={1}
        yieldAiSafeAddress={createdSafe ?? undefined}
      />

      {/* Nested Decibel margin deposit modal */}
      <DecibelDepositModal
        isOpen={decibelDepositOpen}
        onClose={() => {
          setDecibelDepositOpen(false);
          void refetchDecibelBalance();
        }}
        subaccountAddr={effectiveSubaccount}
      />
    </>
  );
}
