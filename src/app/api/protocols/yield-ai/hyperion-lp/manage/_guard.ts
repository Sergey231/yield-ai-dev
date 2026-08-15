import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";
import {
  STRATEGY_REGISTRY_VIEWS,
  resolveActiveAiAgentStrategy,
} from "@/lib/protocols/yield-ai/strategyRegistry";
import { assertOwnerManageAuth } from "@/lib/protocols/yield-ai/manageAuthServer";
import type {
  HyperionManageAction,
  HyperionManageSignedFields,
} from "@/lib/protocols/yield-ai/hyperionManageAuth";

const APTOS_API_KEY = process.env.APTOS_API_KEY;

const aptos = new Aptos(
  new AptosConfig({
    network: Network.MAINNET,
    ...(APTOS_API_KEY && {
      clientConfig: { HEADERS: { Authorization: `Bearer ${APTOS_API_KEY}` } },
    }),
  })
);

// Signature/ownership verification lives in the shared guard; routes keep
// catching this class by its historical name.
export { ManageAuthError as HyperionManageAuthError } from "@/lib/protocols/yield-ai/manageAuthServer";

/**
 * Authorization for the user-facing Hyperion LP `manage/*` routes.
 *
 * These routes are NOT gated by the cron secret (it must never reach the
 * browser). Live executor actions require a wallet-signed owner authorization
 * bound to the exact action fields, plus on-chain checks that the signer owns
 * the safe and that the safe is opted into the `hyperion_lp` strategy.
 */
export async function assertSafeOptedIntoHyperion(safeAddressRaw: string): Promise<string> {
  const safe = toCanonicalAddress(safeAddressRaw);
  if (!safe.startsWith("0x")) {
    throw new Error("Invalid safeAddress");
  }

  const raw = await aptos.view({
    payload: {
      function: STRATEGY_REGISTRY_VIEWS.getSafeActiveStrategies,
      typeArguments: [],
      functionArguments: [safe],
    },
  });
  const vec = Array.isArray(raw) ? raw[0] : raw;
  const resolved = resolveActiveAiAgentStrategy({ activeStrategyIdBytesVec: vec });

  if (resolved.activeStrategyId !== "hyperion_lp") {
    throw new Error(
      "Safe is not opted into the Hyperion LP strategy. Attach the hyperion_lp strategy first."
    );
  }
  return safe;
}

export async function assertHyperionManageOwnerAuth(params: {
  safeAddress: string;
  action: HyperionManageAction;
  fields: HyperionManageSignedFields;
  auth: unknown;
}) {
  await assertOwnerManageAuth({
    action: params.action,
    fields: params.fields,
    auth: params.auth,
    safeAddress: params.safeAddress,
  });
}
