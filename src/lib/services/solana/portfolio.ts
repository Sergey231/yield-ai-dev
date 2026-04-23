import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { Token } from "@/lib/types/token";
import { JupiterTokenMetadataService } from "./tokenMetadata";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

// Jupiter "receipt" mints (jl* / JUICED) that mirror protocol positions.
// We exclude them from wallet token list to avoid double-counting deposits.
const JUPITER_RECEIPT_MINT_EXCLUDE = new Set<string>([
  // jlUSDG
  "9fvHrYNw1A8Evpcj7X2yy4k4fT7nNHcA9L6UsamNHAif",
  // jlUSDT
  "Cmn4v2wipYV41dkakDvCgFJpxhtaaKt11NyWV8pjSE8A",
  // jlUSDS
  "j14XLJZSVMcUYpAfajdZRpnfHUpJieZHS4aPektLWvh",
  // JUICED (jupUSD receipt)
  "7GxATsNMnaC88vdwd2t3mwrFuQwwGvmYPrUQ4D6FotXk",
  // jlUSDC
  "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D",
  // jlEURC
  "GcV9tEj62VncGithz4o4N9x6HWXARxuRgEAYk9zahNA8",
]);

const KNOWN_TOKENS: Record<string, { symbol: string; name: string; logoUrl?: string }> = {
  [WRAPPED_SOL_MINT]: { symbol: "SOL", name: "Solana", logoUrl: "/token_ico/sol.png" },
};

export interface SolanaPortfolio {
  tokens: Token[];
  totalValueUsd: number;
}

type ParsedTokenAccount =
  Awaited<ReturnType<Connection["getParsedTokenAccountsByOwner"]>>["value"][number];

export class SolanaPortfolioService {
  private static instance: SolanaPortfolioService;
  private connection: Connection;
  private rpcEndpoints: string[];
  private static readonly PRICE_TTL_MS = 30_000;
  private static priceCache = new Map<string, { price: number; expiresAt: number }>();
  private static inFlightPriceBatches = new Map<string, Promise<Record<string, number>>>();

  private constructor() {
    // Build robust RPC list with key-safe Helius handling.
    const directEnvEndpoints = [
      process.env.SOLANA_RPC_URL,
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
    ]
      .filter(Boolean)
      .map((endpoint) => this.normalizeRpcEndpoint(endpoint as string))
      .filter(Boolean) as string[];
    const fallbackHelius = this.buildHeliusEndpointFromKey();

    this.rpcEndpoints = [
      ...directEnvEndpoints,
      ...(fallbackHelius ? [fallbackHelius] : []),
      "https://rpc.ankr.com/solana",
      clusterApiUrl("mainnet-beta"),
    ];
    // Deduplicate while preserving order.
    this.rpcEndpoints = Array.from(new Set(this.rpcEndpoints));

    const endpoint = this.rpcEndpoints[0] || clusterApiUrl("mainnet-beta");
    this.connection = new Connection(endpoint, "confirmed");
  }

