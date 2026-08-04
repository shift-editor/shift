import { describe, expect, it } from "vitest";
import type { DisplayGlyph } from "@shift/types";
import { DisplayGlyphRenderModel } from "./DisplayGlyphRenderModel";

const DISPLAY_GLYPH: DisplayGlyph = {
  glyphIndex: 1,
  location: new Float64Array(),
  rootGeometry: 0,
  geometries: [
    {
      glyphIndex: 1,
      contours: { start: 0, count: 1 },
      components: { start: 0, count: 1 },
      anchors: { start: 0, count: 1 },
      guides: { start: 0, count: 0 },
    },
    {
      glyphIndex: 2,
      contours: { start: 1, count: 1 },
      components: { start: 1, count: 0 },
      anchors: { start: 1, count: 0 },
      guides: { start: 0, count: 0 },
    },
  ],
  contours: [
    { points: { start: 0, count: 2 }, closed: false },
    { points: { start: 2, count: 2 }, closed: false },
  ],
  components: [{ geometryIndex: 1, transform: new Float64Array([1, 0, 0, 1, 100, 20]) }],
  pointCoordinates: new Float64Array([0, 0, 10, 0, 0, 0, 5, 0]),
  pointKinds: ["onCurve", "onCurve", "onCurve", "onCurve"],
  pointSmooth: [true, false, false, false],
  pointProvenance: ["native", "native", "native", "native"],
  pointTrueTypeIndices: [0, 1, 0, 1],
  anchors: [{ name: "top", x: 5, y: 10 }],
  guides: [],
  xAdvance: 500,
  bounds: [0, 0, 105, 20],
};

describe("retained glyph rendering geometry", () => {
  it("keeps root handles separate while transforming component outlines", () => {
    const glyph = new DisplayGlyphRenderModel(DISPLAY_GLYPH);

    expect(glyph.contours.map((contour) => contour.root)).toEqual([true, false]);
    expect(glyph.contours[0]?.contour.points[0]).toMatchObject({ smooth: true });
    expect(glyph.contours[0]?.contour.points[1]).toMatchObject({ x: 10, y: 0 });
    expect(glyph.contours[1]?.contour.points[0]).toMatchObject({ x: 100, y: 20 });
    expect(glyph.contours.map((contour) => contour.svgPath)).toEqual([
      "M 0 0 L 10 0",
      "M 100 20 L 105 20",
    ]);
    expect(glyph.anchors).toEqual([{ name: "top", x: 5, y: 10 }]);
    expect(glyph.xAdvance).toBe(500);
  });

  it("does not expose root contours for a component-only glyph", () => {
    const root = DISPLAY_GLYPH.geometries[0];
    if (!root) throw new Error("fixture root geometry is missing");

    const glyph = new DisplayGlyphRenderModel({
      ...DISPLAY_GLYPH,
      geometries: [
        { ...root, contours: { start: 0, count: 0 } },
        ...DISPLAY_GLYPH.geometries.slice(1),
      ],
    });

    expect(glyph.contours.map((contour) => contour.root)).toEqual([false]);
  });
});
