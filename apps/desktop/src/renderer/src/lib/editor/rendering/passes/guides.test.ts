import { describe, it, expect, vi, beforeEach } from "vitest";

import { renderGuides, getGuides, type Guides } from "./guides";
import type { IRenderer } from "@/types/graphics";
import type { Glyph, FontMetrics } from "@shift/types";

function createMockRenderer(): IRenderer {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    clear: vi.fn(),
    lineWidth: 1,
    strokeStyle: "black",
    fillStyle: "white",
    antiAlias: false,
    dashPattern: [],
    setStyle: vi.fn(),
    drawLine: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillCircle: vi.fn(),
    strokeCircle: vi.fn(),
    createPath: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    quadTo: vi.fn(),
    cubicTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    transform: vi.fn(),
  };
}

const guides: Guides = {
  ascender: { y: 800 },
  capHeight: { y: 700 },
  xHeight: { y: 500 },
  baseline: { y: 0 },
  descender: { y: -200 },
  xAdvance: 600,
};

describe("guides", () => {
  let ctx: IRenderer;

  beforeEach(() => {
    ctx = createMockRenderer();
  });

  describe("getGuides", () => {
    it("returns correct guide structure from glyph and metrics", () => {
      const glyph: Glyph = { name: "A", contours: [], xAdvance: 600 };
      const metrics: FontMetrics = {
        unitsPerEm: 1000,
        ascender: 800,
        capHeight: 700,
        xHeight: 500,
        descender: -200,
        lineGap: null,
        italicAngle: null,
        underlinePosition: null,
        underlineThickness: null,
      };

      const result = getGuides(glyph, metrics);

      expect(result).toEqual({
        ascender: { y: 800 },
        capHeight: { y: 700 },
        xHeight: { y: 500 },
        baseline: { y: 0 },
        descender: { y: -200 },
        xAdvance: 600,
      });
    });

    it("defaults capHeight and xHeight to 0 when null", () => {
      const glyph: Glyph = { name: "A", contours: [], xAdvance: 500 };
      const metrics: FontMetrics = {
        unitsPerEm: 1000,
        ascender: 800,
        capHeight: null,
        xHeight: null,
        descender: -200,
        lineGap: null,
        italicAngle: null,
        underlinePosition: null,
        underlineThickness: null,
      };

      const result = getGuides(glyph, metrics);

      expect(result.capHeight).toEqual({ y: 0 });
      expect(result.xHeight).toEqual({ y: 0 });
    });

    it("uses glyph xAdvance for xAdvance", () => {
      const glyph: Glyph = { name: "B", contours: [], xAdvance: 750 };
      const metrics: FontMetrics = {
        unitsPerEm: 1000,
        ascender: 800,
        capHeight: 700,
        xHeight: 500,
        descender: -200,
        lineGap: null,
        italicAngle: null,
        underlinePosition: null,
        underlineThickness: null,
      };

      const result = getGuides(glyph, metrics);

      expect(result.xAdvance).toBe(750);
    });
  });

  describe("renderGuides", () => {
    it("draws horizontal lines for all 5 guide levels", () => {
      renderGuides(ctx, guides);

      expect(ctx.moveTo).toHaveBeenCalledWith(0, 800);
      expect(ctx.lineTo).toHaveBeenCalledWith(600, 800);

      expect(ctx.moveTo).toHaveBeenCalledWith(0, 700);
      expect(ctx.lineTo).toHaveBeenCalledWith(600, 700);

      expect(ctx.moveTo).toHaveBeenCalledWith(0, 500);
      expect(ctx.lineTo).toHaveBeenCalledWith(600, 500);

      expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
      expect(ctx.lineTo).toHaveBeenCalledWith(600, 0);

      expect(ctx.moveTo).toHaveBeenCalledWith(0, -200);
      expect(ctx.lineTo).toHaveBeenCalledWith(600, -200);
    });

    it("draws vertical lines at x=0 and x=xAdvance", () => {
      renderGuides(ctx, guides);

      expect(ctx.moveTo).toHaveBeenCalledWith(0, -200);
      expect(ctx.lineTo).toHaveBeenCalledWith(0, 800);

      expect(ctx.moveTo).toHaveBeenCalledWith(600, -200);
      expect(ctx.lineTo).toHaveBeenCalledWith(600, 800);
    });

    it("calls beginPath and stroke exactly once", () => {
      renderGuides(ctx, guides);

      expect(ctx.beginPath).toHaveBeenCalledTimes(1);
      expect(ctx.stroke).toHaveBeenCalledTimes(1);
    });

    it("calls beginPath before any drawing and stroke at the end", () => {
      const callOrder: string[] = [];

      ctx.beginPath = vi.fn(() => callOrder.push("beginPath"));
      ctx.moveTo = vi.fn(() => callOrder.push("moveTo"));
      ctx.lineTo = vi.fn(() => callOrder.push("lineTo"));
      ctx.stroke = vi.fn(() => callOrder.push("stroke"));

      renderGuides(ctx, guides);

      expect(callOrder[0]).toBe("beginPath");
      expect(callOrder[callOrder.length - 1]).toBe("stroke");
    });

    it("makes 7 moveTo calls total (5 horizontal + 2 vertical)", () => {
      renderGuides(ctx, guides);

      expect(ctx.moveTo).toHaveBeenCalledTimes(7);
    });

    it("makes 7 lineTo calls total (5 horizontal + 2 vertical)", () => {
      renderGuides(ctx, guides);

      expect(ctx.lineTo).toHaveBeenCalledTimes(7);
    });
  });
});
