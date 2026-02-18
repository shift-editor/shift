import { describe, expect, it } from "vitest";
import type { Glyph, Point, PointId, RenderContour } from "@shift/types";
import {
  deriveGlyphTightBounds,
  deriveGlyphXBounds,
  iterateRenderableContours,
  parseContourSegments,
  type SegmentContourLike,
} from "./GlyphGeometry";

function makePoint(
  id: string,
  x: number,
  y: number,
  pointType: Point["pointType"] = "onCurve",
): Point {
  return {
    id: id as PointId,
    x,
    y,
    pointType,
    smooth: false,
  };
}

function makeGlyph(input: {
  xAdvance?: number;
  contours?: Glyph["contours"];
  compositeContours?: readonly RenderContour[];
}): Glyph {
  return {
    unicode: 65,
    name: "A",
    xAdvance: input.xAdvance ?? 500,
    contours: input.contours ?? [],
    anchors: [],
    compositeContours: input.compositeContours ?? [],
    activeContourId: null,
  };
}

describe("iterateRenderableContours", () => {
  it("includes normal and composite contours", () => {
    const glyph = makeGlyph({
      contours: [{ id: "c1" as any, closed: true, points: [makePoint("p1", 0, 0)] }],
      compositeContours: [
        {
          closed: false,
          points: [{ x: 1, y: 1, pointType: "onCurve", smooth: false }],
        },
      ],
    });

    const contours = [...iterateRenderableContours(glyph)];
    expect(contours).toHaveLength(2);
  });
});

describe("parseContourSegments", () => {
  it("parses line, quad, and cubic segments", () => {
    const lineSegments = parseContourSegments({
      closed: false,
      points: [makePoint("p1", 0, 0), makePoint("p2", 10, 0)],
    });
    const quadSegments = parseContourSegments({
      closed: false,
      points: [
        makePoint("p1", 0, 0, "onCurve"),
        makePoint("p2", 10, 10, "offCurve"),
        makePoint("p3", 20, 0, "onCurve"),
      ],
    });
    const cubicSegments = parseContourSegments({
      closed: false,
      points: [
        makePoint("p1", 0, 0, "onCurve"),
        makePoint("p2", 10, 20, "offCurve"),
        makePoint("p3", 20, 20, "offCurve"),
        makePoint("p4", 30, 0, "onCurve"),
      ],
    });

    expect(lineSegments[0].type).toBe("line");
    expect(quadSegments[0].type).toBe("quad");
    expect(cubicSegments[0].type).toBe("cubic");
  });

  it("works when contour points have no IDs", () => {
    const contour: SegmentContourLike = {
      closed: false,
      points: [
        { x: 0, y: 0, pointType: "onCurve", smooth: false },
        { x: 100, y: 0, pointType: "onCurve", smooth: false },
      ],
    };

    const segments = parseContourSegments(contour);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("line");
    expect(segments[0].points.anchor1.id).toBeUndefined();
    expect(segments[0].points.anchor2.id).toBeUndefined();
  });
});

describe("glyph bounds derivation", () => {
  it("returns null for empty geometry", () => {
    expect(deriveGlyphTightBounds(makeGlyph({}))).toBeNull();
    expect(deriveGlyphXBounds(makeGlyph({}))).toBeNull();
  });

  it("returns tight bounds for contour geometry", () => {
    const glyph = makeGlyph({
      contours: [
        {
          id: "c1" as any,
          closed: true,
          points: [
            makePoint("p1", 10, 20),
            makePoint("p2", 40, 20),
            makePoint("p3", 40, 50),
            makePoint("p4", 10, 50),
          ],
        },
      ],
    });

    expect(deriveGlyphTightBounds(glyph)).toEqual({
      min: { x: 10, y: 20 },
      max: { x: 40, y: 50 },
    });
  });

  it("includes composite contour geometry", () => {
    const glyph = makeGlyph({
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

    expect(deriveGlyphXBounds(glyph)).toEqual({ minX: 50, maxX: 150 });
  });

  it("uses curve-tight x bounds", () => {
    const glyph = makeGlyph({
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
});
