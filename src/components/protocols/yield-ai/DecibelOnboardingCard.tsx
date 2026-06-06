'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, AlertCircle, Plus, RefreshCw, ChevronDown, ChevronUp, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { useDecibelOnboardingStatus, type DecibelOnboardingStep } from '@/lib/query/hooks/protocols/decibel/useDecibelOnboardingStatus';
import { useDecibelSubaccounts } from '@/lib/query/hooks/protocols/decibel/useDecibelSubaccounts';
import { useDecibelDelegation } from '@/lib/query/hooks/protocols/decibel/useDecibelDelegation';
import { useDecibelBuilderFeeApproval } from '@/lib/query/hooks/protocols/decibel/useDecibelBuilderFeeApproval';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { buildDelegateTradingPayload, buildRevokeDelegationPayload } from '@/lib/protocols/decibel/delegateTrading';
import { buildApproveBuilderFeePayload } from '@/lib/protocols/decibel/approveBuilderFee';
import { toCanonicalAddress } from '@/lib/utils/addressNormalization';
import { cn } from '@/lib/utils';
import { DecibelDepositModal } from '@/components/ui/decibel-deposit-modal';

export interface DecibelOnboardingCardProps {
  ownerAddress?: string;
  safeAddress?: string;
  safeBalance?: number;
  hasOpenTrade?: boolean;
  /**
   * The Decibel subaccount that DN trades actually use:
   *  - when a DN record exists: the on-chain `decibelSubaccount` from the record;
   *  - otherwise: the subaccount selected for opening a new DN.
   * The builder-fee badge is keyed on this, not on whichever row the user clicks
   * in the delegation list, to avoid showing "approved" when the actually-traded
   * subaccount has no approval.
   */
  tradingSubaccount?: string;
  onDepositClick?: () => void;
  className?: string;
  /**
   * When true, render the full step list even if everything is ready, instead
   * of the compact "Ready for Decibel delta-neutral trading" banner. Used by
   * the manage-positions gear toggle: if the user explicitly opened the
   * settings panel they want to see the steps, not a one-line "Ready" pill.
   */
  forceExpanded?: boolean;
}

function StepIcon({ status }: { status: DecibelOnboardingStep['status'] }) {
  switch (status) {
    case 'completed':
      return <Check className="h-4 w-4 text-green-600" />;
    case 'loading':
      return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    case 'error':
      return <AlertCircle className="h-4 w-4 text-destructive" />;
    case 'required':
      return <div className="h-4 w-4 rounded-full border-2 border-muted-foreground bg-background" />;
  }
}

interface SubaccountDelegationRowProps {
  subaccount: { subaccount_address: string; is_primary: boolean; is_active: boolean };
  isSelected: boolean;
  isTradingSubaccount: boolean;
  onSelect: () => void;
  onDelegate: () => void;
  onRevoke: (params: { subaccountAddr: string; delegatedAccount: string; refetchDelegation?: () => unknown }) => Promise<void>;
  onApproveBuilderFee: (params: ApproveBuilderFeeActionParams) => Promise<void>;
  onDeposit: (subaccountAddr: string) => void;
  /** Reports per-subaccount fee-approval status up to the parent so it can derive
   * "any approved" without re-fetching. */
  onApprovalStatus: (subaccountAddr: string, status: { approved: boolean }) => void;
  isDelegating: boolean;
  isRevoking: boolean;
  isApprovingBuilderFee: boolean;
  isBuilderFeeApprovalPending: boolean;
}

interface ApproveBuilderFeeActionParams {
  subaccountAddr: string;
  builderAddr: string;
  maxFeeBps: number;
  refetchApproval?: () => unknown;
}

