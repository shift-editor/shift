import { describe, it, expect, vi } from "vitest";
import type { Font } from "@/lib/model/Font";
import type { Bounds } from "@shift/geo";
import { computeTextLayout, hitTestTextSlot, hitTestTextCaret, type GlyphRef } from "./layout";
import { expectAt } from "@/testing";

function createMockFont(
  advances: Record<number, number> = {},
  svgPaths: Record<number, string> = {},
  bboxes: Record<number, Bounds> = {},
): Font {
  const glyphNameMap: Record<number, string> = {};
  for (const unicode of [
    ...Object.keys(advances),
    ...Object.keys(svgPaths),
    ...Object.keys(bboxes),
  ]) {
    const u = Number(unicode);
    glyphNameMap[u] = `uni${u.toString(16).toUpperCase()}`;
  }

  return {
    getMetrics: () => ({
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      capHeight: 700,
      xHeight: 500,
      lineGap: 0,
      italicAngle: null,
      underlinePosition: null,
      underlineThickness: null,
    }),
    getMetadata: () => ({
      familyName: "Test",
      styleName: null,
      versionMajor: null,
      versionMinor: null,
      copyright: null,
      trademark: null,
      designer: null,
      designerUrl: null,
      manufacturer: null,
      manufacturerUrl: null,
      license: null,
      licenseUrl: null,
      description: null,
      note: null,
    }),
    nameForUnicode: (unicode: number) => glyphNameMap[unicode] ?? null,
    getPath: (name: string) => {
      const unicode = Object.entries(glyphNameMap).find(([, n]) => n === name)?.[0];
      if (!unicode) return null;
      const svgPath = svgPaths[Number(unicode)] ?? null;
      return svgPath ? new Path2D(svgPath) : null;
    },
    getAdvance: (name: string) => {
      const unicode = Object.entries(glyphNameMap).find(([, n]) => n === name)?.[0];
      if (!unicode) return null;
      return advances[Number(unicode)] ?? null;
    },
    getBbox: (name: string) => {
      const unicode = Object.entries(glyphNameMap).find(([, n]) => n === name)?.[0];
      if (!unicode) return null;
      return bboxes[Number(unicode)] ?? null;
    },
    getSvgPath: (name: string) => {
      const unicode = Object.entries(glyphNameMap).find(([, n]) => n === name)?.[0];
      if (!unicode) return null;
      return svgPaths[Number(unicode)] ?? null;
    },
  };
}

function toGlyphs(unicodes: number[]): GlyphRef[] {
  return unicodes.map((unicode) => ({
    glyphName: `uni${unicode.toString(16).toUpperCase()}`,
    unicode,
  }));
}

describe("computeTextLayout", () => {
  it("should return empty layout for empty codepoints", () => {
    const font = createMockFont();
    const layout = computeTextLayout([], { x: 0, y: 0 }, font);
    expect(layout.slots).toEqual([]);
    expect(layout.totalAdvance).toBe(0);
  });

  it("should compute positioned slots with accumulated advances", () => {
    const font = createMockFont({
      72: 600, // H
      101: 500, // e
      108: 250, // l
    });

    const layout = computeTextLayout(toGlyphs([72, 101, 108]), { x: 100, y: 0 }, font);

    expect(layout.slots).toHaveLength(3);
    expect(expectAt(layout.slots, 0).x).toBe(100);
    expect(expectAt(layout.slots, 0).advance).toBe(600);
    expect(expectAt(layout.slots, 1).x).toBe(700);
    expect(expectAt(layout.slots, 1).advance).toBe(500);
    expect(expectAt(layout.slots, 2).x).toBe(1200);
    expect(expectAt(layout.slots, 2).advance).toBe(250);
    expect(layout.totalAdvance).toBe(1350);
  });

  it("should use 0 advance for missing glyphs", () => {
    const font = createMockFont();
    const layout = computeTextLayout(toGlyphs([65]), { x: 0, y: 0 }, font);

    expect(expectAt(layout.slots, 0).advance).toBe(0);
    expect(layout.totalAdvance).toBe(0);
  });
});

describe("computeTextLayout (multi-line)", () => {
  it("should place slots on the next line after a newline", () => {
    const font = createMockFont({ 72: 600, 101: 500 });
    // H, newline, e
    const glyphs: GlyphRef[] = [
      ...toGlyphs([72]),
      { glyphName: ".newline", unicode: 10 },
      ...toGlyphs([101]),
    ];
    const layout = computeTextLayout(glyphs, { x: 0, y: 0 }, font);

    expect(layout.slots).toHaveLength(3);
    // Line 1: H at y=0
    expect(expectAt(layout.slots, 0).y).toBe(0);
    // Newline slot at y=0
    expect(expectAt(layout.slots, 1).y).toBe(0);
    // Line 2: e at y=-1000 (lineHeight = 800 - (-200) + 0 = 1000)
    expect(expectAt(layout.slots, 2).y).toBe(-1000);
    expect(expectAt(layout.slots, 2).x).toBe(0);
  });
});

