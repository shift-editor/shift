import type {
  Axis,
  AxisId,
  AxisMappingBasis,
  InterpolationBasis,
  SlugWeightSet,
  Source,
  VariationBasis,
} from "@shift/types";
import type { Signal } from "../signals";
import type { EngineVariation, FontEngine } from "../../types/font";
import type { DesignAxisLocation, ExternalAxisLocation } from "../../types/variation";
import type { SourceSetWeights } from "./engine";
import { asDesignAxisLocation, asExternalAxisLocation } from "../variation/location";

/** A location as numbers in `axes` order; NaN where it has no coordinate, read as the default. */
export function locationValues(
  axes: readonly Axis[],
  location: ReadonlyMap<AxisId, number>,
): number[] {
  return axes.map((axis) => location.get(axis.id) ?? Number.NaN);
}

function locationFromValues(axes: readonly Axis[], values: readonly number[]): Map<AxisId, number> {
  const location = new Map<AxisId, number>();
  for (const [index, axis] of axes.entries()) {
    const value = values[index];
    if (value !== undefined && !Number.isNaN(value)) location.set(axis.id, value);
  }
  return location;
}

function sameValues(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => Object.is(value, right[index]));
}

/** The batched weights last read, and what they were read at. */
interface ReadWeights {
  readonly axes: readonly Axis[];
  readonly mappings: readonly AxisMappingBasis[];
  readonly sources: readonly Source[];
  readonly location: readonly number[];
  readonly weights: SourceSetWeights;
}

/**
 * A font's variation, evaluated by one session of its engine: its axis
 * mappings, the weights of the source sets its glyphs interpolate over, and
 * the compiled deltas a compiled font's glyphs carry, at a location. The
 * session builds the mappings and each set's basis from its own font, unsaved
 * edits included, and runs shift-font's evaluators.
 *
 * @remarks
 * A `Font` makes one per session, as a computed over
 * `FontEngine.variationCell`: a set's or a compiled basis's number is the
 * session's own. Readers do not subscribe: {@link Designspace} subscribes
 * for them, to the cells this reads with `peek`.
 *
 * A frame reads every interned set's weights in one call, once per location;
 * each glyph then reads its set's row. The read is kept until the location or
 * the font's axes, mappings or sources change.
 *
 * An answer of the wrong length means the session was released under the
 * reader, and throws.
 */
export class FontVariation {
  readonly #variation: EngineVariation;
  readonly #axesCell: Signal<readonly Axis[]>;
  readonly #mappingBasesCell: Signal<readonly AxisMappingBasis[]>;
  readonly #sourcesCell: Signal<readonly Source[]>;
  // non-reactive: each projection basis's set number in this session; a number never changes
  readonly #sets = new WeakMap<InterpolationBasis, number>();
  // non-reactive: each compiled basis's number in this session; a number never changes
  readonly #compiled = new WeakMap<VariationBasis, number>();
  // non-reactive: one read of pure results, checked against everything it was read at
  #weights: ReadWeights | null = null;

  constructor(
    engineVariation: EngineVariation,
    cells: {
      axesCell: Signal<readonly Axis[]>;
      mappingBasesCell: Signal<readonly AxisMappingBasis[]>;
      sourcesCell: Signal<readonly Source[]>;
    },
  ) {
    this.#variation = engineVariation;
    this.#axesCell = cells.axesCell;
    this.#mappingBasesCell = cells.mappingBasesCell;
    this.#sourcesCell = cells.sourcesCell;
  }

  /** Maps an external location once, through the font's axis mappings, into design space. */
  toDesign(location: ExternalAxisLocation): DesignAxisLocation {
    const axes = this.#axesCell.peek();
    const design = this.#variation.designLocation(locationValues(axes, location));
    return asDesignAxisLocation(locationFromValues(axes, onEveryAxis(axes, design)));
  }

  /** The external location a design location's mapping came from, on the external axes. */
  toExternal(location: DesignAxisLocation): ExternalAxisLocation {
    const axes = this.#axesCell.peek();
    const external = this.#variation.externalLocation(locationValues(axes, location));
    return asExternalAxisLocation(locationFromValues(axes, onEveryAxis(axes, external)));
  }

