import type { Axis, InterpolationSupport, VariationBasis } from "@shift/types";
import type { AxisLocation } from "@/types/variation";

/** Evaluates a Rust/Fontdrasil-compiled numeric variation basis. */
export function evaluateVariationBasis(
  basis: VariationBasis,
  location: AxisLocation,
  axes: readonly Axis[],
): Float64Array {
  const valueCount = basis.deltas[0]?.values.length ?? 0;
  const values = new Float64Array(valueCount);
  const axesById = new Map(axes.map((axis) => [axis.id, axis]));

  for (const delta of basis.deltas) {
    const scalar = regionScalar(delta.region, location, axesById);
    if (scalar === 0) continue;

    for (let index = 0; index < valueCount; index++) {
      values[index] += scalar * (delta.values[index] ?? 0);
    }
  }

  return values;
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
    const value = normalizeAxis(location.get(axis.id) ?? axis.default, axis);

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
    return Math.abs(range) < Number.EPSILON ? 0 : (value - axis.default) / range;
  }
  if (value > axis.default) {
    const range = maximum - axis.default;
    return Math.abs(range) < Number.EPSILON ? 0 : (value - axis.default) / range;
  }
  return 0;
}
