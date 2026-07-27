import { describe, expect, it } from "vitest";
import type { GlyphId, GlyphName } from "@shift/types";
import type { GlyphCatalogItem } from "@/types/glyphCatalog";
import {
  deriveGlyphCatalogLayout,
  deriveVisibleGlyphCatalogCells,
  hitGlyphCatalogCell,
} from "./glyphCatalogLayout";

function catalog(count: number): GlyphCatalogItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `glyph-${index}` as GlyphId,
    name: `name-${index}` as GlyphName,
    unicode: index,
  }));
}

describe("canvas-owned Glyph catalog layout", () => {
  it("distributes nominal cells into columns and derives the complete scroll height", () => {
    const layout = deriveGlyphCatalogLayout(500, 240, 9);

    expect(layout.columns).toBe(4);
    expect(layout.cellWidth).toBe(101);
    expect(layout.rowCount).toBe(3);
    expect(layout.totalHeight).toBe(409);
  });

  it("changes columns, cell width, and total height when the viewport resizes", () => {
    const layout = deriveGlyphCatalogLayout(350, 240, 9);

    expect(layout.columns).toBe(2);
    expect(layout.cellWidth).toBe(135);
    expect(layout.rowCount).toBe(5);
    expect(layout.totalHeight).toBe(655);
  });

  it("derives top, middle, and end cells from catalog order and scrollTop", () => {
    const glyphs = catalog(20);
    const layout = deriveGlyphCatalogLayout(500, 200, glyphs.length);

    expect(
      deriveVisibleGlyphCatalogCells(layout, glyphs, 0).cells.map((cell) => cell.catalogIndex),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(
      deriveVisibleGlyphCatalogCells(layout, glyphs, 143).cells.map((cell) => cell.catalogIndex),
    ).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(
      deriveVisibleGlyphCatalogCells(layout, glyphs, 999).cells.map((cell) => cell.catalogIndex),
    ).toEqual([12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it("keeps filtered IDs and their rectangles aligned after resizing", () => {
    const allGlyphs = catalog(8);
    const filtered = [allGlyphs[2]!, allGlyphs[5]!, allGlyphs[7]!];
    const narrow = deriveVisibleGlyphCatalogCells(
      deriveGlyphCatalogLayout(280, 180, filtered.length),
      filtered,
      0,
    );
    const wide = deriveVisibleGlyphCatalogCells(
      deriveGlyphCatalogLayout(500, 180, filtered.length),
      filtered,
      0,
    );

    expect(narrow.cells.map((cell) => cell.glyph.id)).toEqual(["glyph-2", "glyph-5", "glyph-7"]);
    expect(narrow.cells[2]?.previewRect).toMatchObject({ x: 36, y: 143, width: 100, height: 75 });
    expect(wide.cells[2]?.previewRect).toMatchObject({ x: 254, y: 20, width: 101, height: 75 });
  });

  it("hits preview tiles but excludes labels, gaps, and viewport padding", () => {
    const glyphs = catalog(3);
    const frame = deriveVisibleGlyphCatalogCells(
      deriveGlyphCatalogLayout(280, 200, glyphs.length),
      glyphs,
      0,
    );

    expect(hitGlyphCatalogCell(frame, { x: 37, y: 21 })?.catalogIndex).toBe(0);
    expect(hitGlyphCatalogCell(frame, { x: 37, y: 104 })).toBeNull();
    expect(hitGlyphCatalogCell(frame, { x: 37, y: 104 }, "name")?.catalogIndex).toBe(0);
    expect(hitGlyphCatalogCell(frame, { x: 37, y: 99 })).toBeNull();
    expect(hitGlyphCatalogCell(frame, { x: 140, y: 21 })).toBeNull();
    expect(hitGlyphCatalogCell(frame, { x: 5, y: 5 })).toBeNull();
  });

  it("never loses all cells while a non-empty catalog viewport scrolls through content", () => {
    const glyphs = catalog(17);
    const layout = deriveGlyphCatalogLayout(280, 60, glyphs.length);
    const maximumScrollTop = layout.totalHeight - layout.viewportHeight;

    for (let scrollTop = 0; scrollTop <= maximumScrollTop; scrollTop += 1) {
      expect(
        deriveVisibleGlyphCatalogCells(layout, glyphs, scrollTop).cells.length,
      ).toBeGreaterThan(0);
    }
  });
});
