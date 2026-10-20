import type {
  Axis,
  AxisId,
  AxisMappingBasis,
  InterpolationBasis,
  VariationBasis,
} from "@shift/types";
import {
  denormalizeAxis as wasmDenormalizeAxis,
  evaluateAxisMapping as wasmEvaluateAxisMapping,
  evaluateVariationBasis as wasmEvaluateVariationBasis,
  interpolationWeights as wasmInterpolationWeights,
  mapAxisLocation,
  registerAxes,
  registerAxisMappings,
  registerInterpolationBasis,
  registerVariationBasis,
  releaseAxes,
  releaseAxisMappings,
  releaseInterpolationBasis,
  releaseVariationBasis,
} from "@shift/wasm";
import type { DesignAxisLocation, ExternalAxisLocation } from "../../types/variation";
import { asDesignAxisLocation } from "../variation/location";

/**
 * Registers Rust-compiled values with the module once per object, and frees
 * the module's copy when the object is collected.
 */
class Handles<T extends object> {
  // non-reactive: identity cache of module handles; values never change for a key
  readonly #handles = new WeakMap<T, number>();
  readonly #released: FinalizationRegistry<number>;
  readonly #register: (value: T) => number;

  constructor(register: (value: T) => number, release: (handle: number) => void) {
    this.#register = register;
    this.#released = new FinalizationRegistry(release);
  }

  of(value: T): number {
    let handle = this.#handles.get(value);
    if (handle === undefined) {
      handle = this.#register(value);
      this.#handles.set(value, handle);
      this.#released.register(value, handle);
    }
    return handle;
  }
}

const axesHandles = new Handles<readonly Axis[]>(
  (axes) => registerAxes(axes as Axis[]),
  releaseAxes,
);
const basisHandles = new Handles<VariationBasis>(registerVariationBasis, releaseVariationBasis);
const interpolationHandles = new Handles<InterpolationBasis>(
  registerInterpolationBasis,
  releaseInterpolationBasis,
);
const mappingHandles = new Handles<readonly AxisMappingBasis[]>(
  (bases) => registerAxisMappings(bases as AxisMappingBasis[]),
  releaseAxisMappings,
);

/** A location as numbers in `axes` order; NaN where it has no coordinate, read as the default. */
function locationValues(
  axes: readonly Axis[],
  location: ReadonlyMap<AxisId, number>,
): Float64Array {
  const values = new Float64Array(axes.length);
  for (const [index, axis] of axes.entries()) values[index] = location.get(axis.id) ?? Number.NaN;
  return values;
}

function locationFromValues(axes: readonly Axis[], values: Float64Array): Map<AxisId, number> {
  const location = new Map<AxisId, number>();
  for (const [index, axis] of axes.entries()) {
    const value = values[index];
    if (value !== undefined && !Number.isNaN(value)) location.set(axis.id, value);
  }
  return location;
}

/**
 * Evaluates one weight per source of an interpolation basis at a design location.
 *
 * @remarks
 * Runs shift-font's `InterpolationBasis::weights_at`. A region naming an axis
 * the basis or `axes` lack contributes nothing. The result is shared between
 * callers at the same location: read it, don't change it.
 */
export function interpolationWeights(
  basis: InterpolationBasis,
  location: DesignAxisLocation,
  axes: readonly Axis[],
): Float64Array {
  const values = locationValues(axes, location);
  const last = lastWeights.get(basis);
  if (last && last.axes === axes && sameValues(last.location, values)) return last.weights;

  const weights = wasmInterpolationWeights(
    interpolationHandles.of(basis),
    axesHandles.of(axes),
    values,
  );
  lastWeights.set(basis, { axes, location: values, weights });
  return weights;
}

/**
 * The last weights evaluated for each basis.
 *
 * @remarks
 * Glyphs with the same sources share one interned basis, so while a location
 * holds, every glyph after the first reuses its weights: a scrub step costs
 * one evaluation per distinct source set, however many glyphs are drawn.
 */
// non-reactive: a memo of pure results keyed by basis identity
const lastWeights = new WeakMap<
  InterpolationBasis,
  {
    readonly axes: readonly Axis[];
    readonly location: Float64Array;
    readonly weights: Float64Array;
  }
>();

function sameValues(left: Float64Array, right: Float64Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (!Object.is(left[index], right[index])) return false;
  }
  return true;
}

/** Evaluates a Rust-compiled variation basis, normalizing by each axis's own range. */
export function evaluateVariationBasis(
  basis: VariationBasis,
  location: ReadonlyMap<AxisId, number>,
  axes: readonly Axis[],
): Float64Array {
  return wasmEvaluateVariationBasis(
    basisHandles.of(basis),
    axesHandles.of(axes),
    locationValues(axes, location),
  );
}

/** Maps an external location to its design location through a font's compiled axis mappings. */
export function mapAxisMappings(
  location: ExternalAxisLocation,
  axes: readonly Axis[],
  bases: readonly AxisMappingBasis[],
): DesignAxisLocation {
  const design = mapAxisLocation(
    mappingHandles.of(bases),
    axesHandles.of(axes),
    locationValues(axes, location),
  );
  return asDesignAxisLocation(locationFromValues(axes, design));
}

/** Maps a location through one of a font's compiled axis mappings; its output axes only. */
export function evaluateAxisMapping(
  bases: readonly AxisMappingBasis[],
  index: number,
  location: ReadonlyMap<AxisId, number>,
  axes: readonly Axis[],
): DesignAxisLocation {
  const outputs = wasmEvaluateAxisMapping(
    mappingHandles.of(bases),
    index,
    axesHandles.of(axes),
    locationValues(axes, location),
  );
  const outputIds = bases[index]?.outputAxisIds ?? [];
  return asDesignAxisLocation(
    new Map(
      outputIds.flatMap((axisId, outputIndex) => {
        const value = outputs[outputIndex];
        return value === undefined || Number.isNaN(value) ? [] : [[axisId, value] as const];
      }),
    ),
  );
}

/** Converts a normalized coordinate on an axis back to its design value. */
export function denormalizeAxis(axes: readonly Axis[], axis: Axis, value: number): number {
  return wasmDenormalizeAxis(axesHandles.of(axes), axes.indexOf(axis), value);
}
