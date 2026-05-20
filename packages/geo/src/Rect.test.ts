import { describe, expect, it } from "vitest";
import { Rect } from "./Rect";

describe("Rect", () => {
  describe("construction", () => {
    it("fromPoints normalizes opposite corners", () => {
      expect(Rect.fromPoints({ x: 10, y: 20 }, { x: -5, y: 30 })).toEqual({
        x: -5,
        y: 20,
        width: 15,
        height: 10,
        left: -5,
        top: 20,
        right: 10,
        bottom: 30,
      });
    });

    it("fromPoints supports degenerate rectangles", () => {
      expect(Rect.fromPoints({ x: 7, y: 3 }, { x: 7, y: 3 })).toEqual({
        x: 7,
        y: 3,
        width: 0,
        height: 0,
        left: 7,
        top: 3,
        right: 7,
        bottom: 3,
      });
    });
  });

  describe("queries", () => {
    const rect = Rect.fromPoints({ x: 0, y: 0 }, { x: 10, y: 20 });

    it("containsPoint returns true for interior points", () => {
      expect(Rect.containsPoint(rect, { x: 5, y: 10 })).toBe(true);
    });

    it("containsPoint returns true for edge points", () => {
      expect(Rect.containsPoint(rect, { x: 0, y: 0 })).toBe(true);
      expect(Rect.containsPoint(rect, { x: 10, y: 20 })).toBe(true);
    });

    it("containsPoint returns false for exterior points", () => {
      expect(Rect.containsPoint(rect, { x: -1, y: 10 })).toBe(false);
      expect(Rect.containsPoint(rect, { x: 5, y: 21 })).toBe(false);
    });
  });
});
