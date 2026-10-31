import type {
  Axis,
  AxisId,
  AxisMappingBasis,
  InterpolationBasis,
  SlugWeightSet,
  Source,
  VariationBasis,
} from "@shift/types";
import { variation } from "@shift/wasm";
import type { Signal } from "../signals";
import type { EngineVariation, FontEngine } from "../../types/font";
import type {
  DesignAxisLocation,
  ExternalAxisLocation,
  VariationReader,
} from "../../types/variation";
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

/** The weights last evaluated for one basis, and what they were evaluated against. */
interface EvaluatedWeights {
  readonly axes: readonly Axis[];
  readonly mappings: readonly AxisMappingBasis[];
  readonly location: readonly number[];
  readonly weights: Float64Array;
}

/**
 * The last weights evaluated for each basis, so glyphs that share one interned
 * basis evaluate it once per location.
 *
 * @remarks
 * Glyphs with the same sources share one interned basis, so while a location
 * holds, every glyph after the first reuses its weights: a scrub step costs
 * one evaluation per distinct source set, however many glyphs are drawn.
 */
class WeightMemo {
  // non-reactive: a memo of pure results keyed by basis identity and checked against its inputs
  readonly #last = new WeakMap<InterpolationBasis, EvaluatedWeights>();

  /** The weights for `basis` at `location`, evaluating them with `evaluate` when the memo misses. */
  weights(
    basis: InterpolationBasis,
    axes: readonly Axis[],
    mappings: readonly AxisMappingBasis[],
    location: readonly number[],
    evaluate: () => Float64Array,
  ): Float64Array {
    const last = this.#last.get(basis);
    if (
      last &&
      last.axes === axes &&
      last.mappings === mappings &&
      sameValues(last.location, location)
    ) {
      return last.weights;
    }

    const weights = evaluate();
    this.#last.set(basis, { axes, mappings, location, weights });
    return weights;
  }
}

function sameValues(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => Object.is(value, right[index]));
}

/**
 * Variation for a font without an editing engine (a preview, a retained
 * source, a memory session), or while its engine is not open: each call
 * carries the font's axes, its compiled axis mappings and the basis it
 * evaluates to `@shift/wasm`'s stateless `Variation` calls, which run
 * shift-font's evaluators.
 *
 * @remarks
 * Reads the cells with `peek`: the {@link Designspace} that calls it
 * subscribes its reader to them.
 */
export class StatelessVariationReader implements VariationReader {
  readonly #axesCell: Signal<readonly Axis[]>;
  readonly #mappingBasesCell: Signal<readonly AxisMappingBasis[]>;
  readonly #weights = new WeightMemo();
  // non-reactive: the bases by the numbers this reader gave them; a number never changes
  readonly #bases: InterpolationBasis[] = [];
  // non-reactive: each basis's number, the inverse of #bases
  readonly #numbers = new WeakMap<InterpolationBasis, number>();

  constructor(
    axesCell: Signal<readonly Axis[]>,
    mappingBasesCell: Signal<readonly AxisMappingBasis[]>,
  ) {
    this.#axesCell = axesCell;
    this.#mappingBasesCell = mappingBasesCell;
  }

  toDesign(location: ExternalAxisLocation): DesignAxisLocation {
    const axes = this.#axesCell.peek();
    const design = variation.mapLocation(
      axes,
      this.#mappingBasesCell.peek(),
      locationValues(axes, location),
    );
    return asDesignAxisLocation(locationFromValues(axes, design));
  }

  toExternal(location: DesignAxisLocation): ExternalAxisLocation {
    const axes = this.#axesCell.peek();
    const external = variation.unmapLocation(
      axes,
      this.#mappingBasesCell.peek(),
      locationValues(axes, location),
    );
    return asExternalAxisLocation(locationFromValues(axes, external));
  }

  sourceSet(basis: InterpolationBasis): number {
    let set = this.#numbers.get(basis);
    if (set === undefined) {
      set = this.#bases.push(basis) - 1;
      this.#numbers.set(basis, set);
    }
    return set;
  }

