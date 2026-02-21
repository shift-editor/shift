/**
 * FontEngine testing utilities.
 *
 * Provides mock implementations for testing code that depends on FontEngine
 * without requiring the Rust backend.
 */

import { vi } from "vitest";
import type { GlyphSnapshot, PointSnapshot } from "@shift/types";
import { asPointId, asContourId } from "@shift/types";
import { FontEngine, MockFontEngine } from "@/engine";
import type { CommandEditingAPI } from "@/lib/commands/core/Command";

/**
 * Create a mock FontEngine for testing.
 * This is a simple wrapper around MockFontEngine.
 */
export function createMockFontEngine(): FontEngine {
  return new FontEngine(new MockFontEngine());
}

// ═══════════════════════════════════════════════════════════════════════════
// MOCK EDITING OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create mock editing operations for testing commands.
 *
 * Returns vi.fn() mocks for each editing method with sensible defaults:
 * - `addPoint`, `addPointToContour`, `insertPointBefore` return auto-incrementing point IDs
 * - `addContour` returns auto-incrementing contour IDs
 * - `getActiveContourId` returns "contour-0"
 * - Other methods are simple mocks
 *
 * Use this when testing Command classes that need to verify editing method calls.
 *
 * @example
 * ```typescript
 * import { createMockEditing, createMockCommandContext } from '@/testing';
 *
 * it('should add point', () => {
 *   const ctx = createMockCommandContext();
 *   const cmd = new AddPointCommand(100, 200, 'onCurve');
 *   cmd.execute(ctx);
 *   expect(ctx.fontEngine.editing.addPoint).toHaveBeenCalledWith(100, 200, 'onCurve', false);
 * });
 * ```
 */
export function createMockEditing(): CommandEditingAPI {
  let pointIdCounter = 0;
  let contourIdCounter = 0;

  return {
    addPoint: vi.fn().mockImplementation(() => asPointId(`point-${++pointIdCounter}`)),
    addPointToContour: vi.fn().mockImplementation(() => asPointId(`point-${++pointIdCounter}`)),
    insertPointBefore: vi.fn().mockImplementation(() => asPointId(`point-${++pointIdCounter}`)),
    movePoints: vi.fn().mockReturnValue([]),
    movePointTo: vi.fn(),
    setXAdvance: vi.fn(),
    translateLayer: vi.fn(),
    removePoints: vi.fn(),
    addContour: vi.fn().mockImplementation(() => asContourId(`contour-${++contourIdCounter}`)),
    removeContour: vi.fn(),
    closeContour: vi.fn(),
    openContour: vi.fn(),
    getActiveContourId: vi.fn().mockReturnValue(asContourId("contour-0")),
    setActiveContour: vi.fn(),
    reverseContour: vi.fn(),
    restoreSnapshot: vi.fn(),
    pasteContours: vi.fn().mockReturnValue({
      success: true,
      createdPointIds: [],
      createdContourIds: [],
      error: null,
    }),
  };
}

/**
 * Get all points from a snapshot as a flat array.
 */
export function getAllPoints(snapshot: GlyphSnapshot | null): PointSnapshot[] {
  if (!snapshot) return [];
  const result: PointSnapshot[] = [];
  for (const contour of snapshot.contours) {
    result.push(...contour.points);
  }
  return result;
}

/**
 * Get point count across all contours.
 */
export function getPointCount(snapshot: GlyphSnapshot | null): number {
  if (!snapshot) return 0;
  return snapshot.contours.reduce((sum, c) => sum + c.points.length, 0);
}

/**
 * Get contour count.
 */
export function getContourCount(snapshot: GlyphSnapshot | null): number {
  if (!snapshot) return 0;
  return snapshot.contours.length;
}
