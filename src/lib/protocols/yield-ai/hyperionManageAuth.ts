export type HyperionManageAction =
  | "hyperion_lp_manage_open"
  | "hyperion_lp_manage_add"
  | "hyperion_lp_manage_claim"
  | "hyperion_lp_manage_close";

export type HyperionManageSignedFields = Record<string, string | number | boolean | null>;

export const HYPERION_MANAGE_AUTH_TTL_MS = 5 * 60 * 1000;

export function buildHyperionManageAuthMessage(params: {
  action: HyperionManageAction;
  fields: HyperionManageSignedFields;
  expiresAt: number;
}): string {
  return `Yield AI Hyperion LP manage authorization ${JSON.stringify(params)}`;
}
