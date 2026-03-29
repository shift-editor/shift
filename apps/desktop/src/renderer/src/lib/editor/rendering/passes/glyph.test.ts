import { describe, it, expect, vi, beforeEach } from "vitest";

import { renderGlyphOutline, renderGlyphFilled } from "./glyph";
import type { IRenderer } from "@/types/graphics";
import type { Contour, Glyph } from "@shift/types";
import { asContourId, asPointId } from "@shift/types";

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
    id: asContourId("triangle"),
    closed: true,
    points: [
      { id: asPointId("p1"), x: 0, y: 0, pointType: "onCurve", smooth: false },
      { id: asPointId("p2"), x: 100, y: 0, pointType: "onCurve", smooth: false },
      { id: asPointId("p3"), x: 50, y: 100, pointType: "onCurve", smooth: false },
    ],
  };
}

function createOpenContour(): Contour {
  return {
    id: asContourId("line"),
    closed: false,
    points: [
      { id: asPointId("p1"), x: 0, y: 0, pointType: "onCurve", smooth: false },
      { id: asPointId("p2"), x: 100, y: 100, pointType: "onCurve", smooth: false },
    ],
  };
}

function createGlyphWithHole(): Glyph {
  return {
    name: "O",
    contours: [
      {
        id: asContourId("outer"),
        closed: true,
        points: [
          { id: asPointId("p1"), x: 0, y: 0, pointType: "onCurve", smooth: false },
          { id: asPointId("p2"), x: 100, y: 0, pointType: "onCurve", smooth: false },
          { id: asPointId("p3"), x: 100, y: 100, pointType: "onCurve", smooth: false },
          { id: asPointId("p4"), x: 0, y: 100, pointType: "onCurve", smooth: false },
        ],
      },
      {
        id: asContourId("inner"),
        closed: true,
        points: [
          { id: asPointId("p5"), x: 25, y: 25, pointType: "onCurve", smooth: false },
          { id: asPointId("p6"), x: 25, y: 75, pointType: "onCurve", smooth: false },
          { id: asPointId("p7"), x: 75, y: 75, pointType: "onCurve", smooth: false },
          { id: asPointId("p8"), x: 75, y: 25, pointType: "onCurve", smooth: false },
        ],
      },
    ],
    xAdvance: 120,
    unicode: 79,
    anchors: [],
    compositeContours: [],
    activeContourId: asContourId("outer"),
  };
}