describe("hitTestTextSlot", () => {
  const font = createMockFont();
  const metrics = {
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    capHeight: 700,
    xHeight: 500,
    lineGap: 0,
    italicAngle: null,
    underlinePosition: null,
    underlineThickness: null,
  };

  it("should return null for empty layout", () => {
    const layout = { slots: [], totalAdvance: 0 };
    expect(hitTestTextSlot(layout, { x: 50, y: 400 }, metrics, font)).toBeNull();
  });

  it("should return null when y is above ascender", () => {
    const font = createMockFont({ 65: 500 });
    const layout = computeTextLayout(toGlyphs([65]), { x: 0, y: 0 }, font);
    expect(hitTestTextSlot(layout, { x: 250, y: 900 }, metrics, font)).toBeNull();
  });

  it("should return null when y is below descender", () => {
    const font = createMockFont({ 65: 500 });
    const layout = computeTextLayout(toGlyphs([65]), { x: 0, y: 0 }, font);
    expect(hitTestTextSlot(layout, { x: 250, y: -300 }, metrics, font)).toBeNull();
  });

  it("should return slot index only when point is inside slot bounds", () => {
    const font = createMockFont({
      72: 600, // H: 0-600
      101: 500, // e: 600-1100
      108: 250, // l: 1100-1350
    });
    const layout = computeTextLayout(toGlyphs([72, 101, 108]), { x: 0, y: 0 }, font);

    expect(hitTestTextSlot(layout, { x: 100, y: 400 }, metrics, font)).toBe(0);
    expect(hitTestTextSlot(layout, { x: 400, y: 400 }, metrics, font)).toBe(0);
    expect(hitTestTextSlot(layout, { x: 700, y: 400 }, metrics, font)).toBe(1);
    expect(hitTestTextSlot(layout, { x: 1400, y: 400 }, metrics, font)).toBeNull();
  });

  it("shape hit test should reject points outside glyph bbox before path hit", () => {
    const pathHitTester = {
      hitPath: vi.fn(() => true),
    };

    const font = createMockFont(
      { 65: 500 },
      { 65: "M0 0L100 100" },
      {
        65: {
          min: { x: 10, y: 0 },
          max: { x: 100, y: 100 },
        },
      },
    );
    const layout = computeTextLayout(toGlyphs([65]), { x: 0, y: 0 }, font);

    const result = hitTestTextSlot(layout, { x: 5, y: 50 }, metrics, font, {
      outlineRadius: 0,
      includeFill: true,
      requireShape: true,
      pathHitTester,
    });

    expect(result).toBeNull();
    expect(pathHitTester.hitPath).not.toHaveBeenCalled();
  });

  it("shape hit test should allow zero-advance combining marks by glyph bounds", () => {
    const combiningAcute = 0x0301;
    const letterA = 0x0061;
    const spacingAcute = 0x00b4;

    const pathHitTester = {
      hitPath: vi.fn(
        (_path: Path2D, x: number, y: number, _strokeWidth: number, _fill: boolean) =>
          x >= 40 && x <= 120 && y >= 0 && y <= 100,
      ),
    };

    const font = createMockFont(
      {
        [combiningAcute]: 0,
        [letterA]: 500,
        [spacingAcute]: 300,
      },
      {
        [combiningAcute]: "M40 0L120 0L120 100L40 100Z",
      },
      {
        [combiningAcute]: {
          min: { x: 40, y: 0 },
          max: { x: 120, y: 100 },
        },
      },
    );
    const layout = computeTextLayout(
      toGlyphs([combiningAcute, letterA, spacingAcute]),
      { x: 0, y: 0 },
      font,
    );

    expect(
      hitTestTextSlot(layout, { x: 80, y: 50 }, metrics, font, {
        outlineRadius: 2,
        includeFill: true,
        requireShape: true,
        pathHitTester,
      }),
    ).toBe(0);

    expect(pathHitTester.hitPath).toHaveBeenCalled();
  });

  it("should hit slots on the second line", () => {
    const font = createMockFont({ 72: 600, 101: 500 });
    // H, newline, e — "e" is on line 2 at y=-1000
    const glyphs: GlyphRef[] = [
      ...toGlyphs([72]),
      { glyphName: ".newline", unicode: 10 },
      ...toGlyphs([101]),
    ];
    const layout = computeTextLayout(glyphs, { x: 0, y: 0 }, font);

    // Click on line 2 (y=-500 is between descender -1200 and ascender -200)
    expect(hitTestTextSlot(layout, { x: 250, y: -500 }, metrics, font)).toBe(2);

    // Click on line 1 still works
    expect(hitTestTextSlot(layout, { x: 100, y: 400 }, metrics, font)).toBe(0);
  });

  it("should not match line 1 slot when clicking on line 2 Y", () => {
    const font = createMockFont({ 72: 600, 101: 500 });
    const glyphs: GlyphRef[] = [
      ...toGlyphs([72]),
      { glyphName: ".newline", unicode: 10 },
      ...toGlyphs([101]),
    ];
    const layout = computeTextLayout(glyphs, { x: 0, y: 0 }, font);

    // x=100 is within H's advance, but y=-500 is on line 2 — should not hit H
    expect(hitTestTextSlot(layout, { x: 100, y: -500 }, metrics, font)).not.toBe(0);
  });

  it("shape hit test should return slot only when path hit succeeds", () => {
    const pathHitTester = {
      hitPath: vi.fn(
        (_path: Path2D, x: number, y: number, _strokeWidth: number, _fill: boolean) => {
          return x >= 20 && x <= 80 && y >= 10 && y <= 90;
        },
      ),
    };

    const font = createMockFont(
      { 65: 500 },
      { 65: "M0 0L100 100" },
      {
        65: {
          min: { x: 0, y: 0 },
          max: { x: 100, y: 100 },
        },
      },
    );
    const layout = computeTextLayout(toGlyphs([65]), { x: 0, y: 0 }, font);

    expect(
      hitTestTextSlot(layout, { x: 15, y: 50 }, metrics, font, {
        outlineRadius: 2,
        includeFill: true,
        requireShape: true,
        pathHitTester,
      }),
    ).toBeNull();

    expect(
      hitTestTextSlot(layout, { x: 50, y: 50 }, metrics, font, {
        outlineRadius: 2,
        includeFill: true,
        requireShape: true,
        pathHitTester,
      }),
    ).toBe(0);

    expect(pathHitTester.hitPath).toHaveBeenCalled();
  });
});

