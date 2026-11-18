import type { AxisId, LayerPlacement, Source } from "@shift/types";
import { asAxisId } from "@shift/types";
import { track, type Signal } from "../signals";
import type { DesignAxisLocation, ExternalAxisLocation } from "../../types/variation";
import type { Designspace } from "../variation/Designspace";
import type { Axis } from "./Axis";
import {
  asDesignAxisLocation,
  axisValue,
  designAxisLocationFromLocation,
  designAxisLocationsEqual,
} from "../variation/location";

/**
 * One glyph's design space: the font's axes, then the glyph's own (a `dot`'s
 * Spread and Strike), as shift-font's `Font::glyph_space_axes` lists them.
 *
 * @remarks
 * A location the editor draws a glyph at holds the font's axes in user units
 * and may hold the glyph's own axes, which have no mapping: their values are
 * in the axis's own units everywhere. Values on another glyph's axes are
 * ignored. Every method subscribes to what it reads.
 */
export class GlyphSpace {
  readonly #designspace: Designspace;
  readonly #axesCell: Signal<readonly Axis[]>;

  /**
   * @param designspace - the font's axes, mappings and sources.
   * @param axesCell - the glyph's own axes, in order.
   */
  constructor(designspace: Designspace, axesCell: Signal<readonly Axis[]>) {
    this.#designspace = designspace;
    this.#axesCell = axesCell;
  }

  /** The glyph's own axes, in order. */
  get axes(): readonly Axis[] {
    track(this.#axesCell);
    return this.#axesCell.peek();
  }

  get axesCell(): Signal<readonly Axis[]> {
    return this.#axesCell;
  }

  /** The font's axes, then the glyph's own. */
  get spaceAxes(): readonly Axis[] {
    const own = this.axes;
    const font = this.#designspace.axes;
    return own.length === 0 ? font : [...font, ...own];
  }

  /** Whether `axisId` is one of the glyph's own axes. */
  hasAxis(axisId: AxisId): boolean {
    return this.axes.some((axis) => axis.id === axisId);
  }

  /**
   * `location`'s design coordinates: the font's axes mapped once, then the
   * glyph's own as given. Other glyphs' axes are dropped.
   */
  toDesign(location: ExternalAxisLocation): DesignAxisLocation {
    const design = this.#designspace.toDesign(location);
    const own = this.axes;
    if (own.length === 0) return design;

    const values = new Map(design);
    for (const axis of own) {
      const value = location.get(axis.id);
      if (value !== undefined) values.set(axis.id, value);
    }
    return asDesignAxisLocation(values);
  }

  /** Whether `location` leaves every one of the glyph's own axes at its default. */
  atOwnDefaults(location: ExternalAxisLocation | DesignAxisLocation): boolean {
    return this.axes.every((axis) => axisValue(location, axis) === axis.kind.default);
  }

  /**
   * Where a drawing sits in the glyph's design space: its source's location
   * when it is on one, or its base source's location (none: every axis at
   * its default) with its own coordinates laid over it.
   *
   * @returns null when the base names a source the font lacks.
   */
  drawingLocation(source: Source, placement: LayerPlacement | null): DesignAxisLocation | null {
    if (!placement) return designAxisLocationFromLocation(source.location);

    const baseId = placement.baseSourceId ?? null;
    const base = baseId ? this.#designspace.source(baseId) : null;
    if (baseId && !base) return null;

    const values = new Map<AxisId, number>(
      base ? designAxisLocationFromLocation(base.location) : [],
    );
    for (const [axisId, value] of Object.entries(placement.coordinates.values)) {
      values.set(asAxisId(axisId), value);
    }
    return asDesignAxisLocation(values);
  }

  /** Whether two design locations are the same place in the glyph's space. */
  same(left: DesignAxisLocation, right: DesignAxisLocation): boolean {
    return designAxisLocationsEqual(left, right, this.spaceAxes);
  }
}
