import { describe, it, expect, vi, beforeEach } from "vitest";

import { renderGlyphOutline, renderGlyphFilled } from "./glyph";
import type { IRenderer } from "@/types/graphics";
import type { Contour, Glyph } from "@shift/types";

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
    fillPath: vi.fn(),
    strokePath: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    transform: vi.fn(),
  };
}

function createClosedTriangleContour(): Contour {
  return {
    id: 0,
    closed: true,
    points: [
      { id: 1, x: 0, y: 0, pointType: "onCurve", smooth: false },
      { id: 2, x: 100, y: 0, pointType: "onCurve", smooth: false },
      { id: 3, x: 50, y: 100, pointType: "onCurve", smooth: false },
    ],
  };
}

function createOpenContour(): Contour {
  return {
    id: 0,
    closed: false,
    points: [
      { id: 1, x: 0, y: 0, pointType: "onCurve", smooth: false },
      { id: 2, x: 100, y: 100, pointType: "onCurve", smooth: false },
    ],
  };
}

function createGlyphWithHole(): Glyph {
  return {
    name: "O",
    contours: [
      {
        id: 0,
        closed: true,
        points: [
          { id: 1, x: 0, y: 0, pointType: "onCurve", smooth: false },
          { id: 2, x: 100, y: 0, pointType: "onCurve", smooth: false },
          { id: 3, x: 100, y: 100, pointType: "onCurve", smooth: false },
          { id: 4, x: 0, y: 100, pointType: "onCurve", smooth: false },
        ],
      },
      {
        id: 1,
        closed: true,
        points: [
          { id: 5, x: 25, y: 25, pointType: "onCurve", smooth: false },
          { id: 6, x: 25, y: 75, pointType: "onCurve", smooth: false },
          { id: 7, x: 75, y: 75, pointType: "onCurve", smooth: false },
          { id: 8, x: 75, y: 25, pointType: "onCurve", smooth: false },
        ],
      },
    ],
    xAdvance: 120,
  };
}

describe("glyph", () => {
  let ctx: IRenderer;

  beforeEach(() => {
    ctx = createMockRenderer();
  });

  describe("renderGlyphOutline", () => {
    it("calls beginPath and stroke", () => {
      const glyph: Glyph = {
        name: "A",
        contours: [createClosedTriangleContour()],
        xAdvance: 100,
      };

      renderGlyphOutline(ctx, glyph);

      expect(ctx.beginPath).toHaveBeenCalledTimes(1);
      expect(ctx.stroke).toHaveBeenCalledTimes(1);
    });

    it("builds paths for all contours", () => {
      const glyph = createGlyphWithHole();

      renderGlyphOutline(ctx, glyph);

      expect(ctx.moveTo).toHaveBeenCalledTimes(2);
    });

    it("returns true when glyph has closed contours", () => {
      const glyph = createGlyphWithHole();
      const result = renderGlyphOutline(ctx, glyph);

      expect(result).toBe(true);
    });

    it("returns false when only open contours", () => {
      const glyph: Glyph = {
        name: "line",
        contours: [createOpenContour()],
        xAdvance: 100,
      };

      const result = renderGlyphOutline(ctx, glyph);

      expect(result).toBe(false);
    });

    it("returns true when mix of open and closed contours", () => {
      const glyph: Glyph = {
        name: "mix",
        contours: [createClosedTriangleContour(), createOpenContour()],
        xAdvance: 100,
      };

      const result = renderGlyphOutline(ctx, glyph);

      expect(result).toBe(true);
    });

    it("calls beginPath before any drawing and stroke at the end", () => {
      const callOrder: string[] = [];
      ctx.beginPath = vi.fn(() => callOrder.push("beginPath"));
      ctx.moveTo = vi.fn(() => callOrder.push("moveTo"));
      ctx.lineTo = vi.fn(() => callOrder.push("lineTo"));
      ctx.stroke = vi.fn(() => callOrder.push("stroke"));

      const glyph: Glyph = {
        name: "A",
        contours: [createClosedTriangleContour()],
        xAdvance: 100,
      };

      renderGlyphOutline(ctx, glyph);

      expect(callOrder[0]).toBe("beginPath");
      expect(callOrder[callOrder.length - 1]).toBe("stroke");
    });

    it("returns false for empty glyph with no contours", () => {
      const glyph: Glyph = { name: "empty", contours: [], xAdvance: 0 };
      const result = renderGlyphOutline(ctx, glyph);

      expect(result).toBe(false);
    });
  });

  describe("renderGlyphFilled", () => {
    it("sets fillStyle to black", () => {
      const glyph: Glyph = {
        name: "A",
        contours: [createClosedTriangleContour()],
        xAdvance: 100,
      };

      renderGlyphFilled(ctx, glyph);

      expect(ctx.fillStyle).toBe("black");
    });

    it("calls beginPath and fill", () => {
      const glyph: Glyph = {
        name: "A",
        contours: [createClosedTriangleContour()],
        xAdvance: 100,
      };

      renderGlyphFilled(ctx, glyph);

      expect(ctx.beginPath).toHaveBeenCalledTimes(1);
      expect(ctx.fill).toHaveBeenCalledTimes(1);
    });

    it("builds paths for all contours", () => {
      const glyph = createGlyphWithHole();

      renderGlyphFilled(ctx, glyph);

      expect(ctx.moveTo).toHaveBeenCalledTimes(2);
    });

    it("calls beginPath before drawing and fill at the end", () => {
      const callOrder: string[] = [];
      ctx.beginPath = vi.fn(() => callOrder.push("beginPath"));
      ctx.moveTo = vi.fn(() => callOrder.push("moveTo"));
      ctx.fill = vi.fn(() => callOrder.push("fill"));

      const glyph: Glyph = {
        name: "A",
        contours: [createClosedTriangleContour()],
        xAdvance: 100,
      };

      renderGlyphFilled(ctx, glyph);

      expect(callOrder[0]).toBe("beginPath");
      expect(callOrder[callOrder.length - 1]).toBe("fill");
    });

    it("does not call stroke", () => {
      const glyph: Glyph = {
        name: "A",
        contours: [createClosedTriangleContour()],
        xAdvance: 100,
      };

      renderGlyphFilled(ctx, glyph);

      expect(ctx.stroke).not.toHaveBeenCalled();
    });
  });
});
