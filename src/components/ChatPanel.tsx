'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { SwapModal } from '@/components/ui/swap-modal';
import { YieldCalculatorModal } from '@/components/ui/yield-calculator-modal';
import { TransferModal } from '@/components/ui/transfer-modal';
import { ClaimAllRewardsModal } from '@/components/ui/claim-all-rewards-modal';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';
import { useWalletData } from '@/contexts/WalletContext';
import { useWalletStore } from '@/lib/stores/walletStore';
import type { ClaimableRewardsSummary } from '@/lib/stores/walletStore';
import { useToast } from '@/components/ui/use-toast';
import { getSolanaWalletAddress } from '@/lib/wallet/getSolanaWalletAddress';
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { getSafeSolanaRpcEndpoint } from '@/lib/solana/solanaRpcEndpoint';
import { useNativeWalletStore } from '@/lib/stores/nativeWalletStore';
import {
  isYieldAiNativeAppNow,
  postToNative,
  signAndSubmitSolanaTransaction,
} from '@/lib/mobile/nativeBridge';
import { Gift, Loader2 } from 'lucide-react';

/** Minimal shape for portfolio rows when summing USD in Tools panel */
type WalletTokenForTotal = {
  value?: string | null;
  price?: string | null;
  decimals?: number;
  amount?: string;
};

