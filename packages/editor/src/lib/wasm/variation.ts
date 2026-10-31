import type {
  Axis,
  AxisId,
  AxisMappingBasis,
  InterpolationBasis,
  SlugWeightSet,
  VariationBasis,
} from "@shift/types";
import { variation } from "@shift/wasm";
import type { Signal } from "../signals";
import type { FontEngine } from "../../types/font";
import type {
  DesignAxisLocation,
  ExternalAxisLocation,
  VariationReader,
} from "../../types/variation";
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
 * source, a memory session): each call carries the font's axes, its compiled
 * axis mappings and the basis it evaluates to `@shift/wasm`'s stateless
 * `Variation` calls, which run shift-font's evaluators.
 *
 * @remarks
 * Reads the cells with `peek`: the {@link Designspace} that calls it
 * subscribes its reader to them.
 */
export class StatelessVariationReader implements VariationReader {
  readonly #axesCell: Signal<readonly Axis[]>;
  readonly #mappingBasesCell: Signal<readonly AxisMappingBasis[]>;
  readonly #weights = new WeightMemo();

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

  interpolationWeights(basis: InterpolationBasis, location: DesignAxisLocation): Float64Array {
    const axes = this.#axesCell.peek();
    const values = locationValues(axes, location);
    return this.#weights.weights(basis, axes, NO_MAPPINGS, values, () =>
      Float64Array.from(variation.interpolationWeights(axes, basis, values)),
    );
  }

  variationAdjustments(basis: VariationBasis, location: DesignAxisLocation): Float64Array {
    const axes = this.#axesCell.peek();
    return Float64Array.from(
      variation.evaluateVariation(axes, basis, locationValues(axes, location)),
    );
  }
}

/** What weights evaluated without the font's mappings are memoized against. */
const NO_MAPPINGS: readonly AxisMappingBasis[] = [];

/**
 * Variation for the font open in the window's editing engine: mapping and
 * interpolation weights come from the engine, which builds the axis mappings
 * and each source set's basis from its own font, unsaved edits included.
 *
 * @remarks
 * Compiled deltas ({@link variationAdjustments}) belong only to imported
 * glyphs of retained sources, which the engine never holds, and every read
 * falls back to `stateless` while the engine is not open.
 */
export class EngineVariationReader implements VariationReader {
  readonly #engine: FontEngine;
  readonly #axesCell: Signal<readonly Axis[]>;
  readonly #mappingBasesCell: Signal<readonly AxisMappingBasis[]>;
  readonly #stateless: StatelessVariationReader;
  readonly #weights = new WeightMemo();

  constructor(
    engine: FontEngine,
    axesCell: Signal<readonly Axis[]>,
    mappingBasesCell: Signal<readonly AxisMappingBasis[]>,
  ) {
    this.#engine = engine;
    this.#axesCell = axesCell;
    this.#mappingBasesCell = mappingBasesCell;
    this.#stateless = new StatelessVariationReader(axesCell, mappingBasesCell);
  }

  toDesign(location: ExternalAxisLocation): DesignAxisLocation {
    const axes = this.#axesCell.peek();
    const design = this.#engine.designLocation(locationValues(axes, location));
    if (!design) return this.#stateless.toDesign(location);
    return asDesignAxisLocation(locationFromValues(axes, design));
  }

  toExternal(location: DesignAxisLocation): ExternalAxisLocation {
    const axes = this.#axesCell.peek();
    const external = this.#engine.externalLocation(locationValues(axes, location));
    if (!external) return this.#stateless.toExternal(location);
    return asExternalAxisLocation(locationFromValues(axes, external));
  }

  interpolationWeights(basis: InterpolationBasis, location: DesignAxisLocation): Float64Array {
    const axes = this.#axesCell.peek();
    const values = locationValues(axes, location);
    // The engine's basis for the set follows its sources and mappings, which
    // can change while the projection's basis object stays the same.
    return this.#weights.weights(basis, axes, this.#mappingBasesCell.peek(), values, () => {
      const weights = this.#engine.interpolationWeights(basis.sourceIds, values);
      if (!weights || weights.length !== basis.sourceIds.length) {
        return this.#stateless.interpolationWeights(basis, location);
      }
      return Float64Array.from(weights);
    });
  }

  variationAdjustments(basis: VariationBasis, location: DesignAxisLocation): Float64Array {
    return this.#stateless.variationAdjustments(basis, location);
  }
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
