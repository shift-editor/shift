import { describe, it, expect } from "vitest";
import { Alignment } from "./Alignment";
import { Bounds } from "@shift/geo";
import type { TransformablePoint } from "./types";
import type { PointId } from "@shift/types";

function createPoint(id: number, x: number, y: number): TransformablePoint {
  return { id: `0:${id}` as PointId, x, y };
}

describe("Alignment", () => {
  describe("alignPoints", () => {
    const bounds = Bounds.create({ x: 100, y: 100 }, { x: 200, y: 200 });

    it("aligns points to left edge", () => {
      const points = [createPoint(1, 100, 150), createPoint(2, 150, 100), createPoint(3, 200, 200)];
      const aligned = Alignment.alignPoints(points, "left", bounds);
      expect(aligned.every((p) => p.x === 100)).toBe(true);
      expect(aligned.map((p) => p.y)).toEqual([150, 100, 200]);
    });

    it("aligns points to right edge", () => {
      const points = [createPoint(1, 100, 150), createPoint(2, 150, 100), createPoint(3, 200, 200)];
      const aligned = Alignment.alignPoints(points, "right", bounds);
      expect(aligned.every((p) => p.x === 200)).toBe(true);
    });

    it("aligns points to horizontal center", () => {
      const points = [createPoint(1, 100, 150), createPoint(2, 150, 100), createPoint(3, 200, 200)];
      const aligned = Alignment.alignPoints(points, "center-h", bounds);
      expect(aligned.every((p) => p.x === 150)).toBe(true);
    });

    it("aligns points to top edge", () => {
      const points = [createPoint(1, 100, 150), createPoint(2, 150, 100), createPoint(3, 200, 200)];
      const aligned = Alignment.alignPoints(points, "top", bounds);
      expect(aligned.every((p) => p.y === 200)).toBe(true);
      expect(aligned.map((p) => p.x)).toEqual([100, 150, 200]);
    });

    it("aligns points to bottom edge", () => {
      const points = [createPoint(1, 100, 150), createPoint(2, 150, 100), createPoint(3, 200, 200)];
      const aligned = Alignment.alignPoints(points, "bottom", bounds);
      expect(aligned.every((p) => p.y === 100)).toBe(true);
    });

    it("aligns points to vertical center", () => {
      const points = [createPoint(1, 100, 150), createPoint(2, 150, 100), createPoint(3, 200, 200)];
      const aligned = Alignment.alignPoints(points, "center-v", bounds);
      expect(aligned.every((p) => p.y === 150)).toBe(true);
    });

    it("returns empty array for empty input", () => {
      const aligned = Alignment.alignPoints([], "left", bounds);
      expect(aligned).toEqual([]);
    });

    it("preserves point IDs", () => {
      const points = [createPoint(1, 100, 150), createPoint(2, 150, 100)];
      const aligned = Alignment.alignPoints(points, "left", bounds);
      expect(aligned[0].id).toBe(points[0].id);
      expect(aligned[1].id).toBe(points[1].id);
    });
  });

  describe("distributePoints", () => {
    it("distributes points horizontally with equal spacing", () => {
      const points = [createPoint(1, 100, 100), createPoint(2, 300, 100), createPoint(3, 120, 100)];
      const distributed = Alignment.distributePoints(points, "horizontal");

      const sorted = distributed.sort((a, b) => a.x - b.x);
      expect(sorted[0].x).toBe(100);
      expect(sorted[1].x).toBe(200);
      expect(sorted[2].x).toBe(300);
    });

    it("distributes points vertically with equal spacing", () => {
      const points = [createPoint(1, 100, 100), createPoint(2, 100, 400), createPoint(3, 100, 150)];
      const distributed = Alignment.distributePoints(points, "vertical");

      const sorted = distributed.sort((a, b) => a.y - b.y);
      expect(sorted[0].y).toBe(100);
      expect(sorted[1].y).toBe(250);
      expect(sorted[2].y).toBe(400);
    });

    it("keeps first and last points in place horizontally", () => {
      const points = [createPoint(1, 100, 100), createPoint(2, 300, 100), createPoint(3, 120, 100)];
      const distributed = Alignment.distributePoints(points, "horizontal");

      const first = distributed.find((p) => p.id === ("0:1" as PointId));
      const last = distributed.find((p) => p.id === ("0:2" as PointId));
      expect(first?.x).toBe(100);
      expect(last?.x).toBe(300);
    });

    it("returns unchanged array for less than 3 points", () => {
      const points = [createPoint(1, 100, 100), createPoint(2, 200, 200)];
      const distributed = Alignment.distributePoints(points, "horizontal");
      expect(distributed).toEqual(points);
    });

    it("handles 4+ points correctly", () => {
      const points = [
        createPoint(1, 0, 0),
        createPoint(2, 300, 0),
        createPoint(3, 50, 0),
        createPoint(4, 200, 0),
      ];
      const distributed = Alignment.distributePoints(points, "horizontal");

      const sorted = distributed.sort((a, b) => a.x - b.x);
      expect(sorted[0].x).toBe(0);
      expect(sorted[1].x).toBeCloseTo(100);
      expect(sorted[2].x).toBeCloseTo(200);
      expect(sorted[3].x).toBe(300);
    });

    it("preserves point IDs during distribution", () => {
      const points = [createPoint(1, 100, 100), createPoint(2, 300, 100), createPoint(3, 120, 100)];
      const distributed = Alignment.distributePoints(points, "horizontal");
      const ids = distributed.map((p) => p.id).sort();
      expect(ids).toEqual(["0:1", "0:2", "0:3"]);
    });
  });
});
