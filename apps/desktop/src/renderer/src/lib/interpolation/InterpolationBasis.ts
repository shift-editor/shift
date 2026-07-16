import type { Axis, InterpolationBasis, InterpolationSupport, SourceId } from "@shift/types";
import { axisValue } from "@/lib/variation/location";
import type { AxisLocation } from "@/types/variation";

/** Evaluates one contribution weight per ordered source in an interpolation basis. */
export function interpolationWeights(
  basis: InterpolationBasis,
  location: AxisLocation,
  axes: readonly Axis[],
): Float64Array {
  const weights = new Float64Array(basis.sourceIds.length);
  const axesById = new Map(axes.map((axis) => [axis.id, axis]));

  for (let regionIndex = 0; regionIndex < basis.regions.length; regionIndex++) {
    const region = basis.regions[regionIndex];
    const coefficients = basis.coefficients[regionIndex];
    if (!region || !coefficients) continue;

    const scalar = regionScalar(region, location, axesById);
    if (scalar === 0) continue;

    for (let sourceIndex = 0; sourceIndex < weights.length; sourceIndex++) {
      weights[sourceIndex] += scalar * (coefficients[sourceIndex] ?? 0);
    }
  }

  return weights;
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

function regionScalar(
  region: readonly InterpolationSupport[],
  location: AxisLocation,
  axesById: ReadonlyMap<Axis["id"], Axis>,
): number {
  let scalar = 1;
  for (const support of region) {
    if (!validSupport(support)) continue;

    const axis = axesById.get(support.axisId);
    if (!axis) return 0;
    const value = normalizeAxis(axisValue(location, axis), axis);

    if (value === support.peak) continue;
    if (support.lower === 0 && support.peak === 0 && support.upper === 0) continue;
    if (value <= support.lower || support.upper <= value) return 0;

    const edge = value < support.peak ? support.lower : support.upper;
    scalar *= (value - edge) / (support.peak - edge);
  }

  return scalar;
}

function validSupport(support: InterpolationSupport): boolean {
  if (support.lower > support.peak || support.peak > support.upper) return false;
  return !(support.lower < 0 && support.upper > 0);
}

function normalizeAxis(value: number, axis: Axis): number {
  const minimum = axis.minimum ?? Math.min(...(axis.values ?? [axis.default]));
  const maximum = axis.maximum ?? Math.max(...(axis.values ?? [axis.default]));

  if (value < axis.default) {
    const range = axis.default - minimum;
    return range === 0 ? 0 : (value - axis.default) / range;
  }
  if (value > axis.default) {
    const range = maximum - axis.default;
    return range === 0 ? 0 : (value - axis.default) / range;
  }
  return 0;
}
