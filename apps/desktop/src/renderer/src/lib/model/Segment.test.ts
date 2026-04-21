import { describe, it, expect } from "vitest";
import { Segment } from "./Segment";
import type { LineSegment, QuadSegment, CubicSegment } from "@/types/segments";
import { asPointId } from "@shift/types";

const pt = (id: string, x: number, y: number, pointType: "onCurve" | "offCurve" = "onCurve") => ({
  id: asPointId(id),
  x,
  y,
  pointType,
  smooth: false,
});

const line = (): LineSegment => ({
  type: "line",
  points: { anchor1: pt("p1", 0, 0), anchor2: pt("p2", 100, 0) },
});

const quad = (): QuadSegment => ({
  type: "quad",
  points: {
    anchor1: pt("p1", 0, 0),
    control: pt("c1", 50, 100, "offCurve"),
    anchor2: pt("p2", 100, 0),
  },
});

const cubic = (): CubicSegment => ({
  type: "cubic",
  points: {
    anchor1: pt("p1", 0, 0),
    control1: pt("c1", 25, 100, "offCurve"),
    control2: pt("c2", 75, 100, "offCurve"),
    anchor2: pt("p2", 100, 0),
  },
});

describe("Segment", () => {
  it("id uses anchor point ids", () => {
    expect(new Segment(line()).id).toBe("p1:p2");
    expect(new Segment(quad()).id).toBe("p1:p2");
    expect(new Segment(cubic()).id).toBe("p1:p2");
  });

  it("exposes type and anchors", () => {
    const seg = new Segment(cubic());
    expect(seg.type).toBe("cubic");
    expect(seg.anchor1.id).toBe("p1");
    expect(seg.anchor2.id).toBe("p2");
  });

  it("pointIds includes controls per variant", () => {
    expect(new Segment(line()).pointIds).toEqual(["p1", "p2"]);
    expect(new Segment(quad()).pointIds).toEqual(["p1", "c1", "p2"]);
    expect(new Segment(cubic()).pointIds).toEqual(["p1", "c1", "c2", "p2"]);
  });

  it("toCurve returns matching curve type", () => {
    expect(new Segment(line()).toCurve().type).toBe("line");
    expect(new Segment(quad()).toCurve().type).toBe("quadratic");
    expect(new Segment(cubic()).toCurve().type).toBe("cubic");
  });

  it("bounds of a line are anchor extents", () => {
    const b = new Segment(line()).bounds;
    expect(b.min).toEqual({ x: 0, y: 0 });
    expect(b.max).toEqual({ x: 100, y: 0 });
  });

  it("bounds of a cubic include control envelope", () => {
    const b = new Segment(cubic()).bounds;
    expect(b.min.x).toBeGreaterThanOrEqual(0);
    expect(b.max.y).toBeGreaterThan(0);
  });

  describe("hitTest", () => {
    it("hits a line within radius", () => {
      const hit = new Segment(line()).hitTest({ x: 50, y: 2 }, 5);
      expect(hit).not.toBeNull();
      expect(hit!.segmentId).toBe("p1:p2");
      expect(hit!.t).toBeCloseTo(0.5, 1);
      expect(hit!.point.x).toBeCloseTo(50, 1);
    });

    it("misses when beyond radius", () => {
      expect(new Segment(line()).hitTest({ x: 50, y: 10 }, 5)).toBeNull();
    });

    it("rejects based on bounds cheaply", () => {
      expect(new Segment(line()).hitTest({ x: 500, y: 500 }, 5)).toBeNull();
    });

    it("hits a cubic near endpoints", () => {
      const hit = new Segment(cubic()).hitTest({ x: 0, y: 0 }, 5);
      expect(hit).not.toBeNull();
    });
  });

  describe("hitTestMultiple", () => {
    it("picks the closest hit", () => {
      const a = new Segment(line());
      const b = new Segment({
        type: "line",
        points: { anchor1: pt("p3", 0, 50), anchor2: pt("p4", 100, 50) },
      });
      const hit = Segment.hitTestMultiple([a, b], { x: 50, y: 1 }, 10);
      expect(hit!.segmentId).toBe("p1:p2");
    });

    it("returns null when nothing hits", () => {
      expect(Segment.hitTestMultiple([new Segment(line())], { x: 50, y: 100 }, 5)).toBeNull();
    });

    it("returns null for empty input", () => {
      expect(Segment.hitTestMultiple([], { x: 0, y: 0 }, 5)).toBeNull();
    });
  });

  describe("parse", () => {
    it("returns empty for fewer than 2 points", () => {
      expect(Segment.parse([], false)).toEqual([]);
      expect(Segment.parse([pt("p1", 0, 0)], false)).toEqual([]);
    });

    it("parses onCurve pairs into line segments", () => {
      const segments = Segment.parse([pt("p1", 0, 0), pt("p2", 100, 0)], false);
      expect(segments).toHaveLength(1);
      expect(segments[0]!.type).toBe("line");
    });

    it("parses quad and cubic patterns", () => {
      const q = Segment.parse(
        [pt("p1", 0, 0), pt("c1", 50, 100, "offCurve"), pt("p2", 100, 0)],
        false,
      );
      expect(q).toHaveLength(1);
      expect(q[0]!.type).toBe("quad");

      const c = Segment.parse(
        [
          pt("p1", 0, 0),
          pt("c1", 25, 100, "offCurve"),
          pt("c2", 75, 100, "offCurve"),
          pt("p2", 100, 0),
        ],
        false,
      );
      expect(c).toHaveLength(1);
      expect(c[0]!.type).toBe("cubic");
    });

    it("closes the contour with a wrap-around line", () => {
      const segments = Segment.parse([pt("p1", 0, 0), pt("p2", 100, 0), pt("p3", 50, 87)], true);
      expect(segments).toHaveLength(3);
      expect(segments.every((s) => s.type === "line")).toBe(true);
      expect(segments[2]!.anchor1.id).toBe("p3");
      expect(segments[2]!.anchor2.id).toBe("p1");
    });
  });
});