function SubaccountDelegationRow({
  subaccount,
  isSelected,
  isTradingSubaccount,
  onSelect,
  onDelegate,
  onRevoke,
  onApproveBuilderFee,
  onDeposit,
  onApprovalStatus,
  isDelegating,
  isRevoking,
  isApprovingBuilderFee,
  isBuilderFeeApprovalPending,
}: SubaccountDelegationRowProps) {
  const { data: delegationStatus, isLoading, refetch } = useDecibelDelegation(
    subaccount.subaccount_address,
    { enabled: Boolean(subaccount.subaccount_address) }
  );
  const builderApproval = useDecibelBuilderFeeApproval({
    subaccount: subaccount.subaccount_address,
    enabled: Boolean(subaccount.subaccount_address),
  });

  const isDelegated = delegationStatus?.isDelegatedToExecutor ?? false;
  const canApproveBuilderFee =
    subaccount.is_active &&
    !builderApproval.isLoading &&
    !builderApproval.meetsRequiredFee &&
    Boolean(builderApproval.builderAddress) &&
    builderApproval.requiredBps != null;
  const isReadyForDeposit =
    subaccount.is_active && isDelegated && builderApproval.meetsRequiredFee;

  // Push fee-approval status to parent so it can compute "any approved" without
  // re-fetching the same data twice. Run only when the boolean flips.
  useEffect(() => {
    if (builderApproval.isLoading) return;
    onApprovalStatus(subaccount.subaccount_address, {
      approved: Boolean(builderApproval.meetsRequiredFee),
    });
  }, [
    builderApproval.isLoading,
    builderApproval.meetsRequiredFee,
    subaccount.subaccount_address,
    onApprovalStatus,
  ]);

  return (
    <TooltipProvider>
    <div className={cn(
      'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between p-2 rounded border',
      isTradingSubaccount
        ? 'bg-amber-500/5 border-amber-500/30'
        : isSelected ? 'bg-primary/5 border-primary/20' : 'bg-muted/30 border-border',
      !subaccount.is_active && 'opacity-60'
    )}>
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 font-mono text-sm">
            {subaccount.subaccount_address.slice(0, 8)}...{subaccount.subaccount_address.slice(-6)}
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-1 flex-wrap">
          {subaccount.is_primary && (
            <Badge variant="secondary" className="text-xs">Primary</Badge>
          )}
          {!subaccount.is_active && (
            <Badge variant="outline" className="text-xs">Inactive</Badge>
          )}
          {isLoading ? (
            <Badge variant="outline" className="text-xs">
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
              Checking
            </Badge>
          ) : isDelegated ? (
            <Badge className="bg-green-500/10 text-green-600 border-green-500/20 text-xs">
              Delegated
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs">
              Not delegated
            </Badge>
          )}
          {builderApproval.isLoading ? (
            <Badge variant="outline" className="text-xs">
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
              Fee check
            </Badge>
          ) : builderApproval.meetsRequiredFee ? (
            <Badge className="max-w-full whitespace-normal break-words bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30 text-xs">
              Builder fee{" "}
              {builderApproval.approvedBps != null
                ? `${(builderApproval.approvedBps / 100).toFixed(2)}% `
                : ""}
              approved
            </Badge>
          ) : builderApproval.approvedBps != null && builderApproval.requiredBps != null ? (
            <Badge variant="outline" className="max-w-full whitespace-normal break-words border-amber-500/40 text-amber-600 dark:text-amber-400 text-xs">
              Builder fee {(builderApproval.approvedBps / 100).toFixed(2)}% &lt; required{" "}
              {(builderApproval.requiredBps / 100).toFixed(2)}%
            </Badge>
          ) : (
            <Badge variant="outline" className="max-w-full whitespace-normal break-words border-muted-foreground/30 text-muted-foreground text-xs">
              Builder fee not approved
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0 justify-end">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void refetch();
            void builderApproval.refetch();
          }}
          className="h-6 w-6 p-0"
          disabled={isLoading || builderApproval.isLoading}
        >
          <RefreshCw className={cn("h-3 w-3", (isLoading || builderApproval.isLoading) && "animate-spin")} />
        </Button>

        {subaccount.is_active && (
          <>
            {canApproveBuilderFee && (
              <Button
                size="sm"
                variant={isTradingSubaccount ? 'default' : 'outline'}
                onClick={() => onApproveBuilderFee({
                  subaccountAddr: subaccount.subaccount_address,
                  builderAddr: builderApproval.builderAddress!,
                  maxFeeBps: builderApproval.requiredBps!,
                  refetchApproval: builderApproval.refetch,
                })}
                disabled={isBuilderFeeApprovalPending}
                className="text-xs"
              >
                {isApprovingBuilderFee ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : builderApproval.approvedBps != null ? (
                  'Raise fee cap'
                ) : (
                  'Approve fee'
                )}
              </Button>
            )}

            {isReadyForDeposit && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => onDeposit(subaccount.subaccount_address)}
                    className="text-xs h-7 px-2.5"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Deposit USDC to Decibel
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Deposit USDC from your wallet to your Decibel margin</p>
                </TooltipContent>
              </Tooltip>
            )}

            {!isDelegated ? (
              <Button
                size="sm"
                variant="default"
                onClick={() => {
                  onSelect();
                  onDelegate();
                }}
                disabled={isDelegating || isLoading}
                className="text-xs"
              >
                {isDelegating && isSelected ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  'Delegate'
                )}
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const delegatedAccount = delegationStatus?.executorAddress;
                      if (!delegatedAccount) return;
                      void onRevoke({
                        subaccountAddr: subaccount.subaccount_address,
                        delegatedAccount,
                        refetchDelegation: refetch,
                      });
                    }}
                    disabled={isRevoking || !delegationStatus?.executorAddress}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    aria-label="Revoke delegation"
                  >
                    {isRevoking ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Unlink className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Revoke delegation for this subaccount</p>
                </TooltipContent>
              </Tooltip>
            )}
          </>
        )}
      </div>
    </div>
    </TooltipProvider>
  );
}

