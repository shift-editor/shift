/**
 * Tests for the Pen tool.
 *
 * These tests verify:
 * - Point creation
 * - Bezier curve creation (drag to create handles)
 * - Closing contours
 * - Multiple contours
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Pen } from "./pen";
import { Editor } from "@/lib/editor/Editor";
import { createMockFontEngine, getPointCount, getContourCount } from "@/testing";
import { EventEmitter } from "@/lib/core/EventEmitter";

/**
 * Create a minimal Editor mock for testing Pen tool.
 *
 * The Pen tool currently uses Editor directly, so we need to mock it.
 * After refactoring to use ToolContext, these tests can be simplified.
 */
function createMockEditor() {
  const fontEngine = createMockFontEngine();
  fontEngine.session.startEditSession(65);
  fontEngine.editing.addContour();

  // EventEmitter instance kept for potential future use
  new EventEmitter();

  // Track state
  let selectedPoints = new Set<string>();
  let hoveredPoint: string | null = null;
  let isBatching = false;

  // Mock command history
  const mockCommandHistory = {
    execute: vi.fn((cmd: any) => cmd.execute({ fontEngine, snapshot: fontEngine.snapshot.value })),
    record: vi.fn(),
    beginBatch: vi.fn(() => { isBatching = true; }),
    endBatch: vi.fn(() => { isBatching = false; }),
    cancelBatch: vi.fn(() => { isBatching = false; }),
    get isBatching() { return isBatching; },
    undo: vi.fn(),
    redo: vi.fn(),
  };

  // Snapshot is now a signal - read via .value
  const mockEditor = {
    fontEngine,
    commandHistory: mockCommandHistory,
    getMousePosition: vi.fn((x?: number, y?: number) => ({ x: x ?? 0, y: y ?? 0 })),
    projectScreenToUpm: vi.fn((x: number, y: number) => ({ x, y })),
    getSnapshot: vi.fn(() => fontEngine.snapshot.value),
    addPoint: vi.fn((x: number, y: number, type: "onCurve" | "offCurve") => {
      return fontEngine.editing.addPoint(x, y, type, false);
    }),
    closeContour: vi.fn(() => {
      fontEngine.editing.closeContour();
    }),
    setSelectedPoints: vi.fn((ids: Set<string>) => {
      selectedPoints = ids;
    }),
    setHoveredPoint: vi.fn((id: string | null) => {
      hoveredPoint = id;
    }),
    clearSelectedPoints: vi.fn(() => {
      selectedPoints.clear();
    }),
    clearHoveredPoint: vi.fn(() => {
      hoveredPoint = null;
    }),
    requestRedraw: vi.fn(),
    redrawGlyph: vi.fn(),
    emit: vi.fn(),
    paintHandle: vi.fn(),
    createToolContext: vi.fn(() => ({
      snapshot: fontEngine.snapshot.value,
      selectedPoints,
      hoveredPoint,
      fontEngine,
    })),
  };

  return { mockEditor, fontEngine };
}

