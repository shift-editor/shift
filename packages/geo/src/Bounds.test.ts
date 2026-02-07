import { describe, it, expect } from "vitest";
import { Bounds } from "./Bounds";

describe("Bounds", () => {
  describe("construction", () => {
    it("create builds from min/max", () => {
      const b = Bounds.create({ x: 1, y: 2 }, { x: 3, y: 4 });
      expect(b.min).toEqual({ x: 1, y: 2 });
      expect(b.max).toEqual({ x: 3, y: 4 });
    });

    it("fromPoint creates degenerate bounds", () => {
      const b = Bounds.fromPoint({ x: 5, y: 10 });
      expect(b.min).toEqual({ x: 5, y: 10 });
      expect(b.max).toEqual({ x: 5, y: 10 });
      expect(Bounds.width(b)).toBe(0);
      expect(Bounds.height(b)).toBe(0);
    });

    it("fromPoints returns null for empty array", () => {
      expect(Bounds.fromPoints([])).toBeNull();
    });

    it("fromPoints computes envelope", () => {
      const b = Bounds.fromPoints([
        { x: 10, y: 20 },
        { x: -5, y: 30 },
        { x: 15, y: -10 },
      ]);
      expect(b).not.toBeNull();
      expect(b!.min).toEqual({ x: -5, y: -10 });
      expect(b!.max).toEqual({ x: 15, y: 30 });
    });

    it("fromPoints works with single point", () => {
      const b = Bounds.fromPoints([{ x: 7, y: 3 }]);
      expect(b!.min).toEqual({ x: 7, y: 3 });
      expect(b!.max).toEqual({ x: 7, y: 3 });
    });

    it("fromXYWH constructs from x, y, width, height", () => {
      const b = Bounds.fromXYWH(10, 20, 100, 50);
      expect(b.min).toEqual({ x: 10, y: 20 });
      expect(b.max).toEqual({ x: 110, y: 70 });
    });
  });

  describe("composition", () => {
    it("union merges two bounds", () => {
      const a = Bounds.create({ x: 0, y: 0 }, { x: 10, y: 10 });
      const b = Bounds.create({ x: 5, y: -5 }, { x: 20, y: 5 });
      const u = Bounds.union(a, b);
      expect(u.min).toEqual({ x: 0, y: -5 });
      expect(u.max).toEqual({ x: 20, y: 10 });
    });

    it("unionAll merges multiple, skipping nulls", () => {
      const a = Bounds.create({ x: 0, y: 0 }, { x: 10, y: 10 });
      const b = Bounds.create({ x: 20, y: 20 }, { x: 30, y: 30 });
      const result = Bounds.unionAll([a, null, b, null]);
      expect(result).not.toBeNull();
      expect(result!.min).toEqual({ x: 0, y: 0 });
      expect(result!.max).toEqual({ x: 30, y: 30 });
    });

    it("unionAll returns null for all-null input", () => {
      expect(Bounds.unionAll([null, null])).toBeNull();
    });

    it("unionAll returns null for empty input", () => {
      expect(Bounds.unionAll([])).toBeNull();
    });

    it("includePoint expands bounds to contain point", () => {
      const b = Bounds.create({ x: 0, y: 0 }, { x: 10, y: 10 });
      const expanded = Bounds.includePoint(b, { x: 15, y: -5 });
      expect(expanded.min).toEqual({ x: 0, y: -5 });
      expect(expanded.max).toEqual({ x: 15, y: 10 });
    });

    it("includePoint is a no-op for interior point", () => {
      const b = Bounds.create({ x: 0, y: 0 }, { x: 10, y: 10 });
      const same = Bounds.includePoint(b, { x: 5, y: 5 });
      expect(same.min).toEqual({ x: 0, y: 0 });
      expect(same.max).toEqual({ x: 10, y: 10 });
    });
  });

  describe("derived properties", () => {
    const b = Bounds.create({ x: 10, y: 20 }, { x: 50, y: 80 });

    it("width", () => {
      expect(Bounds.width(b)).toBe(40);
    });

    it("height", () => {
      expect(Bounds.height(b)).toBe(60);
    });

    it("center", () => {
      expect(Bounds.center(b)).toEqual({ x: 30, y: 50 });
    });
  });

  describe("queries", () => {
    const b = Bounds.create({ x: 0, y: 0 }, { x: 10, y: 10 });

    it("containsPoint returns true for interior point", () => {
      expect(Bounds.containsPoint(b, { x: 5, y: 5 })).toBe(true);
    });

    it("containsPoint returns true for edge point", () => {
      expect(Bounds.containsPoint(b, { x: 0, y: 0 })).toBe(true);
      expect(Bounds.containsPoint(b, { x: 10, y: 10 })).toBe(true);
    });

    it("containsPoint returns false for exterior point", () => {
      expect(Bounds.containsPoint(b, { x: 11, y: 5 })).toBe(false);
      expect(Bounds.containsPoint(b, { x: -1, y: 5 })).toBe(false);
    });

    it("overlaps returns true for overlapping bounds", () => {
      const other = Bounds.create({ x: 5, y: 5 }, { x: 15, y: 15 });
      expect(Bounds.overlaps(b, other)).toBe(true);
    });

    it("overlaps returns true for touching bounds", () => {
      const touching = Bounds.create({ x: 10, y: 0 }, { x: 20, y: 10 });
      expect(Bounds.overlaps(b, touching)).toBe(true);
    });

    it("overlaps returns false for separate bounds", () => {
      const far = Bounds.create({ x: 20, y: 20 }, { x: 30, y: 30 });
      expect(Bounds.overlaps(b, far)).toBe(false);
    });
  });

  describe("transform", () => {
    it("expand adds padding on all sides", () => {
      const b = Bounds.create({ x: 10, y: 20 }, { x: 30, y: 40 });
      const expanded = Bounds.expand(b, 5);
      expect(expanded.min).toEqual({ x: 5, y: 15 });
      expect(expanded.max).toEqual({ x: 35, y: 45 });
    });
  });

  describe("conversion", () => {
    it("toRect produces correct Rect2D", () => {
      const b = Bounds.create({ x: 10, y: 20 }, { x: 50, y: 80 });
      const rect = Bounds.toRect(b);
      expect(rect).toEqual({
        x: 10,
        y: 20,
        width: 40,
        height: 60,
        left: 10,
        top: 20,
        right: 50,
        bottom: 80,
      });
    });
  });
});
