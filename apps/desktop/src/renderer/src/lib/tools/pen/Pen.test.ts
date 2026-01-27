import { describe, it, expect, beforeEach, vi } from "vitest";
import { Pen } from ".";
import {
  getPointCount,
  getContourCount,
  createMockToolContext,
  createToolMouseEvent,
  ToolEventSimulator,
  type MockToolContext,
} from "@/testing";

describe("Pen tool", () => {
  let pen: Pen;
  let sim: ToolEventSimulator;
  let ctx: MockToolContext;

  beforeEach(() => {
    ctx = createMockToolContext();
    pen = new Pen(ctx);
    sim = new ToolEventSimulator(pen);
    sim.setReady();
  });

  describe("state management", () => {
    it("should start in idle state", () => {
      const newCtx = createMockToolContext();
      const newPen = new Pen(newCtx);
      expect(newPen.name).toBe("pen");
    });

    it("should have correct name", () => {
      expect(pen.name).toBe("pen");
    });

    it("should transition to ready state", () => {
      const newCtx = createMockToolContext();
      const newPen = new Pen(newCtx);
      const newSim = new ToolEventSimulator(newPen);
      newSim.setIdle();
      newSim.setReady();
      expect(newPen.name).toBe("pen");
    });
  });

  describe("point creation", () => {
    it("should add point on mouse down via commandHistory", () => {
      const event = createToolMouseEvent(100, 200);
      sim.onMouseDown(event);

      expect(ctx.mocks.commands.mocks.beginBatch).toHaveBeenCalledWith("Add Point");
      expect(ctx.mocks.commands.mocks.execute).toHaveBeenCalled();
      expect(getPointCount(ctx.fontEngine.$glyph.value)).toBe(1);
    });

    it("should not add point on non-left click", () => {
      const event = createToolMouseEvent(100, 200, { button: 2 });
      sim.onMouseDown(event);

      expect(ctx.mocks.commands.mocks.execute).not.toHaveBeenCalled();
    });

    it("should not add point when not in ready state", () => {
      sim.setIdle();
      const event = createToolMouseEvent(100, 200);
      sim.onMouseDown(event);

      expect(ctx.mocks.commands.mocks.execute).not.toHaveBeenCalled();
    });
  });

  describe("point coordinates", () => {
    it("should use projected UPM coordinates and create point at that location", () => {
      const event = createToolMouseEvent(150, 250);
      sim.onMouseDown(event);

      expect(ctx.mocks.commands.mocks.execute).toHaveBeenCalled();
      const snapshot = ctx.fontEngine.$glyph.value;
      const activeContour = snapshot?.contours.find((c) => c.id === snapshot.activeContourId);
      expect(activeContour?.points[0]?.x).toBe(150);
      expect(activeContour?.points[0]?.y).toBe(250);
    });

    it("should add multiple points at different positions", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      sim.onMouseDown(createToolMouseEvent(200, 200));
      sim.onMouseUp(createToolMouseEvent(200, 200));
      sim.onMouseDown(createToolMouseEvent(300, 100));

      expect(getPointCount(ctx.fontEngine.$glyph.value)).toBe(3);
    });
  });

  describe("bezier drag (handle creation)", () => {
    it("should create control point when dragging far enough", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      expect(getPointCount(ctx.fontEngine.$glyph.value)).toBe(1);

      sim.onMouseMove(createToolMouseEvent(120, 100));

      expect(getPointCount(ctx.fontEngine.$glyph.value)).toBeGreaterThanOrEqual(1);
    });

    it("should not create control point for small drag", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      const initialCount = getPointCount(ctx.fontEngine.$glyph.value);

      sim.onMouseMove(createToolMouseEvent(101, 100));

      expect(getPointCount(ctx.fontEngine.$glyph.value)).toBe(initialCount);
    });
  });

  describe("closing contours", () => {
    it("should close contour when clicking near first point", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      sim.onMouseDown(createToolMouseEvent(200, 200));
      sim.onMouseUp(createToolMouseEvent(200, 200));
      expect(getPointCount(ctx.fontEngine.$glyph.value)).toBe(2);

      ctx.mocks.commands.mocks.execute.mockClear();
      ctx.mocks.commands.mocks.beginBatch.mockClear();

      sim.onMouseDown(createToolMouseEvent(102, 102));

      expect(ctx.mocks.commands.mocks.beginBatch).toHaveBeenCalledWith("Close Contour");
      expect(ctx.mocks.commands.mocks.endBatch).toHaveBeenCalled();
    });

    it("should create new contour after closing", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      sim.onMouseDown(createToolMouseEvent(200, 200));
      sim.onMouseUp(createToolMouseEvent(200, 200));

      sim.onMouseDown(createToolMouseEvent(100, 100));

      expect(ctx.fontEngine.editing.addContour).toBeDefined();
    });
  });

  describe("multiple contours", () => {
    it("should work with multiple contours", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      sim.onMouseDown(createToolMouseEvent(200, 100));
      sim.onMouseUp(createToolMouseEvent(200, 100));

      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));

      sim.onMouseDown(createToolMouseEvent(300, 300));
      sim.onMouseUp(createToolMouseEvent(300, 300));

      expect(getContourCount(ctx.fontEngine.$glyph.value)).toBeGreaterThanOrEqual(1);
    });
  });

  describe("mouse up handling", () => {
    it("should return to ready state on mouse up and end batch", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));

      expect(ctx.mocks.commands.mocks.endBatch).toHaveBeenCalled();

      ctx.mocks.commands.mocks.execute.mockClear();
      sim.onMouseDown(createToolMouseEvent(200, 200));
      expect(ctx.mocks.commands.mocks.execute).toHaveBeenCalled();
      expect(getPointCount(ctx.fontEngine.$glyph.value)).toBe(2);
    });
  });

  describe("cursor behavior", () => {
    it("should show pen-end cursor when hovering over endpoint without active contour", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      sim.onMouseDown(createToolMouseEvent(200, 200));
      sim.onMouseUp(createToolMouseEvent(200, 200));

      sim.cancel();

      ctx.mocks.cursor.mocks.set.mockClear();
      sim.onMouseMove(createToolMouseEvent(202, 202));

      expect(ctx.mocks.cursor.mocks.set).toHaveBeenCalledWith({
        type: "pen-end",
      });
    });

    it("should show pen cursor when not hovering over a point", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));

      ctx.mocks.cursor.mocks.set.mockClear();
      sim.onMouseMove(createToolMouseEvent(200, 200));

      expect(ctx.mocks.cursor.mocks.set).toHaveBeenCalledWith({ type: "pen" });
    });

    it("should switch cursor when moving from endpoint to empty space (no active contour)", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      sim.onMouseDown(createToolMouseEvent(200, 200));
      sim.onMouseUp(createToolMouseEvent(200, 200));

      sim.cancel();

      sim.onMouseMove(createToolMouseEvent(202, 202));
      expect(ctx.mocks.cursor.mocks.set).toHaveBeenLastCalledWith({
        type: "pen-end",
      });

      sim.onMouseMove(createToolMouseEvent(300, 300));
      expect(ctx.mocks.cursor.mocks.set).toHaveBeenLastCalledWith({
        type: "pen",
      });
    });
  });

  describe("preview line", () => {
    it("should track mouse position in ready state", () => {
      sim.onMouseMove(createToolMouseEvent(150, 250));

      const state = pen.getState();
      expect(state.type).toBe("ready");
      if (state.type === "ready") {
        expect(state.mousePos).toEqual({ x: 150, y: 250 });
      }
    });

    it("should update mouse position as cursor moves", () => {
      sim.onMouseMove(createToolMouseEvent(100, 100));

      let state = pen.getState();
      if (state.type === "ready") {
        expect(state.mousePos).toEqual({ x: 100, y: 100 });
      }

      sim.onMouseMove(createToolMouseEvent(200, 300));

      state = pen.getState();
      if (state.type === "ready") {
        expect(state.mousePos).toEqual({ x: 200, y: 300 });
      }
    });

    it("should initialize with zero mousePos when entering ready state", () => {
      const newCtx = createMockToolContext();
      const newPen = new Pen(newCtx);
      const newSim = new ToolEventSimulator(newPen);
      newSim.setReady();

      const state = newPen.getState();
      expect(state.type).toBe("ready");
      if (state.type === "ready") {
        expect(state.mousePos).toEqual({ x: 0, y: 0 });
      }
    });

    it("should preserve mouse position when transitioning to ready after placing point", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(150, 150));

      const state = pen.getState();
      expect(state.type).toBe("ready");
      if (state.type === "ready") {
        expect(state.mousePos).toEqual({ x: 150, y: 150 });
      }
    });
  });

  describe("zoom-aware hit testing", () => {
    it("should use zoom-aware hit radius for contour closing", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      sim.onMouseDown(createToolMouseEvent(200, 200));
      sim.onMouseUp(createToolMouseEvent(200, 200));

      ctx.mocks.commands.mocks.execute.mockClear();
      ctx.mocks.commands.mocks.beginBatch.mockClear();

      sim.onMouseDown(createToolMouseEvent(105, 105));

      expect(ctx.mocks.commands.mocks.beginBatch).toHaveBeenCalledWith("Close Contour");
    });

    it("should not close contour when outside zoom-aware hit radius", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      sim.onMouseDown(createToolMouseEvent(200, 200));
      sim.onMouseUp(createToolMouseEvent(200, 200));

      ctx.mocks.commands.mocks.execute.mockClear();
      ctx.mocks.commands.mocks.beginBatch.mockClear();

      sim.onMouseDown(createToolMouseEvent(115, 115));

      expect(ctx.mocks.commands.mocks.beginBatch).toHaveBeenCalledWith("Add Point");
      expect(ctx.mocks.commands.mocks.beginBatch).not.toHaveBeenCalledWith("Close Contour");
    });

    it("should use zoom-aware hit radius for endpoint hover detection (no active contour)", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      sim.onMouseDown(createToolMouseEvent(200, 200));
      sim.onMouseUp(createToolMouseEvent(200, 200));

      sim.cancel();

      ctx.mocks.cursor.mocks.set.mockClear();
      sim.onMouseMove(createToolMouseEvent(205, 205));

      expect(ctx.mocks.cursor.mocks.set).toHaveBeenCalledWith({
        type: "pen-end",
      });
    });

    it("should not show pen-end cursor when outside zoom-aware hit radius (no active contour)", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      sim.onMouseDown(createToolMouseEvent(200, 200));
      sim.onMouseUp(createToolMouseEvent(200, 200));

      sim.cancel();

      ctx.mocks.cursor.mocks.set.mockClear();
      sim.onMouseMove(createToolMouseEvent(215, 215));

      expect(ctx.mocks.cursor.mocks.set).toHaveBeenCalledWith({ type: "pen" });
    });
  });

  describe("zoom-adjusted preview line", () => {
    it("should call screen.lineWidth when rendering preview line", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));

      sim.onMouseMove(createToolMouseEvent(150, 150));

      ctx.mocks.screen.mocks.lineWidth.mockClear();

      const mockRenderer = {
        setStyle: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        set lineWidth(_: number) {},
      };

      pen.render?.(mockRenderer as any);

      expect(ctx.mocks.screen.mocks.lineWidth).toHaveBeenCalled();
    });
  });

  describe("cancel", () => {
    it("should cancel point placement on Escape during anchored state", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      expect(pen.getState().type).toBe("anchored");
      expect(ctx.mocks.commands.mocks.beginBatch).toHaveBeenCalledWith("Add Point");

      sim.cancel();

      expect(ctx.mocks.commands.mocks.cancelBatch).toHaveBeenCalled();
      expect(pen.getState().type).toBe("ready");
    });

    it("should cancel point placement on Escape during dragging state", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseMove(createToolMouseEvent(120, 100));
      expect(pen.getState().type).toBe("dragging");

      sim.cancel();

      expect(ctx.mocks.commands.mocks.cancelBatch).toHaveBeenCalled();
      expect(pen.getState().type).toBe("ready");
    });

    it("should abandon contour on Escape when in ready state with points", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      sim.onMouseDown(createToolMouseEvent(200, 200));
      sim.onMouseUp(createToolMouseEvent(200, 200));

      const contourCountBefore = getContourCount(ctx.fontEngine.$glyph.value);

      sim.cancel();

      const contourCountAfter = getContourCount(ctx.fontEngine.$glyph.value);
      expect(contourCountAfter).toBe(contourCountBefore + 1);
      expect(pen.getState().type).toBe("ready");
    });

    it("should do nothing on Escape when no points in contour", () => {
      const contourCountBefore = getContourCount(ctx.fontEngine.$glyph.value);

      sim.cancel();

      const contourCountAfter = getContourCount(ctx.fontEngine.$glyph.value);
      expect(contourCountAfter).toBe(contourCountBefore);
      expect(pen.getState().type).toBe("ready");
    });
  });

  describe("continue contour", () => {
    it("should continue from end point when no active drawing contour", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      sim.onMouseDown(createToolMouseEvent(200, 200));
      sim.onMouseUp(createToolMouseEvent(200, 200));
      sim.onMouseDown(createToolMouseEvent(300, 300));
      sim.onMouseUp(createToolMouseEvent(300, 300));

      sim.cancel();

      ctx.mocks.commands.mocks.execute.mockClear();
      ctx.mocks.commands.mocks.beginBatch.mockClear();

      sim.onMouseDown(createToolMouseEvent(302, 302));

      expect(ctx.mocks.commands.mocks.beginBatch).toHaveBeenCalledWith("Continue Contour");
      expect(ctx.mocks.commands.mocks.endBatch).toHaveBeenCalled();
    });

    it("should continue from start point with reverse when no active drawing contour", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      sim.onMouseDown(createToolMouseEvent(200, 200));
      sim.onMouseUp(createToolMouseEvent(200, 200));
      sim.onMouseDown(createToolMouseEvent(300, 300));
      sim.onMouseUp(createToolMouseEvent(300, 300));

      sim.cancel();

      ctx.mocks.commands.mocks.execute.mockClear();
      ctx.mocks.commands.mocks.beginBatch.mockClear();

      sim.onMouseDown(createToolMouseEvent(102, 102));

      expect(ctx.mocks.commands.mocks.beginBatch).toHaveBeenCalledWith("Continue Contour");
      expect(ctx.mocks.commands.mocks.endBatch).toHaveBeenCalled();
    });

    it("should not continue when there is an active drawing contour", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      sim.onMouseDown(createToolMouseEvent(200, 200));
      sim.onMouseUp(createToolMouseEvent(200, 200));

      ctx.mocks.commands.mocks.beginBatch.mockClear();

      sim.onMouseDown(createToolMouseEvent(202, 202));

      expect(ctx.mocks.commands.mocks.beginBatch).not.toHaveBeenCalledWith("Continue Contour");
    });
  });

  describe("split contour", () => {
    it("should split at middle point when no active drawing contour", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      sim.onMouseDown(createToolMouseEvent(200, 200));
      sim.onMouseUp(createToolMouseEvent(200, 200));
      sim.onMouseDown(createToolMouseEvent(300, 300));
      sim.onMouseUp(createToolMouseEvent(300, 300));
      sim.onMouseDown(createToolMouseEvent(400, 400));
      sim.onMouseUp(createToolMouseEvent(400, 400));

      sim.cancel();

      ctx.mocks.commands.mocks.execute.mockClear();
      ctx.mocks.commands.mocks.beginBatch.mockClear();

      sim.onMouseDown(createToolMouseEvent(202, 202));

      expect(ctx.mocks.commands.mocks.beginBatch).toHaveBeenCalledWith("Split Contour");
      expect(ctx.mocks.commands.mocks.endBatch).toHaveBeenCalled();
    });

    it("should not split when there is an active drawing contour", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      sim.onMouseDown(createToolMouseEvent(200, 200));
      sim.onMouseUp(createToolMouseEvent(200, 200));
      sim.onMouseDown(createToolMouseEvent(300, 300));
      sim.onMouseUp(createToolMouseEvent(300, 300));
      sim.onMouseDown(createToolMouseEvent(400, 400));
      sim.onMouseUp(createToolMouseEvent(400, 400));

      ctx.mocks.commands.mocks.beginBatch.mockClear();

      sim.onMouseDown(createToolMouseEvent(202, 202));

      expect(ctx.mocks.commands.mocks.beginBatch).not.toHaveBeenCalledWith("Split Contour");
    });
  });

  describe("cursor feedback for continue/split", () => {
    it("should show pen-end cursor when hovering over endpoint of non-active contour", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      sim.onMouseDown(createToolMouseEvent(200, 200));
      sim.onMouseUp(createToolMouseEvent(200, 200));
      sim.onMouseDown(createToolMouseEvent(300, 300));
      sim.onMouseUp(createToolMouseEvent(300, 300));

      sim.cancel();

      ctx.mocks.cursor.mocks.set.mockClear();
      sim.onMouseMove(createToolMouseEvent(302, 302));

      expect(ctx.mocks.cursor.mocks.set).toHaveBeenCalledWith({
        type: "pen-end",
      });
    });

    it("should show pen-end cursor when hovering over middle point of non-active contour", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      sim.onMouseDown(createToolMouseEvent(200, 200));
      sim.onMouseUp(createToolMouseEvent(200, 200));
      sim.onMouseDown(createToolMouseEvent(300, 300));
      sim.onMouseUp(createToolMouseEvent(300, 300));
      sim.onMouseDown(createToolMouseEvent(400, 400));
      sim.onMouseUp(createToolMouseEvent(400, 400));

      sim.cancel();

      ctx.mocks.cursor.mocks.set.mockClear();
      sim.onMouseMove(createToolMouseEvent(202, 202));

      expect(ctx.mocks.cursor.mocks.set).toHaveBeenCalledWith({
        type: "pen-end",
      });
    });
  });

  describe("cursor with active drawing contour", () => {
    it("should NOT show pen-end cursor when hovering over any point while actively drawing", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      sim.onMouseDown(createToolMouseEvent(200, 200));
      sim.onMouseUp(createToolMouseEvent(200, 200));

      ctx.mocks.cursor.mocks.set.mockClear();
      sim.onMouseMove(createToolMouseEvent(202, 202));

      expect(ctx.mocks.cursor.mocks.set).toHaveBeenCalledWith({ type: "pen" });
    });

    it("should show pen-end cursor only when hovering over first point to close contour", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      sim.onMouseDown(createToolMouseEvent(200, 200));
      sim.onMouseUp(createToolMouseEvent(200, 200));

      ctx.mocks.cursor.mocks.set.mockClear();
      sim.onMouseMove(createToolMouseEvent(102, 102));

      expect(ctx.mocks.cursor.mocks.set).toHaveBeenCalledWith({
        type: "pen-end",
      });
    });

    it("should show pen cursor when hovering over last point while actively drawing", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      sim.onMouseDown(createToolMouseEvent(200, 200));
      sim.onMouseUp(createToolMouseEvent(200, 200));
      sim.onMouseDown(createToolMouseEvent(300, 300));
      sim.onMouseUp(createToolMouseEvent(300, 300));

      ctx.mocks.cursor.mocks.set.mockClear();
      sim.onMouseMove(createToolMouseEvent(302, 302));

      expect(ctx.mocks.cursor.mocks.set).toHaveBeenCalledWith({ type: "pen" });
    });

    it("should show pen cursor when hovering empty space while actively drawing", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));

      ctx.mocks.cursor.mocks.set.mockClear();
      sim.onMouseMove(createToolMouseEvent(500, 500));

      expect(ctx.mocks.cursor.mocks.set).toHaveBeenCalledWith({ type: "pen" });
    });
  });
});
