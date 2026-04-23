export interface JupiterTokenData {
  id: string;
  name: string;
  symbol: string;
  icon: string;
  decimals: number;
  usdPrice?: number;
  priceBlockId?: number;
  stats24h?: {
    priceChange: number;
  };
  isVerified?: boolean;
  tags?: string[];
}

type MetadataRecord = {
  symbol?: string;
  name?: string;
  logoUrl?: string;
  decimals?: number;
};

type MetadataCacheEntry = {
  expiresAt: number;
  metadata: MetadataRecord | null;
};

export class JupiterTokenMetadataService {
  private static instance: JupiterTokenMetadataService;
  // Cache is safe to keep for a long time because we only store symbol/name/icon/decimals
  // (not prices). This dramatically reduces 429s from Jupiter search endpoint.
  private cache: Map<string, MetadataCacheEntry>;
  private static batchCache: Map<string, { data: JupiterTokenData[]; timestamp: number }>;
  private readonly ttlMs = 1000 * 60 * 60 * 24 * 30; // 30 days for individual cache
  private readonly missingTtlMs = 1000 * 60 * 5; // 5 minutes for negative cache (avoid sticky N/A on transient 429)
  private static readonly BATCH_CACHE_DURATION = 1000 * 60 * 60 * 24; // 24 hours for batch cache
  private static readonly BASE_URL = 'https://api.jup.ag/tokens/v2/search';

  private constructor() {
    // Use globalThis so Next.js/Vercel keeps cache across module reloads in the same runtime.
    const g = globalThis as unknown as {
      __jupTokenMetaCache?: Map<string, MetadataCacheEntry>;
      __jupTokenMetaBatchCache?: Map<string, { data: JupiterTokenData[]; timestamp: number }>;
    };
    g.__jupTokenMetaCache ??= new Map<string, MetadataCacheEntry>();
    g.__jupTokenMetaBatchCache ??= new Map<string, { data: JupiterTokenData[]; timestamp: number }>();
    this.cache = g.__jupTokenMetaCache;
    JupiterTokenMetadataService.batchCache = g.__jupTokenMetaBatchCache;
  }

  static getInstance(): JupiterTokenMetadataService {
    if (!JupiterTokenMetadataService.instance) {
      JupiterTokenMetadataService.instance = new JupiterTokenMetadataService();
    }
    return JupiterTokenMetadataService.instance;
  }

  async getMetadataMap(mints: string[]): Promise<Record<string, MetadataRecord>> {
    if (mints.length === 0) {
      return {};
    }

    const now = Date.now();
    const pending: string[] = [];
    const result: Record<string, MetadataRecord> = {};

    // Проверяем индивидуальный кэш
    for (const mint of mints) {
      const cached = this.cache.get(mint);
      if (cached && cached.expiresAt > now) {
        if (cached.metadata) {
          result[mint] = cached.metadata;
        }
      } else {
        pending.push(mint);
      }
    }

    // Если есть токены, которые нужно загрузить
    if (pending.length > 0) {
      await this.fetchBatch(pending);
      
      // После загрузки проверяем кэш снова
      for (const mint of pending) {
        const cached = this.cache.get(mint);
        if (cached?.metadata) {
          result[mint] = cached.metadata;
        }
      }
    }

    return result;
  }

