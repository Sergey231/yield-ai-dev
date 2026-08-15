import Panora from "@panoraexchange/swap-sdk";
import { getProtocolByName } from "@/lib/protocols/getProtocolsList";

export type PanoraQuoteMode = "exactIn" | "exactOut";

export interface PanoraSwapQuoteRequest {
  fromToken: string;
  toToken: string;
  /** Human-readable from amount (ExactIn). */
  amount?: string;
  /** Human-readable to amount (ExactOut). */
  toTokenAmount?: string;
  quoteMode?: PanoraQuoteMode;
  slippage: number;
  toWalletAddress?: string;
}

export interface PanoraSwapQuoteResponse {
  success: boolean;
  data?: any;
  error?: string;
}

interface CachedQuote {
  data: any;
  timestamp: number;
}

export class PanoraSwapService {
  private static instance: PanoraSwapService;
  private client: any;
  private quoteCache: Map<string, CachedQuote> = new Map();
  private readonly QUOTE_CACHE_TTL = 10 * 1000; // 10 seconds
  private readonly MAX_RATE_LIMIT_RETRIES = 3;

  private constructor() {
    this.client = new Panora({
      apiKey: process.env.PANORA_API_KEY || "",
      rpcUrl: process.env.APTOS_RPC_URL || "https://fullnode.mainnet.aptoslabs.com"
    });
  }

  public static getInstance(): PanoraSwapService {
    if (!PanoraSwapService.instance) {
      PanoraSwapService.instance = new PanoraSwapService();
    }
    return PanoraSwapService.instance;
  }

  private getPanoraConfig() {
    const panoraProtocol = getProtocolByName("Panora");
    return panoraProtocol?.panoraConfig;
  }

  private resolveQuoteMode(request: PanoraSwapQuoteRequest): PanoraQuoteMode {
    if (request.quoteMode) return request.quoteMode;
    return request.toTokenAmount && !request.amount ? "exactOut" : "exactIn";
  }

  private getQuoteCacheKey(request: PanoraSwapQuoteRequest, slippage: number): string {
    const wallet = request.toWalletAddress || "";
    const mode = this.resolveQuoteMode(request);
    const amt = mode === "exactOut" ? request.toTokenAmount : request.amount;
    return `${request.fromToken}:${request.toToken}:${mode}:${amt}:${wallet}:${slippage}`;
  }

  private isQuoteCacheValid(timestamp: number): boolean {
    return Date.now() - timestamp < this.QUOTE_CACHE_TTL;
  }

  private isRateLimitError(error: any): boolean {
    const status =
      error?.status ??
      error?.statusCode ??
      error?.response?.status ??
      error?.cause?.status;

    if (status === 429) return true;

    const message = String(error?.message || error?.toString?.() || "").toLowerCase();
    return message.includes("too many requests") || message.includes("rate limit");
  }

