'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, ExternalLink, Loader2, AlertCircle, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { useDecibelOnboardingStatus, type DecibelOnboardingStep } from '@/lib/query/hooks/protocols/decibel/useDecibelOnboardingStatus';
import { useDecibelSubaccounts } from '@/lib/query/hooks/protocols/decibel/useDecibelSubaccounts';
import { useDecibelDelegation } from '@/lib/query/hooks/protocols/decibel/useDecibelDelegation';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { buildDelegateTradingPayload } from '@/lib/protocols/decibel/delegateTrading';
import { toCanonicalAddress } from '@/lib/utils/addressNormalization';
import { cn } from '@/lib/utils';

export interface DecibelOnboardingCardProps {
  ownerAddress?: string;
  safeAddress?: string;
  safeBalance?: number;
  onDepositClick?: () => void;
  className?: string;
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
  onSelect: () => void;
  onDelegate: () => void;
  isDelegating: boolean;
}

function SubaccountDelegationRow({
  subaccount,
  isSelected,
  onSelect,
  onDelegate,
  isDelegating,
}: SubaccountDelegationRowProps) {
  const { data: delegationStatus, isLoading, refetch } = useDecibelDelegation(
    subaccount.subaccount_address,
    { enabled: Boolean(subaccount.subaccount_address) }
  );

  const isDelegated = delegationStatus?.isDelegatedToExecutor ?? false;

  return (
    <div className={cn(
      'flex items-center justify-between p-2 rounded border',
      isSelected ? 'bg-primary/5 border-primary/20' : 'bg-muted/30 border-border',
      !subaccount.is_active && 'opacity-60'
    )}>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <input
            type="radio"
            checked={isSelected}
            onChange={onSelect}
            className="h-3 w-3"
            disabled={!subaccount.is_active}
          />
          <div className="font-mono text-sm">
            {subaccount.subaccount_address.slice(0, 8)}...{subaccount.subaccount_address.slice(-6)}
          </div>
        </div>

        <div className="flex items-center gap-1">
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
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => refetch()}
          className="h-6 w-6 p-0"
          disabled={isLoading}
        >
          <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
        </Button>

        {subaccount.is_active && (
          <Button
            size="sm"
            variant={isDelegated ? "outline" : "default"}
            onClick={() => {
              onSelect();
              if (!isDelegated) {
                onDelegate();
              }
            }}
            disabled={isDelegating || isLoading}
            className="text-xs"
          >
            {isDelegating && isSelected ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : isDelegated ? (
              'Delegated'
            ) : (
              'Delegate'
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

export function DecibelOnboardingCard({
  ownerAddress,
  safeAddress,
  safeBalance,
  onDepositClick,
  className,
}: DecibelOnboardingCardProps) {
  const { toast } = useToast();
  const { signAndSubmitTransaction } = useWallet();
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [selectedSubaccount, setSelectedSubaccount] = useState<string>('');
  const [isDelegating, setIsDelegating] = useState(false);

  // Get Decibel subaccounts for the user
  const { data: subaccounts = [], isLoading: subaccountsLoading } = useDecibelSubaccounts(ownerAddress);

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

  // Get overall onboarding status
  const status = useDecibelOnboardingStatus(ownerAddress, safeBalance);

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
          functionArguments: payload.functionArguments as any,
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
  const selectedDelegationStatus = delegationStatus?.isDelegatedToExecutor ?? false;

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

  if (status.isReady && hasAnyDelegatedSubaccount) {
    return (
      <div className={cn('rounded-lg border bg-green-500/5 border-green-500/20 p-3 sm:p-4', className)}>
        <div className="flex items-center gap-2">
          <Check className="h-5 w-5 text-green-600" />
          <span className="font-medium text-green-900 dark:text-green-100">
            Ready for Decibel delta-neutral trading
          </span>
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
            Decibel delta-neutral setup
            <Badge variant="secondary" className="text-xs">
              {completedSteps}/{totalSteps}
            </Badge>
          </div>
          <div className="text-sm text-muted-foreground">
            Complete these steps to start delta-neutral trading
          </div>
        </div>
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

                {step.action && step.actionLabel && step.id !== 'delegation' && (
                  <Button
                    size="sm"
                    variant={step.action === 'deposit_safe' ? 'default' : 'outline'}
                    onClick={() => handleStepAction(step)}
                    disabled={isCreatingAccount && step.action === 'create_account'}
                  >
                    {isCreatingAccount && step.action === 'create_account' ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : step.action === 'setup_delegation' || step.action === 'deposit_decibel' ? (
                      <>
                        <ExternalLink className="h-3 w-3 mr-1.5" />
                        {step.actionLabel}
                      </>
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
                  {subaccounts.map((sub) => (
                    <SubaccountDelegationRow
                      key={sub.subaccount_address}
                      subaccount={sub}
                      isSelected={selectedSubaccount === sub.subaccount_address}
                      onSelect={() => setSelectedSubaccount(sub.subaccount_address)}
                      onDelegate={handleDelegate}
                      isDelegating={isDelegating && selectedSubaccount === sub.subaccount_address}
                    />
                  ))}
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

      {status.primarySubaccount && status.availableBalance !== undefined && (
        <div className="text-xs text-muted-foreground pt-2 border-t">
          Decibel balance: ${status.availableBalance.toFixed(2)} USDC
        </div>
      )}
    </Card>
  );
}