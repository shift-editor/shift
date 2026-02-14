import { describe, it, expect, beforeEach } from "vitest";
import { Select } from ".";
import {
  getAllPoints,
  createMockToolContext,
  createToolMouseEvent,
  ToolEventSimulator,
  makeTestCoordinates,
  type MockToolContext,
} from "@/testing";
import { asAnchorId, type PointId } from "@shift/types";

describe("Select tool", () => {
  let select: Select;
  let sim: ToolEventSimulator;
  let ctx: MockToolContext;

  beforeEach(() => {
    ctx = createMockToolContext();
    select = new Select(ctx);
    sim = new ToolEventSimulator(select);
    sim.setReady();
  });

  describe("cursor", () => {
    it("returns copy cursor when Option held and hovering a point", () => {
      const pointId = ctx.edit.addPoint(100, 100, "onCurve", false);
      ctx.hover.setHoveredPoint(pointId);
      ctx.setCurrentModifiers({ shiftKey: false, altKey: true, metaKey: false });

      expect(select.$cursor.value).toEqual({ type: "copy" });
    });

    it("returns default when Option not held over point", () => {
      const pointId = ctx.edit.addPoint(100, 100, "onCurve", false);
      ctx.hover.setHoveredPoint(pointId);
      ctx.setCurrentModifiers({ shiftKey: false, altKey: false, metaKey: false });

      expect(select.$cursor.value).toEqual({ type: "default" });
    });
  });

  describe("state management", () => {
    it("should have correct name", () => {
      expect(select.name).toBe("select");
    });

    it("should start in idle state and transition to ready", () => {
      const newCtx = createMockToolContext();
      const newSelect = new Select(newCtx);
      const newSim = new ToolEventSimulator(newSelect);
      newSim.setIdle();
      newSim.setReady();
      expect(newSelect.name).toBe("select");
    });
  });

  describe("point selection", () => {
    beforeEach(() => {
      ctx.edit.addPoint(100, 100, "onCurve", false);
      ctx.edit.addPoint(200, 200, "onCurve", false);
      ctx.edit.addPoint(300, 300, "onCurve", false);
    });

    it("should select point when clicking on it", () => {
      const event = createToolMouseEvent(100, 100);
      sim.onMouseDown(event);
      expect(ctx.mocks.selection.selectPoints).toHaveBeenCalled();
    });

    it("should clear selection when clicking empty space", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));

      ctx.mocks.selection.mocks.selectPoints.mockClear();
      sim.onMouseDown(createToolMouseEvent(500, 500));
    });

    it("should update selection to clicked point", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));

      ctx.mocks.selection.mocks.selectPoints.mockClear();
      sim.onMouseDown(createToolMouseEvent(200, 200));

      expect(ctx.mocks.selection.selectPoints).toHaveBeenCalled();
    });

    it("should clear selection when in ready state with selection and clicking empty (e.g. after Cmd+A)", () => {
      const id1 = ctx.edit.addPoint(100, 100, "onCurve", false);
      ctx.edit.addPoint(200, 200, "onCurve", false);
      ctx.selection.selectPoints([id1]);
      ctx.mocks.selection.clear.mockClear();
      sim.click(500, 500);
      expect(ctx.mocks.selection.clear).toHaveBeenCalled();
    });
  });

  describe("toggle smooth", () => {
    it("should call toggleSmooth when double-clicking on-curve point", () => {
      const pointId = ctx.edit.addPoint(100, 100, "onCurve", false);
      ctx.mocks.edit.toggleSmooth.mockClear();
      select.handleEvent({
        type: "doubleClick",
        point: { x: 100, y: 100 },
        coords: makeTestCoordinates({ x: 100, y: 100 }),
      });
      expect(ctx.mocks.edit.toggleSmooth).toHaveBeenCalledWith(pointId);
    });

    it("should not call toggleSmooth when double-clicking empty space", () => {
      ctx.edit.addPoint(100, 100, "onCurve", false);
      ctx.mocks.edit.toggleSmooth.mockClear();
      select.handleEvent({
        type: "doubleClick",
        point: { x: 500, y: 500 },
        coords: makeTestCoordinates({ x: 500, y: 500 }),
      });
      expect(ctx.mocks.edit.toggleSmooth).not.toHaveBeenCalled();
    });
  });

  describe("moving points", () => {
    beforeEach(() => {
      ctx.edit.addPoint(100, 100, "onCurve", false);
    });

    it("should move selected point when dragging", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseMove(createToolMouseEvent(150, 150));

      const points = getAllPoints(ctx.edit.getGlyph());
      expect(points[0].x).toBe(150);
      expect(points[0].y).toBe(150);
    });

    it("should move point incrementally during drag", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));

      sim.onMouseMove(createToolMouseEvent(110, 110));
      let points = getAllPoints(ctx.edit.getGlyph());
      expect(points[0].x).toBe(110);
      expect(points[0].y).toBe(110);

      sim.onMouseMove(createToolMouseEvent(130, 130));
      points = getAllPoints(ctx.edit.getGlyph());
      expect(points[0].x).toBe(130);
      expect(points[0].y).toBe(130);
    });

    it("should use applySmartEdits when dragging", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      ctx.mocks.edit.mocks.applySmartEdits.mockClear();

      sim.onMouseMove(createToolMouseEvent(150, 150));

      expect(ctx.mocks.edit.applySmartEdits).toHaveBeenCalled();
    });

    it("should call applySmartEdits with selected points and delta", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      ctx.mocks.edit.mocks.applySmartEdits.mockClear();

      sim.onMouseMove(createToolMouseEvent(150, 160));

      expect(ctx.mocks.edit.applySmartEdits).toHaveBeenCalledWith(expect.any(Array), 50, 60);
    });
  });

  describe("rectangle selection", () => {
    beforeEach(() => {
      ctx.edit.addPoint(100, 100, "onCurve", false);
      ctx.edit.addPoint(150, 150, "onCurve", false);
      ctx.edit.addPoint(300, 300, "onCurve", false);
    });

    it("should select points within rectangle on mouse up", () => {
      sim.onMouseDown(createToolMouseEvent(50, 50));
      sim.onMouseMove(createToolMouseEvent(200, 200));
      sim.onMouseUp(createToolMouseEvent(200, 200));
      expect(ctx.mocks.selection.selectPoints).toHaveBeenCalled();
    });

    it("should set mode to committed when selection rectangle is released", () => {
      sim.onMouseDown(createToolMouseEvent(50, 50));
      sim.onMouseMove(createToolMouseEvent(200, 200));
      ctx.mocks.selection.mocks.setMode.mockClear();

      sim.onMouseUp(createToolMouseEvent(200, 200));
      expect(ctx.mocks.selection.setMode).toHaveBeenCalledWith("committed");
    });

    it("should transition from selecting to ready when no points in rectangle", () => {
      sim.onMouseDown(createToolMouseEvent(400, 400));
      sim.onMouseMove(createToolMouseEvent(450, 450));

      sim.onMouseUp(createToolMouseEvent(450, 450));

      expect(select.getState().type).toBe("ready");
    });

    it("should select points within rectangle on drag end", () => {
      sim.onMouseDown(createToolMouseEvent(50, 50));
      sim.onMouseMove(createToolMouseEvent(120, 120));
      ctx.mocks.selection.mocks.selectPoints.mockClear();

      sim.onMouseUp(createToolMouseEvent(120, 120));
      expect(ctx.mocks.selection.selectPoints).toHaveBeenCalled();
    });
  });

  describe("nudging points", () => {
    let pointId: PointId;

    beforeEach(() => {
      pointId = ctx.edit.addPoint(100, 100, "onCurve", false);
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
    });

    it("should nudge point right with ArrowRight", () => {
      sim.keyDown("ArrowRight");

      const points = getAllPoints(ctx.edit.getGlyph());
      expect(points[0].x).toBeGreaterThan(100);
    });

    it("should nudge point left with ArrowLeft", () => {
      sim.keyDown("ArrowLeft");

      const points = getAllPoints(ctx.edit.getGlyph());
      expect(points[0].x).toBeLessThan(100);
    });

    it("should nudge point up with ArrowUp", () => {
      sim.keyDown("ArrowUp");

      const points = getAllPoints(ctx.edit.getGlyph());
      expect(points[0].y).toBeGreaterThan(100);
    });

    it("should nudge point down with ArrowDown", () => {
      sim.keyDown("ArrowDown");

      const points = getAllPoints(ctx.edit.getGlyph());
      expect(points[0].y).toBeLessThan(100);
    });

    it("should nudge by larger amount with shift key", () => {
      const before = getAllPoints(ctx.edit.getGlyph())[0].x;

      sim.keyDown("ArrowRight");
      const afterSmall = getAllPoints(ctx.edit.getGlyph())[0].x;
      const smallNudge = afterSmall - before;

      ctx.fontEngine.editing.movePoints([pointId], { x: -smallNudge, y: 0 });

      sim.keyDown("ArrowRight", { shiftKey: true });
      const afterLarge = getAllPoints(ctx.edit.getGlyph())[0].x;
      const largeNudge = afterLarge - before;

      expect(largeNudge).toBeGreaterThan(smallNudge);
    });

    it("should nudge by largest amount with meta key", () => {
      const before = getAllPoints(ctx.edit.getGlyph())[0].x;

      sim.keyDown("ArrowRight", { metaKey: true });
      const after = getAllPoints(ctx.edit.getGlyph())[0].x;

      expect(after - before).toBeGreaterThan(1);
    });

    it("should only nudge when in selected state", () => {
      const newCtx = createMockToolContext();
      const newSelect = new Select(newCtx);
      const newSim = new ToolEventSimulator(newSelect);
      newCtx.edit.addPoint(100, 100, "onCurve", false);
      newSim.setReady();

      const before = getAllPoints(newCtx.edit.getGlyph())[0].x;

      newSim.keyDown("ArrowRight");

      const after = getAllPoints(newCtx.edit.getGlyph())[0].x;
      expect(after).toBe(before);
    });
  });

  describe("state transitions", () => {
    it("should transition state on mouse down", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      expect(select.getState().type).not.toBe("ready");
    });

    it("should update state on mouse move during selecting", () => {
      sim.onMouseDown(createToolMouseEvent(50, 50));
      const stateBefore = select.getState();
      sim.onMouseMove(createToolMouseEvent(100, 100));
      expect(select.getState()).not.toBe(stateBefore);
    });

    it("should execute nudge command", () => {
      ctx.edit.addPoint(100, 100, "onCurve", false);
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      ctx.mocks.commands.mocks.execute.mockClear();

      sim.keyDown("ArrowRight");
      expect(ctx.mocks.commands.execute).toHaveBeenCalled();
    });
  });

  describe("segment selection", () => {
    beforeEach(() => {
      ctx.edit.addPoint(100, 100, "onCurve", false);
      ctx.edit.addPoint(200, 200, "onCurve", false);
    });

    it("should select segment when clicking on it", () => {
      sim.onMouseDown(createToolMouseEvent(150, 150));
      expect(ctx.mocks.selection.selectPoints).toHaveBeenCalled();
    });

    it("should prefer point hit over segment hit", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      expect(ctx.mocks.selection.selectPoints).toHaveBeenCalled();
    });

    it("clears anchor selection on non-additive segment select", () => {
      ctx.selectAnchors([asAnchorId("a-segment")]);

      sim.click(150, 150);

      expect(ctx.getSelectedAnchors()).toEqual([]);
      expect(select.getState().type).toBe("selected");
    });
  });

  describe("segment shift-click", () => {
    beforeEach(() => {
      ctx.edit.addPoint(100, 100, "onCurve", false);
      ctx.edit.addPoint(200, 200, "onCurve", false);
      ctx.edit.addPoint(300, 100, "onCurve", false);
    });

    it("should transition to ready state when all segments are deselected", () => {
      sim.onMouseDown(createToolMouseEvent(100, 100));
      sim.onMouseUp(createToolMouseEvent(100, 100));
      expect(select.getState().type).toBe("selected");

      sim.onMouseDown(createToolMouseEvent(500, 500));
      sim.onMouseMove(createToolMouseEvent(550, 550));
      sim.onMouseUp(createToolMouseEvent(550, 550));

      expect(select.getState().type).toBe("ready");
    });

    it("stays selected when toggling off a point while an anchor remains selected", () => {
      sim.click(100, 100);
      expect(select.getState().type).toBe("selected");

      ctx.selectAnchors([asAnchorId("a-point-toggle")]);
      sim.click(100, 100, { shiftKey: true });

      expect(select.getState().type).toBe("selected");
      expect(ctx.getSelectedAnchors()).toEqual([asAnchorId("a-point-toggle")]);
    });

    it("stays selected when toggling off a segment while an anchor remains selected", () => {
      sim.click(200, 100);
      sim.click(150, 150);
      expect(select.getState().type).toBe("selected");

      ctx.selectAnchors([asAnchorId("a-segment-toggle")]);
      sim.click(150, 150, { shiftKey: true });

      expect(select.getState().type).toBe("selected");
      expect(ctx.getSelectedAnchors()).toEqual([asAnchorId("a-segment-toggle")]);
    });
  });

  describe("resize behavior", () => {
    beforeEach(() => {
      ctx.edit.addPoint(0, 0, "onCurve", false);
      ctx.edit.addPoint(100, 0, "onCurve", false);
      ctx.edit.addPoint(100, 100, "onCurve", false);
      ctx.edit.addPoint(0, 100, "onCurve", false);

      sim.onMouseDown(createToolMouseEvent(50, 50));
      sim.onMouseMove(createToolMouseEvent(120, 120));
      sim.onMouseUp(createToolMouseEvent(120, 120));
      expect(select.getState().type).toBe("selected");

      ctx.mocks.hitTest.mocks.getSelectionBoundingRect.mockReturnValue({
        left: 0,
        right: 100,
        top: 0,
        bottom: 100,
        width: 100,
        height: 100,
      });

      (ctx.hitTestBoundingBoxAt as ReturnType<typeof import("vitest").vi.fn>).mockReturnValue({
        type: "resize",
        edge: "right",
      });
    });

    it("should cancel preview before executing scale command", () => {
      sim.onMouseDown(createToolMouseEvent(110, 50));
      sim.onMouseMove(createToolMouseEvent(50, 50));

      const cancelCalls: number[] = [];
      const executeCalls: number[] = [];
      let callOrder = 0;

      ctx.mocks.preview.mocks.cancelPreview.mockImplementation(() => {
        cancelCalls.push(callOrder++);
      });
      ctx.mocks.commands.mocks.execute.mockImplementation((cmd: any) => {
        executeCalls.push(callOrder++);
        return cmd.execute?.({
          fontEngine: ctx.fontEngine,
          glyph: ctx.fontEngine.$glyph.value,
        });
      });

      sim.onMouseUp(createToolMouseEvent(50, 50));

      expect(cancelCalls.length).toBeGreaterThan(0);
      expect(executeCalls.length).toBeGreaterThan(0);
      expect(cancelCalls[0]).toBeLessThan(executeCalls[0]);
    });

    it("should begin preview when starting resize", () => {
      ctx.mocks.preview.mocks.beginPreview.mockClear();

      sim.onMouseDown(createToolMouseEvent(110, 50));

      expect(ctx.mocks.preview.beginPreview).toHaveBeenCalled();
    });

    it("should transition to resizing state when dragging from edge", () => {
      sim.onMouseDown(createToolMouseEvent(110, 50));

      expect(select.getState().type).toBe("resizing");
    });

    it("should return to selected state after resize completes", () => {
      sim.onMouseDown(createToolMouseEvent(110, 50));
      sim.onMouseMove(createToolMouseEvent(50, 50));
      sim.onMouseUp(createToolMouseEvent(50, 50));

      expect(select.getState().type).toBe("selected");
    });

    it("should cancel preview on resize dragCancel", () => {
      sim.onMouseDown(createToolMouseEvent(110, 50));
      sim.onMouseMove(createToolMouseEvent(50, 50));
      ctx.mocks.preview.mocks.cancelPreview.mockClear();

      select.handleEvent({ type: "dragCancel" });

      expect(ctx.mocks.preview.cancelPreview).toHaveBeenCalled();
    });
  });
});
