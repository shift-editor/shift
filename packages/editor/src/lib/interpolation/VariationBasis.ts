import type {
  Axis,
  AxisId,
  DesignNormalization,
  InterpolationSupport,
  VariationBasis,
} from "@shift/types";

/** Evaluates a Rust/Fontdrasil-compiled numeric variation basis. */
export function evaluateVariationBasis(
  basis: VariationBasis,
  location: ReadonlyMap<AxisId, number>,
  axes: readonly Axis[],
  designNormalization?: readonly DesignNormalization[],
): Float64Array {
  const valueCount = basis.deltas[0]?.values.length ?? 0;
  const values = new Float64Array(valueCount);
  const axesById = new Map(axes.map((axis) => [axis.id, axis]));
  const normalizationById = designNormalization
    ? new Map(designNormalization.map((normalization) => [normalization.axisId, normalization]))
    : null;

  for (const delta of basis.deltas) {
    const scalar = regionScalar(delta.region, location, axesById, normalizationById);
    if (scalar === 0) continue;

    for (let index = 0; index < valueCount; index++) {
      values[index] += scalar * (delta.values[index] ?? 0);
    }
  }

  return values;
}

function regionScalar(
  region: readonly InterpolationSupport[],
  location: ReadonlyMap<AxisId, number>,
  axesById: ReadonlyMap<Axis["id"], Axis>,
  normalizationById: ReadonlyMap<AxisId, DesignNormalization> | null,
): number {
  let scalar = 1;

  for (const support of region) {
    if (!validSupport(support)) continue;

    const axis = axesById.get(support.axisId);
    if (!axis) return 0;
    const normalization = normalizationById?.get(axis.id);
    if (normalizationById && !normalization) return 0;
    const unclamped = normalization
      ? normalizeAxis(location.get(axis.id) ?? normalization.default, axis, normalization)
      : normalizeAxis(location.get(axis.id) ?? axis.default, axis);
    const value = Math.min(1, Math.max(-1, unclamped));

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

function normalizeAxis(
  value: number,
  axis: Axis,
  designNormalization?: DesignNormalization,
): number {
  const minimum =
    designNormalization?.minimum ?? axis.minimum ?? Math.min(...(axis.values ?? [axis.default]));
  const maximum =
    designNormalization?.maximum ?? axis.maximum ?? Math.max(...(axis.values ?? [axis.default]));
  const defaultValue = designNormalization?.default ?? axis.default;
  const tolerance = 1e-9 * (1 + Math.abs(defaultValue));
  if (Math.abs(value - defaultValue) < tolerance) return 0;

  const range = value < defaultValue ? defaultValue - minimum : maximum - defaultValue;
  if (Math.abs(range) < tolerance) return 0;

  return snapNormalized((value - defaultValue) / range);
}

/**
 * Snaps a normalized coordinate to `0` or `±1` when it misses by rounding.
 *
 * @remarks
 * Mirrors Rust's `DesignNormalization::normalize`: mapped defaults and extremes
 * come from compiled mapping bases, so a source authored exactly at the default
 * can normalize to `1e-15`.
 */
function snapNormalized(normalized: number): number {
  for (const anchor of [-1, 0, 1]) {
    if (Math.abs(normalized - anchor) < 1e-9) return anchor;
  }
  return normalized;
}
