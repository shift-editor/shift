import type { LayerPlacement, Source } from "@shift/types";
import type { DesignAxisLocation, ExternalAxisLocation } from "../../types/variation";
import type { Glyph } from "../model/Glyph";
import type { Designspace } from "../variation/Designspace";
import {
  asDesignAxisLocation,
  asExternalAxisLocation,
  axisValue,
  locationFromDesignAxisLocation,
} from "../variation/location";

/**
 * The font location with the edited glyph's values on its own axes laid
 * over it: where the editor draws that glyph.
 */
export function withGlyphLocation(
  external: ExternalAxisLocation,
  glyphLocation: ExternalAxisLocation,
): ExternalAxisLocation {
  if (glyphLocation.size === 0) return external;

  return asExternalAxisLocation(new Map([...external, ...glyphLocation]));
}

/**
 * Where a new drawing of `glyph` drawn at `location` sits: on `source`, the
 * font source at the font location when there is one, plus the glyph's own
 * axes away from their defaults ("Regular + Spread 60"); between font
 * sources, at every axis away from its default, with no base ("Bleed 50").
 */
export function drawingPlacement(
  designspace: Designspace,
  glyph: Glyph,
  location: ExternalAxisLocation,
  source: Source | null,
): LayerPlacement {
  const design = glyph.space.toDesign(location);
  const axes = source ? glyph.axes : glyph.space.spaceAxes;
  const origin = glyph.space.toDesign(designspace.defaultLocation());
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
 * The values of `location` that differ from the default location, in
 * `glyph`'s design space, by axis in space order: what names a drawing
 * located off the font's sources ("Spread 100", "Bleed 50").
 */
export function offDefaultValues(
  designspace: Designspace,
  glyph: Glyph,
  location: DesignAxisLocation,
): { name: string; value: number }[] {
  const origin = glyph.space.toDesign(designspace.defaultLocation());
  const external = designspace.toExternal(location);
  return glyph.space.spaceAxes
    .filter((axis) => axisValue(location, axis) !== axisValue(origin, axis))
    .map((axis) => ({
      name: axis.name,
      // Font axes read in user units, as the sliders show them; glyph axes have no mapping.
      value: glyph.space.hasAxis(axis.id) ? axisValue(location, axis) : axisValue(external, axis),
    }));
}

/**
 * A drawing's name in the Sources list, by where it sits: each axis away
 * from its default with its value, "Spread 100" or "Bleed 50, Spread 60".
 */
export function drawingName(
  designspace: Designspace,
  glyph: Glyph,
  location: DesignAxisLocation,
): string {
  const values = offDefaultValues(designspace, glyph, location);
  if (values.length === 0) return "Default";

  return values.map(({ name, value }) => `${name} ${Math.round(value * 100) / 100}`).join(", ");
}
