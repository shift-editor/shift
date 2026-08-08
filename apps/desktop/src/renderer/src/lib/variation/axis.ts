import type { Axis } from "@shift/types";

/** Returns whether an axis has more than one usable variation coordinate. */
export function axisVaries(axis: Axis): boolean {
  switch (axis.axisType) {
    case "continuous":
      return (
        axis.minimum !== undefined && axis.maximum !== undefined && axis.minimum < axis.maximum
      );
    case "discrete":
      return new Set(axis.values).size > 1;
  }
}
