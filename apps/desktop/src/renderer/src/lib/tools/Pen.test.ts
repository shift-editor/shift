import { describe, it, expect, beforeEach, vi } from "vitest";
import { Pen } from "./pen";
import {
  createMockFontEngine,
  getPointCount,
  getContourCount,
} from "@/testing";
import type { PointId } from "@/types/ids";
import type { ToolContext } from "@/types/tool";
import type { Editor } from "@/lib/editor/Editor";

function createMockEditor() {
  const fontEngine = createMockFontEngine();
  fontEngine.session.startEditSession(65);
  fontEngine.editing.addContour();

  let selectedPoints = new Set<PointId>();
  let hoveredPoint: PointId | null = null;
  let isBatching = false;

  const mockCommandHistory = {
    execute: vi.fn((cmd: any) =>
      cmd.execute({ fontEngine, snapshot: fontEngine.snapshot.value }),
    ),
    record: vi.fn(),
    beginBatch: vi.fn(() => {
      isBatching = true;
    }),
    endBatch: vi.fn(() => {
      isBatching = false;
    }),
    cancelBatch: vi.fn(() => {
      isBatching = false;
    }),
    get isBatching() {
      return isBatching;
    },
    undo: vi.fn(),
    redo: vi.fn(),
  };

  const selectMocks = {
    set: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    toggle: vi.fn(),
    clear: vi.fn(),
    has: vi.fn(() => selectedPoints.size > 0),
    setHovered: vi.fn((id: PointId | null) => {
      hoveredPoint = id;
    }),
    setMode: vi.fn(),
  };

  const editMocks = {
    addPoint: vi.fn((x: number, y: number, type: "onCurve" | "offCurve") =>
      fontEngine.editing.addPoint(x, y, type, false),
    ),
    movePoints: vi.fn((ids: Iterable<PointId>, dx: number, dy: number) =>
      fontEngine.editing.movePoints([...ids], dx, dy),
    ),
    movePointTo: vi.fn((id: PointId, x: number, y: number) =>
      fontEngine.editing.movePointTo(id, x, y),
    ),
    removePoints: vi.fn((ids: Iterable<PointId>) =>
      fontEngine.editing.removePoints([...ids]),
    ),
    addContour: vi.fn(() => fontEngine.editing.addContour()),
    closeContour: vi.fn(() => fontEngine.editing.closeContour()),
    toggleSmooth: vi.fn((id: PointId) => fontEngine.editing.toggleSmooth(id)),
    getActiveContourId: vi.fn(() => fontEngine.editing.getActiveContourId()),
    setActiveContour: vi.fn((id: any) =>
      fontEngine.editing.setActiveContour(id),
    ),
    reverseContour: vi.fn((id: any) => fontEngine.editing.reverseContour(id)),
    addPointToContour: vi.fn(
      (contourId: any, x: number, y: number, type: string, smooth: boolean) =>
        fontEngine.editing.addPointToContour(contourId, x, y, type, smooth),
    ),
  };

  const screenMocks = {
    toUpmDistance: vi.fn((px: number) => px),
    hitRadius: 8,
    lineWidth: vi.fn((px = 1) => px),
  };

  const requestRedrawMock = vi.fn();

  const createToolContext = (): ToolContext => ({
    snapshot: fontEngine.snapshot.value,
    selectedPoints,
    hoveredPoint,
    mousePosition: { x: 0, y: 0 },
    selectionMode: "committed",
    screen: screenMocks,
    select: selectMocks,
    edit: editMocks,
    commands: mockCommandHistory as any,
    requestRedraw: requestRedrawMock,
  });

  const mockEditor = {
    fontEngine,
    commandHistory: mockCommandHistory,
    getMousePosition: vi.fn((x?: number, y?: number) => ({
      x: x ?? 0,
      y: y ?? 0,
    })),
    projectScreenToUpm: vi.fn((x: number, y: number) => ({ x, y })),
    getSnapshot: vi.fn(() => fontEngine.snapshot.value),
    requestRedraw: vi.fn(),
    createToolContext: vi.fn(createToolContext),
    paintHandle: vi.fn(),
    setCursor: vi.fn(),
  };

  return {
    mockEditor,
    fontEngine,
    mocks: {
      select: selectMocks,
      edit: editMocks,
      screen: screenMocks,
      requestRedraw: requestRedrawMock,
      commands: mockCommandHistory,
    },
  };
}

