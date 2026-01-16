/**
 * Context mocks for testing.
 *
 * Provides mock implementations of CommandContext and ToolContext
 * for testing commands and tools in isolation.
 */

import { vi } from "vitest";
import type { ToolContext } from "@/types/tool";
import type { PointId } from "@/types/ids";
import type { Rect2D } from "@/types/math";
import type { GlyphSnapshot } from "@/types/generated";
import type { CommandContext } from "@/lib/commands/Command";
import { CommandHistory } from "@/lib/commands";
import { Viewport } from "@/lib/editor/Viewport";
import {
  createMockFontEngine,
  createMockEditing,
  createTestSnapshot,
  populateEngine,
  type TestSnapshotConfig,
} from "./engine";

// ═══════════════════════════════════════════════════════════════════════════
// COMMAND CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a mock CommandContext for testing commands.
 *
 * Uses createMockEditing() to provide vi.fn() mocks for all editing methods,
 * making it easy to verify command behavior.
 *
 * @example
 * ```typescript
 * import { createMockCommandContext } from '@/testing';
 *
 * it('should add point', () => {
 *   const ctx = createMockCommandContext();
 *   const cmd = new AddPointCommand(100, 200, 'onCurve');
 *   cmd.execute(ctx);
 *   expect(ctx.fontEngine.editing.addPoint).toHaveBeenCalledWith(100, 200, 'onCurve', false);
 * });
 * ```
 */
export function createMockCommandContext(snapshot: GlyphSnapshot | null = null): CommandContext {
  return {
    fontEngine: {
      editing: createMockEditing(),
    } as any,
    snapshot,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

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
 * Create a mock ToolContext for testing tools.
 *
 * Returns both the context and tracking functions for assertions.
 *
 * @example
 * ```typescript
 * import { createMockToolContext, createMouseEvent } from '@/testing';
 *
 * it('should select point on click', () => {
 *   const { ctx, getSelectedPoints } = createMockToolContext({
 *     snapshot: { contours: [{ points: [{ x: 100, y: 100 }] }] }
 *   });
 *
 *   tool.onMouseDown(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));
 *   expect(getSelectedPoints().size).toBe(1);
 * });
 * ```
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
    () => fontEngine.snapshot.value
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
      return fontEngine.snapshot.value;
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
