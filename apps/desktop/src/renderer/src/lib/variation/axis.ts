import type { Axis } from "@shift/types";

/** Returns whether an axis has more than one usable variation coordinate. */
export function axisVaries(axis: Axis): boolean {
  switch (axis.kind.kind) {
    case "continuous":
      return axis.kind.minimum < axis.kind.maximum;
    case "discrete":
      return new Set(axis.kind.values).size > 1;
  }
}
