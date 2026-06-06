"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useWallet as useSolanaWallet, useConnection } from "@solana/wallet-adapter-react";
import { SolanaWalletSelector } from "@/components/SolanaWalletSelector";

interface AttestationData {
  messages?: Array<{
    attestation?: string;
    message?: string;
    eventNonce?: string;
  }>;
}

// Helper: Fetch attestation via server-side proxy (avoids CORS issues)
async function fetchAttestation(
  sourceDomain: number,
  signature: string,
  onProgress?: (attempt: number, maxAttempts: number) => void
): Promise<AttestationData> {
  const maxAttempts = 15;
  const initialDelay = 10000; // 10 seconds
  const maxDelay = 60000; // 60 seconds

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (onProgress) {
      onProgress(attempt, maxAttempts);
    }

    const delay = Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay);
    if (attempt > 1) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    try {
      const url = `/api/cctp/attestation?domain=${sourceDomain}&signature=${encodeURIComponent(signature.trim())}`;
      console.log(`[Minting Solana] Fetching attestation, attempt ${attempt}/${maxAttempts}:`, url);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.log(`[Minting Solana] Attestation not ready yet (404), attempt ${attempt}/${maxAttempts}`);
          if (attempt === maxAttempts) {
            throw new Error(`Attestation not ready after ${maxAttempts} attempts. Please wait and try again.`);
          }
          continue;
        }

        const errorText = await response.text();
        console.error('[Minting Solana] Circle API error:', response.status, errorText);
        throw new Error(`Circle API error: ${response.status} ${response.statusText}. ${errorText}`);
      }

      const attestationData: AttestationData = await response.json();

      // Validate attestation data
      if (!attestationData.messages || attestationData.messages.length === 0) {
        throw new Error('No messages found in attestation data');
      }

      const firstMessage = attestationData.messages[0];
      
      if (!firstMessage.message) {
        throw new Error('Message field is missing');
      }
      
      if (!firstMessage.attestation) {
        throw new Error('Attestation field is missing');
      }

      // Simplified check: only verify attestation is not explicitly "PENDING"
      // Don't validate format/length as it works on Aptos without these checks
      const attestationValue = firstMessage.attestation;
      if (typeof attestationValue === 'string') {
        const upperAttestation = attestationValue.toUpperCase().trim();
        if (upperAttestation === 'PENDING' || upperAttestation === 'PENDING...') {
          console.log('[Minting Solana] Attestation still pending:', {
            attestationValue: attestationValue.substring(0, 50),
          });
          if (attempt === maxAttempts) {
            throw new Error(`Attestation not ready yet. Status: ${attestationValue.substring(0, 50)}`);
          }
          continue;
        }
      }

      console.log('[Minting Solana] Attestation received successfully:', {
        messageLength: firstMessage.message.length,
        attestationLength: firstMessage.attestation.length,
        eventNonce: firstMessage.eventNonce,
      });

      return attestationData;
    } catch (error: any) {
      if (attempt === maxAttempts) {
        throw error;
      }
      // Continue retrying for network errors
      if (error.message?.includes('Attestation not ready')) {
        continue;
      }
      // For other errors, wait a bit and retry
      console.warn(`[Minting Solana] Error on attempt ${attempt}, retrying:`, error.message);
    }
  }

  throw new Error(`Failed to fetch attestation after ${maxAttempts} attempts`);
}

