import {
  MANAGE_AUTH_TTL_MS,
  buildManageAuthMessage,
  type ManageAuthFields,
} from "./manageAuth";

export type HyperionManageAction =
  | "hyperion_lp_manage_open"
  | "hyperion_lp_manage_add"
  | "hyperion_lp_manage_claim"
  | "hyperion_lp_manage_close";

export type HyperionManageSignedFields = ManageAuthFields;

export const HYPERION_MANAGE_AUTH_TTL_MS = MANAGE_AUTH_TTL_MS;

/** Delegates to the shared Yield AI manage-auth message (action is embedded in the JSON). */
export function buildHyperionManageAuthMessage(params: {
  action: HyperionManageAction;
  fields: HyperionManageSignedFields;
  expiresAt: number;
}): string {
  return buildManageAuthMessage(params);
}
