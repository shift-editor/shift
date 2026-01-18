/**
 * Font-related types
 */

// Re-export auto-generated types from Rust
export type {
  PointTypeString,
  PointSnapshot,
  ContourSnapshot,
  GlyphSnapshot,
  CommandResult,
  RuleId,
  MatchedRule,
} from './generated';

// Import for use in helper functions
import type { PointSnapshot, ContourSnapshot, GlyphSnapshot } from './generated';

/**
 * Font metadata returned from the native API
 */
export interface FontMetadata {
  family: string;
  styleName: string;
  version: number;
}

/**
 * Font metrics used for rendering
 */
export interface FontMetrics {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  capHeight: number;
  xHeight: number;
}

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
