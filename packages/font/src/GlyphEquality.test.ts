import { describe, it, expect } from "vitest";
import { areGlyphSnapshotsEqual } from "./GlyphEquality";
import type { AnchorId, ContourId, GlyphSnapshot, PointId } from "@shift/types";

function cloneGlyphSnapshot(glyph: GlyphSnapshot): GlyphSnapshot {
  return {
    ...glyph,
    contours: glyph.contours.map((contour) => ({
      ...contour,
      points: contour.points.map((point) => ({ ...point })),
    })),
    anchors: glyph.anchors.map((anchor) => ({ ...anchor })),
    compositeContours: glyph.compositeContours.map((contour) => ({
      ...contour,
      points: contour.points.map((point) => ({ ...point })),
    })),
  };
}

function makeGlyphSnapshot(): GlyphSnapshot {
  return {
    unicode: 65,
    name: "A",
    xAdvance: 600,
    activeContourId: "c1" as ContourId,
    contours: [
      {
        id: "c1" as ContourId,
        closed: true,
        points: [
          { id: "p1" as PointId, x: 0, y: 0, pointType: "onCurve", smooth: false },
          { id: "p2" as PointId, x: 120, y: 0, pointType: "offCurve", smooth: false },
          { id: "p3" as PointId, x: 120, y: 300, pointType: "onCurve", smooth: true },
        ],
      },
    ],
    anchors: [{ id: "a1" as AnchorId, name: "top", x: 60, y: 300 }],
    compositeContours: [
      {
        closed: false,
        points: [
          { x: 10, y: 20, pointType: "onCurve", smooth: false },
          { x: 30, y: 40, pointType: "offCurve", smooth: false },
        ],
      },
    ],
  };
}

describe("areGlyphSnapshotsEqual", () => {
  it("returns true for the same reference", () => {
    const glyph = makeGlyphSnapshot();
    expect(areGlyphSnapshotsEqual(glyph, glyph)).toBe(true);
  });

  it("returns true for equal snapshots", () => {
    const left = makeGlyphSnapshot();
    const right = cloneGlyphSnapshot(left);
    expect(areGlyphSnapshotsEqual(left, right)).toBe(true);
  });

  it("returns false when top-level glyph metadata differs", () => {
    const left = makeGlyphSnapshot();
    const right = cloneGlyphSnapshot(left);
    right.xAdvance += 10;
    expect(areGlyphSnapshotsEqual(left, right)).toBe(false);
  });

  it("returns false when contour point geometry differs", () => {
    const left = makeGlyphSnapshot();
    const right = cloneGlyphSnapshot(left);
    right.contours[0].points[1].x += 1;
    expect(areGlyphSnapshotsEqual(left, right)).toBe(false);
  });

  it("returns false when anchors differ", () => {
    const left = makeGlyphSnapshot();
    const right = cloneGlyphSnapshot(left);
    right.anchors[0].name = "bottom";
    expect(areGlyphSnapshotsEqual(left, right)).toBe(false);
  });

  it("returns false when composite contours differ", () => {
    const left = makeGlyphSnapshot();
    const right = cloneGlyphSnapshot(left);
    right.compositeContours[0].points[0].y += 1;
    expect(areGlyphSnapshotsEqual(left, right)).toBe(false);
  });
});
