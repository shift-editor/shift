import type {
  AxisId,
  AxisMappingBasis,
  Axis as AxisRecord,
  InterpolationBasis,
  Source,
  SourceId,
  VariationBasis,
} from "@shift/types";
import { Axis } from "../model/Axis";
import { computed, track, type ComputedSignal, type Signal } from "../signals";
import type { DesignAxisLocation, ExternalAxisLocation } from "../../types/variation";
import {
  asDesignAxisLocation,
  axisValue,
  defaultExternalAxisLocation,
  designAxisLocationDistanceSquared,
  designAxisLocationFromLocation,
  designAxisLocationsEqual,
  emptyExternalAxisLocation,
  externalAxisLocationFromRecord,
} from "./location";
import type { FontVariation } from "../wasm/variation";

/**
 * A font's axes, axis mappings, and sources, with the location operations over them.
 *
 * @remarks
 * Every method subscribes to exactly the cells it reads (`track` then `peek`),
 * so calls are correct from imperative code and keep `computed`/`effect`
 * readers current when the designspace changes. Mapping, interpolation
 * weights and compiled variation deltas are evaluated by the font's engine,
 * through its current {@link FontVariation}; while the engine is not open
 * they throw, as the engine's other reads do.
 */
export class Designspace {
  readonly #axesCell: ComputedSignal<readonly Axis[]>;
  readonly #mappingBasesCell: Signal<readonly AxisMappingBasis[]>;
  readonly #sourcesCell: Signal<readonly Source[]>;
  readonly #variationCell: Signal<FontVariation | null>;

  /**
   * @param cells - the font's axis records, axis mapping bases and sources;
   *   each is read reactively, never written. `variationCell` holds what
   *   evaluates the font's variation: its engine's open session, null while
   *   the engine is not open.
   */
  constructor(cells: {
    axesCell: Signal<readonly AxisRecord[]>;
    mappingBasesCell: Signal<readonly AxisMappingBasis[]>;
    sourcesCell: Signal<readonly Source[]>;
    variationCell: Signal<FontVariation | null>;
  }) {
    const recordsCell = cells.axesCell;
    this.#axesCell = computed(() => recordsCell.value.map((record) => new Axis(record)));
    this.#mappingBasesCell = cells.mappingBasesCell;
    this.#sourcesCell = cells.sourcesCell;
    this.#variationCell = cells.variationCell;
  }

  /**
   * The font's axes in authored order, rebuilt only when the axis records change.
   *
   * @remarks
   * The array keeps its identity while the records do, so readers that key on
   * it (memoized weights) stay valid across unrelated edits.
   */
  get axesCell(): ComputedSignal<readonly Axis[]> {
    return this.#axesCell;
  }