export function MintSolanaForm() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const { publicKey: solanaPublicKey, wallet: solanaWallet, signTransaction } = useSolanaWallet();
  const { connection: solanaConnection } = useConnection();
  
  const SOURCE_DOMAIN_APTOS = 9;
  const [signature, setSignature] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("");
  const [attestationProgress, setAttestationProgress] = useState<{ attempt: number; maxAttempts: number } | null>(null);

  useEffect(() => {
    if (!searchParams) return;
    const sig = searchParams.get("signature");
    if (sig) setSignature(sig);
  }, [searchParams]);

  const solanaAddress = solanaPublicKey?.toBase58() || null;

  const handleMint = async () => {
    if (!signature.trim()) {
      toast({
        title: "Error",
        description: "Please enter Aptos transaction signature",
        variant: "destructive",
      });
      return;
    }

    if (!solanaWallet || !solanaPublicKey || !signTransaction) {
      toast({
        title: "Error",
        description: "Please connect a Solana wallet (e.g. Trust Wallet)",
        variant: "destructive",
      });
      return;
    }

    const formRecipientFromWallet = solanaPublicKey.toBase58();

    setIsProcessing(true);
    setStatus("");
    setAttestationProgress(null);

    try {
      console.log('[Minting Solana] Starting mint process:', {
        sourceDomain: SOURCE_DOMAIN_APTOS,
        signature: signature.substring(0, 20) + '...',
        solanaWallet: solanaWallet.adapter?.name,
        solanaAddress: formRecipientFromWallet,
      });

      setStatus("Fetching attestation from Circle Iris API...");
      const attestationData = await fetchAttestation(
        SOURCE_DOMAIN_APTOS,
        signature.trim(),
        (attempt, maxAttempts) => {
          setAttestationProgress({ attempt, maxAttempts });
          setStatus(`Waiting for attestation... (attempt ${attempt}/${maxAttempts})`);
        }
      );

      setAttestationProgress(null);
      const { performMintOnSolana } = await import('@/lib/cctp-mint-core');
      const txSignature = await performMintOnSolana(
        attestationData,
        solanaPublicKey.toBase58(),
        solanaConnection,
        solanaPublicKey,
        signTransaction,
        (s) => setStatus(s),
      );

      console.log('[Minting Solana] Transaction confirmed:', txSignature);
      toast({
        title: "Mint Successful!",
        description: `USDC minted successfully! Transaction: ${txSignature.slice(0, 8)}...${txSignature.slice(-8)}. View on Solscan: https://solscan.io/tx/${txSignature}`,
      });
      setStatus(`✅ Mint completed! Transaction: ${txSignature}`);

    } catch (error: any) {
      console.error("[Minting Solana] Error:", error);
      setStatus(`Error: ${error.message}`);
      toast({
        title: "Error",
        description: error.message || "Failed to process minting request",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
      setAttestationProgress(null);
    }
  };

  return (
    <div>
      <Card>
        <CardHeader>
          <CardTitle>Solana CCTP Minting</CardTitle>
          <CardDescription>
            Enter Aptos burn transaction signature. Connect a Solana wallet — attestation is fetched and USDC is minted to the ATA from the message (your connected wallet must own that ATA).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Solana wallet connect */}
          <SolanaWalletSelector onWalletChange={() => {}} />

          {/* Wallet Connection Status */}
          {solanaAddress ? (
            <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-md">
              <p className="text-sm text-green-800 dark:text-green-200">
                ✓ Solana wallet connected: {solanaAddress.substring(0, 8)}...{solanaAddress.slice(-8)}
              </p>
            </div>
          ) : (
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-md">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                ⚠ Please connect a Solana wallet (e.g. Trust Wallet) to proceed
              </p>
            </div>
          )}

          {/* Status Display */}
          {status && (
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md">
              <p className="text-sm text-blue-800 dark:text-blue-200">{status}</p>
              {attestationProgress && (
                <div className="mt-2">
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{
                        width: `${(attestationProgress.attempt / attestationProgress.maxAttempts) * 100}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    Attempt {attestationProgress.attempt} of {attestationProgress.maxAttempts}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <Label htmlFor="signature">Aptos transaction signature</Label>
              <Input
                id="signature"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="0x... (Aptos burn tx hash)"
                className="font-mono text-sm"
              />
              <p className="text-xs text-gray-500 mt-1">Transaction hash from Aptos burn. USDC will be minted to the ATA from the message (connected wallet must own it).</p>
            </div>

            <Button
              onClick={handleMint}
              disabled={
                isProcessing ||
                !signature.trim() ||
                !solanaWallet ||
                !signTransaction
              }
              className="w-full bg-green-600 hover:bg-green-700"
            >
              {isProcessing ? "Processing..." : "Mint USDC on Solana"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

