import { ApiError, ApiResponse } from '../types/api';

/**
 * Parse an optional numeric query/body param. Returns `undefined` for a missing/empty value so a
 * downstream `params.x ?? DEFAULT` actually applies the default — NOT `0`.
 *
 * The bug this guards against: `URLSearchParams.get()` returns `null` for an absent key, and
 * `Number(null) === 0` (a JS quirk) is finite, so a naive `Number.isFinite(Number(raw))` check
 * silently turns "the caller omitted this param" into "the caller explicitly passed 0" — which
 * then survives `??` (only `null`/`undefined` fall through it, not `0`) and overrides the
 * intended default. Cost real cron behavior: `dn-rehedge`'s deployed cron path omits `bandBps`,
 * so every run used band=0 (just the market's min-order floor) instead of the intended 1500 (15%)
 * — far more frequent rehedges than designed. `dn-autoclaim` omits `minClaimUsd`, so it claimed
 * any nonzero fee/reward instead of the intended $0.10 floor.
 *
 * An explicit `"0"` still parses to `0` correctly — this only changes behavior for omitted params.
 */
export function parseOptionalNumber(raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export const createErrorResponse = (error: Error): ApiResponse<never> => {
  return {
    error: error.message,
  };
};

export const createSuccessResponse = <T>(data: T): ApiResponse<T> => {
  return {
    data,
  };
};

export const http = {
  async get<T>(url: string, options?: { headers?: Record<string, string> }): Promise<T> {
    const response = await fetch(url, {
      method: 'GET',
      headers: options?.headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  },

  async post<T>(url: string, body: any, options?: { headers?: Record<string, string> }): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }
}; 