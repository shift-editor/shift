import { describe, it, expect, vi, beforeEach } from "vitest";

import { renderHandles } from "./handles";
import { DrawAPI } from "@/lib/tools/core/DrawAPI";
import type { IRenderer, HandleState, ScreenConverter } from "@/types/graphics";
import { asContourId, asPointId } from "@shift/types";
import type { Glyph, Contour, PointId, PointSnapshot } from "@shift/types";

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

function createMockScreen(): ScreenConverter {
  return {
    toUpmDistance: vi.fn((pixels: number) => pixels),
  };
}

function createDrawHarness() {
  const draw = new DrawAPI(createMockRenderer(), createMockScreen());
  return {
    draw,
    spies: {
      setStyle: vi.spyOn(draw, "setStyle"),
      line: vi.spyOn(draw, "line"),
      handle: vi.spyOn(draw, "handle"),
      handleFirst: vi.spyOn(draw, "handleFirst"),
      handleDirection: vi.spyOn(draw, "handleDirection"),
      handleLast: vi.spyOn(draw, "handleLast"),
    },
  };
}

function makePoint(
  id: string,
  x: number,
  y: number,
  pointType: PointSnapshot["pointType"] = "onCurve",
  smooth = false,
): PointSnapshot {
  return {
    id: asPointId(id),
    x,
    y,
    pointType,
    smooth,
  };
}

function createClosedTriangleContour(): Contour {
  return {
    id: asContourId("triangle"),
    closed: true,
    points: [makePoint("p1", 0, 0), makePoint("p2", 100, 0), makePoint("p3", 50, 100)],
  };
}

function makeGlyph(name: string, contours: Contour[], xAdvance = 100): Glyph {
  return {
    unicode: 65,
    name,
    xAdvance,
    contours,
    anchors: [],
    compositeContours: [],
    activeContourId: contours[0]?.id ?? null,
  };
}