describe("hitTestTextCaret", () => {
  const metrics = {
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    capHeight: 700,
    xHeight: 500,
    lineGap: 0,
    italicAngle: null,
    underlinePosition: null,
    underlineThickness: null,
  };

  it("should return caret insertion index using slot midpoints", () => {
    const font = createMockFont({
      72: 600, // H: 0-600
      101: 500, // e: 600-1100
      108: 250, // l: 1100-1350
    });
    const layout = computeTextLayout(toGlyphs([72, 101, 108]), { x: 0, y: 0 }, font);

    expect(hitTestTextCaret(layout, { x: 100, y: 400 }, metrics)).toBe(0);
    expect(hitTestTextCaret(layout, { x: 400, y: 400 }, metrics)).toBe(1);
    expect(hitTestTextCaret(layout, { x: 700, y: 400 }, metrics)).toBe(1);
    expect(hitTestTextCaret(layout, { x: 1400, y: 400 }, metrics)).toBe(3);
  });

  it("should place caret on the correct line in multi-line layout", () => {
    const font = createMockFont({ 72: 600, 101: 500 });
    // H, newline, e — slots: [H@0, \n@0, e@-1000]
    const glyphs: GlyphRef[] = [
      ...toGlyphs([72]),
      { glyphName: ".newline", unicode: 10 },
      ...toGlyphs([101]),
    ];
    const layout = computeTextLayout(glyphs, { x: 0, y: 0 }, font);

    // Click on line 2 before "e" midpoint (midX = 250) — caret before "e" (index 2)
    expect(hitTestTextCaret(layout, { x: 100, y: -500 }, metrics)).toBe(2);

    // Click on line 2 after "e" midpoint — caret after "e" (index 3)
    expect(hitTestTextCaret(layout, { x: 400, y: -500 }, metrics)).toBe(3);

    // Click on line 1 before "H" midpoint — caret before "H" (index 0)
    expect(hitTestTextCaret(layout, { x: 100, y: 400 }, metrics)).toBe(0);
  });

  it("should return null for clicks far below all lines", () => {
    const font = createMockFont({ 72: 600 });
    const layout = computeTextLayout(toGlyphs([72]), { x: 0, y: 0 }, font);

    expect(hitTestTextCaret(layout, { x: 100, y: -2000 }, metrics)).toBeNull();
  });
});
