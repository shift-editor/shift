/**
 * Test helpers for tool testing.
 *
 * Provides mock implementations and utilities for testing tools
 * without requiring the full Editor/React context.
 */

import { vi } from "vitest";
import type { ToolContext } from "@/types/tool";
import type { PointId } from "@/types/ids";
import type { Rect2D } from "@/types/math";
import {
  createMockFontEngine,
  createTestSnapshot,
  populateEngine,
  getAllPoints,
  findPointAt,
  type TestSnapshotConfig,
} from "@/engine/testing";
import { CommandHistory } from "@/lib/commands";
import { Viewport } from "@/lib/editor/Viewport";

// Re-export for convenience
export { createTestSnapshot, getAllPoints, findPointAt };
export type { TestSnapshotConfig };

/**
 * Options for creating a mock tool context.
 */
export interface MockToolContextOptions {
  /** Initial snapshot configuration. */
  snapshot?: TestSnapshotConfig;
  /** Initial selected point IDs. */
  selectedPoints?: Set<PointId>;
  /** Initial hovered point. */
  hoveredPoint?: PointId | null;
  /** Viewport dimensions (defaults to 1000x1000). */
  viewportSize?: { width: number; height: number };
}

/**
 * Create a mock ToolContext for testing.
 * Returns both the context and tracking functions for assertions.
 */
export function createMockToolContext(options: MockToolContextOptions = {}) {
  const fontEngine = createMockFontEngine();
  const viewport = new Viewport();

  // Configure viewport with full Rect2D
  const size = options.viewportSize ?? { width: 1000, height: 1000 };
  const rect: Rect2D = {
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    left: 0,
    top: 0,
    right: size.width,
    bottom: size.height,
  };
  viewport.setRect(rect);

  // Create CommandHistory with fontEngine and snapshot getter
  const commandHistory = new CommandHistory(
    fontEngine,
    () => fontEngine.snapshot
  );

  // Populate with snapshot if provided, otherwise just start empty session
  if (options.snapshot) {
    const snapshot = createTestSnapshot(options.snapshot);
    populateEngine(fontEngine, snapshot);
  } else {
    // Start an empty edit session
    fontEngine.session.startEditSession(65);
    fontEngine.editing.addContour();
  }

  // Track state changes
  let selectedPoints = options.selectedPoints ?? new Set<PointId>();
  let hoveredPoint = options.hoveredPoint ?? null;
  let redrawCount = 0;

  const ctx: ToolContext = {
    get snapshot() {
      return fontEngine.snapshot;
    },
    get selectedPoints() {
      return selectedPoints;
    },
    get hoveredPoint() {
      return hoveredPoint;
    },
    viewport,
    mousePosition: { x: 0, y: 0 },
    fontEngine,
    commands: commandHistory,
    setSelectedPoints: vi.fn((ids: Set<PointId>) => {
      selectedPoints = ids;
    }),
    addToSelection: vi.fn((id: PointId) => {
      selectedPoints = new Set(selectedPoints);
      selectedPoints.add(id);
    }),
    clearSelection: vi.fn(() => {
      selectedPoints = new Set();
    }),
    setHoveredPoint: vi.fn((id: PointId | null) => {
      hoveredPoint = id;
    }),
    requestRedraw: vi.fn(() => {
      redrawCount++;
    }),
  };

  return {
    ctx,
    fontEngine,
    commandHistory,
    viewport,
    /** Get current selected points (for assertions). */
    getSelectedPoints: () => selectedPoints,
    /** Get current hovered point (for assertions). */
    getHoveredPoint: () => hoveredPoint,
    /** Get redraw count (for assertions). */
    getRedrawCount: () => redrawCount,
    /** Update selected points directly (for test setup). */
    setSelectedPoints: (ids: Set<PointId>) => {
      selectedPoints = ids;
    },
  };
}

/**
 * Create a mock React mouse event.
 */
export function createMouseEvent(
  type: "mousedown" | "mouseup" | "mousemove" | "dblclick",
  options: {
    clientX: number;
    clientY: number;
    button?: number;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
  }
): React.MouseEvent<HTMLCanvasElement> {
  return {
    type,
    clientX: options.clientX,
    clientY: options.clientY,
    button: options.button ?? 0,
    shiftKey: options.shiftKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent<HTMLCanvasElement>;
}

/**
 * Create a mock keyboard event.
 */
export function createKeyboardEvent(
  type: "keydown" | "keyup",
  options: {
    key: string;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
  }
): KeyboardEvent {
  return {
    type,
    key: options.key,
    shiftKey: options.shiftKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as KeyboardEvent;
}

/**
 * Simulate a click at screen coordinates.
 * Returns the mouse events for further manipulation.
 */
export function simulateClick(x: number, y: number, options?: { shiftKey?: boolean }) {
  const down = createMouseEvent("mousedown", { clientX: x, clientY: y, ...options });
  const up = createMouseEvent("mouseup", { clientX: x, clientY: y, ...options });
  return { down, up };
}

/**
 * Simulate a drag from one point to another.
 * Returns all the mouse events for the drag operation.
 */
export function simulateDrag(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  steps: number = 5
) {
  const down = createMouseEvent("mousedown", { clientX: fromX, clientY: fromY });

  const moves: React.MouseEvent<HTMLCanvasElement>[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = fromX + (toX - fromX) * t;
    const y = fromY + (toY - fromY) * t;
    moves.push(createMouseEvent("mousemove", { clientX: x, clientY: y }));
  }

  const up = createMouseEvent("mouseup", { clientX: toX, clientY: toY });

  return { down, moves, up };
}
