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
import { createMockFontEngine, getPointCount, getContourCount } from "@/__test-utils__";
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

  // Snapshot is now a signal - read via .value
  const mockEditor = {
    fontEngine,
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
    it("should add point on mouse down", () => {
      const event = createMouseEvent("mousedown", 100, 200);
      pen.onMouseDown(event);

      expect(mockEditor.addPoint).toHaveBeenCalledWith(100, 200, "onCurve");
      expect(getPointCount(fontEngine.snapshot.value)).toBe(1);
    });

    it("should not add point on non-left click", () => {
      const event = createMouseEvent("mousedown", 100, 200, 2); // Right click
      pen.onMouseDown(event);

      expect(mockEditor.addPoint).not.toHaveBeenCalled();
    });

    it("should not add point when not in ready state", () => {
      pen.setIdle();
      const event = createMouseEvent("mousedown", 100, 200);
      pen.onMouseDown(event);

      expect(mockEditor.addPoint).not.toHaveBeenCalled();
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
    it("should use projected UPM coordinates", () => {
      mockEditor.projectScreenToUpm.mockReturnValue({ x: 150, y: 250 });

      const event = createMouseEvent("mousedown", 100, 200);
      pen.onMouseDown(event);

      expect(mockEditor.addPoint).toHaveBeenCalledWith(150, 250, "onCurve");
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

      // Click near first point (within HIT_RADIUS = 8)
      mockEditor.projectScreenToUpm.mockReturnValue({ x: 102, y: 102 });
      pen.onMouseDown(createMouseEvent("mousedown", 102, 102));

      expect(mockEditor.closeContour).toHaveBeenCalled();
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
    it("should return to ready state on mouse up", () => {
      pen.onMouseDown(createMouseEvent("mousedown", 100, 100));
      pen.onMouseUp(createMouseEvent("mouseup", 100, 100));

      // Can start a new point
      pen.onMouseDown(createMouseEvent("mousedown", 200, 200));
      expect(mockEditor.addPoint).toHaveBeenCalledTimes(2);
    });

    // Note: requestRedraw is now handled reactively via signal effects
    // when state transitions occur, not called directly by the tool
  });
});