  interpolationWeights(set: number, location: DesignAxisLocation): Float64Array {
    const basis = this.#bases[set];
    if (!basis) throw new Error(`source set ${set} was not given by this reader`);

    const axes = this.#axesCell.peek();
    const values = locationValues(axes, location);
    return this.#weights.weights(basis, axes, NO_MAPPINGS, values, () =>
      Float64Array.from(variation.interpolationWeights(axes, basis, values)),
    );
  }
}

/** What weights evaluated without the font's mappings are memoized against. */
const NO_MAPPINGS: readonly AxisMappingBasis[] = [];

/**
 * Compiled variation deltas at a location, through `@shift/wasm`'s stateless
 * `Variation` calls. Only imported glyphs of retained sources carry them,
 * which no engine holds, so every font evaluates them here.
 *
 * @remarks
 * Reads the axes with `peek`: the {@link Designspace} that calls it
 * subscribes its reader to them.
 */
export class CompiledVariationReader {
  readonly #axesCell: Signal<readonly Axis[]>;

  constructor(axesCell: Signal<readonly Axis[]>) {
    this.#axesCell = axesCell;
  }

  /**
   * A compiled variation basis's values at a design location, normalized by
   * each axis's own range: shift-font's `VariationBasis::evaluate`.
   */
  adjustments(basis: VariationBasis, location: DesignAxisLocation): Float64Array {
    const axes = this.#axesCell.peek();
    return Float64Array.from(
      variation.evaluateVariation(axes, basis, locationValues(axes, location)),
    );
  }
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
 * Variation for the font open in one session of the window's editing engine:
 * mapping and every source set's weights come from the session, which builds
 * the axis mappings and each set's basis from its own font, unsaved edits
 * included.
 *
 * @remarks
 * A frame reads every interned set's weights in one call, once per location;
 * each glyph then reads its set's row. The read is kept until the location or
 * the font's axes, mappings or sources change: the cells a {@link Designspace}
 * subscribes weight readers to. Reads the cells with `peek`.
 *
 * An answer of the wrong length means the session was released under the
 * reader, and throws.
 */
export class EngineVariationReader implements VariationReader {
  readonly #variation: EngineVariation;
  readonly #axesCell: Signal<readonly Axis[]>;
  readonly #mappingBasesCell: Signal<readonly AxisMappingBasis[]>;
  readonly #sourcesCell: Signal<readonly Source[]>;
  // non-reactive: each projection basis's set number in this session; a number never changes
  readonly #sets = new WeakMap<InterpolationBasis, number>();
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

  toDesign(location: ExternalAxisLocation): DesignAxisLocation {
    const axes = this.#axesCell.peek();
    const design = this.#variation.designLocation(locationValues(axes, location));
    return asDesignAxisLocation(locationFromValues(axes, onEveryAxis(axes, design)));
  }

  toExternal(location: DesignAxisLocation): ExternalAxisLocation {
    const axes = this.#axesCell.peek();
    const external = this.#variation.externalLocation(locationValues(axes, location));
    return asExternalAxisLocation(locationFromValues(axes, onEveryAxis(axes, external)));
  }

  sourceSet(basis: InterpolationBasis): number {
    let set = this.#sets.get(basis);
    if (set === undefined) {
      set = this.#variation.sourceSetNumber(basis.sourceIds);
      this.#sets.set(basis, set);
    }
    return set;
  }

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
 * sets, so a frame sends only the sets' numbers and the location. Without an
 * engine, or while it is closed or lacks a set's sources, one stateless call
 * carries `axes`, `mappingBases` and each set's basis whole.
 *
 * @throws When a set names a weight index past `weightCount`.
 */
export function atlasWeights(
  axes: readonly Axis[],
  mappingBases: readonly AxisMappingBasis[],
  sets: readonly SlugWeightSet[],
  weightCount: number,
  location: ExternalAxisLocation,
  engine: FontEngine | null,
): readonly number[] {
  const values = locationValues(axes, location);
  const engineWeights = engine?.atlasWeights(sets, weightCount, values) ?? null;
  if (engineWeights) return engineWeights;

  const weights = variation.atlasWeights(axes, mappingBases, sets, weightCount, values);
  if (!weights) throw new Error("resident Slug weight index is out of range");
  return weights;
}