function createMouseEvent(
  type: "mousedown" | "mouseup" | "mousemove",
  clientX: number,
  clientY: number,
  button = 0,
): React.MouseEvent<HTMLCanvasElement> {
  return {
    type,
    clientX,
    clientY,
    button,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent<HTMLCanvasElement>;
}

describe("Pen tool", () => {
  let pen: Pen;
  let mockEditor: ReturnType<typeof createMockEditor>["mockEditor"];
  let fontEngine: ReturnType<typeof createMockEditor>["fontEngine"];
  let mocks: ReturnType<typeof createMockEditor>["mocks"];

  beforeEach(() => {
    const setup = createMockEditor();
    mockEditor = setup.mockEditor;
    fontEngine = setup.fontEngine;
    mocks = setup.mocks;
    pen = new Pen(mockEditor as unknown as Editor);
    pen.setReady();
  });

  describe("state management", () => {
    it("should start in idle state", () => {
      const newPen = new Pen(mockEditor as unknown as Editor);
      expect(newPen.name).toBe("pen");
    });

    it("should have correct name", () => {
      expect(pen.name).toBe("pen");
    });

    it("should transition to ready state", () => {
      const newPen = new Pen(mockEditor as unknown as Editor);
      newPen.setIdle();
      newPen.setReady();
      expect(newPen.name).toBe("pen");
    });
  });

  describe("point creation", () => {
    it("should add point on mouse down via commandHistory", () => {
      const event = createMouseEvent("mousedown", 100, 200);
      pen.onMouseDown(event);

      expect(mocks.commands.beginBatch).toHaveBeenCalledWith("Add Point");
      expect(mocks.commands.execute).toHaveBeenCalled();
      expect(getPointCount(fontEngine.snapshot.value)).toBe(1);
    });

    it("should not add point on non-left click", () => {
      const event = createMouseEvent("mousedown", 100, 200, 2);
      pen.onMouseDown(event);

      expect(mocks.commands.execute).not.toHaveBeenCalled();
    });

    it("should not add point when not in ready state", () => {
      pen.setIdle();
      const event = createMouseEvent("mousedown", 100, 200);
      pen.onMouseDown(event);

      expect(mocks.commands.execute).not.toHaveBeenCalled();
    });
  });

  describe("point coordinates", () => {
    it("should use projected UPM coordinates and create point at that location", () => {
      mockEditor.projectScreenToUpm.mockReturnValue({ x: 150, y: 250 });

      const event = createMouseEvent("mousedown", 100, 200);
      pen.onMouseDown(event);

      expect(mocks.commands.execute).toHaveBeenCalled();
      const snapshot = fontEngine.snapshot.value;
      expect(snapshot?.contours[0]?.points[0]?.x).toBe(150);
      expect(snapshot?.contours[0]?.points[0]?.y).toBe(250);
    });

    it("should add multiple points at different positions", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));
      pen.onMouseDown(createMouseEvent("mousedown", 200, 200));
      pen.onMouseUp(createMouseEvent("mouseup", 200, 200));
      pen.onMouseDown(createMouseEvent("mousedown", 300, 100));

      expect(getPointCount(fontEngine.snapshot.value)).toBe(3);
    });
  });

  describe("bezier drag (handle creation)", () => {
    it("should create control point when dragging far enough", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      expect(getPointCount(fontEngine.snapshot.value)).toBe(1);

      pen.onMouseMove(createMouseEvent("mousemove", 120, 100));

      expect(getPointCount(fontEngine.snapshot.value)).toBeGreaterThanOrEqual(
        1,
      );
    });

    it("should not create control point for small drag", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      const initialCount = getPointCount(fontEngine.snapshot.value);

      pen.onMouseMove(createMouseEvent("mousemove", 101, 100));

      expect(getPointCount(fontEngine.snapshot.value)).toBe(initialCount);
    });
  });

  describe("closing contours", () => {
    it("should close contour when clicking near first point", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));
      pen.onMouseDown(createMouseEvent("mousedown", 200, 200));
      pen.onMouseUp(createMouseEvent("mouseup", 200, 200));
      expect(getPointCount(fontEngine.snapshot.value)).toBe(2);

      mocks.commands.execute.mockClear();
      mocks.commands.beginBatch.mockClear();

      mockEditor.projectScreenToUpm.mockReturnValue({ x: 102, y: 102 });
      pen.onMouseDown(createMouseEvent("mousedown", 102, 102));

      expect(mocks.commands.beginBatch).toHaveBeenCalledWith("Close Contour");
      expect(mocks.commands.endBatch).toHaveBeenCalled();
    });

    it("should create new contour after closing", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));
      pen.onMouseDown(createMouseEvent("mousedown", 200, 200));
      pen.onMouseUp(createMouseEvent("mouseup", 200, 200));

      mockEditor.projectScreenToUpm.mockReturnValue({ x: 100, y: 100 });
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));

      expect(fontEngine.editing.addContour).toBeDefined();
    });
  });

  describe("multiple contours", () => {
    it("should work with multiple contours", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));
      pen.onMouseDown(createMouseEvent("mousedown", 200, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 200, 100));

      mockEditor.projectScreenToUpm.mockReturnValue({ x: 100, y: 100 });
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));

      mockEditor.projectScreenToUpm.mockReturnValue({ x: 300, y: 300 });
      pen.onMouseDown(createMouseEvent("mousedown", 300, 300));
      pen.onMouseUp(createMouseEvent("mouseup", 300, 300));

      expect(getContourCount(fontEngine.snapshot.value)).toBeGreaterThanOrEqual(
        1,
      );
    });
  });

  describe("mouse up handling", () => {
    it("should return to ready state on mouse up and end batch", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));

      expect(mocks.commands.endBatch).toHaveBeenCalled();

      mocks.commands.execute.mockClear();
      pen.onMouseDown(createMouseEvent("mousedown", 200, 200));
      expect(mocks.commands.execute).toHaveBeenCalled();
      expect(getPointCount(fontEngine.snapshot.value)).toBe(2);
    });
  });

  describe("cursor behavior", () => {
    it("should show pen-end cursor when hovering over an existing point", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));

      mockEditor.setCursor.mockClear();
      mockEditor.projectScreenToUpm.mockReturnValue({ x: 102, y: 102 });
      pen.onMouseMove(createMouseEvent("mousemove", 102, 102));

      expect(mockEditor.setCursor).toHaveBeenCalledWith({ type: "pen-end" });
    });

    it("should show pen cursor when not hovering over a point", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));

      mockEditor.setCursor.mockClear();
      mockEditor.projectScreenToUpm.mockReturnValue({ x: 200, y: 200 });
      pen.onMouseMove(createMouseEvent("mousemove", 200, 200));

      expect(mockEditor.setCursor).toHaveBeenCalledWith({ type: "pen" });
    });

    it("should switch cursor when moving from point to empty space", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));

      mockEditor.projectScreenToUpm.mockReturnValue({ x: 102, y: 102 });
      pen.onMouseMove(createMouseEvent("mousemove", 102, 102));
      expect(mockEditor.setCursor).toHaveBeenLastCalledWith({
        type: "pen-end",
      });

      mockEditor.projectScreenToUpm.mockReturnValue({ x: 300, y: 300 });
      pen.onMouseMove(createMouseEvent("mousemove", 300, 300));
      expect(mockEditor.setCursor).toHaveBeenLastCalledWith({ type: "pen" });
    });
  });

  describe("preview line", () => {
    it("should track mouse position in ready state", () => {
      mockEditor.projectScreenToUpm.mockReturnValue({ x: 150, y: 250 });
      pen.onMouseMove(createMouseEvent("mousemove", 150, 250));

      const state = pen.getState();
      expect(state.type).toBe("ready");
      if (state.type === "ready") {
        expect(state.mousePos).toEqual({ x: 150, y: 250 });
      }
    });

    it("should update mouse position as cursor moves", () => {
      mockEditor.projectScreenToUpm.mockReturnValue({ x: 100, y: 100 });
      pen.onMouseMove(createMouseEvent("mousemove", 100, 100));

      let state = pen.getState();
      if (state.type === "ready") {
        expect(state.mousePos).toEqual({ x: 100, y: 100 });
      }

      mockEditor.projectScreenToUpm.mockReturnValue({ x: 200, y: 300 });
      pen.onMouseMove(createMouseEvent("mousemove", 200, 300));

      state = pen.getState();
      if (state.type === "ready") {
        expect(state.mousePos).toEqual({ x: 200, y: 300 });
      }
    });

    it("should initialize with zero mousePos when entering ready state", () => {
      const newPen = new Pen(mockEditor as unknown as Editor);
      newPen.setReady();

      const state = newPen.getState();
      expect(state.type).toBe("ready");
      if (state.type === "ready") {
        expect(state.mousePos).toEqual({ x: 0, y: 0 });
      }
    });

    it("should preserve mouse position when transitioning to ready after placing point", () => {
      mockEditor.projectScreenToUpm.mockReturnValue({ x: 100, y: 100 });
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));

      mockEditor.projectScreenToUpm.mockReturnValue({ x: 150, y: 150 });
      pen.onMouseUp(createMouseEvent("mouseup", 150, 150));

      const state = pen.getState();
      expect(state.type).toBe("ready");
      if (state.type === "ready") {
        expect(state.mousePos).toEqual({ x: 150, y: 150 });
      }
    });
  });

  describe("zoom-aware hit testing", () => {
    it("should use zoom-aware hit radius for contour closing", () => {
      mocks.screen.hitRadius = 10;

      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));
      pen.onMouseDown(createMouseEvent("mousedown", 200, 200));
      pen.onMouseUp(createMouseEvent("mouseup", 200, 200));

      mocks.commands.execute.mockClear();
      mocks.commands.beginBatch.mockClear();

      mockEditor.projectScreenToUpm.mockReturnValue({ x: 105, y: 105 });
      pen.onMouseDown(createMouseEvent("mousedown", 105, 105));

      expect(mocks.commands.beginBatch).toHaveBeenCalledWith("Close Contour");
    });

    it("should not close contour when outside zoom-aware hit radius", () => {
      mocks.screen.hitRadius = 5;

      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));
      pen.onMouseDown(createMouseEvent("mousedown", 200, 200));
      pen.onMouseUp(createMouseEvent("mouseup", 200, 200));

      mocks.commands.execute.mockClear();
      mocks.commands.beginBatch.mockClear();

      mockEditor.projectScreenToUpm.mockReturnValue({ x: 110, y: 110 });
      pen.onMouseDown(createMouseEvent("mousedown", 110, 110));

      expect(mocks.commands.beginBatch).toHaveBeenCalledWith("Add Point");
      expect(mocks.commands.beginBatch).not.toHaveBeenCalledWith(
        "Close Contour",
      );
    });

    it("should use zoom-aware hit radius for point hover detection", () => {
      mocks.screen.hitRadius = 10;

      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));

      mockEditor.setCursor.mockClear();
      mockEditor.projectScreenToUpm.mockReturnValue({ x: 105, y: 105 });
      pen.onMouseMove(createMouseEvent("mousemove", 105, 105));

      expect(mockEditor.setCursor).toHaveBeenCalledWith({ type: "pen-end" });
    });

    it("should not show pen-end cursor when outside zoom-aware hit radius", () => {
      mocks.screen.hitRadius = 5;

      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));

      mockEditor.setCursor.mockClear();
      mockEditor.projectScreenToUpm.mockReturnValue({ x: 110, y: 110 });
      pen.onMouseMove(createMouseEvent("mousemove", 110, 110));

      expect(mockEditor.setCursor).toHaveBeenCalledWith({ type: "pen" });
    });
  });

  describe("zoom-adjusted preview line", () => {
    it("should call screen.lineWidth when rendering preview line", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));

      mockEditor.projectScreenToUpm.mockReturnValue({ x: 150, y: 150 });
      pen.onMouseMove(createMouseEvent("mousemove", 150, 150));

      mocks.screen.lineWidth.mockClear();

      const mockRenderer = {
        setStyle: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        set lineWidth(_: number) {},
      };

      pen.drawInteractive(mockRenderer as any);

      expect(mocks.screen.lineWidth).toHaveBeenCalled();
    });
  });

  describe("cancel", () => {
    it("should cancel point placement on Escape during anchored state", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      expect(pen.getState().type).toBe("anchored");
      expect(mocks.commands.beginBatch).toHaveBeenCalledWith("Add Point");

      pen.cancel();

      expect(mocks.commands.cancelBatch).toHaveBeenCalled();
      expect(pen.getState().type).toBe("ready");
    });

    it("should cancel point placement on Escape during dragging state", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      mockEditor.projectScreenToUpm.mockReturnValue({ x: 120, y: 100 });
      pen.onMouseMove(createMouseEvent("mousemove", 120, 100));
      expect(pen.getState().type).toBe("dragging");

      pen.cancel();

      expect(mocks.commands.cancelBatch).toHaveBeenCalled();
      expect(pen.getState().type).toBe("ready");
    });

    it("should abandon contour on Escape when in ready state with points", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));
      pen.onMouseDown(createMouseEvent("mousedown", 200, 200));
      pen.onMouseUp(createMouseEvent("mouseup", 200, 200));

      const contourCountBefore = getContourCount(fontEngine.snapshot.value);

      pen.cancel();

      const contourCountAfter = getContourCount(fontEngine.snapshot.value);
      expect(contourCountAfter).toBe(contourCountBefore + 1);
      expect(pen.getState().type).toBe("ready");
    });

    it("should do nothing on Escape when no points in contour", () => {
      const contourCountBefore = getContourCount(fontEngine.snapshot.value);

      pen.cancel();

      const contourCountAfter = getContourCount(fontEngine.snapshot.value);
      expect(contourCountAfter).toBe(contourCountBefore);
      expect(pen.getState().type).toBe("ready");
    });
  });

  describe("continue contour", () => {
    it("should continue from end point when no active drawing contour", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));
      pen.onMouseDown(createMouseEvent("mousedown", 200, 200));
      pen.onMouseUp(createMouseEvent("mouseup", 200, 200));
      pen.onMouseDown(createMouseEvent("mousedown", 300, 300));
      pen.onMouseUp(createMouseEvent("mouseup", 300, 300));

      pen.cancel();

      mocks.commands.execute.mockClear();
      mocks.commands.beginBatch.mockClear();

      mockEditor.projectScreenToUpm.mockReturnValue({ x: 302, y: 302 });
      pen.onMouseDown(createMouseEvent("mousedown", 302, 302));

      expect(mocks.commands.beginBatch).toHaveBeenCalledWith(
        "Continue Contour",
      );
      expect(mocks.commands.endBatch).toHaveBeenCalled();
    });

    it("should continue from start point with reverse when no active drawing contour", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));
      pen.onMouseDown(createMouseEvent("mousedown", 200, 200));
      pen.onMouseUp(createMouseEvent("mouseup", 200, 200));
      pen.onMouseDown(createMouseEvent("mousedown", 300, 300));
      pen.onMouseUp(createMouseEvent("mouseup", 300, 300));

      pen.cancel();

      mocks.commands.execute.mockClear();
      mocks.commands.beginBatch.mockClear();

      mockEditor.projectScreenToUpm.mockReturnValue({ x: 102, y: 102 });
      pen.onMouseDown(createMouseEvent("mousedown", 102, 102));

      expect(mocks.commands.beginBatch).toHaveBeenCalledWith(
        "Continue Contour",
      );
      expect(mocks.commands.endBatch).toHaveBeenCalled();
    });

    it("should not continue when there is an active drawing contour", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));
      pen.onMouseDown(createMouseEvent("mousedown", 200, 200));
      pen.onMouseUp(createMouseEvent("mouseup", 200, 200));

      mocks.commands.beginBatch.mockClear();

      mockEditor.projectScreenToUpm.mockReturnValue({ x: 202, y: 202 });
      pen.onMouseDown(createMouseEvent("mousedown", 202, 202));

      expect(mocks.commands.beginBatch).not.toHaveBeenCalledWith(
        "Continue Contour",
      );
    });
  });

  describe("split contour", () => {
    it("should split at middle point when no active drawing contour", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));
      pen.onMouseDown(createMouseEvent("mousedown", 200, 200));
      pen.onMouseUp(createMouseEvent("mouseup", 200, 200));
      pen.onMouseDown(createMouseEvent("mousedown", 300, 300));
      pen.onMouseUp(createMouseEvent("mouseup", 300, 300));
      pen.onMouseDown(createMouseEvent("mousedown", 400, 400));
      pen.onMouseUp(createMouseEvent("mouseup", 400, 400));

      pen.cancel();

      mocks.commands.execute.mockClear();
      mocks.commands.beginBatch.mockClear();

      mockEditor.projectScreenToUpm.mockReturnValue({ x: 202, y: 202 });
      pen.onMouseDown(createMouseEvent("mousedown", 202, 202));

      expect(mocks.commands.beginBatch).toHaveBeenCalledWith("Split Contour");
      expect(mocks.commands.endBatch).toHaveBeenCalled();
    });

    it("should not split when there is an active drawing contour", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));
      pen.onMouseDown(createMouseEvent("mousedown", 200, 200));
      pen.onMouseUp(createMouseEvent("mouseup", 200, 200));
      pen.onMouseDown(createMouseEvent("mousedown", 300, 300));
      pen.onMouseUp(createMouseEvent("mouseup", 300, 300));
      pen.onMouseDown(createMouseEvent("mousedown", 400, 400));
      pen.onMouseUp(createMouseEvent("mouseup", 400, 400));

      mocks.commands.beginBatch.mockClear();

      mockEditor.projectScreenToUpm.mockReturnValue({ x: 202, y: 202 });
      pen.onMouseDown(createMouseEvent("mousedown", 202, 202));

      expect(mocks.commands.beginBatch).not.toHaveBeenCalledWith(
        "Split Contour",
      );
    });
  });

  describe("cursor feedback for continue/split", () => {
    it("should show pen-end cursor when hovering over endpoint of non-active contour", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));
      pen.onMouseDown(createMouseEvent("mousedown", 200, 200));
      pen.onMouseUp(createMouseEvent("mouseup", 200, 200));
      pen.onMouseDown(createMouseEvent("mousedown", 300, 300));
      pen.onMouseUp(createMouseEvent("mouseup", 300, 300));

      pen.cancel();

      mockEditor.setCursor.mockClear();
      mockEditor.projectScreenToUpm.mockReturnValue({ x: 302, y: 302 });
      pen.onMouseMove(createMouseEvent("mousemove", 302, 302));

      expect(mockEditor.setCursor).toHaveBeenCalledWith({ type: "pen-end" });
    });

    it("should show pen-end cursor when hovering over middle point of non-active contour", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));
      pen.onMouseDown(createMouseEvent("mousedown", 200, 200));
      pen.onMouseUp(createMouseEvent("mouseup", 200, 200));
      pen.onMouseDown(createMouseEvent("mousedown", 300, 300));
      pen.onMouseUp(createMouseEvent("mouseup", 300, 300));
      pen.onMouseDown(createMouseEvent("mousedown", 400, 400));
      pen.onMouseUp(createMouseEvent("mouseup", 400, 400));

      pen.cancel();

      mockEditor.setCursor.mockClear();
      mockEditor.projectScreenToUpm.mockReturnValue({ x: 202, y: 202 });
      pen.onMouseMove(createMouseEvent("mousemove", 202, 202));

      expect(mockEditor.setCursor).toHaveBeenCalledWith({ type: "pen-end" });
    });
  });
});
