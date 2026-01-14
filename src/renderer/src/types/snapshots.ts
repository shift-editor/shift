/**
 * Snapshots returned from Rust to TypeScript
 * These represent the current state of the glyph for rendering
 *
 * Core types are auto-generated from Rust via ts-rs.
 * Run `cargo test --package shift-core` to regenerate.
 */

// Re-export auto-generated types from Rust
export type {
  PointTypeString,
  PointSnapshot,
  ContourSnapshot,
  GlyphSnapshot,
  CommandResult,
} from './generated';

// Import for use in helper functions
import type { PointSnapshot, ContourSnapshot, GlyphSnapshot, CommandResult } from './generated';

// ═══════════════════════════════════════════════════════════
// FONT METADATA & METRICS (not yet generated from Rust)
// ═══════════════════════════════════════════════════════════

export interface FontMetadata {
  family: string;
  styleName: string;
  version: number;
}

export interface FontMetrics {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  capHeight: number;
  xHeight: number;
}

// ═══════════════════════════════════════════════════════════
// HELPER TYPES
// ═══════════════════════════════════════════════════════════

/** Result of a successful command */
export interface SuccessResult extends CommandResult {
  success: true;
  snapshot: GlyphSnapshot;
  error?: never;
}

/** Result of a failed command */
export interface ErrorResult extends CommandResult {
  success: false;
  snapshot: null;
  error: string;
}

/** Type guard for successful results */
export function isSuccessResult(result: CommandResult): result is SuccessResult {
  return result.success && result.snapshot !== null;
}

/** Type guard for error results */
export function isErrorResult(result: CommandResult): result is ErrorResult {
  return !result.success;
}

// ═══════════════════════════════════════════════════════════
// CONVERSION HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * Creates an empty glyph snapshot for initialization
 */
export function createEmptyGlyphSnapshot(unicode: number): GlyphSnapshot {
  return {
    unicode,
    name: '',
    xAdvance: 500,
    contours: [],
    activeContourId: null,
  };
}

/**
 * Finds a point by ID across all contours
 */
export function findPointInSnapshot(
  snapshot: GlyphSnapshot,
  pointId: string
): PointSnapshot | undefined {
  for (const contour of snapshot.contours) {
    const point = contour.points.find((p) => p.id === pointId);
    if (point) return point;
  }
  return undefined;
}

/**
 * Finds a contour by ID
 */
export function findContourInSnapshot(
  snapshot: GlyphSnapshot,
  contourId: string
): ContourSnapshot | undefined {
  return snapshot.contours.find((c) => c.id === contourId);
}

/**
 * Gets all point IDs from a snapshot
 */
export function getAllPointIds(snapshot: GlyphSnapshot): string[] {
  return snapshot.contours.flatMap((c) => c.points.map((p) => p.id));
}
