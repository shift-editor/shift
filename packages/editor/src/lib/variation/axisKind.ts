import type { Axis } from "@shift/types";

type AxisWithKind = Pick<Axis, "kind">;

/** A continuous axis's minimum and maximum; null for a discrete axis. */
export function continuousBounds(
  axis: AxisWithKind,
): { readonly minimum: number; readonly maximum: number } | null {
  return axis.kind.kind === "continuous" ? axis.kind : null;
}

/** The values a discrete axis takes; null for a continuous axis. */
export function discreteValues(axis: AxisWithKind): readonly number[] | null {
  return axis.kind.kind === "discrete" ? axis.kind.values : null;
}
