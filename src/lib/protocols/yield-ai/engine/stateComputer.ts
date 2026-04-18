import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";
import { toCanonicalAddress } from "@/lib/utils/addressNormalization";
import { ComputedState, StrategyRunContext } from "./types";
import { fetchMoarAptRewardsAboveThreshold } from "@/lib/protocols/moar/moarRewardsForWorker";

/** Aptos SDK view function id shape: `0xaddr::module::function` */
type ViewFunctionId = `${string}::${string}::${string}`;

function toBigIntSafe(v: any): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    return BigInt(String(v));
  } catch {
    return 0n;
  }
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function buildAptos(rpcUrl: string) {
  const config = new AptosConfig({
    network: Network.MAINNET,
    fullnode: rpcUrl,
    ...(process.env.APTOS_API_KEY && {
      clientConfig: { HEADERS: { Authorization: `Bearer ${process.env.APTOS_API_KEY}` } },
    }),
  });
  return new Aptos(config);
}

export async function getFaBalance(aptos: Aptos, owner: string, metadata: string): Promise<bigint> {
  const res = await aptos.view({
    payload: {
      function: "0x1::primary_fungible_store::balance",
      typeArguments: ["0x1::fungible_asset::Metadata"],
      functionArguments: [toCanonicalAddress(owner), toCanonicalAddress(metadata)],
    },
  });
  const raw = Array.isArray(res) ? res[0] : (res as any);
  return toBigIntSafe(raw);
}

export async function refreshBalancesForAllowedAssets(options: {
  ctx: StrategyRunContext;
  state: ComputedState;
}): Promise<void> {
  const { ctx, state } = options;
  const aptos = buildAptos(ctx.config.global.rpcUrl);

  const allowedAssets = Array.isArray(ctx.mergedRiskLimits.allowedAssets)
    ? ctx.mergedRiskLimits.allowedAssets
    : [];

  for (const assetKey of allowedAssets) {
    const asset = ctx.config.global.assets[assetKey];
    if (!asset) continue;
    state.safeBalance[assetKey] = await getFaBalance(aptos, ctx.safeAddress, asset.metadata);
  }

  // Recompute excess balances using the same rule-set.
  for (const [k, bal] of Object.entries(state.safeBalance)) {
    state.excessBalance[k] = bal;
  }
  const usd1Reserve = BigInt(Number(ctx.mergedDefaults.usd1ReserveInSafe ?? 0));
  if (state.safeBalance.USD1 != null) {
    state.excessBalance.USD1 =
      state.safeBalance.USD1 > usd1Reserve ? state.safeBalance.USD1 - usd1Reserve : 0n;
  }
}

async function resolveAdapterAddress(aptos: Aptos, viewFn: string): Promise<string> {
  const res = await aptos.view({
    payload: {
      function: viewFn as ViewFunctionId,
      typeArguments: [],
      functionArguments: [],
    },
  });

  const first = Array.isArray(res) ? res[0] : res;
  if (typeof first === "string") return toCanonicalAddress(first);
  if (typeof first === "object" && first && "inner" in (first as any)) {
    const inner = (first as any).inner;
    if (typeof inner === "string") return toCanonicalAddress(inner);
  }
  throw new Error("Could not parse adapter address from view");
}

async function getEchelonClaimable(options: {
  aptos: Aptos;
  echelonPkg: string;
  safeAddress: string;
  rewardName: string;
  farmingId: string;
}): Promise<bigint> {
  const fn = `${options.echelonPkg}::farming::claimable_reward_amount`;
  const res = await options.aptos.view({
    payload: {
      function: fn as ViewFunctionId,
      typeArguments: [],
      functionArguments: [toCanonicalAddress(options.safeAddress), options.rewardName, options.farmingId],
    },
  });
  const raw = Array.isArray(res) ? res[0] : (res as any);
  return toBigIntSafe(raw);
}

export type ComputedAdapters = {
  echelonAdapterAddress: string;
  moarAdapterAddress: string;
};

