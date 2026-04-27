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
  GlyphGeometry,
  MasterSnapshot,
  InterpolationResult,
  SourceError,
  AxisTent,
  GlyphVariationData,
  CommandResult,
  RuleId,
  MatchedRule,
  FontMetrics,
  FontMetadata,
  Axis,
  Component,
  GlyphData,
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
  CompositeComponent,
  CompositeGlyph,
  AxisLocation,
  Source,
} from "./domain";
