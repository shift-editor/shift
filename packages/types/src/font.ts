/**
 * Font-related types
 */

// Re-export auto-generated types from Rust
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
  FontMetrics,
  FontMetadata,
  Axis,
  Location,
  Source,
} from "./generated";

// Domain types (for Editor API)
export type {
  Point,
  Anchor,
  RenderPoint,
  Contour,
  RenderContour,
  Glyph,
  DecomposedTransform,
} from "./domain";
