/**
 * Font-related types
 */

// Re-export auto-generated types from Rust
export type {
  PointType,
  PointSnapshot,
  ContourSnapshot,
  GlyphSnapshot,
  CommandResult,
  RuleId,
  MatchedRule,
  FontMetrics,
  FontMetadata,
} from "./generated";

// Domain types (for Editor API)
export type { Point, Contour, Glyph, DecomposedTransform } from "./domain";