  private buildHeliusEndpointFromKey(): string | null {
    const apiKey =
      process.env.SOLANA_RPC_API_KEY ||
      process.env.NEXT_PUBLIC_SOLANA_RPC_API_KEY ||
      "";
    if (!apiKey) return null;
    return `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  }

  private normalizeRpcEndpoint(endpoint: string): string | null {
    try {
      const parsed = new URL(endpoint);
      const isHelius = parsed.hostname.includes("helius-rpc.com");
      if (!isHelius) return parsed.toString();

      const keyInUrl = parsed.searchParams.get("api-key");
      if (keyInUrl && keyInUrl.trim().length > 0) return parsed.toString();

      const apiKey =
        process.env.SOLANA_RPC_API_KEY ||
        process.env.NEXT_PUBLIC_SOLANA_RPC_API_KEY ||
        "";
      if (!apiKey) return null;
      parsed.searchParams.set("api-key", apiKey);
      return parsed.toString();
    } catch {
      return null;
    }
  }

  static getInstance(): SolanaPortfolioService {
    if (!SolanaPortfolioService.instance) {
      SolanaPortfolioService.instance = new SolanaPortfolioService();
    }
    return SolanaPortfolioService.instance;
  }

  /**
   * Raw SPL + Token-2022 amounts by mint (summed across token accounts).
   * Unlike `getPortfolio`, does **not** skip accounts where `uiAmount` is null/0 — needed for
   * Jupiter jl* receipt matching when RPC omits uiAmount.
   */
  async getRawSplBalancesByMint(address: string): Promise<Map<string, bigint>> {
    const owner = new PublicKey(address);
    const loaded = await this.fetchParsedTokenAccountsWithLamports(owner);
    const map = new Map<string, bigint>();
    for (const { account } of loaded.accounts) {
      const parsed = account.data as {
        program: string;
        parsed?: {
          info?: {
            mint?: string;
            tokenAmount?: {
              amount?: string;
            };
          };
          parsed?: {
            info?: {
              mint?: string;
              tokenAmount?: {
                amount?: string;
              };
            };
          };
        };
      };

      const tokenBlock = parsed.parsed as
        | {
            info?: { mint?: string; tokenAmount?: { amount?: string } };
            parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string } } };
          }
        | undefined;
      const info = tokenBlock?.info ?? tokenBlock?.parsed?.info;
      const mint = info?.mint;
      const tokenAmount = info?.tokenAmount;
      if (!mint || !tokenAmount) continue;

      let raw: bigint;
      try {
        raw = BigInt(String(tokenAmount.amount ?? "0").split(".")[0] || "0");
      } catch {
        continue;
      }
      if (raw <= BigInt(0)) continue;

      map.set(mint, (map.get(mint) ?? BigInt(0)) + raw);
    }

    return map;
  }

  private async fetchParsedTokenAccountsWithLamports(
    owner: PublicKey
  ): Promise<{ accounts: ParsedTokenAccount[]; lamports: number }> {
    let lastError: Error | null = null;
    for (const endpoint of this.rpcEndpoints) {
      try {
        const connection = new Connection(endpoint, "confirmed");
        const [legacyAccounts, token2022Accounts, balance] = await Promise.all([
          connection.getParsedTokenAccountsByOwner(
            owner,
            { programId: TOKEN_PROGRAM_ID },
            "confirmed",
          ),
          connection.getParsedTokenAccountsByOwner(
            owner,
            { programId: TOKEN_2022_PROGRAM_ID },
            "confirmed",
          ),
          connection.getBalance(owner, "confirmed"),
        ]);

        const parsedTokenAccounts: ParsedTokenAccount[] = [
          ...(legacyAccounts?.value ?? []),
          ...(token2022Accounts?.value ?? []),
        ];

        this.connection = connection;
        return { accounts: parsedTokenAccounts, lamports: balance };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to fetch portfolio from ${endpoint}:`, message);
        lastError = error instanceof Error ? error : new Error(message);
        continue;
      }
    }

    throw lastError ?? new Error("Failed to fetch parsed token accounts from all RPC endpoints");
  }

  async getPortfolio(address: string): Promise<SolanaPortfolio> {
    const owner = new PublicKey(address);

    const loaded = await this.fetchParsedTokenAccountsWithLamports(owner);
    const parsedTokenAccounts = loaded.accounts;
    const lamports = loaded.lamports;

    const tokens: Token[] = [];

    for (const { account } of parsedTokenAccounts) {
      const parsed = account.data as {
        program: string;
        parsed?: {
          info?: {
            mint?: string;
            tokenAmount?: {
              amount?: string;
              decimals?: number;
              uiAmount?: number | null;
              uiAmountString?: string;
            };
          };
        };
      };

      const info = parsed.parsed?.info;
      const mint = info?.mint;
      const tokenAmount = info?.tokenAmount;

      if (!mint || !tokenAmount) {
        continue;
      }

      if (JUPITER_RECEIPT_MINT_EXCLUDE.has(mint)) {
        continue;
      }

      const rawAmount = tokenAmount.amount ?? "0";
      const uiAmount = tokenAmount.uiAmount ?? parseFloat(tokenAmount.uiAmountString ?? "0");
      const decimals = tokenAmount.decimals ?? 0;

      if (!uiAmount || uiAmount <= 0) {
        continue;
      }

      tokens.push({
        address: mint,
        name: KNOWN_TOKENS[mint]?.name ?? mint,
        symbol: KNOWN_TOKENS[mint]?.symbol ?? `${mint.slice(0, 4)}…`,
        decimals,
        amount: rawAmount,
        price: null,
        value: null,
      });
    }

    const hasWrappedSol = tokens.some((token) => token.address === WRAPPED_SOL_MINT);
    if (!hasWrappedSol && lamports > 0) {
      tokens.push({
        address: WRAPPED_SOL_MINT,
        name: KNOWN_TOKENS[WRAPPED_SOL_MINT].name,
        symbol: KNOWN_TOKENS[WRAPPED_SOL_MINT].symbol,
        decimals: 9,
        amount: lamports.toString(),
        price: null,
        value: null,
      });
    }

    console.log(`[SolanaPortfolio] 📊 Processing ${tokens.length} tokens before metadata`);
    tokens.forEach((token, idx) => {
      console.log(`[SolanaPortfolio] Token ${idx + 1}:`, {
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        amount: token.amount,
        hasLogoUrl: !!token.logoUrl,
      });
    });

    const metadataService = JupiterTokenMetadataService.getInstance();
    // Avoid depending on Jupiter metadata for SOL (frequently rate-limited); use known local fallback.
    const requestedMints = tokens.map((token) => token.address).filter((m) => m !== WRAPPED_SOL_MINT);
    console.log(`[SolanaPortfolio] 🔍 Requesting metadata for ${requestedMints.length} mints:`, requestedMints);
    
    const metadataMap = await metadataService.getMetadataMap(requestedMints);
    // Seed SOL metadata with local fallback so UI never shows sticky N/A for SOL.
    metadataMap[WRAPPED_SOL_MINT] = {
      symbol: KNOWN_TOKENS[WRAPPED_SOL_MINT]?.symbol,
      name: KNOWN_TOKENS[WRAPPED_SOL_MINT]?.name,
      logoUrl: KNOWN_TOKENS[WRAPPED_SOL_MINT]?.logoUrl,
      decimals: 9,
    };
    
    console.log(`[SolanaPortfolio] 📦 Received metadataMap with ${Object.keys(metadataMap).length} entries:`, 
      Object.keys(metadataMap).map(mint => ({
        mint,
        hasMetadata: !!metadataMap[mint],
        symbol: metadataMap[mint]?.symbol,
        name: metadataMap[mint]?.name,
        hasLogoUrl: !!metadataMap[mint]?.logoUrl,
        logoUrl: metadataMap[mint]?.logoUrl,
      }))
    );

    for (const token of tokens) {
      const metadata = metadataMap[token.address];
      console.log(`[SolanaPortfolio] 🔄 Processing token ${token.address}:`, {
        before: {
          symbol: token.symbol,
          name: token.name,
          decimals: token.decimals,
          logoUrl: token.logoUrl,
        },
        metadata: metadata ? {
          symbol: metadata.symbol,
          name: metadata.name,
          decimals: metadata.decimals,
          logoUrl: metadata.logoUrl,
        } : null,
      });

      if (!metadata) {
        // Non-fatal; prices can still be fetched. Keep logs quiet to avoid noise on rate limits.
        continue;
      }

      if (metadata.symbol) {
        const oldSymbol = token.symbol;
        token.symbol = metadata.symbol;
        console.log(`[SolanaPortfolio] ✅ Updated symbol: "${oldSymbol}" -> "${token.symbol}"`);
      }
      if (metadata.name) {
        const oldName = token.name;
        token.name = metadata.name;
        console.log(`[SolanaPortfolio] ✅ Updated name: "${oldName}" -> "${token.name}"`);
      }
      if (metadata.logoUrl) {
        token.logoUrl = metadata.logoUrl;
        console.log(`[SolanaPortfolio] ✅ Set logoUrl for ${token.symbol || token.address}: ${metadata.logoUrl}`);
      } else {
        console.warn(`[SolanaPortfolio] ⚠️ No logoUrl in metadata for ${token.symbol || token.address} (address: ${token.address})`);
      }
      if (
        typeof metadata.decimals === "number" &&
        Number.isFinite(metadata.decimals)
      ) {
        const oldDecimals = token.decimals;
        token.decimals = metadata.decimals;
        console.log(`[SolanaPortfolio] ✅ Updated decimals: ${oldDecimals} -> ${token.decimals}`);
      }
    }

    const uniqueMints = Array.from(new Set(tokens.map((token) => token.address)));
    console.log(`[SolanaPortfolio] 💰 Fetching prices for ${uniqueMints.length} unique mints:`, uniqueMints);

    const priceMap = await this.fetchUsdPrices(uniqueMints);
    console.log(`[SolanaPortfolio] 💰 Received priceMap with ${Object.keys(priceMap).length} prices:`, 
      Object.entries(priceMap).map(([mint, price]) => ({ mint, price }))
    );

    let totalValueUsd = 0;

    for (const token of tokens) {
      const price = priceMap[token.address];
      console.log(`[SolanaPortfolio] 💵 Processing price for ${token.symbol || token.address} (${token.address}):`, {
        hasPrice: typeof price === "number",
        price: price,
        amount: token.amount,
        decimals: token.decimals,
      });

      if (typeof price !== "number") {
        console.warn(`[SolanaPortfolio] ⚠️ No price found for ${token.symbol || token.address} (${token.address}), skipping value calculation`);
        continue;
      }

      const amountInUnits = parseFloat(token.amount) / Math.pow(10, token.decimals);
      const usdValue = amountInUnits * price;

      token.price = price.toString();
      token.value = usdValue.toString();
      totalValueUsd += usdValue;

      console.log(`[SolanaPortfolio] ✅ Calculated values for ${token.symbol || token.address}:`, {
        amountInUnits: amountInUnits.toFixed(6),
        price: price,
        usdValue: usdValue.toFixed(2),
        tokenPrice: token.price,
        tokenValue: token.value,
      });
    }

    // Filter out likely NFTs from the wallet token list.
    // We don't have Metaplex `tokenStandard` here, so use a conservative heuristic:
    // - decimals == 0
    // - raw amount == 1 (1-of-1)
    // - no USD price from Jupiter price API
    //
    // This keeps fungible tokens with decimals 0 that still have a price.
    const beforeNftFilter = tokens.length;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      if (!t) continue;
      if (t.decimals !== 0) continue;
      const raw = String(t.amount ?? "").trim();
      if (raw !== "1") continue;
      const price = priceMap[t.address];
      const hasPrice = typeof price === "number" && Number.isFinite(price) && price > 0;
      if (hasPrice) continue;
      tokens.splice(i, 1);
    }
    const removedNfts = beforeNftFilter - tokens.length;
    if (removedNfts > 0) {
      console.log(`[SolanaPortfolio] 🧹 Filtered out likely NFTs: ${removedNfts}`);
    }

    tokens.sort((a, b) => {
      const valueA = a.value ? parseFloat(a.value) : 0;
      const valueB = b.value ? parseFloat(b.value) : 0;
      return valueB - valueA;
    });

    console.log(`[SolanaPortfolio] 📋 Final tokens after processing:`, 
      tokens.map((token, idx) => ({
        index: idx + 1,
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        amount: token.amount,
        price: token.price,
        value: token.value,
        logoUrl: token.logoUrl,
        hasLogoUrl: !!token.logoUrl,
      }))
    );
    console.log(`[SolanaPortfolio] 💰 Total value USD: ${totalValueUsd.toFixed(2)}`);

    return {
      tokens,
      totalValueUsd,
    };
  }

  private async fetchUsdPrices(mints: string[]): Promise<Record<string, number>> {
    if (!mints.length) {
      return {};
    }

    const result: Record<string, number> = {};

    const now = Date.now();
    const ids = [...new Set(mints)];
    const chunkSize = 50;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const parseRetryAfterMs = (value: string | null): number | null => {
      if (!value) return null;
      const sec = Number(value);
      if (Number.isFinite(sec) && sec > 0) return Math.min(60_000, Math.max(0, Math.floor(sec * 1000)));
      const dt = Date.parse(value);
      if (Number.isFinite(dt)) {
        const ms = dt - Date.now();
        return ms > 0 ? Math.min(60_000, ms) : 0;
      }
      return null;
    };

    // 1) Fill from fresh cache first
    const pending: string[] = [];
    for (const mint of ids) {
      const cached = SolanaPortfolioService.priceCache.get(mint);
      if (cached && cached.expiresAt > now) {
        result[mint] = cached.price;
      } else {
        pending.push(mint);
      }
    }

    const fetchBatch = async (idsChunk: string[]) => {
      if (!idsChunk.length) return;

      const url = new URL("https://api.jup.ag/price/v3");
      url.searchParams.set("ids", idsChunk.join(","));

      try {
        const headers: HeadersInit = {
          'Accept': 'application/json',
        };
        
        // Добавляем API ключ, если он есть
        const apiKey = process.env.NEXT_PUBLIC_JUP_API_KEY || process.env.JUP_API_KEY;
        if (apiKey) {
          headers['x-api-key'] = apiKey;
        }

        // TODO: proxy Jupiter Price API through our backend service to avoid direct client calls.
        const attemptFetch = async (): Promise<Response> => {
          return await fetch(url.toString(), {
            cache: "no-store",
            headers,
          });
        };

        const maxAttempts = 3;
        let response: Response | null = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          response = await attemptFetch();
          if (response.ok) break;

          const status = response.status;
          const retryable = status === 429 || (status >= 500 && status <= 599);
          const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
          if (!retryable || attempt === maxAttempts) {
            console.warn(
              `[SolanaPortfolio] Price API response not OK: ${status} ${response.statusText} (attempt ${attempt}/${maxAttempts})`,
            );
            return;
          }

          const backoffMs = retryAfterMs ?? Math.min(4000, 500 * Math.pow(2, attempt - 1));
          console.warn(
            `[SolanaPortfolio] Price API retryable status ${status}; waiting ${backoffMs}ms (attempt ${attempt}/${maxAttempts})`,
          );
          await sleep(backoffMs);
        }

        if (!response || !response.ok) return;

        const json = (await response.json().catch(() => null)) as unknown;
        /**
         * Jupiter Price API responses vary by version:
         * - v3 commonly returns `{ data: { [mint]: { price: number } } }`
         * - some gateways may return `{ [mint]: { usdPrice: number } }`
         */
        const dataObj = (() => {
          if (!json || typeof json !== "object") return null;
          const o = json as Record<string, unknown>;
          const maybeData = o["data"];
          if (maybeData && typeof maybeData === "object") return maybeData as Record<string, unknown>;
          return o as Record<string, unknown>;
        })();

        if (!dataObj) return;

        for (const [mint, value] of Object.entries(dataObj)) {
          const row = value as any;
          const p =
            typeof row?.usdPrice === "number"
              ? row.usdPrice
              : typeof row?.price === "number"
                ? row.price
                : NaN;
          if (!Number.isFinite(p) || p <= 0) continue;
          result[mint] = p;
          SolanaPortfolioService.priceCache.set(mint, {
            price: p,
            expiresAt: Date.now() + SolanaPortfolioService.PRICE_TTL_MS,
          });
        }
      } catch (error) {
        console.error("Failed to fetch Solana token prices:", error);
      }
    };

    // 2) Fetch missing prices with coalescing per idsChunk
    for (let i = 0; i < pending.length; i += chunkSize) {
      const chunk = pending.slice(i, i + chunkSize);
      const cacheKey = chunk.slice().sort().join(",");
      const existing = SolanaPortfolioService.inFlightPriceBatches.get(cacheKey);
      if (existing) {
        const data = await existing;
        for (const [mint, price] of Object.entries(data)) {
          result[mint] = price;
        }
        continue;
      }

      const p = (async () => {
        const before = { ...result };
        await fetchBatch(chunk);
        // Return only newly populated prices for this batch
        const out: Record<string, number> = {};
        for (const mint of chunk) {
          const price = result[mint];
          if (typeof price === "number" && price !== before[mint]) out[mint] = price;
        }
        return out;
      })();

      SolanaPortfolioService.inFlightPriceBatches.set(cacheKey, p);
      try {
        const data = await p;
        for (const [mint, price] of Object.entries(data)) {
          result[mint] = price;
        }
      } finally {
        SolanaPortfolioService.inFlightPriceBatches.delete(cacheKey);
      }
    }

    // 3) Stale-while-revalidate: if some are still missing, fall back to stale cache (even if expired)
    for (const mint of ids) {
      if (typeof result[mint] === "number") continue;
      const cached = SolanaPortfolioService.priceCache.get(mint);
      if (cached) {
        result[mint] = cached.price;
      }
    }

    return result;
  }
}

