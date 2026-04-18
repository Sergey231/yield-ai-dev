import { ComputedState, StrategyRunContext } from "./types";

type ResolveScope = {
  state: ComputedState;
  defaults: Record<string, any>;
  context: Record<string, any>;
};

function getPath(obj: any, path: string): any {
  const parts = path.split(".");
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

export function resolveRef(
  ref: string,
  scope: ResolveScope
): bigint | number | string | boolean | undefined {
  if (!ref || typeof ref !== "string") return undefined;

  if (ref.startsWith("state.")) {
    const v = getPath(scope.state, ref.slice("state.".length));
    return v;
  }

  if (ref.startsWith("defaults.")) {
    const v = getPath(scope.defaults, ref.slice("defaults.".length));
    return v;
  }

  if (ref.startsWith("context.")) {
    const v = getPath(scope.context, ref.slice("context.".length));
    return v;
  }

  return undefined;
}

export function resolveRefAsBigInt(
  ref: string,
  ctx: StrategyRunContext,
  state: ComputedState
): bigint {
  const v = resolveRef(ref, { state, defaults: ctx.mergedDefaults, context: ctx.mergedContext });
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === "string" && v.trim() !== "") {
    try {
      return BigInt(v);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

