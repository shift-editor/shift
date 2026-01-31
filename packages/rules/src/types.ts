import type { PointId, ContourId, PointSnapshot, ContourSnapshot, GlyphSnapshot } from "@shift/types";

/**
 * Rule identifiers matching the Rust implementation
 */
export type RuleId =
  | "moveRightHandle"
  | "moveLeftHandle"
  | "moveBothHandles"
  | "maintainTangencyRight"
  | "maintainTangencyLeft";

/**
 * A matched rule with affected points
 */
export interface MatchedRule {
  pointId: PointId;
  ruleId: RuleId;
  description: string;
  pattern: string;
  affectedPointIds: PointId[];
}

/**
 * A point move operation
 */
export interface PointMove {
  id: PointId;
  x: number;
  y: number;
}

/**
 * Result of applying rules to a selection
 */
export interface RulesResult {
  /** All point moves to apply (selected + affected by rules) */
  moves: PointMove[];
  /** Rules that were matched */
  matchedRules: MatchedRule[];
}

/**
 * Internal rule definition
 */
export interface Rule {
  id: RuleId;
  patternTemplate: string;
  description: string;
}
