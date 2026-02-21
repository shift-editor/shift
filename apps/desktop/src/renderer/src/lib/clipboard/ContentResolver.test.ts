import { describe, it, expect } from "vitest";
import { ContentResolver } from "./ContentResolver";
import { asContourId, asPointId } from "@shift/types";
import { asSegmentId } from "@/types/indicator";
import type { GlyphSnapshot } from "@shift/types";
import { expectAt, expectDefined } from "@/testing";

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
    activeContourId: config.contours[0] ? asContourId(config.contours[0].id) : null,
    contours: config.contours.map((c) => ({
      id: asContourId(c.id),
      closed: c.closed ?? false,
      points: c.points.map((p) => ({
        id: asPointId(p.id),
        x: p.x,
        y: p.y,
        pointType: p.pointType,
        smooth: p.smooth ?? false,
      })),
    })),
    anchors: [],
    compositeContours: [],
  };
}

describe("ContentResolver", () => {
  const resolver = new ContentResolver();

  it("returns null for null snapshot", () => {
    const result = resolver.resolve(null, [], []);
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
    const result = resolver.resolve(snapshot, [], []);
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

    const result = resolver.resolve(snapshot, [asPointId("p1")], []);
    const resolved = expectDefined(result, "resolved content");
    const contour = expectAt(resolved.contours, 0);

    expect(resolved.contours).toHaveLength(1);
    expect(contour.points).toHaveLength(1);
    expect(expectAt(contour.points, 0)).toEqual({
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
      [asPointId("p1"), asPointId("p2"), asPointId("p3")],
      [],
    );
    const resolved = expectDefined(result, "resolved content");
    const contour = expectAt(resolved.contours, 0);

    expect(resolved.contours).toHaveLength(1);
    expect(contour.points).toHaveLength(3);
    expect(contour.closed).toBe(true);
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

    const result = resolver.resolve(snapshot, [asPointId("p1"), asPointId("p2")], []);
    const resolved = expectDefined(result, "resolved content");

    expect(expectAt(resolved.contours, 0).closed).toBe(false);
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

    const result = resolver.resolve(snapshot, [], [asSegmentId("p1:p2")]);
    const resolved = expectDefined(result, "resolved content");

    expect(expectAt(resolved.contours, 0).points.length).toBeGreaterThanOrEqual(2);
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

    const result = resolver.resolve(snapshot, [asPointId("p1")], []);
    const resolved = expectDefined(result, "resolved content");
    const points = expectAt(resolved.contours, 0).points;

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

    const result = resolver.resolve(snapshot, [asPointId("p1"), asPointId("p2")], []);
    const resolved = expectDefined(result, "resolved content");

    expect(resolved.contours).toHaveLength(2);
  });
});
