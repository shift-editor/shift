import type { Axis, AxisId, AxisMappingBasis, Source, SourceId } from "@shift/types";
import { track, type Signal } from "../signals";
import type { DesignAxisLocation, ExternalAxisLocation } from "../../types/variation";
import {
  axisValue,
  defaultExternalAxisLocation,
  designAxisLocationDistanceSquared,
  designAxisLocationFromLocation,
  designAxisLocationsEqual,
  emptyExternalAxisLocation,
  externalAxisLocationForDesignLocation,
  externalAxisLocationFromRecord,
  mapAxisLocation,
} from "./location";

/**
 * A font's axes, axis mappings, and sources, with the location operations over them.
 *
 * @remarks
 * Every method subscribes to exactly the cells it reads (`track` then `peek`),
 * so calls are correct from imperative code and keep `computed`/`effect`
 * readers current when the designspace changes.
 */
export class Designspace {
  readonly #axesCell: Signal<Axis[]>;
  readonly #mappingBasesCell: Signal<AxisMappingBasis[]>;
  readonly #sourcesCell: Signal<Source[]>;

  constructor(cells: {
    axesCell: Signal<Axis[]>;
    mappingBasesCell: Signal<AxisMappingBasis[]>;
    sourcesCell: Signal<Source[]>;
  }) {
    this.#axesCell = cells.axesCell;
    this.#mappingBasesCell = cells.mappingBasesCell;
    this.#sourcesCell = cells.sourcesCell;
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

  source(sourceId: SourceId): Source | null {
    return this.sources.find((source) => source.id === sourceId) ?? null;
  }

  /** Maps external user coordinates once into internal design coordinates. */
  toDesign(location: ExternalAxisLocation): DesignAxisLocation {
    return mapAxisLocation(location, this.axes, read(this.#mappingBasesCell));
  }

  /** Resolves the external user coordinates that represent a design location. */
  toExternal(location: DesignAxisLocation): ExternalAxisLocation {
    return externalAxisLocationForDesignLocation(location, this.axes, read(this.#mappingBasesCell));
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
