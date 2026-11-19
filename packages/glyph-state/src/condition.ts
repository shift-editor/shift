import type { Condition, ConditionRange } from "@shift/types";

/** Whether two ranges are the same: one axis, the same ends; an open end is unset either way. */
export function sameConditionRange(left: ConditionRange, right: ConditionRange): boolean {
  return (
    left.axisId === right.axisId &&
    (left.min ?? null) === (right.min ?? null) &&
    (left.max ?? null) === (right.max ?? null)
  );
}

/** Whether two conditions have the same ranges in the same order. */
export function sameCondition(left: Condition, right: Condition): boolean {
  return (
    left.all.length === right.all.length &&
    left.all.every((range, index) => sameConditionRange(range, right.all[index]!))
  );
}
