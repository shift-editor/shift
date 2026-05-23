import { describe, expect, it } from "vitest";
import { createBridge } from "@shift/bridge";
import { MUTATORSANS_DESIGNSPACE } from "@/testing/fixtures";
import {
  axisLocationFromLocation,
  axisValue,
  defaultAxisLocation,
  emptyAxisLocation,
  withAxisValue,
} from "@/lib/variation/location";
import type { AxisLocation } from "@/types/variation";
import { signal } from "@/lib/signals/signal";
import { Font } from "./Font";

function loadFont(): Font {
  const font = new Font(createBridge());
  font.load(MUTATORSANS_DESIGNSPACE);
  return font;
}

function locationOverride(font: Font, override: Record<string, number>): AxisLocation {
  let location = defaultAxisLocation(font.getAxes());
  for (const axis of font.getAxes()) {
    if (override[axis.tag] !== undefined) {
      location = withAxisValue(location, axis, override[axis.tag]);
    }
  }
  return location;
}

describe("Font", () => {
  it("exposes bridge default metrics before a font is loaded", () => {
    const font = new Font(createBridge());

    expect(font.loaded).toBe(false);
    expect(font.metrics.unitsPerEm).toBe(1000);
    expect(font.metrics.ascender).toBe(800);
    expect(font.metrics.descender).toBe(-200);
  });

  it("hydrates committed glyph directory records from the bridge", () => {
    const font = loadFont();

    expect(font.loaded).toBe(true);
    expect(font.glyphRecords().length).toBeGreaterThan(0);
    expect(font.metrics.unitsPerEm).toBeGreaterThan(0);
  });

  it("resolves glyph handles by name and unicode", () => {
    const font = loadFont();

    expect(font.glyphHandleForName("A")).toEqual({ name: "A", unicode: 65 });
    expect(font.glyphHandleForUnicode(65)).toEqual({ name: "A", unicode: 65 });
    expect(font.nameForUnicode(65)).toBe("A");
    expect(font.glyphHandleForName("notdef")).toEqual({ name: "notdef" });
    expect(font.glyphHandleForUnicode(0xffff)).toEqual({
      name: "uniFFFF",
      unicode: 0xffff,
    });
  });

  it("creates a fresh loaded font with a default source", () => {
    const font = new Font(createBridge());

    font.create();

    expect(font.loaded).toBe(true);
    expect(font.sources).toHaveLength(1);
    expect(font.defaultSource.name).toBe("Regular");
    expect(font.sourceAt(emptyAxisLocation())?.id).toBe(font.defaultSource.id);
  });

  it("exposes component dependency information from glyph records", () => {
    const font = loadFont();
    const bases = font.componentBaseNamesForName("Aacute");

    expect(bases.length).toBeGreaterThan(0);
    expect(font.dependentNamesForName(bases[0])).toContain("Aacute");
  });

  it("returns a stable Glyph instance per glyph name", () => {
    const font = loadFont();

    const a = font.glyph({ name: "A", unicode: 65 });

    expect(a).not.toBeNull();
    expect(font.glyph({ name: "A" })).toBe(a);
  });

  it("updates a glyph identity through the font index", () => {
    const font = loadFont();

    font.updateGlyphIdentity("A", "A.alt", []);

    expect(font.glyphHandleForName("A")).toEqual({ name: "A", unicode: 65 });
    expect(font.glyphHandleForName("A.alt")).toEqual({ name: "A.alt" });
    expect(font.nameForUnicode(65)).toBe("A");
    expect(font.glyph({ name: "A", unicode: 65 })).toBeNull();
    expect(font.glyph({ name: "A.alt" })).not.toBeNull();
  });

  it("creates an empty committed glyph through the bridge", () => {
    const font = loadFont();

    const handle = font.createGlyph("newGlyph");

    expect(handle).toEqual({ name: "newGlyph" });
    expect(font.hasGlyph("newGlyph")).toBe(true);
    expect(font.glyphRecords().some((record) => record.name === "newGlyph")).toBe(true);
    expect(font.glyph(handle)).not.toBeNull();
  });

  it("auto-increments duplicate quick glyph names", () => {
    const font = loadFont();

    expect(font.createGlyph("newGlyph")).toEqual({ name: "newGlyph" });
    expect(font.createGlyph("newGlyph")).toEqual({ name: "newGlyph.1" });
    expect(font.createGlyph("newGlyph")).toEqual({ name: "newGlyph.2" });
  });

  it("moves Unicode assignment when updating glyph identity", () => {
    const font = loadFont();

    font.updateGlyphIdentity("A", "agrave", [0x00e0]);

    expect(font.glyphHandleForName("agrave")).toEqual({ name: "agrave", unicode: 0x00e0 });
    expect(font.nameForUnicode(0x00e0)).toBe("agrave");
    expect(font.nameForUnicode(65)).toBe("A");
  });

  it("returns a stable GlyphSource instance per glyph source", () => {
    const font = loadFont();
    const source = font.defaultSource;

    const a = font.glyphSource({ name: "A", unicode: 65 }, source);

    expect(a).not.toBeNull();
    expect(font.glyphSource({ name: "A" }, source)).toBe(a);
  });

  it("exposes variation defaults as a typed design location", () => {
    const font = loadFont();
    const location = font.defaultLocation();

    expect(font.isVariable()).toBe(true);
    for (const axis of font.getAxes()) {
      expect(axisValue(location, axis)).toBe(axis.default);
    }
  });

  it("looks up sources by id and exact design location", () => {
    const font = loadFont();
    const source = font.sources[0];

    expect(source).toBeDefined();
    expect(font.source(source.id)).toEqual(source);
    expect(font.sourceAt(axisLocationFromLocation(source.location))?.id).toBe(source.id);
  });

  it("matches omitted location axes against axis defaults", () => {
    const font = loadFont();
    const defaultSource = font.sources.find((source) =>
      font
        .getAxes()
        .every(
          (axis) => axisValue(axisLocationFromLocation(source.location), axis) === axis.default,
        ),
    );

    expect(defaultSource).toBeDefined();
    expect(font.sourceAt(emptyAxisLocation())?.id).toBe(defaultSource?.id);
  });

  it("distinguishes in-between locations from editable source locations", () => {
    const font = loadFont();
    const inBetween = locationOverride(font, { wdth: 500, wght: 500 });

    expect(font.sourceAt(inBetween)).toBeNull();
    expect(font.nearestSource(inBetween)).not.toBeNull();
  });

  it("close clears loaded directory state", () => {
    const font = loadFont();
    const location = signal(font.defaultLocation());

    const glyph = font.glyph({ name: "A", unicode: 65 });

    expect(glyph ? glyph.outline(location).svgPath.length : 0).toBeGreaterThan(0);
    font.close();

    expect(font.loaded).toBe(false);
    expect(font.glyphRecords()).toEqual([]);
    expect(font.glyphHandleForName("A")).toEqual({ name: "A", unicode: 65 });
    expect(font.metrics.unitsPerEm).toBe(1000);
  });
});
