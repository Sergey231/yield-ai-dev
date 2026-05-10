'use client';

import { useMemo } from 'react';
import { useDecibelSubaccounts } from './useDecibelSubaccounts';
import { useDecibelDelegation } from './useDecibelDelegation';
import { useDecibelAccountBalance } from './useDecibelAccountBalance';

export type DecibelOnboardingStep = {
  id: 'account' | 'delegation' | 'balance_decibel' | 'balance_safe';
  label: string;
  status: 'completed' | 'required' | 'loading' | 'error';
  error?: string;
  action?: 'create_account' | 'setup_delegation' | 'deposit_decibel' | 'deposit_safe';
  actionLabel?: string;
};

export type DecibelOnboardingStatus = {
  isReady: boolean;
  steps: DecibelOnboardingStep[];
  primarySubaccount?: string;
  availableBalance?: number;
};

const MIN_TRADING_BALANCE = 20; // $20 USDC minimum

export function useDecibelOnboardingStatus(
  ownerAddress: string | undefined,
  safeBalance?: number,
  opts?: { enabled?: boolean }
) {
  const enabled = (opts?.enabled ?? true) && Boolean(ownerAddress);

  // Step 1: Check if Decibel account exists
  const {
    data: subaccounts = [],
    isLoading: isLoadingSubaccounts,
    error: subaccountsError
  } = useDecibelSubaccounts(ownerAddress, { enabled });

  const primarySubaccount = useMemo(() => {
    return subaccounts.find(sub => sub.is_primary && sub.is_active)?.subaccount_address;
  }, [subaccounts]);

  // Step 2: Check delegation for primary subaccount
  const {
    data: delegationStatus,
    isLoading: isLoadingDelegation,
    error: delegationError
  } = useDecibelDelegation(primarySubaccount, { enabled: Boolean(primarySubaccount) });

  // Step 3: Check Decibel account balance
  const {
    data: accountBalance,
    isLoading: isLoadingBalance,
    error: balanceError
  } = useDecibelAccountBalance(primarySubaccount, { enabled: Boolean(primarySubaccount) });

  const status = useMemo((): DecibelOnboardingStatus => {
    const steps: DecibelOnboardingStep[] = [];

    // Step 1: Decibel account
    const hasAccount = subaccounts.length > 0 && Boolean(primarySubaccount);
    steps.push({
      id: 'account',
      label: 'Decibel account',
      status: isLoadingSubaccounts
        ? 'loading'
        : subaccountsError
          ? 'error'
          : hasAccount
            ? 'completed'
            : 'required',
      error: subaccountsError?.message,
      action: hasAccount ? undefined : 'create_account',
      actionLabel: hasAccount ? undefined : 'Create Decibel account',
    });

    // Step 2: Delegation (only if account exists)
    if (hasAccount) {
      const isDelegated = delegationStatus?.isDelegatedToExecutor ?? false;
      steps.push({
        id: 'delegation',
        label: 'Bot delegation',
        status: isLoadingDelegation
          ? 'loading'
          : delegationError
            ? 'error'
            : isDelegated
              ? 'completed'
              : 'required',
        error: delegationError?.message,
        action: isDelegated ? undefined : 'setup_delegation',
        actionLabel: isDelegated ? undefined : 'Setup delegation',
      });

      // Step 3: Decibel balance
      const decibelBalance = accountBalance?.usdc_cross_withdrawable_balance ?? 0;
      const hasMinDecibelBalance = decibelBalance >= MIN_TRADING_BALANCE;
      steps.push({
        id: 'balance_decibel',
        label: `Decibel balance (≥$${MIN_TRADING_BALANCE} USDC)`,
        status: isLoadingBalance
          ? 'loading'
          : balanceError
            ? 'error'
            : hasMinDecibelBalance
              ? 'completed'
              : 'required',
        error: balanceError?.message,
        action: hasMinDecibelBalance ? undefined : 'deposit_decibel',
        actionLabel: hasMinDecibelBalance ? undefined : 'Deposit to Decibel',
      });
    }

    // Step 4: Safe balance (always check if we have a safe balance)
    if (typeof safeBalance === 'number') {
      const hasMinSafeBalance = safeBalance >= MIN_TRADING_BALANCE;
      steps.push({
        id: 'balance_safe',
        label: `Safe balance (≥$${MIN_TRADING_BALANCE} USDC)`,
        status: hasMinSafeBalance ? 'completed' : 'required',
        action: hasMinSafeBalance ? undefined : 'deposit_safe',
        actionLabel: hasMinSafeBalance ? undefined : 'Deposit USDC to Safe',
      });
    }

    const isReady = steps.every(step => step.status === 'completed');

    return {
      isReady,
      steps,
      primarySubaccount,
      availableBalance: accountBalance?.usdc_cross_withdrawable_balance,
    };
  }, [
    subaccounts,
    primarySubaccount,
    delegationStatus,
    accountBalance,
    safeBalance,
    isLoadingSubaccounts,
    isLoadingDelegation,
    isLoadingBalance,
    subaccountsError,
    delegationError,
    balanceError,
  ]);

  return status;
}