import { describe, it, expect, vi, beforeEach } from "vitest";

import { buildContourPath, renderGlyph } from "./render";
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

describe("render", () => {
  let ctx: IRenderer;

  beforeEach(() => {
    ctx = createMockRenderer();
  });

  describe("buildContourPath", () => {
    it("does NOT call beginPath - caller owns path lifecycle", () => {
      const contour = createClosedTriangleContour();
      buildContourPath(ctx, contour);

      expect(ctx.beginPath).not.toHaveBeenCalled();
    });

    it("calls moveTo for the first point", () => {
      const contour = createClosedTriangleContour();
      buildContourPath(ctx, contour);

      expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    });

    it("calls lineTo for subsequent on-curve points", () => {
      const contour = createClosedTriangleContour();
      buildContourPath(ctx, contour);

      expect(ctx.lineTo).toHaveBeenCalledWith(100, 0);
      expect(ctx.lineTo).toHaveBeenCalledWith(50, 100);
    });

    it("calls closePath for closed contours", () => {
      const contour = createClosedTriangleContour();
      buildContourPath(ctx, contour);

      expect(ctx.closePath).toHaveBeenCalled();
    });

    it("does not call closePath for open contours", () => {
      const contour = createOpenContour();
      buildContourPath(ctx, contour);

      expect(ctx.closePath).not.toHaveBeenCalled();
    });

    it("returns true for closed contours", () => {
      const contour = createClosedTriangleContour();
      const result = buildContourPath(ctx, contour);

      expect(result).toBe(true);
    });

    it("returns false for open contours", () => {
      const contour = createOpenContour();
      const result = buildContourPath(ctx, contour);

      expect(result).toBe(false);
    });

    it("returns false for degenerate contours (< 2 points)", () => {
      const contour: Contour = {
        id: asContourId("degenerate"),
        closed: true,
        points: [{ id: asPointId("p1"), x: 0, y: 0, pointType: "onCurve", smooth: false }],
      };
      const result = buildContourPath(ctx, contour);

      expect(result).toBe(false);
      expect(ctx.moveTo).not.toHaveBeenCalled();
    });
  });

  describe("renderGlyph", () => {
    it("calls beginPath exactly once for multi-contour glyph", () => {
      const glyph = createGlyphWithHole();
      renderGlyph(ctx, glyph);

      expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    });

    it("calls stroke exactly once for multi-contour glyph", () => {
      const glyph = createGlyphWithHole();
      renderGlyph(ctx, glyph);

      expect(ctx.stroke).toHaveBeenCalledTimes(1);
    });

    it("builds all contours into single path before stroking", () => {
      const glyph = createGlyphWithHole();
      const callOrder: string[] = [];

      ctx.beginPath = vi.fn(() => callOrder.push("beginPath"));
      ctx.moveTo = vi.fn(() => callOrder.push("moveTo"));
      ctx.stroke = vi.fn(() => callOrder.push("stroke"));

      renderGlyph(ctx, glyph);

      expect(callOrder[0]).toBe("beginPath");
      expect(callOrder.filter((c) => c === "moveTo").length).toBe(2);
      expect(callOrder[callOrder.length - 1]).toBe("stroke");
    });

    it("returns true when glyph has closed contours", () => {
      const glyph = createGlyphWithHole();
      const result = renderGlyph(ctx, glyph);

      expect(result).toBe(true);
    });

    it("returns false when glyph has only open contours", () => {
      const glyph: Glyph = {
        name: "line",
        contours: [createOpenContour()],
        xAdvance: 100,
        unicode: 65,
        anchors: [],
        compositeContours: [],
        activeContourId: asContourId("line"),
      };
      const result = renderGlyph(ctx, glyph);

      expect(result).toBe(false);
    });
  });

  describe("winding order for fills", () => {
    it("all contours added to same path enables correct winding fill", () => {
      const glyph = createGlyphWithHole();
      const callOrder: string[] = [];

      ctx.beginPath = vi.fn(() => callOrder.push("beginPath"));
      ctx.closePath = vi.fn(() => callOrder.push("closePath"));
      ctx.stroke = vi.fn(() => callOrder.push("stroke"));

      renderGlyph(ctx, glyph);

      const beginPathIndex = callOrder.indexOf("beginPath");
      const strokeIndex = callOrder.indexOf("stroke");
      const closePathCalls = callOrder.filter((c) => c === "closePath").length;

      expect(closePathCalls).toBe(2);
      expect(beginPathIndex).toBe(0);
      expect(strokeIndex).toBe(callOrder.length - 1);
    });
  });
});