export async function computeStateForSafe(ctx: StrategyRunContext): Promise<{
  state: ComputedState;
  adapters: ComputedAdapters;
  moarAptClaimLines: Awaited<ReturnType<typeof fetchMoarAptRewardsAboveThreshold>>;
}> {
  const aptos = buildAptos(ctx.config.global.rpcUrl);

  const allowedAssets = Array.isArray(ctx.mergedRiskLimits.allowedAssets)
    ? ctx.mergedRiskLimits.allowedAssets
    : [];

  const safeBalance: Record<string, bigint> = {};
  for (const assetKey of allowedAssets) {
    const asset = ctx.config.global.assets[assetKey];
    if (!asset) continue;
    safeBalance[assetKey] = await getFaBalance(aptos, ctx.safeAddress, asset.metadata);
  }

  // Adapters
  const globalPkg = ctx.config.global.package;
  const echelonProtocol = ctx.config.global.protocols.echelon;
  const moarProtocol = ctx.config.global.protocols.moar;
  if (!echelonProtocol || !moarProtocol) {
    throw new Error("Missing required protocols in config: echelon/moar");
  }

  const echelonView = echelonProtocol.adapterAddressView.includes("::")
    ? `${globalPkg}::${echelonProtocol.adapterAddressView}`
    : echelonProtocol.adapterAddressView;
  const moarView = moarProtocol.adapterAddressView.includes("::")
    ? `${globalPkg}::${moarProtocol.adapterAddressView}`
    : moarProtocol.adapterAddressView;

  const [echelonAdapterAddress, moarAdapterAddress] = await Promise.all([
    resolveAdapterAddress(aptos, echelonView),
    resolveAdapterAddress(aptos, moarView),
  ]);

  // Moar claimable APT (sum) and claim lines (used by claim action)
  const minClaim = BigInt(Number(ctx.mergedDefaults.minClaimBaseUnits ?? envNumber("YIELD_AI_MIN_CLAIM_BASE_UNITS", 0)));
  const moarAptClaimLines = await fetchMoarAptRewardsAboveThreshold(ctx.safeAddress, minClaim);
  const moarClaimableApt = moarAptClaimLines.reduce((acc, l) => {
    try {
      return acc + BigInt(l.claimable_amount);
    } catch {
      return acc;
    }
  }, 0n);

  // Echelon claimable per reward asset, derived from claim actions
  const echelonClaimable: Record<string, bigint> = {};
  const farmingId: string | undefined = ctx.mergedContext?.echelon?.farmingId;
  if (typeof farmingId === "string" && farmingId.length > 0) {
    const echelonPkg = ctx.config.global.protocols.echelon.packageAddress;
    for (const a of ctx.mergedActions) {
      if (a.type !== "claimEchelonReward" || a.enabled !== true) continue;
      const rewardAsset = a.params?.rewardAsset;
      const rewardName = a.params?.rewardName;
      if (typeof rewardAsset !== "string" || typeof rewardName !== "string") continue;
      echelonClaimable[rewardAsset] = await getEchelonClaimable({
        aptos,
        echelonPkg,
        safeAddress: ctx.safeAddress,
        rewardName,
        farmingId,
      });
    }
  }

  // excess balances (currently only USD1 reserve is modeled)
  const excessBalance: Record<string, bigint> = {};
  for (const [k, bal] of Object.entries(safeBalance)) {
    excessBalance[k] = bal;
  }
  const usd1Reserve = BigInt(Number(ctx.mergedDefaults.usd1ReserveInSafe ?? 0));
  if (safeBalance.USD1 != null) {
    excessBalance.USD1 = safeBalance.USD1 > usd1Reserve ? safeBalance.USD1 - usd1Reserve : 0n;
  }

  return {
    state: { safeBalance, excessBalance, moarClaimableApt, echelonClaimable },
    adapters: { echelonAdapterAddress, moarAdapterAddress },
    moarAptClaimLines,
  };
}