export function DecibelOnboardingCard({
  ownerAddress,
  safeBalance,
  hasOpenTrade,
  tradingSubaccount,
  onDepositClick,
  className,
  forceExpanded = false,
}: DecibelOnboardingCardProps) {
  const { toast } = useToast();
  const { signAndSubmitTransaction } = useWallet();
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [selectedSubaccount, setSelectedSubaccount] = useState<string>('');
  const [isDelegating, setIsDelegating] = useState(false);
  const [revokingSubaccount, setRevokingSubaccount] = useState<string | null>(null);
  const [approvingBuilderFeeSubaccount, setApprovingBuilderFeeSubaccount] = useState<string | null>(null);
  const [showAllSteps, setShowAllSteps] = useState(forceExpanded);
  const [depositSubaccount, setDepositSubaccount] = useState<string | null>(null);
  // Fee-approval status reported up from each delegation row.
  const [feeApprovedMap, setFeeApprovedMap] = useState<Record<string, boolean>>({});
  const handleApprovalStatus = useCallback(
    (subaccountAddr: string, status: { approved: boolean }) => {
      setFeeApprovedMap((prev) => {
        if (prev[subaccountAddr] === status.approved) return prev;
        return { ...prev, [subaccountAddr]: status.approved };
      });
    },
    []
  );
  const hasAnyApprovedBuilderFee = Object.values(feeApprovedMap).some(Boolean);

  // Get Decibel subaccounts for the user
  const { data: subaccounts = [] } = useDecibelSubaccounts(ownerAddress);

  // Find primary subaccount or use first available
  const primarySubaccount = subaccounts.find(sub => sub.is_primary && sub.is_active)?.subaccount_address ||
                           subaccounts.find(sub => sub.is_active)?.subaccount_address ||
                           '';

  // Auto-select primary subaccount when available
  useEffect(() => {
    if (primarySubaccount && !selectedSubaccount) {
      setSelectedSubaccount(primarySubaccount);
    }
  }, [primarySubaccount, selectedSubaccount]);

  // Get delegation status for selected subaccount
  const { data: delegationStatus, isLoading: delegationLoading, refetch: refetchDelegation } = useDecibelDelegation(
    selectedSubaccount,
    { enabled: Boolean(selectedSubaccount) }
  );

  // Get overall onboarding status (skip safe-balance check when a trade is open)
  const status = useDecibelOnboardingStatus(
    ownerAddress,
    hasOpenTrade ? undefined : safeBalance,
  );

  // Builder fee approval status: keyed on the subaccount that will actually trade
  // (on-chain record's decibelSubaccount when DN exists, otherwise the executor open
  // form's selected subaccount). Falls back to the in-card `selectedSubaccount` only
  // when nothing else is provided. This avoids the trap where the badge looked at the
  // user's clicked row in the delegation list while executor traded on a different sub.
  const builderApprovalSubaccount = tradingSubaccount || selectedSubaccount || undefined;
  const builderApproval = useDecibelBuilderFeeApproval({
    subaccount: builderApprovalSubaccount,
    enabled: Boolean(builderApprovalSubaccount),
  });
  const normalizedTradingSubaccount = tradingSubaccount ? toCanonicalAddress(tradingSubaccount) : '';
  const canApproveBuilderApprovalSubaccount =
    Boolean(builderApprovalSubaccount) &&
    !builderApproval.isLoading &&
    !builderApproval.meetsRequiredFee &&
    Boolean(builderApproval.builderAddress) &&
    builderApproval.requiredBps != null;

  const handleApproveBuilderFee = useCallback(async ({
    subaccountAddr,
    builderAddr,
    maxFeeBps,
    refetchApproval,
  }: ApproveBuilderFeeActionParams) => {
    if (!signAndSubmitTransaction) {
      toast({
        title: 'Cannot approve builder fee',
        description: 'Wallet does not support transaction signing',
        variant: 'destructive',
      });
      return;
    }

    try {
      const canonicalSubaccountAddr = toCanonicalAddress(subaccountAddr);
      setApprovingBuilderFeeSubaccount(canonicalSubaccountAddr);
      const payload = buildApproveBuilderFeePayload({
        subaccountAddr: canonicalSubaccountAddr,
        builderAddr,
        maxFeeBps,
        isTestnet: false,
      });

      const result = await signAndSubmitTransaction({
        data: {
          function: payload.function as `${string}::${string}::${string}`,
          typeArguments: payload.typeArguments,
          functionArguments: payload.functionArguments as (string | number)[],
        },
        options: { maxGasAmount: 20000 },
      });

      const txHash = typeof result?.hash === 'string' ? result.hash : undefined;
      toast({
        title: 'Builder fee approved',
        description: `Approved ${(maxFeeBps / 100).toFixed(2)}% max for sub ${canonicalSubaccountAddr.slice(0, 6)}...${canonicalSubaccountAddr.slice(-4)}`,
        action: txHash ? (
          <ToastAction
            altText="View in Explorer"
            onClick={() => window.open(`https://explorer.aptoslabs.com/txn/${txHash}?network=mainnet`, '_blank')}
          >
            View in Explorer
          </ToastAction>
        ) : undefined,
      });

      setTimeout(() => {
        void Promise.resolve(refetchApproval?.()).catch(() => undefined);
      }, 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to approve builder fee';
      toast({ title: 'Approve failed', description: msg, variant: 'destructive' });
    } finally {
      setApprovingBuilderFeeSubaccount(null);
    }
  }, [signAndSubmitTransaction, toast]);

  const handleCreateAccount = async () => {
    if (!ownerAddress) return;

    try {
      setIsCreatingAccount(true);
      const response = await fetch('/api/protocols/decibel/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: ownerAddress }),
      });

      const json = await response.json();
      if (!response.ok || !json?.success) {
        throw new Error(json?.error || 'Failed to create Decibel account');
      }

      if (json.alreadyOnboarded) {
        toast({
          title: 'Account exists',
          description: 'You already have a Decibel account',
        });
      } else {
        toast({
          title: 'Account created',
          description: 'Decibel account created successfully',
        });
      }
    } catch (error) {
      toast({
        title: 'Failed to create account',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsCreatingAccount(false);
    }
  };

  const handleDelegate = async () => {
    if (!selectedSubaccount || !delegationStatus?.executorAddress || !signAndSubmitTransaction) {
      toast({
        title: 'Cannot delegate',
        description: 'Missing required information for delegation',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsDelegating(true);
      const payload = buildDelegateTradingPayload({
        subaccountAddr: selectedSubaccount,
        accountToDelegateTo: delegationStatus.executorAddress,
        expirationTimestampSecs: null,
      });

      const result = await signAndSubmitTransaction({
        data: {
          function: payload.function as `${string}::${string}::${string}`,
          typeArguments: payload.typeArguments,
          functionArguments: payload.functionArguments as (string | number | null)[],
        },
        options: { maxGasAmount: 70000 },
      });

      const txHash = typeof result?.hash === 'string' ? result.hash : undefined;

      toast({
        title: 'Delegation submitted',
        description: txHash
          ? `Transaction ${txHash.slice(0, 6)}...${txHash.slice(-4)}`
          : 'Transaction submitted successfully.',
      });

      // Refresh delegation status after successful transaction
      setTimeout(() => {
        refetchDelegation();
      }, 2000);

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delegate trading';
      toast({ title: 'Delegation failed', description: msg, variant: 'destructive' });
    } finally {
      setIsDelegating(false);
    }
  };

  const handleRevoke = useCallback(async (params: {
    subaccountAddr: string;
    delegatedAccount: string;
    refetchDelegation?: () => unknown;
  }) => {
    if (!signAndSubmitTransaction) {
      toast({
        title: 'Cannot revoke delegation',
        description: 'Wallet does not support transaction signing',
        variant: 'destructive',
      });
      return;
    }
    try {
      const canonicalSubaccount = toCanonicalAddress(params.subaccountAddr);
      setRevokingSubaccount(canonicalSubaccount);
      const payload = buildRevokeDelegationPayload({
        subaccountAddr: canonicalSubaccount,
        delegatedAccount: params.delegatedAccount,
        isTestnet: false,
      });
      const result = await signAndSubmitTransaction({
        data: {
          function: payload.function as `${string}::${string}::${string}`,
          typeArguments: payload.typeArguments,
          functionArguments: payload.functionArguments as (string | number | null)[],
        },
        options: { maxGasAmount: 70000 },
      });
      const txHash = typeof result?.hash === 'string' ? result.hash : undefined;
      toast({
        title: 'Delegation revoked',
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
      setTimeout(() => {
        void Promise.resolve(params.refetchDelegation?.()).catch(() => undefined);
      }, 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to revoke delegation';
      toast({ title: 'Revoke failed', description: msg, variant: 'destructive' });
    } finally {
      setRevokingSubaccount(null);
    }
  }, [signAndSubmitTransaction, toast]);

  const handleOpenDecibel = () => {
    window.open('https://app.decibel.trade/', '_blank', 'noopener,noreferrer');
  };

  const handleStepAction = (step: DecibelOnboardingStep) => {
    switch (step.action) {
      case 'create_account':
        handleCreateAccount();
        break;
      case 'setup_delegation':
        // For delegation step, we don't automatically delegate
        // The user will use the individual subaccount delegation controls
        break;
      case 'deposit_decibel':
        handleOpenDecibel();
        break;
      case 'deposit_safe':
        onDepositClick?.();
        break;
    }
  };

  // Check if we have subaccounts and can show delegation controls
  const hasSubaccounts = subaccounts.length > 0;
  // Check if ANY subaccount is delegated (for overall completion status)
  const [hasAnyDelegatedSubaccount, setHasAnyDelegatedSubaccount] = useState(false);

  useEffect(() => {
    if (!hasSubaccounts) {
      setHasAnyDelegatedSubaccount(false);
      return;
    }

    // Check all subaccounts for delegation - this is a simplified check
    // In a real implementation, you might want to use React Query to batch these
    const checkAllDelegations = async () => {
      const checks = await Promise.allSettled(
        subaccounts.map(async (sub) => {
          const response = await fetch(`/api/protocols/decibel/delegations?subaccount=${encodeURIComponent(sub.subaccount_address)}`);
          const json = await response.json();
          return json.success ? json.isDelegatedToExecutor : false;
        })
      );

      const hasAny = checks.some(result => result.status === 'fulfilled' && result.value === true);
      setHasAnyDelegatedSubaccount(hasAny);
    };

    checkAllDelegations();
  }, [subaccounts, hasSubaccounts, selectedSubaccount]);

  // Override delegation step if we have local delegation status
  const modifiedSteps = status.steps.map((step) => {
    if (step.id === 'delegation' && hasSubaccounts) {
      return {
        ...step,
        status: hasAnyDelegatedSubaccount ? 'completed' as const : 'required' as const,
        actionLabel: hasAnyDelegatedSubaccount ? undefined : 'Manage delegation',
        action: hasAnyDelegatedSubaccount ? undefined : 'setup_delegation' as const,
      };
    }
    return step;
  });

  // Decibel's onboarding "Ready" banner requires:
  // 1) underlying onboarding status (account exists, etc.),
  // 2) at least one delegated subaccount,
  // 3) at least one subaccount with builder-fee approved at the required cap —
  //    without (3) the Open button stays disabled, so showing "Ready" misleads.
  const isFullyReady =
    status.isReady && hasAnyDelegatedSubaccount && hasAnyApprovedBuilderFee;

  // When the parent explicitly opened this card (manage-positions gear button)
  // skip the compact "Ready" banner — the user asked to see the steps, so show
  // the full list with its green check marks even if everything is already done.
  if (!forceExpanded && isFullyReady && !showAllSteps && !canApproveBuilderApprovalSubaccount) {
    return (
      <div className={cn('rounded-lg border bg-green-500/5 border-green-500/20 p-3 sm:p-4', className)}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Check className="h-5 w-5 text-green-600" />
            <span className="font-medium text-green-900 dark:text-green-100">
              Ready for Decibel delta-neutral trading
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowAllSteps(true)}
            className="h-8"
          >
            <ChevronDown className="h-4 w-4 mr-1.5" />
            Steps
          </Button>
        </div>
        <p className="text-sm text-green-700 dark:text-green-300 mt-1">
          Your account is set up and ready to start delta-neutral positions.
        </p>
      </div>
    );
  }

  const completedSteps = modifiedSteps.filter(s => s.status === 'completed').length;
  const totalSteps = modifiedSteps.length;

  return (
    <Card className={cn('p-3 sm:p-4 space-y-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium flex items-center gap-2">
            {isFullyReady ? 'Ready for Decibel delta-neutral trading' : 'Decibel delta-neutral setup'}
            <Badge variant="secondary" className="text-xs">
              {completedSteps}/{totalSteps}
            </Badge>
          </div>
          <div className="text-sm text-muted-foreground">
            {isFullyReady
              ? 'Review steps and switch subaccount if needed'
              : 'Complete these steps to start delta-neutral trading'}
          </div>
        </div>
        {isFullyReady && !forceExpanded ? (
          <Button size="sm" variant="outline" onClick={() => setShowAllSteps(false)} className="h-8">
            <ChevronUp className="h-4 w-4 mr-1.5" />
            Hide steps
          </Button>
        ) : null}
      </div>

      <div className="space-y-3">
        {modifiedSteps.map((step) => (
          <div key={step.id} className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <StepIcon status={step.status} />
                <div className="min-w-0 flex-1">
                  <div className={cn(
                    'text-sm font-medium',
                    step.status === 'completed' ? 'text-muted-foreground' : 'text-foreground'
                  )}>
                    {step.label}
                    {step.id === 'delegation' && hasSubaccounts && (
                      <span className="text-xs text-muted-foreground ml-2">
                        ({subaccounts.length} subaccount{subaccounts.length !== 1 ? 's' : ''})
                      </span>
                    )}
                  </div>
                  {step.error && (
                    <div className="text-xs text-destructive mt-0.5">{step.error}</div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {step.id === 'delegation' && delegationStatus && !delegationLoading && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => refetchDelegation()}
                    className="h-7 w-7 p-0"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                )}

                {step.action && step.actionLabel && step.id !== 'delegation' && step.action !== 'deposit_decibel' && (
                  <Button
                    size="sm"
                    variant={step.action === 'deposit_safe' ? 'default' : 'outline'}
                    onClick={() => handleStepAction(step)}
                    disabled={isCreatingAccount && step.action === 'create_account'}
                  >
                    {isCreatingAccount && step.action === 'create_account' ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : step.action === 'deposit_safe' ? (
                      <>
                        <Plus className="h-3 w-3 mr-1.5" />
                        {step.actionLabel}
                      </>
                    ) : (
                      step.actionLabel
                    )}
                  </Button>
                )}
              </div>
            </div>

            {/* All subaccounts delegation status for delegation step */}
            {step.id === 'delegation' && hasSubaccounts && (
              <div className="ml-7 space-y-3">
                <div className="text-xs font-medium text-muted-foreground">
                  Subaccount delegation status:
                </div>

                <div className="space-y-2">
                  {subaccounts.map((sub) => {
                    const canonicalSubaccount = toCanonicalAddress(sub.subaccount_address);
                    const isTradingSubaccount =
                      Boolean(normalizedTradingSubaccount) &&
                      canonicalSubaccount === normalizedTradingSubaccount;

                    return (
                      <SubaccountDelegationRow
                        key={sub.subaccount_address}
                        subaccount={sub}
                        isSelected={selectedSubaccount === sub.subaccount_address}
                        isTradingSubaccount={isTradingSubaccount}
                        onSelect={() => setSelectedSubaccount(sub.subaccount_address)}
                        onDelegate={handleDelegate}
                        onRevoke={handleRevoke}
                        onApproveBuilderFee={handleApproveBuilderFee}
                        onDeposit={(addr) => setDepositSubaccount(addr)}
                        onApprovalStatus={handleApprovalStatus}
                        isDelegating={isDelegating && selectedSubaccount === sub.subaccount_address}
                        isRevoking={revokingSubaccount === canonicalSubaccount}
                        isApprovingBuilderFee={approvingBuilderFeeSubaccount === canonicalSubaccount}
                        isBuilderFeeApprovalPending={Boolean(approvingBuilderFeeSubaccount)}
                      />
                    );
                  })}
                </div>

                {delegationStatus?.executorAddress && selectedSubaccount && (
                  <div className="text-xs text-muted-foreground pt-2 border-t">
                    Executor: {delegationStatus.executorAddress.slice(0, 8)}...{delegationStatus.executorAddress.slice(-6)}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Trading-subaccount Builder fee summary block removed — the per-row
          "Builder fee X% approved" badge now carries the same info, and the
          "Approve fee" / "Raise fee cap" button per row handles the action.
          Shipping just the row keeps the panel less noisy. */}

      {status.primarySubaccount && status.availableBalance !== undefined && (
        <div className="text-xs text-muted-foreground pt-2 border-t">
          Decibel balance: ${status.availableBalance.toFixed(2)} USDC
        </div>
      )}
      <DecibelDepositModal
        isOpen={Boolean(depositSubaccount)}
        onClose={() => setDepositSubaccount(null)}
        subaccountAddr={depositSubaccount ?? ''}
      />
    </Card>
  );
}
