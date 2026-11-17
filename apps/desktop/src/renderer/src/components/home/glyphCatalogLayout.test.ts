import { describe, expect, it } from "vitest";
import type { GlyphId, GlyphName } from "@shift/types";
import type { GlyphCatalogItem } from "@/types/glyphCatalog";
import { Rect } from "@shift/geo";
import { GlyphCatalogLayout } from "./glyphCatalogLayout";

function catalog(count: number): GlyphCatalogItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `glyph-${index}` as GlyphId,
    name: `name-${index}` as GlyphName,
    displayName: `name-${index}`,
    unicode: index,
    markColor: null,
  }));
}

function layout(width: number, height: number, glyphCount: number): GlyphCatalogLayout {
  return new GlyphCatalogLayout(width, height, glyphCount);
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

  it("keeps sparse rows at their nominal cell width as the viewport resizes", () => {
    const glyphs = catalog(2);
    const narrow = layout(500, 240, glyphs.length).frame(glyphs, 0);
    const wide = layout(720, 240, glyphs.length).frame(glyphs, 0);

    expect(narrow.layout.cellWidth).toBe(100);
    expect(wide.layout.cellWidth).toBe(100);
    expect(narrow.cells.map((cell) => cell.cellRect)).toEqual(
      wide.cells.map((cell) => cell.cellRect),
    );
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
    expect(wide.cells[2]?.previewRect).toMatchObject({ x: 252, y: 20, width: 100, height: 75 });
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
});

describe("revealing a glyph", () => {
  // 1000 glyphs in a viewport a few rows tall.
  const layout = new GlyphCatalogLayout(800, 400, 1000);
  const rowOf = (index: number) => Math.floor(index / layout.columns);

  it("leaves a fully visible cell where it is", () => {
    expect(layout.scrollTopToReveal(0, 0)).toBeNull();
  });

  it("scrolls down just far enough to show a cell below the viewport", () => {
    const index = layout.columns * 10;
    const scrollTop = layout.scrollTopToReveal(index, 0)!;
    const cellTop = layout.viewportPadding + rowOf(index) * layout.rowPitch;

    expect(scrollTop).toBeGreaterThan(0);
    expect(scrollTop).toBeLessThanOrEqual(cellTop);
    expect(scrollTop + layout.viewportHeight).toBeGreaterThan(cellTop + layout.previewHeight);
  });

  it("scrolls up to a cell above the viewport", () => {
    expect(layout.scrollTopToReveal(0, 5000)).toBe(0);
  });
});

describe("sizing the catalog's tiles", () => {
  it("fits more, shorter tiles at a smaller size and fewer, taller ones at a larger", () => {
    const small = new GlyphCatalogLayout(500, 240, 40, 56);
    const normal = new GlyphCatalogLayout(500, 240, 40);
    const large = new GlyphCatalogLayout(500, 240, 40, 200);

    expect([small.columns, normal.columns, large.columns]).toEqual([6, 4, 2]);
    expect([small.previewHeight, normal.previewHeight, large.previewHeight]).toEqual([42, 75, 150]);
    expect([small.rowPitch, normal.rowPitch, large.rowPitch]).toEqual([90, 123, 198]);
    expect(large.frame(catalog(40), 0).cells[0]!.cellRect.height).toBe(186);
  });

  it("keeps a size outside its limits at the nearest one", () => {
    expect(new GlyphCatalogLayout(500, 240, 40, 5).previewHeight).toBe(42);
    expect(new GlyphCatalogLayout(500, 240, 40, 5000).previewHeight).toBe(165);
  });
});

describe("fitting the catalog into a sidebar", () => {
  it("drops the name and most of the margins at the compact density", () => {
    const compact = new GlyphCatalogLayout(240, 300, 12, 56, "compact");

    expect(compact.columns).toBe(3);
    expect(compact.gridLeft).toBe(8);
    expect(compact.cellHeight).toBe(compact.previewHeight);
    expect(compact.rowPitch).toBe(50);
    expect(compact.frame(catalog(12), 0).cells[0]).toMatchObject({
      cellRect: { x: 8, y: 8, height: 42 },
      nameRect: { height: 0 },
    });
  });
});

describe("hit-testing the catalog's scrolled content", () => {
  it("finds the glyph whose preview or name holds a point in the scrolled content", () => {
    // Four columns of 101 with an 8 gap from x 36; rows of 123 from y 20.
    const result = new GlyphCatalogLayout(500, 240, 9);

    expect(result.indexAt({ x: 40, y: 30 })).toBe(0);
    expect(result.indexAt({ x: 36 + 109 + 5, y: 20 + 123 + 5 })).toBe(5);
    expect(result.indexAt({ x: 40, y: 20 + 75 + 8 + 5 })).toBeNull();
    expect(result.indexAt({ x: 40, y: 20 + 75 + 8 + 5 }, "name")).toBe(0);
    expect(result.indexAt({ x: 36 + 103, y: 30 })).toBeNull();
    expect(result.indexAt({ x: 10, y: 30 })).toBeNull();
    // The last row holds one glyph; the rest of it is empty.
    expect(result.indexAt({ x: 36 + 109 + 5, y: 20 + 2 * 123 + 5 })).toBeNull();
  });

  it("lists the glyphs a box touches in grid order, past the viewport too", () => {
    const result = new GlyphCatalogLayout(500, 240, 9);
    const box = (x: number, y: number, width: number, height: number) =>
      result.indicesIn(Rect.fromXYWH(x, y, width, height));

    expect(box(0, 0, 30, 400)).toEqual([]);
    expect(box(40, 30, 1, 1)).toEqual([0]);
    expect(box(100, 60, 60, 100)).toEqual([0, 1, 4, 5]);
    expect(box(0, 0, 500, 400)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // Starting in the gap between two columns touches neither until it reaches one.
    expect(box(36 + 103, 30, 4, 4)).toEqual([]);
  });
});
