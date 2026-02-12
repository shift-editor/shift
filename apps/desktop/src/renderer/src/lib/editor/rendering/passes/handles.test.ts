import { describe, it, expect, vi, beforeEach } from "vitest";

import { renderHandles } from "./handles";
import type { IRenderer, HandleState } from "@/types/graphics";
import type { Glyph, Contour, PointId } from "@shift/types";
import type { DrawAPI } from "@/lib/tools/core/DrawAPI";

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

function createMockDraw() {
  return {
    setStyle: vi.fn(),
    line: vi.fn(),
    handle: vi.fn(),
    handleFirst: vi.fn(),
    handleDirection: vi.fn(),
    handleLast: vi.fn(),
    renderer: createMockRenderer(),
  } as unknown as DrawAPI;
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

describe("handles", () => {
  let draw: DrawAPI;

  beforeEach(() => {
    draw = createMockDraw();
  });

  describe("renderHandles", () => {
    it("calls setStyle with default styles", () => {
      const glyph: Glyph = {
        name: "A",
        contours: [createClosedTriangleContour()],
        xAdvance: 100,
      };

      renderHandles(draw, glyph, () => "idle");

      expect((draw as any).setStyle).toHaveBeenCalled();
    });

    it("first point of closed contour gets handleDirection", () => {
      const glyph: Glyph = {
        name: "A",
        contours: [createClosedTriangleContour()],
        xAdvance: 100,
      };

      renderHandles(draw, glyph, () => "idle");

      expect((draw as any).handleDirection).toHaveBeenCalledWith(
        { x: 0, y: 0 },
        expect.any(Number),
        "idle",
      );
    });

    it("non-first on-curve points of closed contour get handle with corner", () => {
      const glyph: Glyph = {
        name: "A",
        contours: [createClosedTriangleContour()],
        xAdvance: 100,
      };

      renderHandles(draw, glyph, () => "idle");

      expect((draw as any).handle).toHaveBeenCalledWith({ x: 100, y: 0 }, "corner", "idle");
      expect((draw as any).handle).toHaveBeenCalledWith({ x: 50, y: 100 }, "corner", "idle");
    });

    it("calls getHandleState for each point", () => {
      const glyph: Glyph = {
        name: "A",
        contours: [createClosedTriangleContour()],
        xAdvance: 100,
      };
      const getHandleState = vi.fn<(id: PointId) => HandleState>(() => "idle");

      renderHandles(draw, glyph, getHandleState);

      expect(getHandleState).toHaveBeenCalledTimes(3);
      expect(getHandleState).toHaveBeenCalledWith(1);
      expect(getHandleState).toHaveBeenCalledWith(2);
      expect(getHandleState).toHaveBeenCalledWith(3);
    });

    it("passes handle state from getHandleState to draw methods", () => {
      const glyph: Glyph = {
        name: "A",
        contours: [createClosedTriangleContour()],
        xAdvance: 100,
      };
      const getHandleState = vi.fn<(id: PointId) => HandleState>((id) => {
        if (id === 1) return "selected";
        if (id === 2) return "hovered";
        return "idle";
      });

      renderHandles(draw, glyph, getHandleState);

      expect((draw as any).handleDirection).toHaveBeenCalledWith(
        { x: 0, y: 0 },
        expect.any(Number),
        "selected",
      );
      expect((draw as any).handle).toHaveBeenCalledWith({ x: 100, y: 0 }, "corner", "hovered");
      expect((draw as any).handle).toHaveBeenCalledWith({ x: 50, y: 100 }, "corner", "idle");
    });

    it("first point of open contour gets handleFirst", () => {
      const openContour: Contour = {
        id: 0,
        closed: false,
        points: [
          { id: 1, x: 0, y: 0, pointType: "onCurve", smooth: false },
          { id: 2, x: 100, y: 0, pointType: "onCurve", smooth: false },
          { id: 3, x: 200, y: 0, pointType: "onCurve", smooth: false },
        ],
      };
      const glyph: Glyph = {
        name: "line",
        contours: [openContour],
        xAdvance: 200,
      };

      renderHandles(draw, glyph, () => "idle");

      expect((draw as any).handleFirst).toHaveBeenCalledWith(
        { x: 0, y: 0 },
        expect.any(Number),
        "idle",
      );
    });

    it("last point of open contour gets handleLast", () => {
      const openContour: Contour = {
        id: 0,
        closed: false,
        points: [
          { id: 1, x: 0, y: 0, pointType: "onCurve", smooth: false },
          { id: 2, x: 100, y: 0, pointType: "onCurve", smooth: false },
          { id: 3, x: 200, y: 0, pointType: "onCurve", smooth: false },
        ],
      };
      const glyph: Glyph = {
        name: "line",
        contours: [openContour],
        xAdvance: 200,
      };

      renderHandles(draw, glyph, () => "idle");

      expect((draw as any).handleLast).toHaveBeenCalledWith(
        { anchor: { x: 200, y: 0 }, prev: { x: 100, y: 0 } },
        "idle",
      );
    });

    it("draws control point lines for off-curve points", () => {
      const contourWithCubic: Contour = {
        id: 0,
        closed: true,
        points: [
          { id: 1, x: 0, y: 0, pointType: "onCurve", smooth: false },
          { id: 2, x: 30, y: 50, pointType: "offCurve", smooth: false },
          { id: 3, x: 70, y: 50, pointType: "offCurve", smooth: false },
          { id: 4, x: 100, y: 0, pointType: "onCurve", smooth: false },
        ],
      };
      const glyph: Glyph = {
        name: "curve",
        contours: [contourWithCubic],
        xAdvance: 100,
      };

      renderHandles(draw, glyph, () => "idle");

      expect((draw as any).line).toHaveBeenCalled();
    });

    it("smooth on-curve points get handle with smooth type", () => {
      const contour: Contour = {
        id: 0,
        closed: true,
        points: [
          { id: 1, x: 0, y: 0, pointType: "onCurve", smooth: false },
          { id: 2, x: 50, y: 50, pointType: "onCurve", smooth: true },
          { id: 3, x: 100, y: 0, pointType: "onCurve", smooth: false },
        ],
      };
      const glyph: Glyph = {
        name: "smooth",
        contours: [contour],
        xAdvance: 100,
      };

      renderHandles(draw, glyph, () => "idle");

      expect((draw as any).handle).toHaveBeenCalledWith({ x: 50, y: 50 }, "smooth", "idle");
    });

    it("off-curve points get handle with control type", () => {
      const contour: Contour = {
        id: 0,
        closed: true,
        points: [
          { id: 1, x: 0, y: 0, pointType: "onCurve", smooth: false },
          { id: 2, x: 50, y: 50, pointType: "offCurve", smooth: false },
          { id: 3, x: 100, y: 0, pointType: "onCurve", smooth: false },
        ],
      };
      const glyph: Glyph = {
        name: "quad",
        contours: [contour],
        xAdvance: 100,
      };

      renderHandles(draw, glyph, () => "idle");

      expect((draw as any).handle).toHaveBeenCalledWith({ x: 50, y: 50 }, "control", "idle");
    });

    it("single point contour gets handle with corner", () => {
      const contour: Contour = {
        id: 0,
        closed: false,
        points: [{ id: 1, x: 50, y: 50, pointType: "onCurve", smooth: false }],
      };
      const glyph: Glyph = {
        name: "dot",
        contours: [contour],
        xAdvance: 100,
      };

      renderHandles(draw, glyph, () => "idle");

      expect((draw as any).handle).toHaveBeenCalledWith({ x: 50, y: 50 }, "corner", "idle");
    });

    it("skips empty contours", () => {
      const emptyContour: Contour = {
        id: 0,
        closed: true,
        points: [],
      };
      const glyph: Glyph = {
        name: "empty",
        contours: [emptyContour],
        xAdvance: 100,
      };

      renderHandles(draw, glyph, () => "idle");

      expect((draw as any).handle).not.toHaveBeenCalled();
      expect((draw as any).handleDirection).not.toHaveBeenCalled();
      expect((draw as any).handleFirst).not.toHaveBeenCalled();
      expect((draw as any).handleLast).not.toHaveBeenCalled();
    });
  });
});
