/**
 * Test utilities for the Shift font editor.
 *
 * This module provides all testing utilities in one place.
 * Import from `@/testing` instead of scattered locations.
 *
 * ## Quick Reference
 *
 * ### For Testing Commands
 * ```typescript
 * import { createMockCommandContext } from '@/testing';
 *
 * const ctx = createMockCommandContext();
 * cmd.execute(ctx);
 * expect(ctx.fontEngine.editing.addPoint).toHaveBeenCalled();
 * ```
 *
 * ### For Testing Tools
 * ```typescript
 * import { createMockToolContext, createMouseEvent, getPointCount } from '@/testing';
 *
 * const { ctx, fontEngine } = createMockToolContext();
 * tool.onMouseDown(createMouseEvent('mousedown', { clientX: 100, clientY: 100 }));
 * expect(getPointCount(fontEngine.$glyph.value)).toBe(1);
 * ```
 *
 * ### For Creating Test Data
 * ```typescript
 * import { createTestSnapshot, createMockFontEngine, populateEngine } from '@/testing';
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
  createMockFontEngine,

  // Mock editing operations
  createMockEditing,
  getAllPoints,
  getPointCount,
  getContourCount,
} from "./engine";

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

export { createMockCommandContext, type MockToolContextOptions } from "./context";

// ═══════════════════════════════════════════════════════════════════════════
// TOOL CONTEXT UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

export {
  createMockToolContext,
  createToolMouseEvent,
  ToolEventSimulator,
  makeTestCoordinates,
  makeTestCoordinatesFromScene,
  makeTestCoordinatesFromGlyphLocal,
  type MockToolContext,
  type ToolMouseEvent,
  type ToolEventTarget,
} from "./services";
