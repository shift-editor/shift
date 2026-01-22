import { describe, it, expect } from "vitest";
import { Polygon } from "./Polygon";

describe("Polygon", () => {
  // In standard screen coordinates (Y down), this polygon winds clockwise
  // visually: top-left → top-right → bottom-right → bottom-left
  const clockwiseSquare = [
    { x: 0, y: 0 },
    { x: 0, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 0 },
  ];

  // Reverse winding: top-left → bottom-left → bottom-right → top-right
  const counterClockwiseSquare = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  describe("signedArea", () => {
    it("returns 0 for degenerate polygons", () => {
      expect(Polygon.signedArea([])).toBe(0);
      expect(Polygon.signedArea([{ x: 0, y: 0 }])).toBe(0);
      expect(Polygon.signedArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
    });

    it("returns positive area for clockwise polygon", () => {
      expect(Polygon.signedArea(clockwiseSquare)).toBeGreaterThan(0);
    });

    it("returns negative area for counter-clockwise polygon", () => {
      expect(Polygon.signedArea(counterClockwiseSquare)).toBeLessThan(0);
    });
  });

  describe("area", () => {
    it("returns absolute area regardless of winding", () => {
      // 10x10 square = 100 area
      expect(Polygon.area(clockwiseSquare)).toBe(100);
      expect(Polygon.area(counterClockwiseSquare)).toBe(100);
    });
  });

  describe("isClockwise", () => {
    it("returns true for degenerate polygons", () => {
      expect(Polygon.isClockwise([])).toBe(true);
      expect(Polygon.isClockwise([{ x: 0, y: 0 }])).toBe(true);
      expect(Polygon.isClockwise([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(true);
    });

    it("returns true for clockwise polygon", () => {
      expect(Polygon.isClockwise(clockwiseSquare)).toBe(true);
    });

    it("returns false for counter-clockwise polygon", () => {
      expect(Polygon.isClockwise(counterClockwiseSquare)).toBe(false);
    });
  });

  describe("isCounterClockwise", () => {
    it("returns false for degenerate polygons", () => {
      expect(Polygon.isCounterClockwise([])).toBe(false);
      expect(Polygon.isCounterClockwise([{ x: 0, y: 0 }])).toBe(false);
    });

    it("returns true for counter-clockwise polygon", () => {
      expect(Polygon.isCounterClockwise(counterClockwiseSquare)).toBe(true);
    });

    it("returns false for clockwise polygon", () => {
      expect(Polygon.isCounterClockwise(clockwiseSquare)).toBe(false);
    });
  });
});
