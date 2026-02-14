/**
 * @shift/types - Shared TypeScript types for Shift font editor
 *
 * This package contains:
 * - Auto-generated types from Rust (via ts-rs)
 * - Core mathematical types
 * - Branded ID types for type safety
 * - Font-related types and utilities
 */

// Math types
export type { Point2D, Rect2D, TransformMatrix, A, B, C, D, E, F } from "./math";

// ID types
export type { PointId, ContourId, AnchorId } from "./ids";
export {
  asPointId,
  asContourId,
  asAnchorId,
  isValidPointId,
  isValidContourId,
  isValidAnchorId,
} from "./ids";

// Font types (includes generated types)
export type {
  PointType,
  PointSnapshot,
  ContourSnapshot,
  AnchorSnapshot,
  RenderPointSnapshot,
  RenderContourSnapshot,
  GlyphSnapshot,
  CommandResult,
  RuleId,
  MatchedRule,
  FontMetadata,
  FontMetrics,
  DecomposedTransform,
} from "./font";

// Domain types (for Editor API)
export type { Point, Anchor, RenderPoint, Contour, RenderContour, Glyph } from "./font";