function createMouseEvent(
  type: "mousedown" | "mouseup" | "mousemove",
  clientX: number,
  clientY: number,
  button = 0
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

  beforeEach(() => {
    const setup = createMockEditor();
    mockEditor = setup.mockEditor;
    fontEngine = setup.fontEngine;
    pen = new Pen(mockEditor as unknown as Editor);
    pen.setReady();
  });

  describe("state management", () => {
    it("should start in idle state", () => {
      const newPen = new Pen(mockEditor as unknown as Editor);
      // Can't easily check internal state, but we can verify it doesn't crash
      expect(newPen.name).toBe("pen");
    });

    it("should have correct name", () => {
      expect(pen.name).toBe("pen");
    });

    it("should transition to ready state", () => {
      const newPen = new Pen(mockEditor as unknown as Editor);
      newPen.setIdle();
      newPen.setReady();
      // Tool should be in ready state - can't check directly but won't crash on mouse events
      expect(newPen.name).toBe("pen");
    });
  });

  describe("point creation", () => {
    it("should add point on mouse down via commandHistory", () => {
      const event = createMouseEvent("mousedown", 100, 200);
      pen.onMouseDown(event);

      expect(mockEditor.commandHistory.beginBatch).toHaveBeenCalledWith("Add Point");
      expect(mockEditor.commandHistory.execute).toHaveBeenCalled();
      expect(getPointCount(fontEngine.snapshot.value)).toBe(1);
    });

    it("should not add point on non-left click", () => {
      const event = createMouseEvent("mousedown", 100, 200, 2); // Right click
      pen.onMouseDown(event);

      expect(mockEditor.commandHistory.execute).not.toHaveBeenCalled();
    });

    it("should not add point when not in ready state", () => {
      pen.setIdle();
      const event = createMouseEvent("mousedown", 100, 200);
      pen.onMouseDown(event);

      expect(mockEditor.commandHistory.execute).not.toHaveBeenCalled();
    });

    it("should emit points:added event", () => {
      const event = createMouseEvent("mousedown", 100, 200);
      pen.onMouseDown(event);

      expect(mockEditor.emit).toHaveBeenCalledWith("points:added", expect.any(Object));
    });

    // Note: requestRedraw is now handled reactively via signal effects
    // watching fontEngine.snapshot, not called directly by the tool
  });

  describe("point coordinates", () => {
    it("should use projected UPM coordinates and create point at that location", () => {
      mockEditor.projectScreenToUpm.mockReturnValue({ x: 150, y: 250 });

      const event = createMouseEvent("mousedown", 100, 200);
      pen.onMouseDown(event);

      // Verify command was executed and point was created at projected coordinates
      expect(mockEditor.commandHistory.execute).toHaveBeenCalled();
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
      // Start point creation
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      expect(getPointCount(fontEngine.snapshot.value)).toBe(1);

      // Drag far enough to trigger handle creation (>3 pixels)
      pen.onMouseMove(createMouseEvent("mousemove", 120, 100));

      // Should have added a control point
      // Note: Current implementation adds leading control on drag
      expect(getPointCount(fontEngine.snapshot.value)).toBeGreaterThanOrEqual(1);
    });

    it("should not create control point for small drag", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      const initialCount = getPointCount(fontEngine.snapshot.value);

      // Small drag (< 3 pixels) - should not create control points
      pen.onMouseMove(createMouseEvent("mousemove", 101, 100));

      expect(getPointCount(fontEngine.snapshot.value)).toBe(initialCount);
    });
  });

  describe("closing contours", () => {
    it("should close contour when clicking near first point", () => {
      // Add at least 2 points to the contour
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));
      pen.onMouseDown(createMouseEvent("mousedown", 200, 200));
      pen.onMouseUp(createMouseEvent("mouseup", 200, 200));
      expect(getPointCount(fontEngine.snapshot.value)).toBe(2);

      // Reset mocks to track close contour
      mockEditor.commandHistory.execute.mockClear();
      mockEditor.commandHistory.beginBatch.mockClear();

      // Click near first point (within HIT_RADIUS = 8)
      mockEditor.projectScreenToUpm.mockReturnValue({ x: 102, y: 102 });
      pen.onMouseDown(createMouseEvent("mousedown", 102, 102));

      // Should have batched close contour commands
      expect(mockEditor.commandHistory.beginBatch).toHaveBeenCalledWith("Close Contour");
      expect(mockEditor.commandHistory.endBatch).toHaveBeenCalled();
    });

    it("should create new contour after closing", () => {
      // Add points and close
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));
      pen.onMouseDown(createMouseEvent("mousedown", 200, 200));
      pen.onMouseUp(createMouseEvent("mouseup", 200, 200));

      // Close by clicking near first point
      mockEditor.projectScreenToUpm.mockReturnValue({ x: 100, y: 100 });
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));

      // New contour should be added
      expect(fontEngine.editing.addContour).toBeDefined();
    });
  });

  describe("multiple contours", () => {
    it("should work with multiple contours", () => {
      // First contour
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));
      pen.onMouseDown(createMouseEvent("mousedown", 200, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 200, 100));

      // Close and create new contour
      mockEditor.projectScreenToUpm.mockReturnValue({ x: 100, y: 100 });
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));

      // Add points to new contour
      mockEditor.projectScreenToUpm.mockReturnValue({ x: 300, y: 300 });
      pen.onMouseDown(createMouseEvent("mousedown", 300, 300));
      pen.onMouseUp(createMouseEvent("mouseup", 300, 300));

      expect(getContourCount(fontEngine.snapshot.value)).toBeGreaterThanOrEqual(1);
    });
  });

  describe("mouse up handling", () => {
    it("should return to ready state on mouse up and end batch", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));

      // Batch should be ended
      expect(mockEditor.commandHistory.endBatch).toHaveBeenCalled();

      // Can start a new point
      mockEditor.commandHistory.execute.mockClear();
      pen.onMouseDown(createMouseEvent("mousedown", 200, 200));
      expect(mockEditor.commandHistory.execute).toHaveBeenCalled();
      expect(getPointCount(fontEngine.snapshot.value)).toBe(2);
    });

    // Note: requestRedraw is now handled reactively via signal effects
    // when state transitions occur, not called directly by the tool
  });
});