describe("glyph", () => {
  let ctx: IRenderer;

  beforeEach(() => {
    ctx = createMockRenderer();
  });

  describe("renderGlyphOutline", () => {
    it("strokes cached contour paths", () => {
      const glyph: Glyph = {
        name: "A",
        contours: [createClosedTriangleContour()],
        xAdvance: 100,
        unicode: 65,
        anchors: [],
        compositeContours: [],
        activeContourId: asContourId("triangle"),
      };

      renderGlyphOutline(ctx, glyph);

      expect(ctx.strokePath).toHaveBeenCalledTimes(1);
    });

    it("strokes paths for all contours", () => {
      const glyph = createGlyphWithHole();

      renderGlyphOutline(ctx, glyph);

      expect(ctx.strokePath).toHaveBeenCalledTimes(2);
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
        unicode: 65,
        anchors: [],
        compositeContours: [],
        activeContourId: asContourId("line"),
      };

      const result = renderGlyphOutline(ctx, glyph);

      expect(result).toBe(false);
    });

    it("returns true when mix of open and closed contours", () => {
      const glyph: Glyph = {
        name: "mix",
        contours: [createClosedTriangleContour(), createOpenContour()],
        xAdvance: 100,
        unicode: 65,
        anchors: [],
        compositeContours: [],
        activeContourId: asContourId("triangle"),
      };

      const result = renderGlyphOutline(ctx, glyph);

      expect(result).toBe(true);
    });

    it("strokes each contour path", () => {
      const callOrder: string[] = [];
      ctx.strokePath = vi.fn(() => callOrder.push("strokePath"));

      const glyph: Glyph = {
        name: "A",
        contours: [createClosedTriangleContour()],
        xAdvance: 100,
        unicode: 65,
        anchors: [],
        compositeContours: [],
        activeContourId: asContourId("triangle"),
      };

      renderGlyphOutline(ctx, glyph);

      expect(callOrder).toEqual(["strokePath"]);
    });

    it("returns false for empty glyph with no contours", () => {
      const glyph: Glyph = {
        name: "empty",
        contours: [],
        xAdvance: 0,
        unicode: 65,
        anchors: [],
        compositeContours: [],
        activeContourId: null,
      };
      const result = renderGlyphOutline(ctx, glyph);

      expect(result).toBe(false);
    });

    it("skips contours that are entirely outside the visible scene bounds", () => {
      const glyph: Glyph = {
        name: "offscreen",
        contours: [createClosedTriangleContour()],
        xAdvance: 100,
        unicode: 65,
        anchors: [],
        compositeContours: [],
        activeContourId: asContourId("triangle"),
      };

      renderGlyphOutline(
        ctx,
        glyph,
        { minX: 1000, maxX: 1100, minY: 1000, maxY: 1100 },
        { x: 0, y: 0 },
      );

      expect(ctx.strokePath).not.toHaveBeenCalled();
    });
  });

  describe("renderGlyphFilled", () => {
    it("sets fillStyle to black", () => {
      const glyph: Glyph = {
        name: "A",
        contours: [createClosedTriangleContour()],
        xAdvance: 100,
        unicode: 65,
        anchors: [],
        compositeContours: [],
        activeContourId: asContourId("triangle"),
      };

      renderGlyphFilled(ctx, glyph);

      expect(ctx.fillStyle).toBe("black");
    });

    it("calls beginPath and fill", () => {
      const glyph: Glyph = {
        name: "A",
        contours: [createClosedTriangleContour()],
        xAdvance: 100,
        unicode: 65,
        anchors: [],
        compositeContours: [],
        activeContourId: asContourId("triangle"),
      };

      renderGlyphFilled(ctx, glyph);

      expect(ctx.fillPath).toHaveBeenCalledTimes(1);
      expect(ctx.beginPath).not.toHaveBeenCalled();
      expect(ctx.fill).not.toHaveBeenCalled();
    });

    it("fills a combined cached path for all contours", () => {
      const glyph = createGlyphWithHole();

      renderGlyphFilled(ctx, glyph);

      expect(ctx.fillPath).toHaveBeenCalledTimes(1);
      expect(ctx.moveTo).not.toHaveBeenCalled();
    });

    it("fills through cached paths without manual path tracing", () => {
      ctx.fillPath = vi.fn();

      const glyph: Glyph = {
        name: "A",
        contours: [createClosedTriangleContour()],
        xAdvance: 100,
        unicode: 65,
        anchors: [],
        compositeContours: [],
        activeContourId: asContourId("triangle"),
      };

      renderGlyphFilled(ctx, glyph);

      expect(ctx.fillPath).toHaveBeenCalledTimes(1);
      expect(ctx.beginPath).not.toHaveBeenCalled();
      expect(ctx.moveTo).not.toHaveBeenCalled();
      expect(ctx.fill).not.toHaveBeenCalled();
    });

    it("does not call stroke", () => {
      const glyph: Glyph = {
        name: "A",
        contours: [createClosedTriangleContour()],
        xAdvance: 100,
        unicode: 65,
        anchors: [],
        compositeContours: [],
        activeContourId: asContourId("triangle"),
      };

      renderGlyphFilled(ctx, glyph);

      expect(ctx.stroke).not.toHaveBeenCalled();
    });

    it("skips filling contours that are entirely outside the visible scene bounds", () => {
      const glyph: Glyph = {
        name: "offscreen",
        contours: [createClosedTriangleContour()],
        xAdvance: 100,
        unicode: 65,
        anchors: [],
        compositeContours: [],
        activeContourId: asContourId("triangle"),
      };

      renderGlyphFilled(
        ctx,
        glyph,
        { minX: 1000, maxX: 1100, minY: 1000, maxY: 1100 },
        { x: 0, y: 0 },
      );

      expect(ctx.moveTo).not.toHaveBeenCalled();
      expect(ctx.fillPath).toHaveBeenCalledTimes(1);
      expect(ctx.fill).not.toHaveBeenCalled();
    });
  });
});
