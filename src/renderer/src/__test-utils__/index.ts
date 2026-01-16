/**
 * Test utilities for the Shift font editor.
 *
 * This module provides all testing utilities in one place.
 * Import from `@/__test-utils__` instead of scattered locations.
 *
 * ## Quick Reference
 *
 * ### For Testing Commands
 * ```typescript
 * import { createMockCommandContext } from '@/__test-utils__';
 *
 * const ctx = createMockCommandContext();
 * cmd.execute(ctx);
 * expect(ctx.fontEngine.editing.addPoint).toHaveBeenCalled();
 * ```
 *
 * ### For Testing Tools
 * ```typescript
 * import { createMockToolContext, createMouseEvent, getPointCount } from '@/__test-utils__';
 *
 * const { ctx, fontEngine } = createMockToolContext();
 * tool.onMouseDown(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));
 * expect(getPointCount(fontEngine.snapshot.value)).toBe(1);
 * ```
 *
 * ### For Creating Test Data
 * ```typescript
 * import { createTestSnapshot, createMockFontEngine, populateEngine } from '@/__test-utils__';
 *
 * const snapshot = createTestSnapshot({
 *   contours: [{ points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], closed: true }]
 * });
 * ```
 */

// ═══════════════════════════════════════════════════════════════════════════
// ENGINE UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

export {
  // FontEngine factories
  TestFontEngine,
  createTestFontEngine,
  createMockFontEngine,

  // Mock editing operations
  createMockEditing,

  // Snapshot creation
  createTestSnapshot,
  populateEngine,
  type TestSnapshotConfig,
  type TestContourConfig,
  type TestPointConfig,

  // Snapshot queries
  findPointAt,
  findPointById,
  getAllPoints,
  getPointCount,
  getContourCount,
} from "./engine";

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

export {
  // Command context
  createMockCommandContext,

  // Tool context
  createMockToolContext,
  type MockToolContextOptions,
} from "./context";

// ═══════════════════════════════════════════════════════════════════════════
// EVENT UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

export {
  // Event factories
  createMouseEvent,
  createKeyboardEvent,

  // Interaction helpers
  simulateClick,
  simulateDrag,
} from "./events";