  get axes(): readonly Axis[] {
    return read(this.#axesCell);
  }

  get sources(): readonly Source[] {
    return read(this.#sourcesCell);
  }

  /** Subscribes the current reader to every designspace input. */
  track(): void {
    track(this.#axesCell);
    track(this.#mappingBasesCell);
    track(this.#sourcesCell);
  }

  axis(axisId: AxisId): Axis | null {
    return this.axes.find((axis) => axis.id === axisId) ?? null;
  }

  /** The axis tagged `tag`; a font has at most one axis per tag. */
  axisTagged(tag: string): Axis | null {
    return this.axes.find((axis) => axis.tag === tag) ?? null;
  }

  source(sourceId: SourceId): Source | null {
    return this.sources.find((source) => source.id === sourceId) ?? null;
  }

  /**
   * The source named exactly `name`.
   *
   * @remarks
   * Names are not unique: the store does not constrain them and renaming a
   * source in Font Settings does not check, so two sources can share one.
   * Only creating a source and importing a designspace pick unused names.
   *
   * @returns null when no source has the name.
   * @throws {Error} when more than one source has it.
   */
  sourceNamed(name: string): Source | null {
    const named = this.sources.filter((source) => source.name === name);
    if (named.length > 1) {
      throw new Error(`Source name ${name} is ambiguous: ${named.length} sources have it`);
    }
    return named[0] ?? null;
  }

  /**
   * Maps external user coordinates once into internal design coordinates. A
   * font without axes has nothing to map, engine or not: every location is
   * the empty one.
   *
   * @throws When the font has axes and its engine is not open.
   */
  toDesign(location: ExternalAxisLocation): DesignAxisLocation {
    if (this.axes.length === 0) return asDesignAxisLocation(new Map());
    return this.#mapping().toDesign(location);
  }

  /**
   * Resolves the external user coordinates that represent a design location;
   * the empty location in a font without axes.
   *
   * @throws When the font has axes and its engine is not open.
   */
  toExternal(location: DesignAxisLocation): ExternalAxisLocation {
    if (this.axes.length === 0) return emptyExternalAxisLocation();
    return this.#mapping().toExternal(location);
  }

  /**
   * One weight per source of `basis`, in its order, at a design location.
   *
   * @remarks
   * Subscribes to the axes, mappings and sources, from which the open
   * document's engine builds the basis it evaluates. The result is shared
   * between callers at the same location: read it, don't change it.
   *
   * @returns null when the font's sources give `basis`'s source set no model.
   */
  interpolationWeights(
    basis: InterpolationBasis,
    location: DesignAxisLocation,
  ): Float64Array | null {
    this.track();
    const variation = this.#variation();
    return variation.interpolationWeights(variation.sourceSet(basis), location);
  }

  /**
   * A compiled variation basis's values at a design location, as a compiled
   * font's glyph carries its deltas.
   *
   * @returns null when the basis's regions name an axis the font lacks.
   */
  variationAdjustments(basis: VariationBasis, location: DesignAxisLocation): Float64Array | null {
    track(this.#axesCell);
    return this.#variation().variationAdjustments(basis, location);
  }

  /** The current variation, subscribed to it and to what mapping reads. */
  #mapping(): FontVariation {
    track(this.#axesCell);
    track(this.#mappingBasesCell);
    return this.#variation();
  }

  /**
   * The engine's current variation, subscribed to it.
   *
   * @throws When the font's engine is not open.
   */
  #variation(): FontVariation {
    const variation = read(this.#variationCell);
    if (!variation) throw new Error("the font's engine is not open");
    return variation;
  }

  /** The source exactly at an external location after mapping, or `null` when interpolated. */
  sourceAt(location: ExternalAxisLocation): Source | null {
    return this.sourceAtDesign(this.toDesign(location));
  }

  /** The source exactly at a design location, or `null` when interpolated. */
  sourceAtDesign(location: DesignAxisLocation): Source | null {
    const axes = this.axes;
    return (
      this.sources.find((source) =>
        designAxisLocationsEqual(designAxisLocationFromLocation(source.location), location, axes),
      ) ?? null
    );
  }

  /** The source closest to an external location after mapping, or `null` without sources. */
  nearestSource(location: ExternalAxisLocation): Source | null {
    const axes = this.axes;
    const design = this.toDesign(location);
    let nearest: { source: Source; distance: number } | null = null;
    for (const source of this.sources) {
      const distance = designAxisLocationDistanceSquared(
        designAxisLocationFromLocation(source.location),
        design,
        axes,
      );
      if (!nearest || distance < nearest.distance) nearest = { source, distance };
    }
    return nearest?.source ?? null;
  }

  /**
   * Builds an external location from explicit axis coordinates.
   *
   * @param coordinates - Values keyed by stable axis identity; omitted axes take their defaults.
   * @throws {Error} when a coordinate names an unknown axis or repeats one.
   */
  location(coordinates: readonly { axisId: AxisId; value: number }[]): ExternalAxisLocation {
    const axisIds = new Set(this.axes.map(({ id }) => id));
    const values: Record<string, number> = {};
    for (const { axisId, value } of coordinates) {
      if (!axisIds.has(axisId)) throw new Error(`Unknown axis: ${axisId}`);
      if (axisId in values) throw new Error(`Duplicate axis coordinate: ${axisId}`);
      values[axisId] = value;
    }
    return externalAxisLocationFromRecord(values);
  }

  /** A location's value on every axis, in axis order, with defaults filled in. */
  coordinates(
    location: ExternalAxisLocation | DesignAxisLocation,
  ): { axisId: AxisId; value: number }[] {
    return this.axes.map((axis) => ({ axisId: axis.id, value: axisValue(location, axis) }));
  }

  /** Every axis at its default, or an empty location for a static font. */
  defaultLocation(): ExternalAxisLocation {
    const axes = this.axes;
    return axes.length > 0 ? defaultExternalAxisLocation(axes) : emptyExternalAxisLocation();
  }
}

function read<T>(cell: Signal<T>): T {
  track(cell);
  return cell.peek();
}