  /**
   * The number the session knows `basis`'s source set by, for
   * {@link interpolationWeights}; it stays the set's for the session's life.
   */
  sourceSet(basis: InterpolationBasis): number {
    let set = this.#sets.get(basis);
    if (set === undefined) {
      set = this.#variation.sourceSetNumber(basis.sourceIds);
      this.#sets.set(basis, set);
    }
    return set;
  }

  /**
   * One weight per source of the source set numbered `set`, in its order, at
   * a design location: shift-font's `InterpolationBasis::weights_at` for the
   * basis the font gives that set.
   *
   * @remarks
   * The result is shared between callers at the same location: read it, don't change it.
   *
   * @returns null when the font's sources give the set no model.
   * @throws When `set` is not a number this reader gave.
   */
  interpolationWeights(set: number, location: DesignAxisLocation): Float64Array | null {
    const axes = this.#axesCell.peek();
    const values = locationValues(axes, location);
    let read = this.#weights;
    if (!read || !this.#current(read, axes, values) || set + 1 >= read.weights.starts.length) {
      read = this.#read(axes, values);
    }

    const { weights, starts } = read.weights;
    const start = starts[set];
    const end = starts[set + 1];
    if (start === undefined || end === undefined) {
      throw new Error(`the engine has no source set ${set}`);
    }
    const row = weights.subarray(start, end);
    return Number.isNaN(row[0]) ? null : row;
  }

  /**
   * A compiled variation basis's values at a design location, each axis
   * normalized by its own range: shift-font's `VariationBasis::evaluate`.
   * The basis crosses to the session once, the first time it is evaluated.
   *
   * @returns null when the basis's regions name an axis the font lacks.
   */
  variationAdjustments(basis: VariationBasis, location: DesignAxisLocation): Float64Array | null {
    let variation = this.#compiled.get(basis);
    if (variation === undefined) {
      variation = this.#variation.variationNumber(basis);
      this.#compiled.set(basis, variation);
    }
    const axes = this.#axesCell.peek();
    const values = this.#variation.variationAt(variation, locationValues(axes, location));
    return values && Float64Array.from(values);
  }

  /** Whether `read` was read at `values` against the font's current inputs. */
  #current(read: ReadWeights, axes: readonly Axis[], values: readonly number[]): boolean {
    return (
      read.axes === axes &&
      read.mappings === this.#mappingBasesCell.peek() &&
      read.sources === this.#sourcesCell.peek() &&
      sameValues(read.location, values)
    );
  }

  #read(axes: readonly Axis[], values: readonly number[]): ReadWeights {
    const read: ReadWeights = {
      axes,
      mappings: this.#mappingBasesCell.peek(),
      sources: this.#sourcesCell.peek(),
      location: values,
      weights: this.#variation.sourceSetWeights(values),
    };
    this.#weights = read;
    return read;
  }
}

/** `values` when they are one per axis of `axes`; the engine answered for a released session otherwise. */
function onEveryAxis(axes: readonly Axis[], values: readonly number[]): readonly number[] {
  if (values.length !== axes.length) {
    throw new Error(`the engine answered ${values.length} coordinates for ${axes.length} axes`);
  }
  return values;
}

/**
 * A Slug atlas's weights at an external location, in one call: the location
 * mapped once, then each weight set's basis evaluated there and its weights
 * written at the set's indices. Weight 0 is always 1.
 *
 * @remarks
 * The open document's `engine` evaluates the bases its own font gives the
 * sets, so a frame sends only the sets' numbers and the location.
 *
 * @throws When the engine is not open, a set's sources are missing from its
 * font or form no model, or a set names a weight index past `weightCount`.
 */
export function atlasWeights(
  axes: readonly Axis[],
  sets: readonly SlugWeightSet[],
  weightCount: number,
  location: ExternalAxisLocation,
  engine: FontEngine,
): readonly number[] {
  const weights = engine.atlasWeights(sets, weightCount, locationValues(axes, location));
  if (!weights) throw new Error("the engine has no weights for the atlas's weight sets");
  return weights;
}
