import { describe, expect, it } from "vitest";
import { zoomMultiplierFromWheel } from "./zoomFromWheel";

const DOM_DELTA_PIXEL = 0;
const DOM_DELTA_LINE = 1;

describe("zoomMultiplierFromWheel", () => {
  describe("pixel mode (deltaMode 0)", () => {
    it("returns 1 for zero delta", () => {
      expect(zoomMultiplierFromWheel(0, DOM_DELTA_PIXEL)).toBe(1);
    });

    it("zooms in for negative deltaY (scroll up)", () => {
      const m = zoomMultiplierFromWheel(-100, DOM_DELTA_PIXEL);
      expect(m).toBeGreaterThan(1);
      expect(m).toBeLessThanOrEqual(1.1);
    });

    it("zooms out for positive deltaY (scroll down)", () => {
      const m = zoomMultiplierFromWheel(100, DOM_DELTA_PIXEL);
      expect(m).toBeLessThan(1);
      expect(m).toBeGreaterThanOrEqual(0.9);
    });

    it("clamps to maxMultiplier for large scroll up", () => {
      expect(zoomMultiplierFromWheel(-1000, DOM_DELTA_PIXEL)).toBe(1.1);
    });

    it("clamps to minMultiplier for large scroll down", () => {
      expect(zoomMultiplierFromWheel(1000, DOM_DELTA_PIXEL)).toBe(0.9);
    });

    it("respects custom pixelDivisor", () => {
      const defaultM = zoomMultiplierFromWheel(-20, DOM_DELTA_PIXEL);
      const customM = zoomMultiplierFromWheel(-20, DOM_DELTA_PIXEL, {
        pixelDivisor: 100,
      });
      expect(customM).toBeGreaterThan(defaultM);
    });
  });

  describe("line mode (deltaMode 1)", () => {
    it("returns 1 for zero delta", () => {
      expect(zoomMultiplierFromWheel(0, DOM_DELTA_LINE)).toBe(1);
    });

    it("zooms in for negative deltaY (scroll up)", () => {
      const m = zoomMultiplierFromWheel(-1, DOM_DELTA_LINE);
      expect(m).toBe(1.08);
    });

    it("zooms out for positive deltaY (scroll down)", () => {
      const m = zoomMultiplierFromWheel(1, DOM_DELTA_LINE);
      expect(m).toBe(0.92);
    });

    it("clamps to maxMultiplier for many lines up", () => {
      expect(zoomMultiplierFromWheel(-10, DOM_DELTA_LINE)).toBe(1.1);
    });

    it("clamps to minMultiplier for many lines down", () => {
      expect(zoomMultiplierFromWheel(10, DOM_DELTA_LINE)).toBe(0.9);
    });

    it("respects custom lineStep", () => {
      const m = zoomMultiplierFromWheel(-1, DOM_DELTA_LINE, {
        lineStep: 0.05,
      });
      expect(m).toBe(1.05);
    });
  });

  describe("custom options", () => {
    it("respects custom minMultiplier and maxMultiplier", () => {
      expect(
        zoomMultiplierFromWheel(-1000, DOM_DELTA_PIXEL, {
          minMultiplier: 0.8,
          maxMultiplier: 1.2,
        }),
      ).toBe(1.2);
      expect(
        zoomMultiplierFromWheel(1000, DOM_DELTA_PIXEL, {
          minMultiplier: 0.8,
          maxMultiplier: 1.2,
        }),
      ).toBe(0.8);
    });
  });
});
