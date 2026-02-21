import { describe, it, expect, vi } from "vitest";
import type { Font } from "@/lib/editor/Font";
import type { Bounds } from "@shift/geo";
import { computeTextLayout, hitTestTextSlot, hitTestTextCaret, type GlyphRef } from "./layout";
import { expectAt } from "@/testing";

function createMockFont(
  advances: Record<number, number> = {},
  svgPaths: Record<number, string> = {},
  bboxes: Record<number, Bounds> = {},
): Font {
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
    getAdvance: (unicode: number) => advances[unicode] ?? null,
    getSvgPath: (unicode: number) => svgPaths[unicode] ?? null,
    getBbox: (unicode: number) => bboxes[unicode] ?? null,
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

  it("should include svgPath in slots", () => {
    const font = createMockFont({ 65: 500 }, { 65: "M0 0L100 100" });
    const layout = computeTextLayout(toGlyphs([65]), { x: 0, y: 0 }, font);

    expect(expectAt(layout.slots, 0).svgPath).toBe("M0 0L100 100");
  });
});

describe("hitTestTextSlot", () => {
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
    expect(hitTestTextSlot(layout, { x: 50, y: 400 }, metrics)).toBeNull();
  });

  it("should return null when y is above ascender", () => {
    const font = createMockFont({ 65: 500 });
    const layout = computeTextLayout(toGlyphs([65]), { x: 0, y: 0 }, font);
    expect(hitTestTextSlot(layout, { x: 250, y: 900 }, metrics)).toBeNull();
  });

  it("should return null when y is below descender", () => {
    const font = createMockFont({ 65: 500 });
    const layout = computeTextLayout(toGlyphs([65]), { x: 0, y: 0 }, font);
    expect(hitTestTextSlot(layout, { x: 250, y: -300 }, metrics)).toBeNull();
  });

  it("should return slot index only when point is inside slot bounds", () => {
    const font = createMockFont({
      72: 600, // H: 0-600
      101: 500, // e: 600-1100
      108: 250, // l: 1100-1350
    });
    const layout = computeTextLayout(toGlyphs([72, 101, 108]), { x: 0, y: 0 }, font);

    expect(hitTestTextSlot(layout, { x: 100, y: 400 }, metrics)).toBe(0);
    expect(hitTestTextSlot(layout, { x: 400, y: 400 }, metrics)).toBe(0);
    expect(hitTestTextSlot(layout, { x: 700, y: 400 }, metrics)).toBe(1);
    expect(hitTestTextSlot(layout, { x: 1400, y: 400 }, metrics)).toBeNull();
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

    const result = hitTestTextSlot(layout, { x: 5, y: 50 }, metrics, {
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
      hitTestTextSlot(layout, { x: 80, y: 50 }, metrics, {
        outlineRadius: 2,
        includeFill: true,
        requireShape: true,
        pathHitTester,
      }),
    ).toBe(0);

    expect(pathHitTester.hitPath).toHaveBeenCalled();
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
      hitTestTextSlot(layout, { x: 15, y: 50 }, metrics, {
        outlineRadius: 2,
        includeFill: true,
        requireShape: true,
        pathHitTester,
      }),
    ).toBeNull();

    expect(
      hitTestTextSlot(layout, { x: 50, y: 50 }, metrics, {
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
});
