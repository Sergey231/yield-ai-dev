"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

// Aptos mainnet config (для работы с боевым USDC CCTP v1)
const aptosConfig = new AptosConfig({ network: Network.MAINNET });
const aptosClient = new Aptos(aptosConfig);

// Entry-функция, которую ты показал из Aptos Explorer
const CCTP_RECEIVE_FN =
  "0xdb4058f273ce5fb86fffba7ce0436c6711a6f9997c1c4eed1a0aaccd6cd4bc6c::cctp_v1_receive_with_gas_drop_off::handle_receive_message_entry";

// Для удобства — твой Solana tx по умолчанию
const DEFAULT_SOLANA_TX =
  "34765YUsCvzkUD1ruUFhrbeUmnxsiycHsxUnuKCfk71QiPqnSKaXPed2XrvuPQA4aVofhMSS8BLX6TNkHwbSK6Aj";

function CctpRedeemTestPageContent() {
  const searchParams = useSearchParams();
  const { account, signAndSubmitTransaction } = useWallet();
  const { toast } = useToast();

  const [solanaTx, setSolanaTx] = useState<string>(DEFAULT_SOLANA_TX);
  const [messageHex, setMessageHex] = useState<string>("");
  const [attestationHex, setAttestationHex] = useState<string>("");
  const [gasDropAmount, setGasDropAmount] = useState<string>("0"); // в Octas (1e-8 APT)
  const [status, setStatus] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isFetchingAttestation, setIsFetchingAttestation] = useState<boolean>(false);
  const [circleApiKey, setCircleApiKey] = useState<string>("");
  const [computedDepositMessageHash, setComputedDepositMessageHash] = useState<string>("");
  const [isComputingHash, setIsComputingHash] = useState<boolean>(false);
  const [cctpMessageFromStorage, setCctpMessageFromStorage] = useState<any>(null);
  const [txInfo, setTxInfo] = useState<any>(null);
  const [isCheckingTx, setIsCheckingTx] = useState<boolean>(false);
  const [solscanData, setSolscanData] = useState<string>("");
  const [isComputingFromSolscan, setIsComputingFromSolscan] = useState<boolean>(false);
  const [computedFromSolscan, setComputedFromSolscan] = useState<any>(null);
  const [aptosRecipientAddress, setAptosRecipientAddress] = useState<string>(""); // Aptos address for mintRecipient (optional)

  // Read query parameters and auto-fill fields
  useEffect(() => {
    if (!searchParams) return;
    const messageHash = searchParams.get('messageHash');
    const txSignature = searchParams.get('txSignature');

    if (messageHash) {
      // If messageHash is provided, we can try to fetch attestation from Circle
      setStatus("MessageHash found in URL. You can fetch attestation from Circle API.");
    }

    if (txSignature) {
      setSolanaTx(txSignature);
    }
  }, [searchParams]);

  // Read CCTP message from localStorage and compute depositMessageHash
  const computeDepositMessageHashFromLocalStorage = async () => {
    setIsComputingHash(true);
    setStatus("Reading CCTP message from localStorage...");
    setComputedDepositMessageHash("");

    try {
      // Check multiple possible localStorage keys
      const possibleKeys = ['cctp_transfers'];

      let cctpMessage = null;
      let transferData = null;
      let foundKey = null;

      // Try each possible key
      for (const storageKey of possibleKeys) {
        try {
          const data = localStorage.getItem(storageKey);
          if (!data) continue;

          let transfers: any[] = [];
          
          try {
            const parsed = JSON.parse(data);
            // Handle both array and single object
            if (Array.isArray(parsed)) {
              transfers = parsed;
            } else if (parsed && typeof parsed === 'object') {
              // Could be a single transfer object or object with transfers array
              if (parsed.transfers && Array.isArray(parsed.transfers)) {
                transfers = parsed.transfers;
              } else if (parsed.receipt?.attestation?.message) {
                // Single transfer object
                transfers = [parsed];
              } else if (Array.isArray(parsed.data)) {
                transfers = parsed.data;
              }
            }
          } catch (parseError) {
            console.warn(`[CCTP Redeem Test] Failed to parse data from ${storageKey}:`, parseError);
            continue;
          }

          // Search through transfers for CCTP message
          for (const transfer of transfers) {
            // Check different possible paths to CCTP message
            const messagePaths = [
              transfer.receipt?.attestation?.message,
              transfer.attestation?.attestation?.message,
              transfer.attestation?.message,
              transfer.message,
              transfer.cctpMessage,
            ];

            for (const message of messagePaths) {
              if (message && typeof message === 'object' && message.sourceDomain !== undefined && message.destinationDomain !== undefined) {
                cctpMessage = message;
                transferData = transfer;
                foundKey = storageKey;
                console.log('[CCTP Redeem Test] Found CCTP message at path:', 
                  message === transfer.receipt?.attestation?.attestation?.message ? 'receipt.attestation.attestation.message' :
                  message === transfer.receipt?.attestation?.message ? 'receipt.attestation.message' :
                  message === transfer.attestation?.attestation?.message ? 'attestation.attestation.message' :
                  message === transfer.attestation?.message ? 'attestation.message' :
                  'other'
                );
                break;
              }
            }

            if (cctpMessage) break;
          }

          if (cctpMessage) break;
        } catch (e: any) {
          console.warn(`[CCTP Redeem Test] Error reading ${storageKey}:`, e.message);
          continue;
        }
      }

      // If still not found, list all localStorage keys for debugging
      if (!cctpMessage) {
        const allKeys = Object.keys(localStorage);
        const relevantKeys = allKeys.filter((key) => key.toLowerCase().includes('cctp') || key.toLowerCase().includes('transfer'));
        
        console.log('[CCTP Redeem Test] Available localStorage keys:', allKeys);
        console.log('[CCTP Redeem Test] Relevant keys:', relevantKeys);
        
        // Try to show what's in relevant keys
        const debugInfo: any = {};
        for (const key of relevantKeys.slice(0, 5)) { // Limit to first 5 to avoid too much data
          try {
            const data = localStorage.getItem(key);
            if (data) {
              debugInfo[key] = {
                length: data.length,
                preview: data.substring(0, 200),
                isJSON: (() => {
                  try {
                    JSON.parse(data);
                    return true;
                  } catch {
                    return false;
                  }
                })(),
              };
            }
          } catch (e) {
            debugInfo[key] = { error: 'Could not read' };
          }
        }
        
        console.log('[CCTP Redeem Test] Debug info for relevant keys:', debugInfo);
        
        throw new Error(
          `CCTP message not found in localStorage. ` +
          `Checked keys: ${possibleKeys.join(', ')}. ` +
          `Found relevant keys: ${relevantKeys.join(', ')}. ` +
          `Make sure you have completed a CCTP transfer on /bridge page. ` +
          `Check console for debug info.`
        );
      }

      console.log('[CCTP Redeem Test] Found CCTP message in localStorage:', {
        key: foundKey,
        message: cctpMessage,
        transferData,
      });

      setCctpMessageFromStorage(cctpMessage);
      setStatus("CCTP message found! Computing depositMessageHash...");

      // Send to API endpoint for computation
      const response = await fetch('/api/compute-deposit-message-hash', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: cctpMessage,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `API error: ${response.status}`);
      }

      const result = await response.json();
      const depositMessageHash = result.depositMessageHash || result.messageHash;

      if (!depositMessageHash) {
        throw new Error('API did not return depositMessageHash');
      }

      setComputedDepositMessageHash(depositMessageHash);
      setStatus(`✅ depositMessageHash computed successfully: ${depositMessageHash.slice(0, 16)}...${depositMessageHash.slice(-8)}`);

      // Also update solanaTx if available
      if (transferData.txHash || transferData.txDetails?.sendTx) {
        setSolanaTx(transferData.txHash || transferData.txDetails.sendTx);
      }

      toast({
        title: "depositMessageHash Computed",
        description: `Successfully computed: ${depositMessageHash.slice(0, 16)}...${depositMessageHash.slice(-8)}`,
      });

      console.log('[CCTP Redeem Test] Computed depositMessageHash:', {
        depositMessageHash,
        cctpMessage,
        transferData,
      });

    } catch (error: any) {
      console.error('[CCTP Redeem Test] Error computing depositMessageHash:', error);
      setStatus(`❌ Error: ${error.message || 'Failed to compute depositMessageHash'}`);
      toast({
        variant: "destructive",
        title: "Computation Failed",
        description: error.message || "Could not compute depositMessageHash from localStorage.",
      });
    } finally {
      setIsComputingHash(false);
    }
  };

  // Check Solana transaction to verify it's a CCTP burn
  const checkSolanaTransaction = async () => {
    if (!solanaTx.trim()) {
      toast({
        variant: "destructive",
        title: "Missing transaction signature",
        description: "Please enter Solana transaction signature first.",
      });
      return;
    }

    setIsCheckingTx(true);
    setStatus("Checking Solana transaction...");

    try {
      const { Connection } = await import('@solana/web3.js');
      const connection = new Connection(
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 
        process.env.SOLANA_RPC_URL || 
        'https://mainnet.helius-rpc.com/?api-key=29798653-2d13-4d8a-96ad-df70b015e234',
        'confirmed'
      );

      const tx = await connection.getTransaction(solanaTx.trim(), {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) {
        throw new Error('Transaction not found');
      }

      const logs = tx.meta?.logMessages || [];
      
      // Get instructions count (for VersionedTransaction, we need to check compiled instructions)
      let instructionsCount = 0;
      try {
        if (tx.transaction.message.getAccountKeys) {
          const accountKeys = tx.transaction.message.getAccountKeys();
          instructionsCount = accountKeys.staticAccountKeys.length;
        }
      } catch (e) {
        // Ignore
      }
      
      // Check if this is a CCTP burn transaction
      const isCCTP = logs.some((log: string) => 
        log.includes('TokenMessenger') || 
        log.includes('DepositForBurn') ||
        log.includes('CCTP') ||
        log.includes('Circle') ||
        log.includes('message_hash') ||
        log.includes('messageHash')
      );

      // Try to extract CCTP message data from transaction events/logs
      let extractedCCTPMessage: any = null;
      if (isCCTP && tx.meta?.innerInstructions) {
        // Look for CCTP message data in inner instructions or events
        for (const innerIxGroup of tx.meta.innerInstructions) {
          for (const innerIx of innerIxGroup.instructions) {
            // Check instruction data for CCTP message
            if (innerIx.data) {
              try {
                const dataStr = Buffer.from(innerIx.data, 'base64').toString('hex');
                // CCTP message might be in instruction data
                console.log('[CCTP Redeem Test] Inner instruction data:', dataStr.substring(0, 100));
              } catch (e) {
                // Ignore
              }
            }
          }
        }
      }

      // Extract program IDs
      const programIds = new Set<string>();
      try {
        if (tx.transaction.message.getAccountKeys) {
          const accountKeys = tx.transaction.message.getAccountKeys();
          accountKeys.staticAccountKeys.forEach((key: any) => {
            programIds.add(key.toBase58());
          });
        }
      } catch (e) {
        // Ignore
      }

      setTxInfo({
        signature: solanaTx.trim(),
        slot: tx.slot,
        blockTime: tx.blockTime,
        success: tx.meta?.err === null,
        isCCTP,
        logsCount: logs.length,
        instructionsCount: instructionsCount,
        programIds: Array.from(programIds),
        logs: logs.slice(0, 20), // First 20 logs
        fee: tx.meta?.fee,
      });

      setStatus(
        `Transaction checked. ` +
        `Success: ${tx.meta?.err === null ? 'Yes' : 'No'}, ` +
        `Is CCTP: ${isCCTP ? 'Yes' : 'Unknown'}, ` +
        `Logs: ${logs.length}, ` +
        `Programs: ${programIds.size}`
      );

      toast({
        title: "Transaction Checked",
        description: isCCTP 
          ? "This appears to be a CCTP transaction. Check details below."
          : "Transaction found, but CCTP indicators not detected. Check details below.",
      });

    } catch (error: any) {
      console.error("[CCTP Redeem Test] Error checking transaction:", error);
      setStatus(`Error checking transaction: ${error.message || 'Unknown error'}`);
      toast({
        variant: "destructive",
        title: "Failed to Check Transaction",
        description: error.message || "Could not check Solana transaction.",
      });
    } finally {
      setIsCheckingTx(false);
    }
  };

  // Convert Solscan data to CCTP message and compute depositMessageHash
  const computeFromSolscanData = async () => {
    if (!solscanData.trim()) {
      toast({
        variant: "destructive",
        title: "Missing data",
        description: "Please paste Solscan data (JSON format).",
      });
      return;
    }

    setIsComputingFromSolscan(true);
    setStatus("Parsing Solscan data and computing depositMessageHash...");
    setComputedFromSolscan(null);
    setComputedDepositMessageHash("");

    try {
      // Parse Solscan JSON data
      let solscanJson: any;
      try {
        solscanJson = JSON.parse(solscanData.trim());
      } catch (e) {
        throw new Error("Invalid JSON format. Please paste valid JSON from Solscan.");
      }

      // Extract required fields from Solscan data
      const nonce = solscanJson.nonce?.data || solscanJson.nonce;
      const burnToken = solscanJson.burnToken?.data || solscanJson.burnToken;
      const amount = solscanJson.amount?.data || solscanJson.amount;
      const depositor = solscanJson.depositor?.data || solscanJson.depositor;
      const mintRecipientSolscan = solscanJson.mintRecipient?.data || solscanJson.mintRecipient;
      const destinationDomain = solscanJson.destinationDomain?.data || solscanJson.destinationDomain;
      const destinationTokenMessenger = solscanJson.destinationTokenMessenger?.data || solscanJson.destinationTokenMessenger;
      const destinationCaller = solscanJson.destinationCaller?.data || solscanJson.destinationCaller;

      if (!nonce || !burnToken || !amount || !depositor || !destinationDomain) {
        throw new Error("Missing required fields in Solscan data. Required: nonce, burnToken, amount, depositor, destinationDomain");
      }

      // IMPORTANT: mintRecipient in Solscan is a Solana public key, but in CCTP message it MUST be Aptos address!
      // Use aptosRecipientAddress if provided, otherwise try to use Solana pubkey bytes.
      // This might be wrong; prefer passing the real Aptos recipient address.
      const mintRecipientAptosAddress = aptosRecipientAddress.trim() || null;
      
      if (!mintRecipientAptosAddress && !mintRecipientSolscan) {
        throw new Error("Missing mintRecipient. Please provide Aptos recipient address in the field below, or include mintRecipient in Solscan data.");
      }

      // Import Solana web3.js for public key conversion
      const { PublicKey } = await import('@solana/web3.js');

      // Helper function to convert Solana public key to 32-byte array (address object format)
      const solanaPubkeyToAddressObj = (pubkeyStr: string): { address: { [key: number]: number } } => {
        try {
          const pubkey = new PublicKey(pubkeyStr);
          const bytes = pubkey.toBytes();
          const addressObj: { [key: number]: number } = {};
          for (let i = 0; i < 32; i++) {
            addressObj[i] = bytes[i] || 0;
          }
          return { address: addressObj };
        } catch (e) {
          throw new Error(`Invalid Solana public key: ${pubkeyStr}`);
        }
      };

      // Helper function to convert Aptos address (hex string) to 32-byte array (address object format)
      const aptosAddressToAddressObj = (aptosAddr: string): { address: { [key: number]: number } } => {
        try {
          // Remove 0x prefix if present
          let hex = aptosAddr.startsWith('0x') ? aptosAddr.slice(2) : aptosAddr;
          // Pad to 64 hex chars (32 bytes)
          hex = hex.padStart(64, '0');
          // Convert to bytes
          const bytes = new Uint8Array(32);
          for (let i = 0; i < 32; i++) {
            bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
          }
          const addressObj: { [key: number]: number } = {};
          for (let i = 0; i < 32; i++) {
            addressObj[i] = bytes[i] || 0;
          }
          return { address: addressObj };
        } catch (e) {
          throw new Error(`Invalid Aptos address: ${aptosAddr}`);
        }
      };

      // Helper function to convert destinationCaller (can be Solana pubkey or all zeros)
      const destinationCallerToAddressObj = (caller: string): { address: { [key: number]: number } } => {
        // If it's all 1s (SystemProgram), return all zeros
        if (caller === "11111111111111111111111111111111" || caller === "0x11111111111111111111111111111111") {
          const addressObj: { [key: number]: number } = {};
          for (let i = 0; i < 32; i++) {
            addressObj[i] = 0;
          }
          return { address: addressObj };
        }
        // Otherwise, try to convert as Solana pubkey
        try {
          return solanaPubkeyToAddressObj(caller);
        } catch {
          // If it fails, return all zeros
          const addressObj: { [key: number]: number } = {};
          for (let i = 0; i < 32; i++) {
            addressObj[i] = 0;
          }
          return { address: addressObj };
        }
      };

      // Build CCTP message structure
      // sourceDomain = 5 (Solana)
      // destinationDomain = 9 (Aptos) or from data
      // sender = depositor (Solana public key)
      // recipient = destinationTokenMessenger (Solana public key, but represents Aptos address)
      // destinationCaller = destinationCaller (or all zeros)
      // payload.burnToken = burnToken (Solana public key)
      // payload.mintRecipient = Aptos address (NOT Solana public key!)
      // payload.amount = amount
      // payload.messageSender = depositor (Solana public key)

      // For mintRecipient: MUST be Aptos address, not Solana public key!
      // Use provided Aptos address if available, otherwise try Solana pubkey bytes (might be wrong!)
      let mintRecipientAddressObj: { address: { [key: number]: number } };
      if (mintRecipientAptosAddress) {
        // Use provided Aptos address (correct way)
        mintRecipientAddressObj = aptosAddressToAddressObj(mintRecipientAptosAddress);
        console.log('[CCTP Redeem Test] Using provided Aptos address for mintRecipient:', mintRecipientAptosAddress);
      } else if (mintRecipientSolscan) {
        // Fallback: try to use Solana pubkey bytes (WARNING: this might be wrong!)
        console.warn('[CCTP Redeem Test] WARNING: Using Solana public key bytes as Aptos address. This might be incorrect! Provide the Aptos recipient address.');
        mintRecipientAddressObj = solanaPubkeyToAddressObj(mintRecipientSolscan);
      } else {
        throw new Error("mintRecipient is required. Please provide Aptos recipient address.");
      }

      const cctpMessage = {
        sourceDomain: 5, // Solana
        destinationDomain: Number(destinationDomain), // Aptos (9)
        nonce: String(nonce),
        sender: solanaPubkeyToAddressObj(depositor),
        recipient: solanaPubkeyToAddressObj(destinationTokenMessenger),
        destinationCaller: destinationCallerToAddressObj(destinationCaller || "11111111111111111111111111111111"),
        payload: {
          burnToken: solanaPubkeyToAddressObj(burnToken),
          mintRecipient: mintRecipientAddressObj, // Use Solana pubkey bytes as Aptos address
          amount: String(amount),
          messageSender: solanaPubkeyToAddressObj(depositor),
        },
      };

      console.log('[CCTP Redeem Test] Built CCTP message from Solscan:', cctpMessage);
      console.log('[CCTP Redeem Test] CCTP message details:', {
        sourceDomain: cctpMessage.sourceDomain,
        destinationDomain: cctpMessage.destinationDomain,
        nonce: cctpMessage.nonce,
        senderBytes: Array.from(Object.values(cctpMessage.sender.address)).slice(0, 8),
        recipientBytes: Array.from(Object.values(cctpMessage.recipient.address)).slice(0, 8),
        mintRecipientBytes: Array.from(Object.values(cctpMessage.payload.mintRecipient.address)).slice(0, 8),
        amount: cctpMessage.payload.amount,
      });

      // Send to API endpoint for computation
      const response = await fetch('/api/compute-deposit-message-hash', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: cctpMessage,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `API error: ${response.status}`);
      }

      const result = await response.json();
      const depositMessageHash = result.depositMessageHash || result.messageHash;

      if (!depositMessageHash) {
        throw new Error('API did not return depositMessageHash');
      }

      setComputedDepositMessageHash(depositMessageHash);
      setComputedFromSolscan({
        cctpMessage,
        depositMessageHash,
        solscanData: solscanJson,
        computedAt: new Date().toISOString(),
      });

      // Compare with known working example (nonce 633206)
      const knownWorkingHash = "0x0e39029ce0051267f554a8cf7ab7d2082656f03ab5a955caa76249cf58a60ce1";
      const isKnownExample = nonce === "633206" || nonce === 633206;
      
      let statusMessage = `✅ depositMessageHash computed from Solscan data: ${depositMessageHash.slice(0, 16)}...${depositMessageHash.slice(-8)}`;
      
      if (isKnownExample) {
        if (depositMessageHash.toLowerCase() === knownWorkingHash.toLowerCase()) {
          statusMessage += `\n✅ Hash matches known working example (nonce 633206)!`;
        } else {
          statusMessage += `\n⚠️ Hash does NOT match known working example. Expected: ${knownWorkingHash}`;
        }
      } else {
        statusMessage += `\n📋 Next: Use this hash to fetch attestation from Circle API.`;
        statusMessage += `\n⏱️ If attestation is "pending", wait 2-5 minutes after burn transaction.`;
        statusMessage += `\n🔍 Verify transaction on Solscan: Check if burn was successful.`;
      }
      
      setStatus(statusMessage);

      toast({
        title: "depositMessageHash Computed",
        description: `Successfully computed from Solscan data: ${depositMessageHash.slice(0, 16)}...${depositMessageHash.slice(-8)}`,
      });

    } catch (error: any) {
      console.error('[CCTP Redeem Test] Error computing from Solscan data:', error);
      setStatus(`❌ Error: ${error.message || 'Failed to compute depositMessageHash from Solscan data'}`);
      toast({
        variant: "destructive",
        title: "Computation Failed",
        description: error.message || "Could not compute depositMessageHash from Solscan data.",
      });
    } finally {
      setIsComputingFromSolscan(false);
    }
  };

  // Try to get attestation by transaction signature (alternative method)
  const fetchAttestationByTxSignature = async () => {
    if (!solanaTx.trim() || !circleApiKey.trim()) {
      toast({
        variant: "destructive",
        title: "Missing data",
        description: "Please provide Solana transaction signature and Circle API key.",
      });
      return;
    }

    setIsFetchingAttestation(true);
    setStatus("Trying to fetch attestation by transaction signature...");

    try {
      // Try different Circle API endpoints
      const baseUrl = "https://xreserve-api.circle.com";
      
      // Method 1: Try query by txHash (if supported)
      const url1 = `${baseUrl}/v1/attestations?txHash=${solanaTx.trim()}`;
      const response1 = await fetch(url1, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${circleApiKey.trim()}`,
        },
      });

      if (response1.ok) {
        const data = await response1.json();
        if (data.attestations && Array.isArray(data.attestations) && data.attestations.length > 0) {
          const attestation = data.attestations[0];
          if (attestation.payload && attestation.attestation) {
            setMessageHex(attestation.payload);
            setAttestationHex(attestation.attestation);
            if (attestation.messageHash) {
              setComputedDepositMessageHash(attestation.messageHash);
            }
            setStatus(`Attestation fetched successfully by transaction signature!`);
            toast({
              title: "Attestation Fetched",
              description: "Message and attestation have been automatically filled from Circle API.",
            });
            setIsFetchingAttestation(false);
            return;
          }
        }
      }

      // Method 2: If txHash query doesn't work, we need depositMessageHash
      setStatus("Could not fetch by txHash. You need depositMessageHash. Try computing it from localStorage first.");
      toast({
        variant: "default",
        title: "Need depositMessageHash",
        description: "Circle API requires depositMessageHash. Compute it from localStorage first.",
      });
    } catch (error: any) {
      console.error("[CCTP Redeem] Error fetching attestation by tx:", error);
      setStatus(`Error: ${error.message || "Unknown error"}`);
      toast({
        variant: "destructive",
        title: "Failed to Fetch Attestation",
        description: error.message || "Could not fetch attestation from Circle API.",
      });
    } finally {
      setIsFetchingAttestation(false);
    }
  };

  // Fetch attestation from Circle API using messageHash
  const fetchAttestationFromCircle = async () => {
    // Try to get messageHash from computed value, URL param, or input
    let messageHash = computedDepositMessageHash || searchParams?.get('messageHash');
    
    if (!messageHash || !circleApiKey.trim()) {
      toast({
        variant: "destructive",
        title: "Missing data",
        description: computedDepositMessageHash 
          ? "Please provide Circle API key." 
          : "Please compute depositMessageHash first or provide Circle API key and messageHash.",
      });
      return;
    }

    setIsFetchingAttestation(true);
    setStatus("Fetching attestation from Circle API...");

    try {
      const url = `https://xreserve-api.circle.com/v1/attestations/${messageHash}`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${circleApiKey.trim()}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        const errorJson = JSON.parse(errorText);
        
        if (errorJson.message?.includes('pending or not available')) {
          setStatus(`Attestation is still pending. This usually takes 2-5 minutes after burn transaction. Your transaction was successful, please wait and try again later.`);
          toast({
            variant: "default",
            title: "Attestation Pending",
            description: "Attestation is still being generated by Circle. Please wait 2-5 minutes and try again. If it's been more than 15 minutes, there may be an issue.",
          });
        } else {
          throw new Error(`Circle API error: ${response.status} - ${errorText}`);
        }
        return;
      }

      const json = await response.json();

      if (json.payload && json.attestation) {
        setMessageHex(json.payload);
        setAttestationHex(json.attestation);
        setStatus(`Attestation fetched successfully! Message and attestation are now filled.`);
        toast({
          title: "Attestation Fetched",
          description: "Message and attestation have been automatically filled from Circle API.",
        });
      } else {
        throw new Error("Invalid response format from Circle API");
      }
    } catch (error: any) {
      console.error("[CCTP Redeem] Error fetching attestation:", error);
      setStatus(`Error fetching attestation: ${error.message || "Unknown error"}`);
      toast({
        variant: "destructive",
        title: "Failed to Fetch Attestation",
        description: error.message || "Could not fetch attestation from Circle API.",
      });
    } finally {
      setIsFetchingAttestation(false);
    }
  };

  const handleRedeem = async () => {
    if (!account?.address) {
      toast({
        variant: "destructive",
        title: "Aptos wallet not connected",
        description: "Подключи Aptos-кошелёк на основной сети и попробуй снова.",
      });
      return;
    }

    if (!messageHex.trim() || !attestationHex.trim()) {
      toast({
        variant: "destructive",
        title: "Missing data",
        description: "Нужны и message, и attestation (в hex / 0x-формате), чтобы сделать redeem.",
      });
      return;
    }

    setIsSubmitting(true);
    setStatus("Формируем Aptos-транзакцию redeem...");

    try {
      // Нормализуем аргументы: Aptos ожидает 0x-prefixed hex для vector<u8>
      const msgArg =
        messageHex.startsWith("0x") || messageHex.startsWith("0X")
          ? messageHex
          : `0x${messageHex}`;
      const attArg =
        attestationHex.startsWith("0x") || attestationHex.startsWith("0X")
          ? attestationHex
          : `0x${attestationHex}`;

      const toAddress = account.address.toString();
      const amountU64 = BigInt(gasDropAmount || "0"); // gasDropAmount в Octas (1e-8 APT)

      const payload = {
        data: {
          function: CCTP_RECEIVE_FN,
          typeArguments: [] as string[],
          functionArguments: [msgArg, attArg, toAddress, amountU64],
        },
      };

      setStatus("Отправляем транзакцию в Aptos...");

      const res = await signAndSubmitTransaction(payload as any);

      setStatus(
        `Транзакция отправлена: ${res.hash}. Ждём подтверждения в сети Aptos...`
      );

      await aptosClient.waitForTransaction({ transactionHash: res.hash });

      const explorerUrl = `https://explorer.aptoslabs.com/txn/${res.hash}?network=mainnet`;
      setStatus(
        `Redeem успешно! Hash: ${res.hash}. Посмотреть в Aptos Explorer: ${explorerUrl}`
      );

      toast({
        title: "Redeem успешен",
        description: `USDC должен был сминтиться на ${toAddress}. Проверь баланс и транзакцию: ${explorerUrl}`,
      });
    } catch (e: any) {
      console.error("[CCTP Redeem Test] Error:", e);
      setStatus(`Ошибка redeem: ${e?.message || "Unknown error"}`);
      toast({
        variant: "destructive",
        title: "Redeem failed",
        description: e?.message || "Не удалось выполнить redeem на Aptos.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-gray-50 via-white to-gray-100">
      <Card className="w-full max-w-2xl border-2">
        <CardHeader>
          <CardTitle>Test CCTP Redeem on Aptos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Страница для ручного redeem одного CCTP v1 сообщения Solana → Aptos.
            <br />
            <b>Шаги:</b>
            <br />1) Скопировать данные из Solscan (depositForBurn event) и вычислить <code>depositMessageHash</code>
            <br />2) Получить <code>message</code> и <code>attestation</code> от Circle API по <code>depositMessageHash</code>
            <br />3) Вставить их сюда и отправить redeem на Aptos.
          </p>

          {/* Compute depositMessageHash from Solscan data */}
          <div className="bg-purple-50 border-2 border-purple-200 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-purple-800">⭐ Compute depositMessageHash from Solscan Data (Recommended)</h3>
            <p className="text-xs text-muted-foreground">
              <b>Для новых транзакций:</b> Если ваша транзакция не в localStorage, используйте этот метод.
              <br />
              Скопируйте JSON данные из Solscan (вкладка "Events" → depositForBurn event) и вставьте сюда.
              <br />
              Формат: <code>{"{nonce: {data: '...'}, burnToken: {data: '...'}, ...}"}</code>
              <br />
              <b>Пример:</b> nonce: 635280, 635528 и т.д. (ваши транзакции)
              <br />
              <b>⚠️ Важно:</b> Убедитесь, что транзакция была успешной на Solscan перед попыткой получить attestation!
            </p>
            <div className="space-y-2">
              <Label htmlFor="solscanData">Solscan Event Data (JSON)</Label>
              <textarea
                id="solscanData"
                value={solscanData}
                onChange={(e) => setSolscanData(e.target.value)}
                placeholder={`{
  "nonce": {"type": "u64", "data": "635280"},
  "burnToken": {"type": "publicKey", "data": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"},
  "amount": {"type": "u64", "data": "10000"},
  "depositor": {"type": "publicKey", "data": "9XL5jCCsn6bkf8DTW8uug9nqN8ssjWX2qkRwZqQnDu4C"},
  "mintRecipient": {"type": "publicKey", "data": "DZizQGAJC9h163BSsDWGFjSCCCc2CYqJgnUvczdRbeNj"},
  "destinationDomain": {"type": "u32", "data": 9},
  "destinationTokenMessenger": {"type": "publicKey", "data": "BfLX7F4MwxDbiDRv9bkfuK13oPreGKzsHqke6rNfogKn"},
  "destinationCaller": {"type": "publicKey", "data": "11111111111111111111111111111111"}
}`}
                className="w-full min-h-[200px] p-2 text-xs font-mono border rounded"
              />
              <div>
                <Label htmlFor="aptosRecipientAddress">
                  Aptos Recipient Address <span className="text-red-600">*Recommended*</span>
                </Label>
                <Input
                  id="aptosRecipientAddress"
                  type="text"
                  value={aptosRecipientAddress}
                  onChange={(e) => setAptosRecipientAddress(e.target.value)}
                  placeholder="0xbaae4e8fcd07785903c2031523c42b42d92a3f83e5aad3a88bc3200f0ff22b30"
                  className="font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  <b>Важно:</b> В Solscan mintRecipient - это Solana public key, но в CCTP message нужен Aptos address!
                  <br />
                  Скопируйте адрес получателя (например: <code>0xbaae4e8fcd07785903c2031523c42b42d92a3f83e5aad3a88bc3200f0ff22b30</code>)
                  <br />
                  Или используйте <code>recipient</code> из txDetails в localStorage (например: <code>0xe58a37f1c2b89c0f729abfc348b92735cf712bb167d52f70c8f44fdd75de75e1</code>)
                </p>
              </div>
              <Button
                onClick={computeFromSolscanData}
                disabled={isComputingFromSolscan || !solscanData.trim()}
                className="w-full bg-purple-600 hover:bg-purple-700"
              >
                {isComputingFromSolscan ? "Computing..." : "Compute depositMessageHash from Solscan Data"}
              </Button>
            </div>
            {computedFromSolscan && (
              <div className="mt-2 p-2 bg-white rounded border">
                <p className="text-xs font-medium text-purple-700 mb-1">Computed depositMessageHash:</p>
                <p className="text-xs font-mono break-all text-purple-800">{computedFromSolscan.depositMessageHash}</p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(computedFromSolscan.depositMessageHash);
                      toast({ title: "Copied!", description: "depositMessageHash copied to clipboard" });
                    }}
                  >
                    Copy Hash
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const url = `/cctp-list-attestations?messageHash=${encodeURIComponent(computedFromSolscan.depositMessageHash)}`;
                      window.open(url, '_blank');
                    }}
                  >
                    Get Attestation
                  </Button>
                </div>
                <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs">
                  <p className="font-medium text-blue-800 mb-1">📋 Следующие шаги:</p>
                  <ol className="list-decimal list-inside space-y-1 text-blue-700">
                    <li>Скопируйте depositMessageHash (кнопка выше)</li>
                    <li>Используйте кнопку "Get Attestation" или перейдите в секцию "Fetch Attestation from Circle API" ниже</li>
                    <li>Введите Circle API Key и получите message + attestation</li>
                    <li>Заполните поля "CCTP message" и "Circle attestation" ниже</li>
                    <li>Нажмите "Redeem CCTP message на Aptos"</li>
                  </ol>
                </div>
                <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
                  <p className="font-medium text-yellow-800 mb-1">⚠️ Если attestation "pending or not available":</p>
                  <ul className="list-disc list-inside space-y-1 text-yellow-700">
                    <li><b>Проверьте транзакцию на Solscan:</b> Убедитесь, что burn был успешным</li>
                    <li><b>Проверьте время:</b> Attestation генерируется 2-5 минут после burn. Если прошло больше 15 минут - может быть проблема</li>
                    <li><b>Проверьте hash:</b> Убедитесь, что depositMessageHash правильный (сравните с известным примером nonce 633206)</li>
                    <li><b>Проверьте Aptos address:</b> Убедитесь, что вы указали правильный Aptos address для mintRecipient (не Solana public key!)</li>
                    <li><b>Проверьте Circle API key:</b> Убедитесь, что API key имеет правильные права доступа</li>
                    <li><b>Попробуйте позже:</b> Circle API может иметь временные проблемы</li>
                  </ul>
                </div>
                <details className="mt-2">
                  <summary className="text-xs text-muted-foreground cursor-pointer">Show CCTP Message (click to expand)</summary>
                  <pre className="text-[10px] mt-2 p-2 bg-white rounded border overflow-auto max-h-40">
                    {JSON.stringify(computedFromSolscan.cctpMessage, null, 2)}
                  </pre>
                </details>
              </div>
            )}
          </div>

          {/* Compute depositMessageHash from localStorage */}
          <div className="bg-green-50 border-2 border-green-200 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-green-800">Compute depositMessageHash from localStorage (Old transactions only)</h3>
            <p className="text-xs text-muted-foreground">
              <b>Только для старых транзакций:</b> Если транзакция была сохранена в localStorage.
              <br />
              Читает CCTP message из localStorage
              и вычисляет depositMessageHash используя keccak256.
              <br />
              <b>Примечание:</b> Если ваша транзакция не в localStorage (например, nonce 635280, 635528), используйте метод выше (Solscan Data).
            </p>
            <Button
              onClick={computeDepositMessageHashFromLocalStorage}
              disabled={isComputingHash}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              {isComputingHash ? "Computing..." : "Compute depositMessageHash from localStorage"}
            </Button>
            {computedDepositMessageHash && (
              <div className="mt-2 p-2 bg-white rounded border">
                <p className="text-xs font-medium text-green-700 mb-1">Computed depositMessageHash:</p>
                <p className="text-xs font-mono break-all text-green-800">{computedDepositMessageHash}</p>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(computedDepositMessageHash);
                      toast({ title: "Copied!", description: "depositMessageHash copied to clipboard" });
                    }}
                  >
                    Copy
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const url = `/cctp-list-attestations?messageHash=${encodeURIComponent(computedDepositMessageHash)}`;
                      window.open(url, '_blank');
                    }}
                  >
                    Get Attestation
                  </Button>
                </div>
              </div>
            )}
            {cctpMessageFromStorage && (
              <details className="mt-2">
                <summary className="text-xs text-muted-foreground cursor-pointer">Show CCTP Message (click to expand)</summary>
                <pre className="text-[10px] mt-2 p-2 bg-white rounded border overflow-auto max-h-40">
                  {JSON.stringify(cctpMessageFromStorage, null, 2)}
                </pre>
              </details>
            )}
          </div>

          {/* Auto-fetch attestation section */}
          <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-blue-800">Fetch Attestation from Circle API</h3>
            <div className="space-y-2">
              <div>
                <Label htmlFor="circleApiKey">Circle API Key</Label>
                <Input
                  id="circleApiKey"
                  type="password"
                  value={circleApiKey}
                  onChange={(e) => setCircleApiKey(e.target.value)}
                  placeholder="sk_live_..."
                  className="font-mono text-xs"
                />
              </div>
              
              {/* Method 1: By depositMessageHash */}
              {(searchParams?.get('messageHash') || computedDepositMessageHash) && (
                <div className="space-y-2">
                  <Button
                    onClick={fetchAttestationFromCircle}
                    disabled={isFetchingAttestation || !circleApiKey.trim()}
                    className="w-full bg-blue-600 hover:bg-blue-700"
                  >
                    {isFetchingAttestation ? "Fetching..." : "Fetch Attestation by depositMessageHash"}
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    Using depositMessageHash: {(computedDepositMessageHash || searchParams?.get('messageHash'))?.slice(0, 16)}...
                    {(computedDepositMessageHash || searchParams?.get('messageHash'))?.slice(-8)}
                  </p>
                </div>
              )}
              
              {/* Method 2: By transaction signature (alternative) */}
              {solanaTx.trim() && (
                <div className="space-y-2 pt-2 border-t">
                  <Button
                    onClick={fetchAttestationByTxSignature}
                    disabled={isFetchingAttestation || !circleApiKey.trim()}
                    variant="outline"
                    className="w-full"
                  >
                    {isFetchingAttestation ? "Trying..." : "Try Fetch by Transaction Signature"}
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    Alternative method: Try to get attestation directly by transaction signature (may not be supported by Circle API)
                  </p>
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <Label htmlFor="solanaTx">Solana tx hash (информативно)</Label>
              <Button
                size="sm"
                variant="outline"
                onClick={checkSolanaTransaction}
                disabled={isCheckingTx || !solanaTx.trim()}
                className="text-xs"
              >
                {isCheckingTx ? "Checking..." : "Check Transaction"}
              </Button>
            </div>
            <Input
              id="solanaTx"
              type="text"
              value={solanaTx}
              onChange={(e) => setSolanaTx(e.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Это tx с DepositForBurn. Здесь он нужен только для
              справки/привязки, сам redeem использует message+attestation.
            </p>
            {txInfo && (
              <div className="mt-2 p-2 bg-muted rounded text-xs">
                <p className="font-medium mb-1">Transaction Info:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Success: {txInfo.success ? '✅ Yes' : '❌ No'}</li>
                  <li>Is CCTP: {txInfo.isCCTP ? '✅ Yes' : '❓ Unknown'}</li>
                  <li>Slot: {txInfo.slot}</li>
                  <li>Logs: {txInfo.logsCount}</li>
                  <li>Programs: {txInfo.programIds.length}</li>
                  {txInfo.logs && txInfo.logs.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer">Show logs (first 20)</summary>
                      <pre className="mt-1 p-2 bg-background rounded text-[10px] overflow-auto max-h-40">
                        {txInfo.logs.join('\n')}
                      </pre>
                    </details>
                  )}
                </ul>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="messageHex">CCTP message (hex / 0x...)</Label>
            <Input
              id="messageHex"
              type="text"
              value={messageHex}
              onChange={(e) => setMessageHex(e.target.value)}
              placeholder="0x..."
              className="font-mono text-xs"
            />
          </div>

          <div>
            <Label htmlFor="attHex">Circle attestation (hex / 0x...)</Label>
            <Input
              id="attHex"
              type="text"
              value={attestationHex}
              onChange={(e) => setAttestationHex(e.target.value)}
              placeholder="0x..."
              className="font-mono text-xs"
            />
          </div>

          <div>
            <Label htmlFor="gasDrop">Gas drop amount (APT, в целых APT)</Label>
            <Input
              id="gasDrop"
              type="number"
              min="0"
              step="0.00000001"
              value={gasDropAmount}
              onChange={(e) => {
                const v = e.target.value || "0";
                // конвертируем APT → Octas (1e8)
                try {
                  const apt = parseFloat(v);
                  if (Number.isNaN(apt) || apt < 0) {
                    setGasDropAmount("0");
                  } else {
                    const octas = BigInt(Math.floor(apt * 1e8));
                    setGasDropAmount(octas.toString());
                  }
                } catch {
                  setGasDropAmount("0");
                }
              }}
              placeholder="0 (без gas drop)"
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Это параметр <code>amount</code> в{" "}
              <code>handle_receive_message_entry</code>. Значение даётся в Octas
              (1e-8 APT). По умолчанию 0.
            </p>
          </div>

          {status && (
            <div className="p-3 bg-muted rounded text-xs whitespace-pre-wrap break-words">
              {status}
            </div>
          )}

          <Button
            onClick={handleRedeem}
            disabled={isSubmitting || !account?.address}
            className="w-full h-11 text-sm font-semibold"
          >
            {isSubmitting ? "Отправка redeem..." : "Redeem CCTP message на Aptos"}
          </Button>

          <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
            <p>
              • Эта страница ничего не делает автоматически с Circle API —{" "}
              <b>нужно самостоятельно получить message и attestation</b> по
              Solana tx.
            </p>
            <p>
              • Она только помогает проверить, что вызов Move‑функции{" "}
              <code>cctp_v1_receive_with_gas_drop_off::handle_receive_message_entry</code>{" "}
              работает для твоего кейса.
            </p>
            {computedDepositMessageHash && (
              <div className="mt-2 p-2 bg-yellow-50 border border-yellow-200 rounded">
                <p className="font-medium text-yellow-800 mb-1">⚠️ If attestation is "pending or not available":</p>
                <ul className="list-disc list-inside space-y-1 text-yellow-700">
                  <li>Wait 2-5 minutes after burn transaction (your tx was 2 hours ago, so it should be ready)</li>
                  <li>Verify the depositMessageHash is correct (computed above)</li>
                  <li>Check if the transaction was actually a CCTP burn (use "Check Transaction" button)</li>
                  <li>Try fetching again - Circle API may have temporary issues</li>
                  <li>Verify your Circle API key has correct permissions</li>
                </ul>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CctpRedeemTestPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <CctpRedeemTestPageContent />
    </Suspense>
  );
}

