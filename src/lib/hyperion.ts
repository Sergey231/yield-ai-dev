import { Network } from "@aptos-labs/ts-sdk";
import { initHyperionSDK } from '@hyperionxyz/sdk';

// Инициализируем SDK с основными параметрами
export const sdk = initHyperionSDK({
  network: Network.MAINNET,
  APTOS_API_KEY: process.env.APTOS_API_KEY || "",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function unwrapHyperionPoolByTokenPair(result: unknown): Record<string, unknown> | null {
  if (!isRecord(result)) return null;

  if (isRecord(result.item)) return result.item;
  if (Array.isArray(result.items)) {
    return isRecord(result.items[0]) ? result.items[0] : null;
  }

  return result;
}
