import type { InterpolationBasis, SourceId } from "@shift/types";
import { blendSourceValues } from "@shift/wasm";

/**
 * Combines source value vectors using a location's evaluated source weights,
 * as shift-font blends them (`interpolation::blend_values`).
 *
 * @returns null when a source's values are missing or the sources differ in length.
 */
export function interpolateSourceValues(
  basis: InterpolationBasis,
  weights: Float64Array,
  valuesForSource: (sourceId: SourceId) => Float64Array | null,
): Float64Array | null {
  return blendValues(weights, basis.sourceIds.map(valuesForSource));
}

/**
 * Combines one value vector per sample, in sample order, with a location's
 * evaluated weights, as shift-font blends them (`interpolation::blend_values`).
 *
 * @returns null when a sample's values are missing or the samples differ in length.
 */
export function blendValues(
  weights: Float64Array,
  samples: readonly (Float64Array | null)[],
): Float64Array | null {
  const lengths = Uint32Array.from(samples, (values) => values?.length ?? 0);
  const packed = new Float64Array(lengths.reduce((total, length) => total + length, 0));
  let offset = 0;
  for (const values of samples) {
    if (!values) continue;
    packed.set(values, offset);
    offset += values.length;
  }
  return blendSourceValues(weights, packed, lengths) ?? null;
}
