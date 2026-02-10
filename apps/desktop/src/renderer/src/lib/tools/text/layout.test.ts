import { describe, it, expect } from "vitest";
import type { Font } from "@/lib/editor/Font";
import { computeTextLayout, hitTestLayout } from "./layout";

function createMockFont(
  advances: Record<number, number> = {},
  svgPaths: Record<number, string> = {},
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
    getBbox: () => null,
  };
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

    const layout = computeTextLayout([72, 101, 108], { x: 100, y: 0 }, font);

    expect(layout.slots).toHaveLength(3);
    expect(layout.slots[0].x).toBe(100);
    expect(layout.slots[0].advance).toBe(600);
    expect(layout.slots[1].x).toBe(700);
    expect(layout.slots[1].advance).toBe(500);
    expect(layout.slots[2].x).toBe(1200);
    expect(layout.slots[2].advance).toBe(250);
    expect(layout.totalAdvance).toBe(1350);
  });

  it("should use 0 advance for missing glyphs", () => {
    const font = createMockFont();
    const layout = computeTextLayout([65], { x: 0, y: 0 }, font);

    expect(layout.slots[0].advance).toBe(0);
    expect(layout.totalAdvance).toBe(0);
  });

  it("should include svgPath in slots", () => {
    const font = createMockFont({ 65: 500 }, { 65: "M0 0L100 100" });
    const layout = computeTextLayout([65], { x: 0, y: 0 }, font);

    expect(layout.slots[0].svgPath).toBe("M0 0L100 100");
  });
});

describe("hitTestLayout", () => {
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
    expect(hitTestLayout(layout, { x: 50, y: 400 }, metrics)).toBeNull();
  });

  it("should return null when y is above ascender", () => {
    const font = createMockFont({ 65: 500 });
    const layout = computeTextLayout([65], { x: 0, y: 0 }, font);
    expect(hitTestLayout(layout, { x: 250, y: 900 }, metrics)).toBeNull();
  });

  it("should return null when y is below descender", () => {
    const font = createMockFont({ 65: 500 });
    const layout = computeTextLayout([65], { x: 0, y: 0 }, font);
    expect(hitTestLayout(layout, { x: 250, y: -300 }, metrics)).toBeNull();
  });

  it("should return index of glyph at position", () => {
    const font = createMockFont({
      72: 600, // H: 0-600
      101: 500, // e: 600-1100
      108: 250, // l: 1100-1350
    });
    const layout = computeTextLayout([72, 101, 108], { x: 0, y: 0 }, font);

    // Click in first half of H → index 0
    expect(hitTestLayout(layout, { x: 100, y: 400 }, metrics)).toBe(0);
    // Click in second half of H → index 1
    expect(hitTestLayout(layout, { x: 400, y: 400 }, metrics)).toBe(1);
    // Click in first half of e → index 1
    expect(hitTestLayout(layout, { x: 700, y: 400 }, metrics)).toBe(1);
    // Click past all glyphs → length
    expect(hitTestLayout(layout, { x: 1400, y: 400 }, metrics)).toBe(3);
  });
});
