import { describe, expect, it } from "vitest";
import type { Glyph, Point, RenderContour } from "@shift/types";
import { deriveGlyphSidebearings, deriveGlyphXBounds } from "./sidebearings";

function makePoint(
  id: string,
  x: number,
  y: number,
  pointType: Point["pointType"] = "onCurve",
): Point {
  return {
    id: id as Point["id"],
    x,
    y,
    pointType,
    smooth: false,
  };
}

function makeGlyph(input: {
  xAdvance: number;
  contours?: Glyph["contours"];
  compositeContours?: readonly RenderContour[];
}): Glyph {
  return {
    unicode: 65,
    name: "A",
    xAdvance: input.xAdvance,
    contours: input.contours ?? [],
    anchors: [],
    compositeContours: input.compositeContours ?? [],
    activeContourId: null,
  };
}

describe("deriveGlyphXBounds", () => {
  it("returns null for empty glyph geometry", () => {
    const glyph = makeGlyph({ xAdvance: 500 });
    expect(deriveGlyphXBounds(glyph)).toBeNull();
  });

  it("includes contour segments in bounds", () => {
    const glyph = makeGlyph({
      xAdvance: 600,
      contours: [
        {
          id: "c1" as any,
          closed: true,
          points: [
            makePoint("p1", 10, 0),
            makePoint("p2", 110, 0),
            makePoint("p3", 110, 100),
            makePoint("p4", 10, 100),
          ],
        },
      ],
    });

    const bounds = deriveGlyphXBounds(glyph);
    expect(bounds).toEqual({ minX: 10, maxX: 110 });
  });

  it("uses tight curve bounds (can exceed anchor x)", () => {
    const glyph = makeGlyph({
      xAdvance: 600,
      contours: [
        {
          id: "c1" as any,
          closed: false,
          points: [
            makePoint("p1", 0, 0, "onCurve"),
            makePoint("p2", 300, 100, "offCurve"),
            makePoint("p3", 200, 0, "onCurve"),
          ],
        },
      ],
    });

    const bounds = deriveGlyphXBounds(glyph);
    expect(bounds).not.toBeNull();
    expect(bounds!.maxX).toBeCloseTo(225, 4);
  });

  it("includes composite contours in bounds", () => {
    const glyph = makeGlyph({
      xAdvance: 700,
      contours: [],
      compositeContours: [
        {
          closed: true,
          points: [
            { x: 50, y: 0, pointType: "onCurve", smooth: false },
            { x: 150, y: 0, pointType: "onCurve", smooth: false },
            { x: 150, y: 100, pointType: "onCurve", smooth: false },
            { x: 50, y: 100, pointType: "onCurve", smooth: false },
          ],
        },
      ],
    });

    const bounds = deriveGlyphXBounds(glyph);
    expect(bounds).toEqual({ minX: 50, maxX: 150 });
  });
});

describe("deriveGlyphSidebearings", () => {
  it("returns null sidebearings when glyph has no drawable bounds", () => {
    const glyph = makeGlyph({ xAdvance: 500 });
    expect(deriveGlyphSidebearings(glyph)).toEqual({ lsb: null, rsb: null });
  });

  it("computes lsb and rsb from bounds and advance", () => {
    const glyph = makeGlyph({
      xAdvance: 600,
      contours: [
        {
          id: "c1" as any,
          closed: true,
          points: [
            makePoint("p1", 20, 0),
            makePoint("p2", 120, 0),
            makePoint("p3", 120, 50),
            makePoint("p4", 20, 50),
          ],
        },
      ],
    });

    expect(deriveGlyphSidebearings(glyph)).toEqual({
      lsb: 20,
      rsb: 480,
    });
  });
});