export default function ChatPanel() {
  const [isSwapModalOpen, setIsSwapModalOpen] = useState(false);
  const [isYieldCalcOpen, setIsYieldCalcOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isSolanaMemoTxPending, setIsSolanaMemoTxPending] = useState(false);
  const [isClaimRewardsOpen, setIsClaimRewardsOpen] = useState(false);
  const [isCheckingClaimRewards, setIsCheckingClaimRewards] = useState(false);
  const [claimRewardsSummary, setClaimRewardsSummary] = useState<ClaimableRewardsSummary | null>(null);
  const { account, wallet, signMessage: aptosSignMessage } = useWallet();
  const {
    connected: solanaConnected,
    publicKey: solanaPublicKey,
    wallets: solanaWallets,
    signMessage: solanaSignMessage,
    wallet: solanaWallet,
  } = useSolanaWallet();
  const { tokens } = useWalletData();
  const totalAssetsStore = useWalletStore((s) => s.totalAssets);
  const rewardsLoading = useWalletStore((s) => s.rewardsLoading);
  const fetchRewards = useWalletStore((s) => s.fetchRewards);
  const fetchPositions = useWalletStore((s) => s.fetchPositions);
  const getClaimableRewardsSummary = useWalletStore((s) => s.getClaimableRewardsSummary);
  const hyperionPositions = useWalletStore((s) => s.positions.hyperion);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const injectedSolanaAddress = useNativeWalletStore((s) => s.solanaAddress);

  // Check if any wallet is connected (Solana derived, Aptos derived, Aptos native, or direct Solana)
  const solanaAddress = useMemo(() => getSolanaWalletAddress(wallet), [wallet]);
  const aptosAddress = account?.address?.toString();
  const hasSolanaWallet = !!solanaAddress;
  // Direct Solana wallet check (covers case when Aptos derived is disconnected but Solana remains connected)
  const hasSolanaDirectWallet = solanaConnected && !!solanaPublicKey;
  // Also check adapters directly for desync scenarios
  const hasSolanaAdapterConnected = useMemo(() => {
    return solanaWallets?.some((w) => w.adapter.connected && w.adapter.publicKey) ?? false;
  }, [solanaWallets]);
  const hasAnyWallet = hasSolanaWallet || hasSolanaDirectWallet || hasSolanaAdapterConnected || !!aptosAddress;

  const walletTotal = useMemo(() => {
    return (tokens || []).reduce((sum, t: WalletTokenForTotal) => {
      let v = 0;
      if (t?.value != null) {
        const parsed = parseFloat(t.value as string);
        v = isNaN(parsed) ? 0 : parsed;
      } else if (t?.price != null) {
        const price = parseFloat(t.price as string);
        const decimals = typeof t.decimals === 'number' ? t.decimals : 8;
        const raw = parseFloat(t.amount as string);
        const amount = isNaN(raw) ? 0 : raw / Math.pow(10, decimals);
        v = (isNaN(price) ? 0 : price) * amount;
      }
      return sum + (isFinite(v) ? v : 0);
    }, 0);
  }, [tokens]);

  const totalAssets = useMemo(() => {
    if (totalAssetsStore && totalAssetsStore > 0) return totalAssetsStore;
    return walletTotal;
  }, [totalAssetsStore, walletTotal]);

  const activeClaimProtocolCount = useMemo(() => {
    if (!claimRewardsSummary?.protocols) return 0;
    return Object.values(claimRewardsSummary.protocols).filter((protocol) => protocol.count > 0).length;
  }, [claimRewardsSummary]);

  const hasClaimRewards =
    !!claimRewardsSummary &&
    claimRewardsSummary.totalValue > 0 &&
    activeClaimProtocolCount > 0;

  const claimButtonChecking = isCheckingClaimRewards || rewardsLoading;
  const claimButtonSubtitle = claimButtonChecking
    ? 'Checking rewards...'
    : hasClaimRewards
      ? `$${claimRewardsSummary.totalValue.toFixed(2)} - ${activeClaimProtocolCount} protocol${activeClaimProtocolCount !== 1 ? 's' : ''}`
      : claimRewardsSummary
        ? 'No rewards found'
        : 'Check available';

  const handlePortfolioTracker = () => {
    // Tracker: любой подключённый Aptos или Solana; иначе — страница ввода адреса
    if (hasAnyWallet) {
      router.push('/portfolio/tracker');
    } else {
      router.push('/portfolio');
    }
  };

  const handleBridgeUSDC = () => {
    if (account?.address) {
      // Navigate to bridge page with destination address as query parameter
      // router.push(`/bridge?destination=${encodeURIComponent(account.address.toString())}`);
      router.push(`/bridge`);
    } else {
      // Show toast if wallet is not connected
      toast({
        variant: 'destructive',
        title: 'Wallet Not Connected',
        description: 'Please connect your native Aptos wallet to bridge USDC',
      });
    }
  };

  const makeRequestId = useCallback(() => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }, []);

  const bytesToBase64 = useCallback((bytes: Uint8Array) => {
    let binary = '';
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary);
  }, []);

  const getSolanaFeePayerBase58 = useCallback((): string | null => {
    const injected = injectedSolanaAddress?.trim();
    if (injected) return injected;
    if (solanaPublicKey) return solanaPublicKey.toBase58();
    return null;
  }, [injectedSolanaAddress, solanaPublicKey]);

  const handleSignSolanaMemoTx = useCallback(async () => {
    try {
      if (isSolanaMemoTxPending) {
        throw new Error('A Solana transaction request is already pending');
      }

      const feePayerBase58 = getSolanaFeePayerBase58();
      if (!feePayerBase58) {
        throw new Error('Solana address is not available');
      }

      const connection = new Connection(getSafeSolanaRpcEndpoint(), 'confirmed');
      const { blockhash } = await connection.getLatestBlockhash('confirmed');

      const memoProgramId = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
      const memoData = new TextEncoder().encode(`Hello from Yield AI (memo tx)`);

      const tx = new Transaction();
      tx.feePayer = new PublicKey(feePayerBase58);
      tx.recentBlockhash = blockhash;
      tx.add(
        new TransactionInstruction({
          programId: memoProgramId,
          keys: [],
          data: Buffer.from(memoData),
        }),
      );

      const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      const txBase64 = bytesToBase64(raw);

      if (isYieldAiNativeAppNow()) {
        setIsSolanaMemoTxPending(true);
        toast({
          title: 'Transaction requested',
          description: 'Please approve the Solana memo transaction in your wallet.',
        });

        const txid = await signAndSubmitSolanaTransaction(txBase64);
        toast({
          title: 'Transaction submitted',
          description: `Tx id: ${txid.slice(0, 12)}...${txid.slice(-12)}`,
        });
        return;
      }

      // Browser fallback: send via wallet adapter if available
      const adapter = solanaWallet?.adapter as { sendTransaction?: (t: Transaction, c: Connection) => Promise<string> };
      if (adapter && typeof adapter.sendTransaction === 'function') {
        await adapter.sendTransaction(tx, connection);
        toast({ title: 'Transaction sent', description: 'Solana memo transaction submitted.' });
        return;
      }

      throw new Error('Solana sendTransaction is not available in this environment');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'Signing failed', description: msg || 'Unknown error' });
    } finally {
      setIsSolanaMemoTxPending(false);
    }
  }, [bytesToBase64, getSolanaFeePayerBase58, isSolanaMemoTxPending, solanaWallet, toast]);

  const handleSignSolanaHello = useCallback(async () => {
    const message = 'Hello from Yield AI';
    try {
      if (isYieldAiNativeAppNow()) {
        const requestId = makeRequestId();
        const ok = postToNative('sign_message', {
          chain: 'solana',
          message,
          requestId,
        });
        if (!ok) throw new Error('Native bridge not available');
        toast({
          title: 'Requested signature',
          description: `Solana sign-message sent to native (requestId: ${requestId}).`,
        });
        return;
      }

      const adapter =
        solanaWallet?.adapter && typeof (solanaWallet.adapter as { signMessage?: (msg: Uint8Array) => Promise<unknown> }).signMessage === 'function'
          ? (solanaWallet.adapter as { signMessage: (msg: Uint8Array) => Promise<unknown> })
          : null;
      const sign =
        solanaSignMessage ??
        (adapter ? (msg: Uint8Array) => adapter.signMessage(msg) : null);
      if (!sign) {
        throw new Error('Solana signMessage is not available in this environment');
      }
      await sign(new TextEncoder().encode(message));
      toast({ title: 'Message signed', description: 'Solana signature created.' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'Signing failed', description: msg || 'Unknown error' });
    }
  }, [makeRequestId, solanaSignMessage, solanaWallet, toast]);

  const handleSignAptosHello = useCallback(async () => {
    const message = 'Hello from Yield AI';
    try {
      if (isYieldAiNativeAppNow()) {
        const requestId = makeRequestId();
        const ok = postToNative('sign_message', {
          chain: 'aptos',
          message,
          requestId,
        });
        if (!ok) throw new Error('Native bridge not available');
        toast({
          title: 'Requested signature',
          description: `Aptos sign-message sent to native (requestId: ${requestId}).`,
        });
        return;
      }

      if (!aptosSignMessage) {
        throw new Error('Aptos signMessage is not available in this environment');
      }
      await aptosSignMessage({
        message,
        nonce: Date.now().toString(),
        address: true,
        application: true,
        chainId: true,
      } as Parameters<typeof aptosSignMessage>[0]);
      toast({ title: 'Message signed', description: 'Aptos signature created.' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: 'destructive', title: 'Signing failed', description: msg || 'Unknown error' });
    }
  }, [aptosSignMessage, makeRequestId, toast]);

  const handleTransfer = () => {
    if (account?.address) {
      setIsTransferModalOpen(true);
    } else {
      toast({
        variant: 'destructive',
        title: 'Wallet Not Connected',
        description: 'Please connect your Aptos wallet to transfer tokens',
      });
    }
  };

  const handleClaimRewards = useCallback(async () => {
    if (!aptosAddress) {
      toast({
        variant: 'destructive',
        title: 'Wallet Not Connected',
        description: 'Please connect your Aptos wallet to check claimable rewards',
      });
      return;
    }

    if (hasClaimRewards) {
      setIsClaimRewardsOpen(true);
      return;
    }

    setIsCheckingClaimRewards(true);

    try {
      await Promise.all([
        fetchRewards(aptosAddress, undefined, true),
        fetchPositions(aptosAddress, ['hyperion'], true),
      ]);

      const nextSummary = await getClaimableRewardsSummary();
      setClaimRewardsSummary(nextSummary);

      const protocolCount = Object.values(nextSummary.protocols).filter((protocol) => protocol.count > 0).length;
      if (nextSummary.totalValue > 0 && protocolCount > 0) {
        setIsClaimRewardsOpen(true);
      } else {
        toast({
          title: 'No claimable rewards',
          description: 'Checked Echelon and Hyperion.',
        });
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Failed to check rewards',
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsCheckingClaimRewards(false);
    }
  }, [
    aptosAddress,
    fetchPositions,
    fetchRewards,
    getClaimableRewardsSummary,
    hasClaimRewards,
    toast,
  ]);

  // Handle query parameter to open calculator
  useEffect(() => {
    if (!searchParams) return;
    const calculatorParam = searchParams.get('calculator');
    if (calculatorParam === 'true') {
      setIsYieldCalcOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    setClaimRewardsSummary(null);
    setIsClaimRewardsOpen(false);
  }, [aptosAddress]);

  /** Native-only debug signing controls (hidden in browser). Handshake sets __YIELDAI_NATIVE_APP__. */
  const [showNativeDebugTools, setShowNativeDebugTools] = useState(false);
  useEffect(() => {
    const sync = () => setShowNativeDebugTools(isYieldAiNativeAppNow());
    sync();
    window.addEventListener('yieldai:native-ready', sync);
    return () => window.removeEventListener('yieldai:native-ready', sync);
  }, []);

  // Handle closing calculator and removing query parameter
  const handleCloseCalculator = useCallback(() => {
    setIsYieldCalcOpen(false);
    // Remove calculator parameter from URL
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.delete('calculator');
    params.delete('apr');
    params.delete('deposit');
    const newSearch = params.toString();
    const newUrl = newSearch ? `${window.location.pathname}?${newSearch}` : window.location.pathname;
    router.replace(newUrl);
  }, [searchParams, router]);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Tools</h1>
        <ThemeToggle />
      </div>
      <div className="mt-4 flex flex-col gap-2 w-full">
        <Button
          variant="outline"
          onClick={handleClaimRewards}
          disabled={claimButtonChecking}
          className={`flex items-center gap-2 w-full justify-start ${hasClaimRewards ? 'border-success/40 text-success hover:bg-success/10' : ''}`}
        >
          {claimButtonChecking ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <Gift className="h-4 w-4 shrink-0" />
          )}
          <span className="flex min-w-0 flex-col items-start leading-tight">
            <span className="truncate">Claim Rewards</span>
            <span className="truncate text-xs font-normal text-muted-foreground">
              {claimButtonSubtitle}
            </span>
          </span>
        </Button>
        <Button
          variant="outline"
          onClick={() => setIsSwapModalOpen(true)}
          className="flex items-center gap-2 w-full justify-start"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          Swap
        </Button>
        <Button
          variant="outline"
          onClick={handleTransfer}
          className="flex items-center gap-2 w-full justify-start"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
          Transfer
        </Button>
        <Button
          variant="outline"
          onClick={() => setIsYieldCalcOpen(true)}
          className="flex items-center gap-2 w-full justify-start"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          Yield Calculator
        </Button>
        <Button
          variant="outline"
          onClick={handlePortfolioTracker}
          className="flex items-center gap-2 w-full justify-start"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Portfolio Tracker
        </Button>
        {hasAnyWallet && (
          <Button
            variant="outline"
            onClick={handleBridgeUSDC}
            className="flex items-center gap-2 w-full justify-start"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Bridge USDC
          </Button>
        )}
      </div>

      {/* Compact Footer - Mobile only */}
      <div className="mt-8 pt-4 border-t border-border md:hidden">
        <div className="flex flex-col items-center gap-3">
          {/* Social Links */}
          <div className="flex items-center gap-4">
            <Link
              href="https://x.com/yieldai_app"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Yield AI
            </Link>
            <Link
              href="https://x.com/ssadkov"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Founder
            </Link>
            <Link
              href="https://home.yieldai.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
              </svg>
              Home
            </Link>
          </div>

          {/* Share Feedback Button */}
          <Link href="https://forms.gle/NEpu5DjsmhVUprA5A" passHref target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="text-xs">
              Share Feedback
            </Button>
          </Link>

          {showNativeDebugTools ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={handleSignSolanaMemoTx}
                disabled={isSolanaMemoTxPending}
              >
                {isSolanaMemoTxPending ? 'Submitting...' : 'Sign tx (Solana Memo)'}
              </Button>
              <Button variant="outline" size="sm" className="text-xs" onClick={handleSignSolanaHello}>
                Sign message (Solana)
              </Button>
              <Button variant="outline" size="sm" className="text-xs" onClick={handleSignAptosHello}>
                Sign message (Aptos)
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Desktop Footer - X links + Share Feedback */}
      <div className="mt-8 pt-4 border-t border-border hidden md:block">
        <div className="flex flex-col items-center gap-3">
          {/* Social Links */}
          <div className="flex items-center gap-4">
            <Link
              href="https://x.com/yieldai_app"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Yield AI
            </Link>
            <Link
              href="https://x.com/ssadkov"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Founder
            </Link>
          </div>

          {/* Share Feedback Button */}
          <Link href="https://forms.gle/NEpu5DjsmhVUprA5A" passHref target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="sm" className="text-xs">
              Share Feedback
            </Button>
          </Link>

          {showNativeDebugTools ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={handleSignSolanaMemoTx}
                disabled={isSolanaMemoTxPending}
              >
                {isSolanaMemoTxPending ? 'Submitting...' : 'Sign tx (Solana Memo)'}
              </Button>
              <Button variant="outline" size="sm" className="text-xs" onClick={handleSignSolanaHello}>
                Sign message (Solana)
              </Button>
              <Button variant="outline" size="sm" className="text-xs" onClick={handleSignAptosHello}>
                Sign message (Aptos)
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <SwapModal isOpen={isSwapModalOpen} onClose={() => setIsSwapModalOpen(false)} />
      <TransferModal isOpen={isTransferModalOpen} onClose={() => setIsTransferModalOpen(false)} />
      {claimRewardsSummary && (
        <ClaimAllRewardsModal
          isOpen={isClaimRewardsOpen}
          onClose={() => setIsClaimRewardsOpen(false)}
          summary={claimRewardsSummary}
          positions={hyperionPositions}
        />
      )}
      <YieldCalculatorModal
        isOpen={isYieldCalcOpen}
        onClose={handleCloseCalculator}
        totalAssets={totalAssets}
        walletTotal={walletTotal}
        initialApr={(() => {
          const aprParam = searchParams?.get('apr');
          if (!aprParam) return undefined;
          const aprValue = parseFloat(aprParam);
          return Number.isFinite(aprValue) && aprValue > 0 ? aprValue : undefined;
        })()}
        initialDeposit={(() => {
          const depositParam = searchParams?.get('deposit');
          if (!depositParam) return undefined;
          const depositValue = parseFloat(depositParam);
          return Number.isFinite(depositValue) && depositValue >= 0 ? depositValue : undefined;
        })()}
      />
    </div>
  );
}