  /**
   * Загружает метаданные для нескольких токенов одним запросом
   */
  private async fetchBatch(mintAddresses: string[]): Promise<void> {
    if (mintAddresses.length === 0) {
      return;
    }

    // Jupiter API имеет лимит 100 mint адресов в одном запросе
    // Разбиваем на чанки по 100, если нужно
    const CHUNK_SIZE = 100;
    const chunks: string[][] = [];
    for (let i = 0; i < mintAddresses.length; i += CHUNK_SIZE) {
      chunks.push(mintAddresses.slice(i, i + CHUNK_SIZE));
    }

    // Обрабатываем каждый чанк
    for (const chunk of chunks) {
      // Проверяем batch кэш для этого чанка
      const cacheKey = chunk.sort().join(',');
      const cached = JupiterTokenMetadataService.batchCache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < JupiterTokenMetadataService.BATCH_CACHE_DURATION) {
        // Обновляем индивидуальный кэш из batch кэша
        this.updateIndividualCache(cached.data, chunk);
        continue;
      }

      try {
        // Передаем несколько mint адресов через запятую в одном запросе
        const query = chunk.join(',');
        const url = `${JupiterTokenMetadataService.BASE_URL}?query=${encodeURIComponent(query)}`;
        
        const headers: HeadersInit = {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        };
        
        // Добавляем API ключ, если он есть
        const apiKey = process.env.NEXT_PUBLIC_JUP_API_KEY || process.env.JUP_API_KEY;
        if (apiKey) {
          headers['x-api-key'] = apiKey;
        }
        
        const maxAttempts = 3;
        let response: Response | null = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          response = await fetch(url, { cache: 'no-store', headers });
          if (response.ok) break;

          const status = response.status;
          const retryable = status === 429 || (status >= 500 && status <= 599);
          const retryAfterHeader = response.headers.get('retry-after');
          const retryAfterMs = retryAfterHeader
            ? (() => {
                const sec = Number(retryAfterHeader);
                if (Number.isFinite(sec) && sec > 0) return Math.min(60_000, Math.floor(sec * 1000));
                const dt = Date.parse(retryAfterHeader);
                if (Number.isFinite(dt)) return Math.min(60_000, Math.max(0, dt - Date.now()));
                return null;
              })()
            : null;

          const errorText = await response.text().catch(() => '');
          console.error(
            `[JupiterTokenMetadata] Response not OK: ${status} ${response.statusText} (attempt ${attempt}/${maxAttempts})`,
            errorText,
          );

          if (!retryable || attempt === maxAttempts) {
            // Do NOT sticky-negative-cache on transient rate limits; keep missing TTL short.
            this.markMissing(chunk, status === 429 ? this.missingTtlMs : this.missingTtlMs);
            response = null;
            break;
          }

          const backoffMs = retryAfterMs ?? Math.min(4000, 500 * Math.pow(2, attempt - 1));
          console.warn(`[JupiterTokenMetadata] Retryable status ${status}; waiting ${backoffMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }

        if (!response) {
          continue;
        }

        const data: JupiterTokenData[] = await response.json();
        
        // Проверяем, что ответ - массив
        if (!Array.isArray(data)) {
          console.error(`[JupiterTokenMetadata] Invalid response format, expected array, got:`, typeof data, data);
          this.markMissing(chunk, this.missingTtlMs);
          continue;
        }
        
        // Сохраняем в batch кэш
        JupiterTokenMetadataService.batchCache.set(cacheKey, {
          data,
          timestamp: Date.now(),
        });

        // Обновляем индивидуальный кэш
        this.updateIndividualCache(data, chunk);
        
      } catch (error) {
        console.error('[JupiterTokenMetadata] Error fetching batch from Jupiter API:', error);
        // Помечаем токены этого чанка как отсутствующие
        this.markMissing(chunk, this.missingTtlMs);
      }
    }
  }

  /**
   * Обновляет индивидуальный кэш из batch данных
   */
  private updateIndividualCache(data: JupiterTokenData[], requestedMints?: string[]): void {
    const now = Date.now();
    
    // Создаем Map для быстрого поиска по id
    const dataMap = new Map<string, JupiterTokenData>();
    for (const token of data) {
      if (token.id) {
        dataMap.set(token.id, token);
      }
    }

    // Если указаны конкретные mint адреса, обновляем только их
    const mintsToUpdate = requestedMints || Array.from(dataMap.keys());
    
    for (const mint of mintsToUpdate) {
      const token = dataMap.get(mint);
      
      if (token) {
        this.cache.set(mint, {
          expiresAt: now + this.ttlMs,
          metadata: {
            symbol: token.symbol,
            name: token.name,
            logoUrl: token.icon, // ВАЖНО: icon, не logoURI
            decimals: token.decimals,
          },
        });
      } else {
        this.markMissing([mint], this.missingTtlMs);
      }
    }
  }

  private markMissing(mints: string[], ttlMs: number = this.ttlMs): void {
    const now = Date.now();
    for (const mint of mints) {
      this.cache.set(mint, {
        expiresAt: now + ttlMs,
        metadata: null,
      });
    }
  }

  /**
   * Очистить кэш
   */
  static clearCache(): void {
    JupiterTokenMetadataService.batchCache?.clear();
    JupiterTokenMetadataService.instance?.cache?.clear();
  }

  /**
   * Получить размер кэша
   */
  static getCacheSize(): number {
    return JupiterTokenMetadataService.batchCache.size;
  }
}
