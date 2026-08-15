'use client';

import { useEffect } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  CustomAptosConnectDialogContent,
  WALLET_CONNECT_MODAL_DIALOG_CLASS,
} from '@/components/wallet/customAptosConnectDialogContent';

export interface WalletConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Wallet-connect modal, mirroring the Deposit button's "not connected" flow.
 * Auto-closes once an Aptos wallet connects so the caller can proceed.
 */
export function WalletConnectDialog({ open, onOpenChange }: WalletConnectDialogProps) {
  const { connected } = useWallet();

  useEffect(() => {
    if (connected && open) onOpenChange(false);
  }, [connected, open, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={WALLET_CONNECT_MODAL_DIALOG_CLASS}>
        <CustomAptosConnectDialogContent
          close={() => onOpenChange(false)}
          mode="deposit"
          dialogOpen={open}
        />
      </DialogContent>
    </Dialog>
  );
}
