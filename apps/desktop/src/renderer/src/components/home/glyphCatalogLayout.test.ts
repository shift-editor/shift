import { describe, expect, it } from "vitest";
import type { GlyphId, GlyphName, SlugPreviewExtents, SourceMetrics } from "@shift/types";
import type { GlyphCatalogItem } from "@/types/glyphCatalog";
import { GlyphCatalogLayout } from "./glyphCatalogLayout";

const METRICS: SourceMetrics = {
  unitsPerEm: 1000,
  metricValues: [],
  ascender: 800,
  descender: -200,
  xHeight: 500,
  capHeight: 700,
  baseline: 0,
  italicAngle: 0,
  lineGap: 0,
  underlinePosition: -100,
  underlineThickness: 50,
};
const NO_OVERFLOW: SlugPreviewExtents = { horizontal: 0, minimumY: 0, maximumY: 0 };

function catalog(count: number): GlyphCatalogItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `glyph-${index}` as GlyphId,
    name: `name-${index}` as GlyphName,
    displayName: `name-${index}`,
    unicode: index,
  }));
}

function layout(
  width: number,
  height: number,
  glyphCount: number,
  previewExtents = NO_OVERFLOW,
): GlyphCatalogLayout {
  return new GlyphCatalogLayout(width, height, glyphCount, METRICS, previewExtents);
}

describe("canvas-owned Glyph catalog layout", () => {
  it("distributes nominal cells into columns and derives the complete scroll height", () => {
    const result = layout(500, 240, 9);

    expect(result.columns).toBe(4);
    expect(result.cellWidth).toBe(101);
    expect(result.rowCount).toBe(3);
    expect(result.totalHeight).toBe(409);
  });

  it("changes columns, cell width, and total height when the viewport resizes", () => {
    const result = layout(350, 240, 9);

    expect(result.columns).toBe(2);
    expect(result.cellWidth).toBe(135);
    expect(result.rowCount).toBe(5);
    expect(result.totalHeight).toBe(655);
  });

  it("derives top, middle, and end cells from catalog order and scrollTop", () => {
    const glyphs = catalog(20);
    const result = layout(500, 200, glyphs.length);

    expect(result.frame(glyphs, 0).cells.map((cell) => cell.catalogIndex)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(result.frame(glyphs, 143).cells.map((cell) => cell.catalogIndex)).toEqual([
      4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(result.frame(glyphs, 999).cells.map((cell) => cell.catalogIndex)).toEqual([
      12, 13, 14, 15, 16, 17, 18, 19,
    ]);
  });

  it("keeps filtered IDs and their rectangles aligned after resizing", () => {
    const allGlyphs = catalog(8);
    const filtered = [allGlyphs[2]!, allGlyphs[5]!, allGlyphs[7]!];
    const narrow = layout(280, 180, filtered.length).frame(filtered, 0);
    const wide = layout(500, 180, filtered.length).frame(filtered, 0);

    expect(narrow.cells.map((cell) => cell.glyph.id)).toEqual(["glyph-2", "glyph-5", "glyph-7"]);
    expect(narrow.cells[2]?.previewRect).toMatchObject({ x: 36, y: 143, width: 100, height: 75 });
    expect(wide.cells[2]?.previewRect).toMatchObject({ x: 254, y: 20, width: 101, height: 75 });
  });

  it("hits preview tiles but excludes labels, gaps, and viewport padding", () => {
    const glyphs = catalog(3);
    const result = layout(280, 200, glyphs.length);
    const frame = result.frame(glyphs, 0);

    expect(result.hit(frame, { x: 37, y: 21 })?.catalogIndex).toBe(0);
    expect(result.hit(frame, { x: 37, y: 104 })).toBeNull();
    expect(result.hit(frame, { x: 37, y: 104 }, "name")?.catalogIndex).toBe(0);
    expect(result.hit(frame, { x: 37, y: 99 })).toBeNull();
    expect(result.hit(frame, { x: 140, y: 21 })).toBeNull();
    expect(result.hit(frame, { x: 5, y: 5 })).toBeNull();
  });

  it("never loses all cells while a non-empty catalog viewport scrolls through content", () => {
    const glyphs = catalog(17);
    const result = layout(280, 60, glyphs.length);
    const maximumScrollTop = result.totalHeight - result.viewportHeight;

    for (let scrollTop = 0; scrollTop <= maximumScrollTop; scrollTop += 1) {
      expect(result.frame(glyphs, scrollTop).cells.length).toBeGreaterThan(0);
    }
  });

  it("expands every cell for font-wide bounds without changing pixels per em", () => {
    const result = layout(500, 240, 9, {
      horizontal: 200,
      minimumY: -500,
      maximumY: 1500,
    });

    expect(result.previewHeight).toBe(120);
    expect(result.columns).toBe(3);
    expect(result.rowPitch).toBe(168);
    expect(result.totalHeight).toBe(544);
  });
});
