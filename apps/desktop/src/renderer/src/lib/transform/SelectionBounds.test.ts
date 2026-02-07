import { describe, it, expect } from "vitest";
import { getSegmentAwareBounds } from "./SelectionBounds";
import { Bounds } from "@shift/geo";
import type { GlyphSnapshot } from "@shift/types";
import { asPointId } from "@shift/types";

function makePoint(id: string, x: number, y: number, type: "onCurve" | "offCurve" = "onCurve") {
  return { id, x, y, pointType: type, smooth: false };
}

describe("getSegmentAwareBounds", () => {
  it("returns null for empty selection", () => {
    const snapshot: GlyphSnapshot = {
      contours: [
        {
          id: "c1",
          points: [makePoint("p1", 0, 0), makePoint("p2", 100, 100)],
          closed: false,
        },
      ],
      width: 500,
      activeContourId: "c1",
    };
    const result = getSegmentAwareBounds(snapshot, []);
    expect(result).toBeNull();
  });

  it("calculates bounds for line segment (same as point AABB)", () => {
    const snapshot: GlyphSnapshot = {
      contours: [
        {
          id: "c1",
          points: [makePoint("p1", 0, 0), makePoint("p2", 100, 50)],
          closed: false,
        },
      ],
      width: 500,
      activeContourId: "c1",
    };
    const selectedPoints = [asPointId("p1"), asPointId("p2")];
    const result = getSegmentAwareBounds(snapshot, selectedPoints);

    expect(result).not.toBeNull();
    expect(result!.min.x).toBe(0);
    expect(result!.min.y).toBe(0);
    expect(result!.max.x).toBe(100);
    expect(result!.max.y).toBe(50);
  });

  it("calculates segment-aware bounds for quadratic curve with vertical bulge", () => {
    const snapshot: GlyphSnapshot = {
      contours: [
        {
          id: "c1",
          points: [
            makePoint("p1", 0, 0),
            makePoint("ctrl", 50, 200, "offCurve"),
            makePoint("p2", 100, 0),
          ],
          closed: false,
        },
      ],
      width: 500,
      activeContourId: "c1",
    };
    const selectedPoints = [asPointId("p1"), asPointId("ctrl"), asPointId("p2")];
    const result = getSegmentAwareBounds(snapshot, selectedPoints);

    expect(result).not.toBeNull();
    expect(result!.min.x).toBe(0);
    expect(result!.min.y).toBe(0);
    expect(result!.max.x).toBe(100);
    expect(result!.max.y).toBe(100);
  });

  it("calculates segment-aware bounds for cubic S-curve", () => {
    const snapshot: GlyphSnapshot = {
      contours: [
        {
          id: "c1",
          points: [
            makePoint("p1", 0, 50),
            makePoint("ctrl1", 0, 150, "offCurve"),
            makePoint("ctrl2", 100, -50, "offCurve"),
            makePoint("p2", 100, 50),
          ],
          closed: false,
        },
      ],
      width: 500,
      activeContourId: "c1",
    };
    const selectedPoints = [
      asPointId("p1"),
      asPointId("ctrl1"),
      asPointId("ctrl2"),
      asPointId("p2"),
    ];
    const result = getSegmentAwareBounds(snapshot, selectedPoints);

    expect(result).not.toBeNull();
    expect(result!.min.x).toBe(0);
    expect(result!.max.x).toBe(100);
    expect(result!.min.y).toBeLessThan(50);
    expect(result!.max.y).toBeGreaterThan(50);
  });

  it("uses point bounds for partially selected curves", () => {
    const snapshot: GlyphSnapshot = {
      contours: [
        {
          id: "c1",
          points: [
            makePoint("p1", 0, 0),
            makePoint("ctrl", 50, 200, "offCurve"),
            makePoint("p2", 100, 0),
          ],
          closed: false,
        },
      ],
      width: 500,
      activeContourId: "c1",
    };
    const selectedPoints = [asPointId("p1"), asPointId("ctrl")];
    const result = getSegmentAwareBounds(snapshot, selectedPoints);

    expect(result).not.toBeNull();
    expect(result!.max.y).toBe(200);
  });

  it("returns null when selected points don't exist in snapshot", () => {
    const snapshot: GlyphSnapshot = {
      contours: [
        {
          id: "c1",
          points: [makePoint("p1", 0, 0)],
          closed: false,
        },
      ],
      width: 500,
      activeContourId: "c1",
    };
    const selectedPoints = [asPointId("nonexistent")];
    const result = getSegmentAwareBounds(snapshot, selectedPoints);

    expect(result).toBeNull();
  });

  it("calculates center correctly", () => {
    const snapshot: GlyphSnapshot = {
      contours: [
        {
          id: "c1",
          points: [makePoint("p1", 0, 0), makePoint("p2", 100, 100)],
          closed: false,
        },
      ],
      width: 500,
      activeContourId: "c1",
    };
    const selectedPoints = [asPointId("p1"), asPointId("p2")];
    const result = getSegmentAwareBounds(snapshot, selectedPoints);

    expect(result).not.toBeNull();
    const center = Bounds.center(result!);
    expect(center.x).toBe(50);
    expect(center.y).toBe(50);
  });
});
