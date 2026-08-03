import { describe, expect, it } from "vitest";
import { defaultResources, GlyphInfo } from "@shift/glyph-info";
import type { CatalogDirectory } from "@shift/types";
import { FontSessionClient } from "@/lib/workspace/FontSessionClient";
import { PreviewGlyphCatalogSource } from "./PreviewGlyphCatalogSource";

const DIRECTORY: CatalogDirectory = {
  format: "TrueType",
  familyName: "Preview Family",
  styleName: "Regular",
  glyphs: [{ index: 0, name: ".notdef", unicodes: [] }],
  axes: [
    {
      index: 0,
      tag: "wght",
      name: "Weight",
      hidden: false,
      kind: "continuous",
      minimum: 100,
      defaultValue: 400,
      maximum: 900,
      values: [],
    },
  ],
  defaultLocation: [400],
  metrics: {
    unitsPerEm: 1_000,
    ascender: 800,
    descender: -200,
    lineGap: 0,
  },
};

function source(): PreviewGlyphCatalogSource {
  return new PreviewGlyphCatalogSource(
    DIRECTORY,
    new FontSessionClient(null, { mode: "preview" }),
    new GlyphInfo(defaultResources),
  );
}

describe("retained preview catalog state", () => {
  it("preserves source-local indexes and the default location", () => {
    const catalog = source();

    expect(catalog.glyphsCell.peek().map((glyph) => glyph.id)).toEqual([0]);
    expect(catalog.locationCell.peek()).toEqual([400]);
    expect(catalog.familyNameCell.peek()).toBe("Preview Family");
  });

  it("accepts valid source coordinates without changing directory state", async () => {
    const catalog = source();

    await catalog.setLocation([700]);

    expect(catalog.locationCell.peek()).toEqual([700]);
    expect(catalog.axesCell.peek()).toEqual(DIRECTORY.axes);
  });

  it("rejects out-of-range coordinates instead of clamping", async () => {
    const catalog = source();

    await expect(catalog.setLocation([1_000])).rejects.toThrow("outside its bounds");
    expect(catalog.locationCell.peek()).toEqual([400]);
  });
});
