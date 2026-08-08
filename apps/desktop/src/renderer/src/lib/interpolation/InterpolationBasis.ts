import type { Axis, InterpolationBasis, SourceId } from "@shift/types";
import type { AxisLocation } from "@/types/variation";
import { evaluateVariationBasis } from "./VariationBasis";

/** Evaluates one contribution weight per ordered source in an interpolation basis. */
export function interpolationWeights(
  basis: InterpolationBasis,
  location: AxisLocation,
  axes: readonly Axis[],
): Float64Array {
  return evaluateVariationBasis(basis.basis, location, axes);
}

/** Combines source value vectors using a location's evaluated source weights. */
export function interpolateSourceValues(
  basis: InterpolationBasis,
  weights: Float64Array,
  valuesForSource: (sourceId: SourceId) => Float64Array | null,
): Float64Array | null {
  const sourceValues = basis.sourceIds.map(valuesForSource);
  const first = sourceValues.find((values) => values !== null);
  if (!first) return null;
  if (sourceValues.some((values) => !values || values.length !== first.length)) return null;

  const result = new Float64Array(first.length);
  for (let sourceIndex = 0; sourceIndex < sourceValues.length; sourceIndex++) {
    const values = sourceValues[sourceIndex];
    if (!values) return null;

    const weight = weights[sourceIndex] ?? 0;
    if (weight === 0) continue;
    for (let valueIndex = 0; valueIndex < values.length; valueIndex++) {
      result[valueIndex] += weight * values[valueIndex];
    }
  }

  return result;
}