describe("handles", () => {
  let draw: DrawAPI;
  let spies: ReturnType<typeof createDrawHarness>["spies"];

  beforeEach(() => {
    const harness = createDrawHarness();
    draw = harness.draw;
    spies = harness.spies;
  });

  describe("renderHandles", () => {
    it("calls setStyle with default styles", () => {
      const glyph = makeGlyph("A", [createClosedTriangleContour()]);

      renderHandles(draw, glyph, () => "idle");

      expect(spies.setStyle).toHaveBeenCalled();
    });

    it("first point of closed contour gets handleDirection", () => {
      const glyph = makeGlyph("A", [createClosedTriangleContour()]);

      renderHandles(draw, glyph, () => "idle");

      expect(spies.handleDirection).toHaveBeenCalledWith(
        { x: 0, y: 0 },
        expect.any(Number),
        "idle",
      );
    });

    it("non-first on-curve points of closed contour get handle with corner", () => {
      const glyph = makeGlyph("A", [createClosedTriangleContour()]);

      renderHandles(draw, glyph, () => "idle");

      expect(spies.handle).toHaveBeenCalledWith({ x: 100, y: 0 }, "corner", "idle");
      expect(spies.handle).toHaveBeenCalledWith({ x: 50, y: 100 }, "corner", "idle");
    });

    it("calls getHandleState for each point", () => {
      const glyph = makeGlyph("A", [createClosedTriangleContour()]);
      const getHandleState = vi.fn<(id: PointId) => HandleState>(() => "idle");

      renderHandles(draw, glyph, getHandleState);

      expect(getHandleState).toHaveBeenCalledTimes(3);
      expect(getHandleState).toHaveBeenCalledWith(asPointId("p1"));
      expect(getHandleState).toHaveBeenCalledWith(asPointId("p2"));
      expect(getHandleState).toHaveBeenCalledWith(asPointId("p3"));
    });

    it("passes handle state from getHandleState to draw methods", () => {
      const glyph = makeGlyph("A", [createClosedTriangleContour()]);
      const getHandleState = vi.fn<(id: PointId) => HandleState>((id) => {
        if (id === asPointId("p1")) return "selected";
        if (id === asPointId("p2")) return "hovered";
        return "idle";
      });

      renderHandles(draw, glyph, getHandleState);

      expect(spies.handleDirection).toHaveBeenCalledWith(
        { x: 0, y: 0 },
        expect.any(Number),
        "selected",
      );
      expect(spies.handle).toHaveBeenCalledWith({ x: 100, y: 0 }, "corner", "hovered");
      expect(spies.handle).toHaveBeenCalledWith({ x: 50, y: 100 }, "corner", "idle");
    });

    it("first point of open contour gets handleFirst", () => {
      const openContour: Contour = {
        id: asContourId("line-1"),
        closed: false,
        points: [makePoint("p1", 0, 0), makePoint("p2", 100, 0), makePoint("p3", 200, 0)],
      };
      const glyph = makeGlyph("line", [openContour], 200);

      renderHandles(draw, glyph, () => "idle");

      expect(spies.handleFirst).toHaveBeenCalledWith({ x: 0, y: 0 }, expect.any(Number), "idle");
    });

    it("last point of open contour gets handleLast", () => {
      const openContour: Contour = {
        id: asContourId("line-2"),
        closed: false,
        points: [makePoint("p1", 0, 0), makePoint("p2", 100, 0), makePoint("p3", 200, 0)],
      };
      const glyph = makeGlyph("line", [openContour], 200);

      renderHandles(draw, glyph, () => "idle");

      expect(spies.handleLast).toHaveBeenCalledWith(
        { anchor: { x: 200, y: 0 }, prev: { x: 100, y: 0 } },
        "idle",
      );
    });

    it("draws control point lines for off-curve points", () => {
      const contourWithCubic: Contour = {
        id: asContourId("cubic"),
        closed: true,
        points: [
          makePoint("p1", 0, 0),
          makePoint("c1", 30, 50, "offCurve"),
          makePoint("c2", 70, 50, "offCurve"),
          makePoint("p2", 100, 0),
        ],
      };
      const glyph = makeGlyph("curve", [contourWithCubic]);

      renderHandles(draw, glyph, () => "idle");

      expect(spies.line).toHaveBeenCalled();
    });

    it("smooth on-curve points get handle with smooth type", () => {
      const contour: Contour = {
        id: asContourId("smooth"),
        closed: true,
        points: [
          makePoint("p1", 0, 0),
          makePoint("p2", 50, 50, "onCurve", true),
          makePoint("p3", 100, 0),
        ],
      };
      const glyph = makeGlyph("smooth", [contour]);

      renderHandles(draw, glyph, () => "idle");

      expect(spies.handle).toHaveBeenCalledWith({ x: 50, y: 50 }, "smooth", "idle");
    });

    it("off-curve points get handle with control type", () => {
      const contour: Contour = {
        id: asContourId("quad"),
        closed: true,
        points: [
          makePoint("p1", 0, 0),
          makePoint("c1", 50, 50, "offCurve"),
          makePoint("p2", 100, 0),
        ],
      };
      const glyph = makeGlyph("quad", [contour]);

      renderHandles(draw, glyph, () => "idle");

      expect(spies.handle).toHaveBeenCalledWith({ x: 50, y: 50 }, "control", "idle");
    });

    it("single point contour gets handle with corner", () => {
      const contour: Contour = {
        id: asContourId("dot"),
        closed: false,
        points: [makePoint("p1", 50, 50)],
      };
      const glyph = makeGlyph("dot", [contour]);

      renderHandles(draw, glyph, () => "idle");

      expect(spies.handle).toHaveBeenCalledWith({ x: 50, y: 50 }, "corner", "idle");
    });

    it("skips empty contours", () => {
      const emptyContour: Contour = {
        id: asContourId("empty"),
        closed: true,
        points: [],
      };
      const glyph = makeGlyph("empty", [emptyContour]);

      renderHandles(draw, glyph, () => "idle");

      expect(spies.handle).not.toHaveBeenCalled();
      expect(spies.handleDirection).not.toHaveBeenCalled();
      expect(spies.handleFirst).not.toHaveBeenCalled();
      expect(spies.handleLast).not.toHaveBeenCalled();
    });
  });
});
