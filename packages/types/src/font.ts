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
} from "./generated";

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
