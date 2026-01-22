import { describe, it, expect } from "vitest";
import { ContentResolver } from "./ContentResolver";
import { asPointId } from "@/types/ids";
import { asSegmentId } from "@/types/indicator";
import type { GlyphSnapshot } from "@/types/generated";

function createSnapshot(config: {
  contours: Array<{
    id: string;
    points: Array<{
      id: string;
      x: number;
      y: number;
      pointType: "onCurve" | "offCurve";
      smooth?: boolean;
    }>;
    closed?: boolean;
  }>;
}): GlyphSnapshot {
  return {
    unicode: 65,
    name: "A",
    xAdvance: 500,
    activeContourId: config.contours[0]?.id ?? null,
    contours: config.contours.map((c) => ({
      id: c.id,
      closed: c.closed ?? false,
      points: c.points.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        pointType: p.pointType,
        smooth: p.smooth ?? false,
      })),
    })),
  };
}

describe("ContentResolver", () => {
  const resolver = new ContentResolver();

  it("returns null for null snapshot", () => {
    const result = resolver.resolve(null, new Set(), new Set());
    expect(result).toBeNull();
  });

  it("returns null for empty selection", () => {
    const snapshot = createSnapshot({
      contours: [
        {
          id: "c1",
          points: [{ id: "p1", x: 0, y: 0, pointType: "onCurve" }],
        },
      ],
    });
    const result = resolver.resolve(snapshot, new Set(), new Set());
    expect(result).toBeNull();
  });

  it("resolves single point selection", () => {
    const snapshot = createSnapshot({
      contours: [
        {
          id: "c1",
          points: [
            { id: "p1", x: 100, y: 200, pointType: "onCurve" },
            { id: "p2", x: 150, y: 250, pointType: "onCurve" },
          ],
        },
      ],
    });

    const result = resolver.resolve(
      snapshot,
      new Set([asPointId("p1")]),
      new Set(),
    );

    expect(result).not.toBeNull();
    expect(result!.contours).toHaveLength(1);
    expect(result!.contours[0].points).toHaveLength(1);
    expect(result!.contours[0].points[0]).toEqual({
      x: 100,
      y: 200,
      pointType: "onCurve",
      smooth: false,
    });
  });

  it("resolves full contour selection", () => {
    const snapshot = createSnapshot({
      contours: [
        {
          id: "c1",
          closed: true,
          points: [
            { id: "p1", x: 0, y: 0, pointType: "onCurve" },
            { id: "p2", x: 100, y: 0, pointType: "onCurve" },
            { id: "p3", x: 100, y: 100, pointType: "onCurve" },
          ],
        },
      ],
    });

    const result = resolver.resolve(
      snapshot,
      new Set([asPointId("p1"), asPointId("p2"), asPointId("p3")]),
      new Set(),
    );

    expect(result).not.toBeNull();
    expect(result!.contours).toHaveLength(1);
    expect(result!.contours[0].points).toHaveLength(3);
    expect(result!.contours[0].closed).toBe(true);
  });

  it("resolves partial contour as open", () => {
    const snapshot = createSnapshot({
      contours: [
        {
          id: "c1",
          closed: true,
          points: [
            { id: "p1", x: 0, y: 0, pointType: "onCurve" },
            { id: "p2", x: 100, y: 0, pointType: "onCurve" },
            { id: "p3", x: 100, y: 100, pointType: "onCurve" },
          ],
        },
      ],
    });

    const result = resolver.resolve(
      snapshot,
      new Set([asPointId("p1"), asPointId("p2")]),
      new Set(),
    );

    expect(result).not.toBeNull();
    expect(result!.contours[0].closed).toBe(false);
  });

  it("expands segments to point IDs", () => {
    const snapshot = createSnapshot({
      contours: [
        {
          id: "c1",
          points: [
            { id: "p1", x: 0, y: 0, pointType: "onCurve" },
            { id: "p2", x: 100, y: 0, pointType: "onCurve" },
            { id: "p3", x: 100, y: 100, pointType: "onCurve" },
          ],
        },
      ],
    });

    const result = resolver.resolve(
      snapshot,
      new Set(),
      new Set([asSegmentId("p1:p2")]),
    );

    expect(result).not.toBeNull();
    expect(result!.contours[0].points.length).toBeGreaterThanOrEqual(2);
  });

  it("includes control points for bezier curves", () => {
    const snapshot = createSnapshot({
      contours: [
        {
          id: "c1",
          points: [
            { id: "p1", x: 0, y: 0, pointType: "onCurve" },
            { id: "p2", x: 50, y: 50, pointType: "offCurve" },
            { id: "p3", x: 100, y: 0, pointType: "onCurve" },
          ],
        },
      ],
    });

    const result = resolver.resolve(
      snapshot,
      new Set([asPointId("p1")]),
      new Set(),
    );

    expect(result).not.toBeNull();
    const points = result!.contours[0].points;
    const hasOffCurve = points.some((p) => p.pointType === "offCurve");
    expect(hasOffCurve).toBe(true);
  });

  it("handles multiple contours", () => {
    const snapshot = createSnapshot({
      contours: [
        {
          id: "c1",
          points: [{ id: "p1", x: 0, y: 0, pointType: "onCurve" }],
        },
        {
          id: "c2",
          points: [{ id: "p2", x: 100, y: 100, pointType: "onCurve" }],
        },
      ],
    });

    const result = resolver.resolve(
      snapshot,
      new Set([asPointId("p1"), asPointId("p2")]),
      new Set(),
    );

    expect(result).not.toBeNull();
    expect(result!.contours).toHaveLength(2);
  });
});
