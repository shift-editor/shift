import type { AxisId, LayerPlacement, Source } from "@shift/types";
import { track, type Signal } from "../signals";
import type { DesignAxisLocation, ExternalAxisLocation } from "../../types/variation";
import type { Designspace } from "../variation/Designspace";
import type { Axis } from "./Axis";
import {
  asDesignAxisLocation,
  axisValue,
  designAxisLocationsEqual,
  locationFromDesignAxisLocation,
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

  /** Whether two design locations are the same place in the glyph's space. */
  same(left: DesignAxisLocation, right: DesignAxisLocation): boolean {
    return designAxisLocationsEqual(left, right, this.spaceAxes);
  }

  /**
   * Where a new drawing drawn at `location` sits: on `source`, the font
   * source at the font location when there is one, plus the glyph's own axes
   * away from their defaults ("Regular + Spread 60"); between font sources,
   * at every axis away from its default, with no base ("Bleed 50").
   */
  placementAt(location: ExternalAxisLocation, source: Source | null): LayerPlacement {
    const design = this.toDesign(location);
    const axes = source ? this.axes : this.spaceAxes;
    const origin = this.toDesign(this.#designspace.defaultLocation());
    const coordinates = asDesignAxisLocation(
      new Map(
        axes
          .filter((axis) => axisValue(design, axis) !== axisValue(origin, axis))
          .map((axis) => [axis.id, axisValue(design, axis)] as const),
      ),
    );
    return {
      baseSourceId: source?.id ?? null,
      coordinates: locationFromDesignAxisLocation(coordinates),
    };
  }

  /**
   * A place's name, as a glyph source's: each axis away from its default
   * with its value, "Spread 100" or "Bleed 50, Spread 60"; font axes in user
   * units, as the sliders show them.
   */
  locationName(location: DesignAxisLocation): string {
    const origin = this.toDesign(this.#designspace.defaultLocation());
    const external = this.#designspace.toExternal(location);
    const parts = this.spaceAxes
      .filter((axis) => axisValue(location, axis) !== axisValue(origin, axis))
      .map((axis) => {
        const value = this.hasAxis(axis.id) ? axisValue(location, axis) : axisValue(external, axis);
        return `${axis.name} ${Math.round(value * 100) / 100}`;
      });
    return parts.length === 0 ? "Default" : parts.join(", ");
  }
}
