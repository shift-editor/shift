import type { Axis, InterpolationBasis, SourceId } from "@shift/types";
import { interpolationWeights } from "../wasm/variation";
import type { DesignAxisLocation } from "../../types/variation";

export { interpolationWeights };

/**
 * Mixes per-source values at design locations over one interpolation basis.
 *
 * @remarks
 * Holds no source values: callers pass a lookup per call, so a glyph can read
 * its live layers while metrics and kerning read their snapshots.
 */
export class SourceInterpolation {
  constructor(readonly basis: InterpolationBasis) {}

  /**
   * Mixes each source's value vector at `location`.
   *
   * @returns null when a source has no vector or the vectors differ in length.
   */
  valuesAt(
    location: DesignAxisLocation,
    axes: readonly Axis[],
    valuesForSource: (sourceId: SourceId) => Float64Array | null,
  ): Float64Array | null {
    const sourceValues = this.basis.sourceIds.map(valuesForSource);
    const first = sourceValues.find((values) => values !== null);
    if (!first) return null;
    if (sourceValues.some((values) => !values || values.length !== first.length)) return null;

    const weights = interpolationWeights(this.basis, location, axes);
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

  /** Mixes one number per source at `location`; reads only sources with a nonzero weight. */
  valueAt(
    location: DesignAxisLocation,
    axes: readonly Axis[],
    valueForSource: (sourceId: SourceId) => number,
  ): number {
    const weights = interpolationWeights(this.basis, location, axes);
    let amount = 0;
    for (const [index, sourceId] of this.basis.sourceIds.entries()) {
      const weight = weights[index] ?? 0;
      if (weight !== 0) amount += weight * valueForSource(sourceId);
    }
    return amount;
  }
}
