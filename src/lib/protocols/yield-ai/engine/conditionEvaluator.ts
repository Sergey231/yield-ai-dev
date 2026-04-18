import { ComputedState, Condition, StrategyRunContext } from "./types";
import { resolveRefAsBigInt } from "./refResolver";

function cmp(op: string, left: bigint, right: bigint): boolean {
  switch (op) {
    case ">=":
      return left >= right;
    case ">":
      return left > right;
    case "<=":
      return left <= right;
    case "<":
      return left < right;
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    default:
      return false;
  }
}

export function evaluateCondition(
  condition: Condition | undefined,
  ctx: StrategyRunContext,
  state: ComputedState
): boolean {
  if (!condition) return true;

  if ("allOf" in condition) {
    return condition.allOf.every((c) => {
      const left = resolveRefAsBigInt(c.leftRef, ctx, state);
      const right = resolveRefAsBigInt(c.rightRef, ctx, state);
      return cmp(c.op, left, right);
    });
  }

  const left = resolveRefAsBigInt(condition.leftRef, ctx, state);
  const right = resolveRefAsBigInt(condition.rightRef, ctx, state);
  return cmp(condition.op, left, right);
}