  private getRetryAfterMs(error: any, attempt: number): number {
    const header =
      error?.response?.headers?.["retry-after"] ??
      error?.headers?.["retry-after"] ??
      error?.retryAfter;

    if (header != null) {
      const seconds = parseInt(String(header), 10);
      if (!Number.isNaN(seconds) && seconds > 0) {
        return seconds * 1000;
      }
    }

    const message = String(error?.message || "");
    const match = message.match(/retry[- ]after[:\s]+(\d+)/i);
    if (match) {
      const seconds = parseInt(match[1], 10);
      if (!Number.isNaN(seconds) && seconds > 0) {
        return seconds * 1000;
      }
    }

    return Math.pow(2, attempt) * 1000;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  public async getSwapQuote(request: PanoraSwapQuoteRequest): Promise<PanoraSwapQuoteResponse> {
    try {
      console.log('Getting quote with params:', request);
      
      const panoraConfig = this.getPanoraConfig();
      
      // Ensure slippage is reasonable (minimum 0.5%, maximum 10%)
      const slippage = Math.max(0.5, Math.min(10, request.slippage));

      const cacheKey = this.getQuoteCacheKey(request, slippage);
      const cached = this.quoteCache.get(cacheKey);
      if (cached && this.isQuoteCacheValid(cached.timestamp)) {
        return {
          success: true,
          data: cached.data
        };
      }
      
      const quoteMode = this.resolveQuoteMode(request);
      const quoteRequest: Record<string, string> = {
        chainId: "1",
        fromTokenAddress: request.fromToken,
        toTokenAddress: request.toToken,
        toWalletAddress: request.toWalletAddress || "0x0000000000000000000000000000000000000000000000000000000000000000",
        slippagePercentage: slippage.toString(),
        getTransactionData: "transactionPayload",
        integratorFeeAddress: panoraConfig?.integratorFeeAddress || "0x0000000000000000000000000000000000000000000000000000000000000000",
        integratorFeePercentage: panoraConfig?.integratorFeePercentage || "0"
      };

      if (quoteMode === "exactOut") {
        if (!request.toTokenAmount) {
          return { success: false, error: "Missing toTokenAmount for ExactOut quote" };
        }
        quoteRequest.toTokenAmount = request.toTokenAmount;
      } else {
        if (!request.amount) {
          return { success: false, error: "Missing fromTokenAmount for ExactIn quote" };
        }
        quoteRequest.fromTokenAmount = request.amount;
      }

      console.log('Quote request:', quoteRequest);

      let response: any;
      let lastError: any;

      for (let attempt = 0; attempt <= this.MAX_RATE_LIMIT_RETRIES; attempt++) {
        try {
          response = await this.client.SwapQuote(quoteRequest);
          lastError = undefined;
          break;
        } catch (error: any) {
          lastError = error;
          if (!this.isRateLimitError(error) || attempt === this.MAX_RATE_LIMIT_RETRIES) {
            throw error;
          }

          const delayMs = this.getRetryAfterMs(error, attempt);
          console.warn(
            `Panora rate limited, retry ${attempt + 1}/${this.MAX_RATE_LIMIT_RETRIES} in ${delayMs}ms`
          );
          await this.sleep(delayMs);
        }
      }

      if (lastError) {
        throw lastError;
      }

      console.log('Quote received:', response);

      // Validate quote response
      if (!response || !response.quotes || response.quotes.length === 0) {
        return {
          success: false,
          error: 'Invalid quote response from Panora'
        };
      }

      const quote = response.quotes[0];
      console.log('Quote details:', {
        quoteMode,
        fromTokenAmount: quote.fromTokenAmount,
        maxFromTokenAmount: quote.maxFromTokenAmount,
        toTokenAmount: quote.toTokenAmount,
        minToTokenAmount: quote.minToTokenAmount,
        slippagePercentage: quote.slippagePercentage,
        priceImpact: quote.priceImpact
      });

      this.quoteCache.set(cacheKey, {
        data: response,
        timestamp: Date.now()
      });

      return {
        success: true,
        data: response
      };
    } catch (error: any) {
      console.error('Panora quote error:', error);
      return {
        success: false,
        error: error.message || 'Failed to get quote'
      };
    }
  }

  public async executeSwap(quoteData: any, walletAddress: string): Promise<PanoraSwapQuoteResponse> {
    try {
      console.log('Executing swap transaction...');
      console.log('Quote data:', quoteData);
      console.log('Wallet address:', walletAddress);

      const panoraConfig = this.getPanoraConfig();

      // Extract transaction payload directly from quote data
      if (quoteData.quotes && quoteData.quotes[0] && quoteData.quotes[0].transactionPayload) {
        const rawPayload = quoteData.quotes[0].transactionPayload;
        console.log('Raw transaction payload from quote:', rawPayload);

        // Validate payload structure
        if (!rawPayload.function || !rawPayload.type_arguments || !rawPayload.arguments) {
          console.error('Invalid payload structure:', rawPayload);
          return {
            success: false,
            error: 'Invalid transaction payload structure'
          };
        }

        // Log key payload information for debugging
        console.log('Payload function:', rawPayload.function);
        console.log('Payload type_arguments count:', rawPayload.type_arguments.length);
        console.log('Payload arguments count:', rawPayload.arguments.length);
        console.log('Min to token amount from quote:', quoteData.quotes[0].minToTokenAmount);
        console.log('To token amount from quote:', quoteData.quotes[0].toTokenAmount);
        console.log('Slippage percentage from quote:', quoteData.quotes[0].slippagePercentage);
        
        // Validate minToTokenAmount is present and reasonable
        if (!quoteData.quotes[0].minToTokenAmount || parseFloat(quoteData.quotes[0].minToTokenAmount) <= 0) {
          console.error('Invalid minToTokenAmount:', quoteData.quotes[0].minToTokenAmount);
          return {
            success: false,
            error: 'Invalid minimum output amount in quote'
          };
        }

        // Return payload AS-IS to preserve exact type arguments and argument encoding required by Panora
        return {
          success: true,
          data: rawPayload
        };
      }

      // Fallback: Try to get transaction payload using Swap method
      console.log('No payload in quote, trying Swap method...');
      
      try {
        const swapRequest = {
          chainId: "1",
          fromTokenAddress: quoteData.fromToken?.address || quoteData.fromTokenAddress,
          toTokenAddress: quoteData.toToken?.address || quoteData.toTokenAddress,
          fromTokenAmount: quoteData.fromTokenAmount,
          toWalletAddress: walletAddress,
          slippagePercentage: quoteData.quotes?.[0]?.slippagePercentage || "2",
          integratorFeeAddress: panoraConfig?.integratorFeeAddress || "0x0000000000000000000000000000000000000000000000000000000000000000",
          integratorFeePercentage: panoraConfig?.integratorFeePercentage || "0",
        };

        console.log('Swap request:', swapRequest);
        
        // Call Swap method but catch the error to extract the transaction payload
        try {
          await this.client.Swap(swapRequest);
        } catch (swapError: any) {
          console.log('Swap error (expected):', swapError);
          
          // Check if the error contains transaction payload
          if (swapError.transactionPayload) {
            console.log('Found transaction payload in error:', swapError.transactionPayload);
            return {
              success: true,
              data: swapError.transactionPayload
            };
          }
        }

        return {
          success: false,
          error: 'Failed to generate transaction payload'
        };
      } catch (error: any) {
        console.error('Error getting transaction payload:', error);
        return {
          success: false,
          error: error.message || 'Failed to execute swap'
        };
      }
    } catch (error: any) {
      console.error('Panora execute swap error:', error);
      return {
        success: false,
        error: error.message || 'Failed to execute swap'
      };
    }
  }

  private convertToBCSFormat(rawPayload: any): any {
    try {
      console.log('Converting payload to BCS format...');
      
      // Create a new payload with the same structure but BCS-formatted arguments
      const bcsPayload = {
        function: rawPayload.function,
        type_arguments: rawPayload.type_arguments,
        arguments: this.convertArgumentsToBCS(rawPayload.arguments)
      };

      return bcsPayload;
    } catch (error: any) {
      console.error('BCS conversion error:', error);
      // Fallback to original payload if conversion fails
      return rawPayload;
    }
  }

  private convertArgumentsToBCS(args: any[]): any[] {
    return args.map((arg, index) => {
      // Special handling for specific argument positions
      if (index === 0) {
        // Argument 0 is signer - should be null for script calls
        return null;
      }
      
      if (index === 1) {
        // Argument 1 is signer_cap - should be zero address
        return "0x0000000000000000000000000000000000000000000000000000000000000000";
      }
      
      if (arg === null) {
        return null;
      }
      
      if (typeof arg === 'string') {
        if (arg.startsWith('0x')) {
          // Keep hex strings as is for addresses and other hex values
          return arg;
        } else {
          // Convert regular strings to BCS format
          const bytes = this.stringToBytes(arg);
          const byteObj: any = {};
          bytes.forEach((byte, i) => {
            byteObj[i] = byte;
          });
          return { value: { value: byteObj } };
        }
      }
      
      if (typeof arg === 'number') {
        // Convert numbers to BCS format
        const bytes = this.numberToBytes(arg);
        const byteObj: any = {};
        bytes.forEach((byte, i) => {
          byteObj[i] = byte;
        });
        return { value: { value: byteObj } };
      }
      
      if (Array.isArray(arg)) {
        // Keep arrays as is for now - they might be complex structures
        return arg;
      }
      
      // For other types, return as is
      return arg;
    });
  }

  private hexToBytes(hex: string): number[] {
    const bytes = [];
    for (let i = 2; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return bytes;
  }

  private stringToBytes(str: string): number[] {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      bytes.push(str.charCodeAt(i));
    }
    return bytes;
  }

  private numberToBytes(num: number): number[] {
    const bytes = [];
    for (let i = 0; i < 8; i++) {
      bytes.push((num >> (i * 8)) & 0xFF);
    }
    return bytes;
  }

  private convertArrayToBCS(arr: any[]): any {
    // For now, return a simple BCS array format
    // This is a simplified version - real BCS arrays are more complex
    const elements = arr.map((item, index) => {
      if (typeof item === 'number') {
        return { value: { value: { "0": item } } };
      }
      if (typeof item === 'string') {
        return { value: { value: { "0": item } } };
      }
      if (Array.isArray(item)) {
        return this.convertArrayToBCS(item);
      }
      return item;
    });
    
    return { value: { value: elements } };
  }
}