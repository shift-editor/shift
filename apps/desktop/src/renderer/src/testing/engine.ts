/**
 * FontEngine testing utilities.
 *
 * Provides mock implementations for testing code that depends on FontEngine
 * without requiring the Rust backend.
 */

import { vi } from "vitest";
import type {
  GlyphSnapshot,
  PointSnapshot,
  ContourSnapshot,
  PointTypeString,
} from "@/types/generated";
import { asPointId, asContourId } from "@/types/ids";
import { FontEngine, MockFontEngine } from "@/engine";

// ═══════════════════════════════════════════════════════════════════════════
// TEST FONTENGINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Test FontEngine with additional test utilities.
 *
 * Extends FontEngine with methods useful for testing:
 * - Direct snapshot manipulation
 * - Call tracking
 * - State inspection
 */
export class TestFontEngine extends FontEngine {
  private _callLog: Array<{ method: string; args: unknown[] }> = [];

  constructor() {
    super(new MockFontEngine());
  }

  /**
   * Get the call log for tracking method invocations.
   */
  get callLog(): ReadonlyArray<{ method: string; args: unknown[] }> {
    return this._callLog;
  }

  /**
   * Clear the call log.
   */
  clearCallLog(): void {
    this._callLog = [];
  }

  /**
   * Log a method call (used internally).
   */
  logCall(method: string, args: unknown[]): void {
    this._callLog.push({ method, args });
  }
}

/**
 * Create a test FontEngine instance with call logging.
 */
export function createTestFontEngine(): TestFontEngine {
  return new TestFontEngine();
}

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
export function createMockEditing() {
  let pointIdCounter = 0;
  let contourIdCounter = 0;

  return {
    addPoint: vi
      .fn()
      .mockImplementation(() => asPointId(`point-${++pointIdCounter}`)),
    addPointToContour: vi
      .fn()
      .mockImplementation(() => asPointId(`point-${++pointIdCounter}`)),
    insertPointBefore: vi
      .fn()
      .mockImplementation(() => asPointId(`point-${++pointIdCounter}`)),
    movePoints: vi.fn().mockReturnValue([]),
    movePointTo: vi.fn(),
    removePoints: vi.fn(),
    addContour: vi
      .fn()
      .mockImplementation(() => asContourId(`contour-${++contourIdCounter}`)),
    closeContour: vi.fn(),
    getActiveContourId: vi.fn().mockReturnValue(asContourId("contour-0")),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SNAPSHOT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Configuration for creating a test snapshot.
 */
export interface TestSnapshotConfig {
  /** Unicode code point (defaults to 65 = 'A'). */
  unicode?: number;
  /** Contour configurations. */
  contours?: TestContourConfig[];
  /** ID of the active contour (auto-generated if not specified). */
  activeContourId?: string;
}

/**
 * Configuration for a test contour.
 */
export interface TestContourConfig {
  /** Custom ID (auto-generated if not specified). */
  id?: string;
  /** Points in the contour. */
  points?: TestPointConfig[];
  /** Whether the contour is closed. */
  closed?: boolean;
}

/**
 * Configuration for a test point.
 */
export interface TestPointConfig {
  /** Custom ID (auto-generated if not specified). */
  id?: string;
  /** X coordinate. */
  x: number;
  /** Y coordinate. */
  y: number;
  /** Point type (defaults to 'onCurve'). */
  type?: PointTypeString;
  /** Whether the point is smooth. */
  smooth?: boolean;
}

/**
 * Create a test snapshot from configuration.
 *
 * @example
 * ```typescript
 * const snapshot = createTestSnapshot({
 *   unicode: 65,
 *   contours: [{
 *     points: [
 *       { x: 0, y: 0 },
 *       { x: 100, y: 0 },
 *       { x: 100, y: 100 },
 *     ],
 *     closed: true
 *   }]
 * });
 * ```
 */
export function createTestSnapshot(
  config: TestSnapshotConfig = {},
): GlyphSnapshot {
  let pointIdCounter = 0;
  let contourIdCounter = 0;

  const contours: ContourSnapshot[] = (config.contours ?? []).map((c) => {
    const contourId = c.id ?? `contour-${++contourIdCounter}`;
    return {
      id: contourId,
      closed: c.closed ?? false,
      points: (c.points ?? []).map((p) => ({
        id: p.id ?? `point-${++pointIdCounter}`,
        x: p.x,
        y: p.y,
        pointType: p.type ?? "onCurve",
        smooth: p.smooth ?? false,
      })),
    };
  });

  const unicode = config.unicode ?? 65;

  return {
    unicode,
    name: String.fromCodePoint(unicode),
    xAdvance: 500,
    contours,
    activeContourId:
      config.activeContourId ??
      (contours.length > 0 ? contours[contours.length - 1].id : null),
  };
}

/**
 * Populate a FontEngine with snapshot data.
 *
 * Starts an edit session and creates all contours/points from the snapshot.
 */
export function populateEngine(
  engine: FontEngine,
  snapshot: GlyphSnapshot,
): void {
  engine.session.startEditSession(snapshot.unicode);

  for (const contour of snapshot.contours) {
    engine.editing.addContour();
    for (const point of contour.points) {
      engine.editing.addPoint(point.x, point.y, point.pointType, point.smooth);
    }
    if (contour.closed) {
      engine.editing.closeContour();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SNAPSHOT QUERY HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find a point in a snapshot by approximate coordinates.
 */
export function findPointAt(
  snapshot: GlyphSnapshot | null,
  x: number,
  y: number,
  tolerance: number = 5,
): PointSnapshot | null {
  if (!snapshot) return null;

  for (const contour of snapshot.contours) {
    for (const point of contour.points) {
      const dx = point.x - x;
      const dy = point.y - y;
      if (Math.sqrt(dx * dx + dy * dy) < tolerance) {
        return point;
      }
    }
  }
  return null;
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
 * Find a point by ID in a snapshot.
 */
export function findPointById(
  snapshot: GlyphSnapshot | null,
  pointId: string,
): PointSnapshot | null {
  if (!snapshot) return null;

  for (const contour of snapshot.contours) {
    const point = contour.points.find((p) => p.id === pointId);
    if (point) return point;
  }
  return null;
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
